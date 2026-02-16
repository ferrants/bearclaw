# Security

BearClaw treats security as a core architectural concern. The security model is defense-in-depth: multiple independent layers that each provide protection, so a failure in one layer doesn't compromise the system.

## Security Layers

```
┌──────────────────────────────────────────────┐
│  Policy Engine (rule-based allow/deny)       │
├──────────────────────────────────────────────┤
│  Security Policy (paths, commands, autonomy) │
├──────────────────────────────────────────────┤
│  Rate Limiting (sliding window, scoped)      │
├──────────────────────────────────────────────┤
│  SSRF Guard (DNS pinning, private IP block)  │
├──────────────────────────────────────────────┤
│  Encrypted Secrets (ChaCha20-Poly1305)       │
├──────────────────────────────────────────────┤
│  Pairing Auth (CSPRNG, lockout, tokens)      │
└──────────────────────────────────────────────┘
```

## SecurityPolicy

The `SecurityPolicy` class (`src/security/policy.ts`) enforces three kinds of checks:

### Path Validation

Every file operation is checked before execution:

1. **Null byte check** — Rejects paths containing `\0`
2. **Upward escape** — Rejects paths that normalize to start with `..`
3. **Workspace-only** — When enabled, rejects absolute paths
4. **Forbidden paths** — Checks against the forbidden path list using path-separator-delimited prefix matching (not substring matching)
5. **Symlink resolution** — After initial checks pass, the resolved (real) path is verified to still be within the workspace

```
User input: "../../../etc/passwd"
  → normalize: "../../etc/passwd" starts with ".." → BLOCKED

User input: "/etc/shadow"
  → workspaceOnly=true, absolute path → BLOCKED

User input: "data/notes.txt"
  → normalize: "data/notes.txt" ✓
  → resolve: "/home/user/.bearclaw/workspace/data/notes.txt" ✓
  → not in forbidden paths ✓
  → realpath matches workspace prefix ✓ → ALLOWED
```

### Command Validation

Shell commands go through a multi-step validation:

1. **Autonomy check** — `readonly` blocks all commands, `full` allows all
2. **Subshell blocking** — Rejects backticks, `$(`, `${`
3. **Redirect blocking** — Rejects `>`
4. **Command splitting** — Splits on `&&`, `||`, `;`, `|`, newlines
5. **Per-command checks**:
   - Skip env assignments (e.g., `FOO=bar command`)
   - Extract base command (strip path prefix)
   - Check restricted commands first (allowed but with blocked args)
   - Check against allowlist

### Allowed Commands

Default allowlist:
```
git, npm, npx, node, cargo, go, python, python3, pip,
ls, cat, grep, find, echo, pwd, wc, head, tail,
sort, uniq, diff, date, which, mkdir, cp, mv, touch, chmod
```

Intentionally excluded: `curl`, `wget`, `env` (security sensitive).

### Restricted Commands

Some commands are allowed but with argument restrictions:

| Command | Blocked Arguments |
|---|---|
| `curl` | `-o`, `--output`, `-O`, `-T`, `--upload-file` |
| `wget` | `-O`, `--output-document` |
| `tee` | `*` (entirely blocked in supervised mode) |

### Forbidden Paths

Default forbidden paths:
```
/etc, /root, /boot, /dev, /proc, /sys, /var,
/bin, /sbin, /lib, /usr, /opt, /tmp,
~/.ssh, ~/.gnupg, ~/.aws, ~/.config/gcloud
```

Tilde (`~`) paths are expanded to the user's home directory.

## PolicyEngine

The `PolicyEngine` (`src/security/policy-engine.ts`) provides rule-based access control, registered as the first before-hook on every tool call.

### Rule Evaluation

1. Collect all rules that match the current tool call (by scope + match conditions)
2. If any `deny` rule matches → **deny** (deny always takes precedence)
3. Else the first matching rule determines the action (`allow` or `approve`)
4. If no rule matches → use `defaultAction` (default: `approve`)

### Policy Rules

```json
{
  "policy": {
    "rules": [
      {
        "id": "allow-git",
        "action": "allow",
        "scope": "exec",
        "match": {
          "command": "git *"
        }
      },
      {
        "id": "deny-rm-rf",
        "action": "deny",
        "scope": "exec",
        "match": {
          "commandRegex": "rm\\s+-rf"
        }
      },
      {
        "id": "block-social-media",
        "action": "deny",
        "scope": "web",
        "match": {
          "urlDomain": "*.twitter.com"
        }
      }
    ]
  }
}
```

### Rule Match Fields

| Field | Description |
|---|---|
| `toolName` | Exact tool name (e.g., `"exec"`, `"read_file"`) |
| `command` | Glob pattern for command (e.g., `"git *"`) |
| `commandRegex` | Regex pattern for command |
| `argsRegex` | Regex pattern for arguments |
| `pathPattern` | Glob pattern for file paths |
| `urlDomain` | Glob pattern for URL domains |
| `channel` | Restrict to specific channel |
| `agentId` | Restrict to specific agent |

### Policy Scopes

| Scope | Applies To |
|---|---|
| `tool` | General tool calls |
| `exec` | Shell command execution |
| `web` | Web fetch operations |
| `cli_delegation` | CLI delegation provider calls |
| `message` | Cross-channel messaging |

### Learning Mode

The `learningMode` setting controls how BearClaw handles unapproved tool calls:

- **`suggest_rules`** (default) — Logs candidate rules to `~/.bearclaw/policy-suggestions.json` after approvals
- **`auto_allow_prompt`** — Prompts the user to auto-allow similar future calls
- **`auto_allow`** — Automatically creates allow rules after approval

## Inline Allows

Users can grant temporary permissions directly in their messages:

```
[allow: once exec git status] Can you check the git status?
[allow: day read_file ./docs/**/*.md] Read all the docs for me
```

| Scope | Duration |
|---|---|
| `once` | Single use, consumed immediately |
| `day` | Valid for `dayScopeHours` (default: 24 hours) |

Inline allow tags are stripped from the message before it reaches the LLM. Wildcard patterns use glob-style matching.

## Approval Manager

The `ApprovalManager` (`src/security/approvals.ts`) caches approval decisions:

| Scope | Description |
|---|---|
| `user+channel` | Approval valid for this user on this channel |
| `conversation` | Approval valid for this conversation only |
| `global` | Approval valid system-wide |

Approvals have a configurable TTL (default: 300 seconds).

## Rate Limiting

BearClaw uses sliding window rate limiting at three levels:

1. **Global** — Total actions per hour across all agents (default: 20)
2. **Per-agent** — Actions per hour for each agent (optional)
3. **Per-tool-class** — Actions per hour for each tool category (optional)

The sliding window algorithm prunes expired timestamps and checks the count against the limit. This prevents one noisy agent from exhausting the global limit and blocking all others.

```json
{
  "security": {
    "rateLimits": {
      "global": 50,
      "perAgent": 20,
      "perToolClass": {
        "exec": 15,
        "web": 10
      }
    }
  }
}
```

## Encrypted Secrets

API keys and bot tokens are encrypted at rest using ChaCha20-Poly1305 AEAD via `@noble/ciphers` (pure JavaScript, no native dependencies).

### How It Works

1. On first startup, a 256-bit secret key is generated and saved to `~/.bearclaw/.secret_key` with 0600 permissions
2. Each encryption generates a random 12-byte nonce
3. The encrypted format is `enc2:` followed by hex-encoded `nonce + ciphertext + auth_tag`
4. On startup, plaintext values in the config are automatically encrypted and the config is rewritten

### What Gets Encrypted

- `providers.anthropic.apiKey`
- `providers.openai.apiKey`
- `channels.telegram.botToken`

### Manual Handling

You never need to manually encrypt values. Just put the plaintext key in your config and start BearClaw — it handles the rest.

## SSRF Guard

The SSRF guard (`src/security/ssrf.ts`) protects the `web_fetch` tool from accessing internal network resources:

### Blocked IP Ranges

| Range | Description |
|---|---|
| `10.0.0.0/8` | Private (RFC 1918) |
| `172.16.0.0/12` | Private (RFC 1918) |
| `192.168.0.0/16` | Private (RFC 1918) |
| `127.0.0.0/8` | Loopback |
| `169.254.0.0/16` | Link-local |
| `0.0.0.0/8` | Current network |
| `100.64.0.0/10` | CGNAT (RFC 6598) |
| `198.18.0.0/15` | Benchmarking (RFC 2544) |
| `224.0.0.0/4` | Multicast |
| `240.0.0.0/4` | Reserved |
| `::1` | IPv6 loopback |
| `fe80::/10` | IPv6 link-local |
| `fc00::/7` | IPv6 ULA |

### DNS Pinning

The guard resolves hostnames to IP addresses and checks the resolved IP, preventing DNS rebinding attacks. Cloud metadata endpoints (e.g., `169.254.169.254`, `metadata.google.internal`) are explicitly blocked.

### Additional CIDR Blocking

The policy engine's `web.blockedCidrs` config allows blocking additional CIDR ranges beyond the defaults.

## Pairing Authentication

The gateway uses a pairing flow for authentication (see [Gateway](gateway.md)):

1. **Code generation** — 6-digit CSPRNG codes with rejection sampling (no modulo bias)
2. **Verification** — SHA-256 hashed codes compared with `timingSafeEqual` (constant-time)
3. **Token issuance** — Random bearer tokens for subsequent requests
4. **Lockout** — After 5 failed attempts, 5-minute lockout
5. **Persistence** — Paired tokens encrypted via SecretStore and saved to `~/.bearclaw/paired-tokens.json`
