# Security Audit: BearClaw

**Date:** 2026-02-15 (updated post-remediation)
**Version:** 0.1.0

---

## Audit History

This is a second-pass audit performed after remediation of all findings from the initial review. The original audit identified 11 issues (7 vulnerabilities, 4 architectural concerns). All have been addressed. This document reflects the current state of the codebase.

---

## What's Done Well

The project has a genuinely thoughtful security model with multiple layers of defense. Specific highlights:

- **Per-agent security isolation**: Each agent directory gets its own `SecurityPolicy`, `PolicyEngine`, and `InlineAllowStore` instances. Agent configs cannot weaken instance-level security — `forbiddenPaths` are unioned, `rateLimits` are capped by instance ceiling, `autonomy` takes the more restrictive level, and `allowedPaths` are filtered to the agent's directory tree. This means a cloned/shared agent config cannot escalate privileges beyond what the instance allows.
- **Encryption**: ChaCha20-Poly1305 via `@noble/ciphers` with random nonces, `.secret_key` file at `0o600`, automatic encrypt-on-startup. Config file now also written at `0o600`.
- **Pairing**: CSPRNG with rejection sampling (no modulo bias), constant-time comparison via SHA-256 + `timingSafeEqual`, brute-force lockout after 5 attempts.
- **SSRF guard**: DNS resolved once, connection made directly to the validated IP via `node:http`/`node:https` with `Host` header and TLS `servername` for SNI. Prevents DNS rebinding. Blocks private IPs, link-local, metadata endpoints, CGN ranges, multicast.
- **Path validation**: Both `read-file` and `write-file` perform raw path checks AND `realpath()` symlink resolution. Session paths are sanitized against traversal.
- **Gateway**: Refuses non-loopback bind by default, body size limits, pairing required by default, JSON parse errors return 400.
- **Command execution**: Blocks backticks, `$()`, `${}`, `<()`, `>()`, `<<`, `<<<`, and output redirection. Default allowlist excludes interpreters (`node`, `python`, `npm`, `npx`).
- **PolicyEngine active in both modes**: CLI and daemon both register the PolicyEngine as a before-hook. CLI mode prompts for approval interactively.
- **Telegram allowFrom**: Matches both numeric user ID and username.
- **Only 2 runtime dependencies**: Small attack surface.

---

## Remaining Issues

### Severity: Medium

#### 1. Daemon auto-approves when policy says "approve"

**Location:** `src/daemon.ts:150-164`

When the PolicyEngine returns `action: "approve"` in daemon mode, the before-hook checks inline allows, then falls through to `{ proceed: true }`. Unlike CLI mode (which now prompts the user), the daemon has no interactive approval mechanism, so `"approve"` effectively means `"allow"`. This is documented in a comment (`// Otherwise need manual approval (for now, auto-approve in daemon mode)`) but means the three-tier policy model (`allow`/`approve`/`deny`) collapses to two tiers in daemon mode.

This is a design gap, not a bug — the daemon can't prompt interactively. A future fix could implement approval via Telegram inline keyboards or gateway webhooks.

#### 2. Command parsing differential with `sh`

**Location:** `src/security/policy.ts:89-96`, `src/tools/builtin/exec.ts:60`

The policy splits commands on `&&`, `||`, `;`, `|`, `\n` and validates each segment. But compound commands are passed to `sh -c`, which has its own parser. While all known bypass vectors (`$()`, backticks, `<()`, `<<<`, `<<`, `>`) are now explicitly blocked before the split step, the fundamental approach — parsing a command string in two different places — remains fragile. Novel shell syntax or obscure bash features could still create a differential.

The safest long-term approach would be to never pass to `sh -c` at all, or to use a shell-parsing library. The current blocklist is reasonably comprehensive for common shells.

#### 3. `edit-file` and `list-dir` don't check resolved paths

**Location:** `src/tools/builtin/edit-file.ts:33`, `src/tools/builtin/list-dir.ts:25`

Both tools call `isPathAllowed()` (raw string check) but not `isResolvedPathAllowed()` (symlink resolution). `read-file` and `write-file` both do the full check. The same symlink-escape pattern applies: if a symlink exists in the workspace pointing outside it, `edit-file` would follow it.

The risk is lower than for `write-file` because `edit-file` requires the file to already exist with specific content (the `old_string` match), and `list-dir` is read-only. But for consistency and defense-in-depth, both should do the resolved path check.

#### 4. `search` tool doesn't check resolved paths

**Location:** `src/tools/builtin/search.ts:40`

Same pattern as above. `search` calls `isPathAllowed()` but not `isResolvedPathAllowed()`. It recursively reads files, so a symlink in the workspace pointing to, say, `/home/user/.aws/credentials` would let the LLM read those contents through search results.

#### 5. Inline allows from Telegram users bypass approval

**Location:** `src/security/inline-allow.ts`, `src/daemon.ts:226`

A Telegram user can include `[allow:day exec]` in their message to grant the agent `exec` permission for 24 hours. This is by design for CLI use (the operator is the user), but in daemon/Telegram mode, the "user" is a remote person sending messages — they shouldn't be able to grant security permissions. The inline allow store is shared across all channels.

#### 6. `go` and `cargo` on the default allowlist can execute arbitrary code

**Location:** `src/config/defaults.ts:2`

`go run malicious.go` and `cargo run` both compile and execute code. This is the same class of issue as the now-removed `node`/`python` entries, though somewhat less exploitable since they require source files rather than inline `-e` flags. `cargo` can also run build scripts. `go generate` runs arbitrary commands.

### Severity: Low

#### 7. Rate limiter is per-process, not persistent

**Location:** `src/security/rate-limiter.ts`

Restarting the process resets all rate limits. For the daemon this is mostly fine (it's long-running). For CLI mode it's meaningless — each invocation gets a fresh budget.

#### 8. No HTTPS on the gateway

**Location:** `src/gateway/server.ts`

The HTTP gateway is plain HTTP. Fine for the default localhost binding. If someone sets `allowPublicBind: true`, pairing tokens and bearer tokens transit in cleartext. The gateway already refuses non-loopback by default, which mitigates this.

#### 9. CLI delegation passes `--dangerously-skip-permissions`

**Location:** `src/providers/cli-delegation.ts:47-50`

The CLI delegation provider hardcodes `--dangerously-skip-permissions` for Claude and `--dangerously-bypass-approvals-and-sandbox` for Codex. This is inherent to how delegation works (the sub-CLI needs to run non-interactively), but it means BearClaw's security model is completely bypassed when using this provider. There's already a log warning for this.

#### 10. `web-fetch` content-type detection is heuristic

**Location:** `src/tools/builtin/web-fetch.ts:45-48`

The previous implementation used the `Content-Type` response header. The new implementation (using `node:http` directly) lost access to the header in the current code path and falls back to checking if the body starts with `<!` or `<html`. This could miss HTML pages that start with a BOM, XML declaration, or whitespace. Low practical impact since `stripHtml` is a cosmetic transformation, not a security boundary.

#### 11. `deepMerge` doesn't filter `constructor` key

**Location:** `src/config/config.ts:149-165`

`Object.keys(source)` excludes `__proto__` but includes `constructor`. A config file with `{"constructor": {...}}` could merge into the config object. Practical risk is near-zero since the config comes from a local file the user controls, and the merged result is used as a typed object.

---

## Additional Notes

- **No input sanitization on LLM output to Telegram** — agent responses go directly to `sendMessage`. Telegram markdown injection is possible but low-risk (cosmetic, no code execution).
- **Session files are not encrypted** — conversation history (which may contain sensitive data the user discussed) is stored as plaintext JSON. The config file gets encryption; sessions do not. In agent-dir mode, sessions are stored per-agent in `{agentDir}/.bearclaw/sessions/`.
- **No token revocation on the gateway** — once a pairing token is issued, it's valid forever. There's no expiry or revocation mechanism. An attacker who obtains a token has permanent access until the `paired-tokens.json` file is manually deleted.
- **Agent config trust boundary** — agent `bearclaw.jsonc` files are treated as semi-trusted. The merge logic prevents privilege escalation, but a malicious agent config could still attempt to reference MCP servers or system prompt files that exfiltrate data. Instance-level `forbiddenPaths` provides some protection here.
- **Sub-agents not externally addressable** — WS clients can only target primary agents (those registered in `AgentRegistry`). Sub-agents defined in `bearclaw.jsonc` `subagents` are only reachable via the `spawn` tool from within the parent agent's loop.

---

## Previously Fixed (from initial audit)

These items were identified in the first audit pass and have been remediated:

| # | Issue | Fix |
|---|-------|-----|
| 1 | TOCTOU DNS rebinding in SSRF guard | `web-fetch` now connects to the resolved IP via `node:http`/`node:https` with `Host` header and TLS SNI |
| 2 | `write-file` missing symlink check | Added `isResolvedPathAllowed()` check |
| 3 | `node`/`python`/`npm`/`npx` on default allowlist | Removed from `ALLOWED_COMMANDS` |
| 4 | Missing `<()`, `<<<`, `<<` in shell blocklist | Added to `isCommandAllowed()` |
| 5 | Session path traversal via `chatId` | Path segments sanitized with `sanitizePathSegment()` |
| 6 | Gateway JSON parse errors return 500 | Extracted `parseJson()` helper, returns 400 |
| 7 | Telegram `allowFrom` only checked numeric ID | Now checks both `msg.from.id` and `msg.from.username` |
| 8 | CLI mode skipped PolicyEngine | CLI now registers PolicyEngine as before-hook |
| 9 | CLI "supervised" mode never prompted | CLI now prompts via readline for approval |
| 10 | `config.json` written world-readable | `saveConfig()` now writes with `mode: 0o600` |

---

## Summary

The codebase is in significantly better shape after the first round of fixes. The most critical vulnerabilities (DNS rebinding, symlink escape on write, interpreter commands on the allowlist) have been addressed. The remaining issues are:

- **Medium-risk items (1-6)** that should be addressed before production use, particularly the `edit-file`/`list-dir`/`search` symlink gaps (items 3-4) and the inline-allow-from-Telegram issue (item 5).
- **Low-risk items (7-11)** that represent design trade-offs or minor gaps.

The overall architecture is sound. The defense-in-depth model (SecurityPolicy + PolicyEngine + rate limiter + per-tool checks) provides meaningful layered protection. The main areas for continued hardening are: closing the remaining symlink check gaps, adding daemon-mode approval workflows, and considering whether `go`/`cargo` belong on the default allowlist.
