# BearClaw Architecture Review — Questions & Concerns

Review of `plans/ARCHITECTURE.md` across security, utility, agentic flow, usability, extensibility, tool use, visibility, skills, and integrations.

---

## Security

### Strengths
- Defense-in-depth: path validation (raw + resolved/symlink), command allowlisting, SSRF guard with DNS pinning, rate limiting, encrypted secrets, pairing auth with constant-time comparison
- Deny-precedence in PolicyEngine is the correct default
- ChaCha20-Poly1305 AEAD is a solid modern choice; rejection sampling for pairing codes eliminates modulo bias
- Double path check (raw path then resolved/realpath) catches symlink escapes

### Concerns

1. **`isCommandAllowed` has bypass vectors.** Blocking `>` catches redirects, but `tee` is not blocked and can write files. `curl -o` and `wget -O` can also write arbitrary content. The allowlist includes both `curl` and `wget` — these are effectively unrestricted write primitives. Either remove them from the default allowlist or add argument-level inspection.

2. **`isPathAllowed` `forbiddenPaths` check uses naive `startsWith`.** `/tmp` being forbidden means `/tmpdata/safe` is also blocked. Use `resolved.startsWith(forbidden + path.sep) || resolved === forbidden` like the workspace check does. Also, rejecting any path containing `..` means `./valid/../valid/file.txt` is rejected even though it's benign.

3. **`env` command is in the allowed list.** This leaks all environment variables, potentially including decrypted secrets passed to child processes. Consider removing it or filtering output.

4. **Rate limiter is global, not per-agent or per-tool.** A noisy agent doing `read_file` 20 times locks out `exec` for all agents for an hour. Consider per-scope or per-tool-class rate limits.

5. **`PairingGuard` state is in-memory only.** A daemon restart clears all tokens — every paired client is immediately deauthenticated with no recovery path. Tokens should be persisted to disk (encrypted).

6. **SSRF `isPrivateIP` uses prefix matching, not CIDR math.** `172.16.` catches `172.16.x.x` but the actual RFC 1918 range is `172.16.0.0/12` (172.16–172.31). A request to `172.20.1.1` would not match `172.16.` — this is a real SSRF hole. Needs proper CIDR parsing for the 172.16/12 range.

7. **No secret rotation mechanism.** If `.secret_key` is compromised, there's no way to re-encrypt existing config values with a new key.

8. **`exec` tool spawns `sh -c` with the full command string** after allowlist check. The allowlist checks the base command name, but complex shell metacharacters beyond what's blocked could still be an issue. Consider spawning commands directly (not via `sh -c`) when possible, or using a stricter parser.

---

## Agentic Flow

### Strengths
- Agent loop pattern (chat → hooks → tools → loop) is clean and well-structured
- Fan-out/aggregation via pending counter is a proven pattern from TinyClaw
- Mention-based inter-agent communication (`[@agent: message]`) is intuitive

### Concerns

9. **No streaming support in the agent loop.** The loop awaits the full LLM response before proceeding. For long responses or user-facing channels, this means no incremental output. `onUpdate` exists in `ToolContext` but there's no equivalent for LLM token streaming.

10. **Tool calls are executed sequentially** (`for...of` over `response.toolCalls`). Many LLMs return multiple independent tool calls that could run in parallel. This is a meaningful latency penalty for multi-tool turns.

11. **No agent-to-agent direct communication outside mention tags.** Agents can only talk to teammates through response text parsing. No shared state, no blackboard, no direct bus messages between agents. This limits coordination to strictly hierarchical leader-delegate flows.

12. **CLI delegation loses all tool call information.** The provider returns `toolCalls: []` always. The orchestrator has no visibility into what the delegated CLI actually did — no audit trail, no policy enforcement on inner actions. Significant observability and security gap.

13. **No error recovery or retry in the agent loop.** If a provider call fails (network error, rate limit, 500), the loop throws. No backoff, no retry, no graceful degradation to a different provider.

14. **`maxIterations` of 25 with no cost/token budget.** An agent could burn through substantial API costs in a single turn. Consider adding a token budget in addition to iteration count.

---

## Usability

### Strengths
- CLI REPL + Telegram as MVP channels is pragmatic
- `@agent` and `@team` prefix routing is intuitive
- Inline allow tags are a nice UX for granting permissions in-flow
- `bearclaw policy status` gives visibility into active permissions

### Concerns

15. **No `bearclaw init` or guided setup flow.** Users must manually create `~/.bearclaw/config.json` with the correct schema. A first-run wizard or `bearclaw init` would significantly improve onboarding.

16. **Config is a single monolithic JSON file.** Agent definitions, team configs, policy rules, and provider keys all in one file will grow unwieldy. Consider splitting into `config.json`, `agents.json`, `policy.json`, or supporting `~/.bearclaw/conf.d/`.

17. **No way to list available agents/teams from the CLI.** Users need to know agent IDs to route messages but there's no `bearclaw agents list` or `bearclaw teams list` command.

18. **Approval UX for non-CLI channels is undefined.** The doc says approvals can happen "via CLI prompt or channel UI (e.g. Telegram buttons)" but there's no implementation detail — no inline keyboard markup, no callback handling.

19. **No help or usage output for the CLI REPL.** A user typing `help` or `?` in the REPL has no documented handler.

---

## Extensibility

### Strengths
- ToolRegistry pattern makes adding new tools straightforward
- Hook system (before/after) is the right abstraction for cross-cutting concerns
- Provider abstraction is clean; adding a new LLM provider is well-defined

### Concerns

20. **No plugin/extension system.** Tools are all `builtin/`. No mechanism for loading external tools from npm packages, local directories, or remote registries.

21. **No dynamic tool registration.** Tools are registered at startup. No way for an agent to discover or load tools at runtime based on context.

22. **Channel interface isn't documented.** `src/channels/types.ts` is listed but never shown. Without the channel contract, it's unclear how to add new channels (Discord, Slack, Matrix, etc.).

23. **No event system beyond hooks.** Hooks are tool-scoped. No general event bus for lifecycle events (agent started, conversation ended, memory updated, etc.) that extensions could subscribe to.

---

## Tool Use

### Strengths
- ToolResult visibility model (ForLLM/ForUser/Silent/Async) is excellent
- JSON Schema validation before execution is correct
- AbortSignal threading through the entire chain is good practice

### Concerns

24. **No `search` or `grep` tool.** For a coding agent, `read_file` and `list_dir` aren't enough. Agents need to search file contents. Critical missing built-in.

25. **`web_download` streams to workspace with no content scanning.** An agent could download and store arbitrary binaries. At minimum, enforce file size limits and consider MIME type restrictions.

26. **`spawn` tool (subagent) has no documented interface.** Listed in the directory but never defined. How does a spawned subagent communicate results back? Does it share the parent's tool registry? Policy?

27. **`message` tool (cross-channel send) is also undocumented.** Can an agent send messages to arbitrary channels? What prevents spamming? Policy rules cover `exec` and `web` scopes but there's no `message` scope in `PolicyScope`.

28. **No file size limits on `read_file` or `write_file`.** An agent could read a 500MB file into memory or write one, crashing the process.

---

## Visibility / Observability

### Concerns

29. **Logging is mentioned but never detailed.** What gets logged? Tool calls? Policy decisions? LLM requests/responses? Token usage? Without structured logging of the agent loop, debugging multi-agent conversations will be very difficult.

30. **No metrics or telemetry.** No token usage tracking, no cost estimation, no tool execution timing, no conversation duration tracking. The `monitoring` config only has `heartbeatInterval`.

31. **No conversation history viewer.** Sessions are persisted (`src/agent/session.ts`) but there's no way to inspect them — no `bearclaw history` command, no log viewer.

32. **`after_tool_call` hooks are fire-and-forget with no await.** If after-hooks do logging or persistence, they could be lost on process exit. At minimum, track pending after-hooks and flush on shutdown.

---

## Skills & Integrations (MCP and non-MCP)

This is the biggest gap in the architecture.

### Concerns

33. **No MCP (Model Context Protocol) support at all.** Major omission for a 2026 agent framework. MCP is the emerging standard for tool interop — Claude, Cursor, Windsurf, and other agent hosts all support it. BearClaw should be both an **MCP client** (connecting to external MCP servers to discover and use their tools) and optionally an **MCP server** (exposing its own tools to other agents). The `ToolRegistry` could map MCP tool definitions naturally, but there's zero mention of MCP anywhere.

34. **No skill/workflow system.** No concept of higher-level skills (sequences of tool calls, reusable workflows, prompt templates). Claude Code has skills; BearClaw agents have no equivalent — they can only use raw tools.

35. **No integration points for external services beyond Telegram.** No webhooks, no OAuth flows, no API key management for third-party services. `web_request` is generic HTTP but there's no structured way to add authenticated integrations (GitHub, Jira, Slack, databases, etc.).

36. **No tool discovery or marketplace.** No way for agents to discover what tools are available beyond what's hardcoded at startup.

37. **CLI delegation is the only "integration" pattern**, and it's coarse-grained — shells out to `claude` or `codex` with `--dangerously-skip-permissions`. No structured way to compose with other agent frameworks or services.

---

## Priority Summary

### Must fix before implementation
- **#6** — SSRF 172.16/12 CIDR bug (actual security vulnerability)
- **#24** — Add `search`/`grep` tool (agents can't function without it)
- **#26** — Define `spawn` tool interface (core to multi-agent)
- **#33** — Add MCP client support (table stakes for 2026 agent interop)

### Should fix
- **#1, #3** — `curl`/`wget`/`tee`/`env` in default allowlist
- **#5** — Persist pairing tokens
- **#10** — Parallel tool execution
- **#20** — Plugin/extension loading
- **#27** — Add `PolicyScope` for `message` tool
- **#9** — Streaming support in agent loop
- **#38** — Divided memory with namespace-aware loading
- **#40** — Cron scheduler (enables heartbeat + recurring tasks)
- **#41** — Crash recovery journal

### Nice to have
- **#16** — Config splitting
- **#15** — `bearclaw init` wizard
- **#14** — Token budget
- **#30** — Metrics/telemetry
- **#34** — Skill/workflow system
- **#39** — Sub-agent success criteria + batch spawn
- **#42** — Content-aware model escalation
- **#43** — Tiny heartbeat (depends on #40)
- **#44** — Skill routing logic + learning

---

## Resolutions

Concrete fixes for each concern, organized into implementation bundles mapped to the existing phase order. Decisions: custom lightweight MCP (no SDK dependency), full plugin extensibility (tools + hooks + channels), `ARCHITECTURE.md` left untouched as the original plan.

---

### Bundle D: Security Hardening (#1, #2, #3, #6, #8) — Phase 1

All must be resolved before Phase 1 is considered complete.

**#6 — SSRF CIDR Fix (CRITICAL)**
- File: `src/security/ssrf.ts`
- Replace `PRIVATE_RANGES` prefix matching with proper CIDR math: `parseIpv4ToUint32()` + bitmask comparison
- Correct ranges: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.0/8`, `169.254.0.0/16`, `0.0.0.0/8`
- Add missing: `100.64.0.0/10` (CGNAT), `198.18.0.0/15` (benchmarking), `224.0.0.0/4` (multicast), `240.0.0.0/4` (reserved)
- Add IPv6 ULA detection (`fc`/`fd` prefixes)
- Export `matchesCidr()` for PolicyEngine `blockedCidrs` config
- Tests: `172.17.0.1`–`172.31.255.255` blocked, `172.15.255.255` allowed, `172.32.0.1` allowed, `100.64.0.1` blocked

**#1 — Command Allowlist Bypass**
- Files: `src/config/defaults.ts`, `src/security/policy.ts`
- Remove `curl`, `wget` from `ALLOWED_COMMANDS`
- Add `RESTRICTED_COMMANDS` map with argument-level blocklists: `curl` blocks `-o`/`--output`/`-O`/`-T`; `wget` blocks `-O`/`--output-document`; `tee` blocked entirely in supervised mode
- Extend `isCommandAllowed()` to inspect args for restricted commands

**#2 — `forbiddenPaths` Prefix Matching**
- File: `src/security/policy.ts`
- Change `startsWith(forbidden)` → `resolved === forbidden || resolved.startsWith(forbidden + path.sep)`
- Replace blanket `rawPath.includes('..')` with `path.normalize()` then check if normalized starts with `..`

**#3 — Remove `env` from Allowlist**
- File: `src/config/defaults.ts` — remove `env` from `ALLOWED_COMMANDS`

**#8 — Direct Spawn for Simple Commands**
- File: `src/tools/builtin/exec.ts`
- `isSimpleCommand()`: true if no `|`, `&&`, `||`, `;`, newlines
- Simple: `spawn(cmd, args, ...)` directly. Complex: `spawn('sh', ['-c', command], ...)` as before

---

### Phase 1 Additions: Foundation Infrastructure

**#4 — Scoped Rate Limiter**
- File: `src/security/rate-limiter.ts`
- `ScopedRateLimiter` wrapping per-key `SlidingWindowRateLimiter` instances
- Scopes: global, per-agent, per-tool-class
- Config: `security.rateLimits.{global,perAgent,perToolClass}`
- Backward compatible: falls back to single global limiter if no scoped config

**#23 — Event Bus**
- New file: `src/events.ts`
- Typed `EventBus` with events: `agent:started`, `agent:stopped`, `conversation:created`, `conversation:completed`, `tool:executed`, `policy:decision`, `provider:error`, `memory:updated`
- Plugins, hooks, logging, and metrics all subscribe to this

**#29 — Structured Logging**
- File: `src/logging.ts`
- `createLogger(subsystem)` → `{ debug, info, warn, error }` emitting JSON to stderr
- After-hook logs all tool executions; PolicyEngine logs all decisions; EventBus subscriber logs lifecycle events

---

### Phase 2 Additions: Providers

**#9 — Streaming Support**
- File: `src/providers/types.ts` — add `onToken?: (token: string) => void` to `ChatOptions`
- Each provider: SSE parsing when `onToken` provided (Anthropic/OpenAI: `stream: true`, Ollama: native)
- Agent loop passes `onToken` from context through to provider

**#13 — Retry with Backoff**
- File: `src/agent/loop.ts`
- `callProviderWithRetry()`: exponential backoff (1s→2s→4s), max 3 retries
- `isRetryable()`: 429, 500, 502, 503, network errors
- All providers: add `resp.ok` checking with status code in thrown error

**#12 — CLI Delegation Observability**
- File: `src/providers/cli-delegation.ts`
- Structured log warning that delegated tool calls are unauditable
- Startup warning if any agent uses `cli-delegation` provider

---

### Phase 3 Additions: Tool System

**#24 — Search/Grep Tool**
- New file: `src/tools/builtin/search.ts`
- Parameters: `pattern`, `path`, `literal`, `glob`, `caseSensitive`, `maxResults` (default 100, cap 500), `contextLines`
- Recursive walk, skip binary files (null byte in first 8KB), skip >10MB, skip `.git`/`node_modules`
- Same double path validation as `read_file`

**#28 — File Size Limits**
- `src/config/defaults.ts`: `READ_FILE_MAX_SIZE = 10MB`, `WRITE_FILE_MAX_SIZE = 10MB`
- `read-file.ts`: `fs.stat()` before read. `write-file.ts`: `Buffer.byteLength()` check before write

**#25 — Download Limits**
- File: `src/tools/builtin/web-download.ts`
- `MAX_DOWNLOAD_SIZE = 50MB`; `BLOCKED_EXTENSIONS = [.exe, .bat, .cmd, .sh, .ps1, .msi, .dll, .so, .dylib]`
- Check Content-Length + streaming byte count

**#27 — Message Tool + PolicyScope**
- `src/config/schema.ts`: add `"message"` to `PolicyScope`
- New file: `src/tools/builtin/message.ts` — publishes to outbound bus, policy-gated
- Default rule: `approve` for all message scope

**#32 — After-Hook Flush**
- File: `src/tools/hooks.ts`
- Track `pendingAfterHooks: Promise[]`, add `flush(timeoutMs)` method
- Daemon shutdown calls `hooks.flush()` before exit

---

### Phase 3b: MCP Client — Custom Lightweight ✅ IMPLEMENTED

**#33 — MCP Support**
- Directory: `src/mcp/`
- No SDK dependency — implements MCP JSON-RPC 2.0 directly over stdio + HTTP Streamable
- Both transports implement the `McpTransport` interface

| File | Purpose |
|---|---|
| `src/mcp/client.ts` | `McpTransport` interface + `McpClient` (stdio transport): spawns subprocess, newline-delimited JSON-RPC over stdin/stdout |
| `src/mcp/http-client.ts` | `McpHttpClient` (HTTP Streamable transport): POST JSON-RPC to URL, handles JSON + SSE responses, `Mcp-Session-Id` tracking, 404 session-expiry auto-retry |
| `src/mcp/tool.ts` | `createMcpTools()` wraps MCP tools as BearClaw `Tool` instances; registers into `ToolRegistry` |
| `src/mcp/index.ts` | Re-exports `McpClient`, `McpHttpClient`, `McpTransport`, `createMcpTools` |

Config (`McpServerConfig`):
- `command?: string` — command to spawn (stdio transport)
- `args?: string[]` — arguments for the command
- `env?: Record<string, string>` — environment variables (supports `${VAR}` expansion)
- `url?: string` — endpoint URL (HTTP Streamable transport)
- `headers?: Record<string, string>` — custom headers, e.g. `Authorization` (supports `${VAR}` expansion)
- `timeout?: number` — request timeout in ms (default 30000)

A config must have either `command` (stdio) or `url` (HTTP). Transport selection is automatic in `agent-runtime-factory.ts`.

```jsonc
{
  "mcp": {
    "servers": {
      "stripe": {
        "url": "https://mcp.stripe.com",
        "headers": { "Authorization": "Bearer ${STRIPE_API_KEY}" }
      },
      "chrome-devtools": {
        "command": "npx",
        "args": ["chrome-devtools-mcp@latest", "--autoConnect"]
      }
    }
  }
}
```

Flow: startup → `createAgentRuntime()` iterates `mcp.servers` → creates `McpHttpClient` or `McpClient` per config → `start()` sends `initialize` + `notifications/initialized` → `createMcpTools()` calls `tools/list` → wraps each as BearClaw `Tool` → registers into `ToolRegistry`. Tool calls send `tools/call`. Policy hooks enforce same rules as builtins.

---

### Phase 3c (NEW): Plugin System

**#20 — Plugin/Extension Loading**
- New directory: `src/plugins/`

| File | Purpose |
|---|---|
| `src/plugins/types.ts` | `BearClawPluginManifest`, `BearClawPluginModule`, `PluginContext`, `PluginActivationResult` |
| `src/plugins/loader.ts` | Scan dirs, load `bearclaw.plugin.json` manifests, `import()` main, call `activate()` |

- Manifest: `bearclaw.plugin.json` with `id`, `name`, `version`, `main`, `type`, `configSchema`
- Module contract: `activate(ctx) → { tools?, beforeHooks?, afterHooks?, channels? }` + optional `deactivate()`
- Full extensibility: plugins can register tools, before/after hooks, AND new channel types (e.g., Discord plugin registers a `discord` channel implementing the `Channel` interface)
- Config: `plugins.dirs` (default `["~/.bearclaw/plugins"]`), `plugins.configs` (per-plugin), `plugins.disabled` (blocklist)
- Complementary to MCP: MCP auto-discovers tools from external servers; plugins are local packages with richer integration (hooks, channels)

---

### Phase 4 Additions: Agent Loop

**#10 — Parallel Tool Execution**
- File: `src/agent/loop.ts`
- Replace `for...of` with `Promise.all()` over tool calls
- Append results in original order (LLMs expect ordered results)

**#14 — Token Budget**
- Add `maxTotalTokens?: number` to `AgentLoopConfig`
- Accumulate `response.usage` across iterations, break if exceeded

**#26 — Spawn Tool**
- New file: `src/tools/builtin/spawn.ts`
- Subagents cannot spawn (spawn excluded from child registry) — prevents runaway cost
- Policy/hooks inherited from parent — same enforcement
- `maxIterations` default 10, capped at parent's value
- Abort signal propagated parent → child; shared workspace
- `ToolContext` expansion: add `toolRegistry`, `hooks`, `provider`, `currentAgentConfig`, `agentConfigs`, `parentMaxIterations`

---

### Phase 4b (NEW): Skills System

**#34 — Skills**
- New directory: `src/skills/`

| File | Purpose |
|---|---|
| `src/skills/types.ts` | `SkillDefinition`, `SkillMatch` |
| `src/skills/loader.ts` | Parse markdown with YAML frontmatter |
| `src/skills/registry.ts` | `SkillRegistry`: match triggers (exact for `/slash`, fuzzy for keywords) |
| `src/skills/builtin/` | Built-in: `code-review.md`, `refactor.md`, `test-writer.md` |

- Skill format: YAML frontmatter (`name`, `description`, `tools[]`, `triggers[]`) + markdown body as prompt template
- When matched, skill prompt injected into system prompt, only skill's required tools enabled
- Config: `skills.dirs` (default `["~/.bearclaw/skills"]`), `skills.builtinEnabled` (default true)

---

### Phase 5 Additions: Channels

**#22 — Channel Interface**
- File: `src/channels/types.ts`
- `Channel` interface: `start(bus, approvalPrompt)`, `send(msg)`, `stop()`, `isRunning()`

**#18 — Telegram Approval UX**
- File: `src/channels/telegram.ts` — inline keyboard: Approve / Deny / Allow-for-day
- File: `src/security/approvals.ts` — pluggable `ApprovalPrompt` interface that channels implement

**#19 — REPL Help**
- File: `src/channels/cli.ts`
- Handle: `help`/`?`, `agents`, `teams`, `skills`, `policy`, `quit`/`exit`

---

### Phase 6 Addition: Orchestration

**#11 — Blackboard for Agent Communication**
- New file: `src/orchestrator/blackboard.ts` — per-conversation key-value store (`write`, `read`, `readAll`, `list`)
- New file: `src/tools/builtin/blackboard.ts` — `blackboard_read` and `blackboard_write` tools (only in team conversations)
- Spawned subagents can also access the conversation blackboard

---

### Phase 8 Additions

**#5 — Persist Pairing Tokens**
- File: `src/security/pairing.ts`
- Save tokens to `~/.bearclaw/paired-tokens.json` (encrypted via SecretStore), load on startup

**MCP Server Mode**
- File: `src/mcp/server.ts` — expose BearClaw tools via MCP JSON-RPC (stdio or SSE)

---

### Phase 9 Additions: CLI Commands + Polish

| Concern | File | What |
|---|---|---|
| #15 | `src/cli/init.ts` | `bearclaw init` — guided setup wizard |
| #16 | `src/config/config.ts` | Support `~/.bearclaw/conf.d/*.json` overlay merge |
| #17 | `src/cli/list.ts` | `bearclaw agents`, `bearclaw teams` |
| #7 | `src/cli/secrets.ts` | `bearclaw secrets rotate` — decrypt with old key, gen new, re-encrypt |
| #30 | `src/monitoring/metrics.ts` | Counter + histogram metrics, snapshot at heartbeat |
| #31 | `src/cli/history.ts` | `bearclaw history` — list/view persisted sessions |
| #36 | `src/cli/plugins.ts` | `bearclaw plugins list` — show builtin/MCP/plugin tools |

---

### OpenClaw Tips: Operational Patterns (#38–#44)

Sourced from `plans/OPENCLAW_TIPS.md`. These address how agents actually operate at runtime — memory loading, crash recovery, scheduling, model selection, and skill intelligence. Each maps to an existing phase.

**#38 — Divided Memory with Namespace-Aware Loading**
- Files: `src/memory/types.ts`, `src/memory/sqlite.ts`, `src/agent/context.ts`
- Add memory **namespaces**: `active-tasks`, `lessons`, `projects`, `daily-log`, `skills` (beyond the existing flat `category` field)
- Context assembly loads **tiered**: always inject `active-tasks` namespace, load others only when relevant via hybrid search query
- Add `memory_write` tool with required `namespace` param, and `memory_recall` tool that accepts optional `namespace` scope
- Auto-archival: daily-log entries older than `archiveDays` get summarized and merged into `lessons` namespace
- Config addition to `memory`: `namespaces: string[]` (default: `["active-tasks", "lessons", "projects", "daily-log", "skills"]`), `alwaysLoad: string[]` (default: `["active-tasks"]`)
- Phase: 7 (Memory)

**#39 — Sub-agents with Success Criteria and Parallel Batch Spawn**
- File: `src/tools/builtin/spawn.ts` (extends #26)
- Add `successCriteria: string` field to spawn args — describes what "done" looks like
- Subagent system prompt includes: `"Your task is complete when: {successCriteria}. State whether you met the criteria and summarize what you did."`
- Subagent result includes `{ response, metCriteria: boolean, summary }` — self-assessed
- Parent receives structured result, can decide to retry or escalate if `metCriteria: false`
- Add `spawn_batch` tool (or `tasks` array param on `spawn`): accepts multiple task descriptions, runs them concurrently via `Promise.all`, collects all results
- Each batch member gets its own session, abort signal, and iteration cap
- Phase: 4 (Agent Loop, alongside spawn tool)

**#40 — Cron Scheduler**
- New directory: `src/scheduler/`
- `src/scheduler/types.ts` — `ScheduledTask { id, cron, agentId, task, channel?, enabled? }`
- `src/scheduler/cron-parser.ts` — Lightweight cron expression parser (minute, hour, day-of-month, month, day-of-week)
- `src/scheduler/scheduler.ts` — Evaluates cron expressions against current time, publishes matching tasks to the message bus as inbound messages
- Each cron job runs in its own **fresh session** — no conversation history bleed, isolated context (exactly per the tip)
- Config addition: `scheduler.tasks: Record<string, { cron, agentId, task, channel?, enabled? }>`
- Example config:
  ```json
  {
    "scheduler": {
      "tasks": {
        "morning-research": { "cron": "0 6 * * *", "agentId": "researcher", "task": "Check tech news and summarize top 5 items" },
        "nightly-cleanup": { "cron": "0 2 * * *", "agentId": "default", "task": "Archive old sessions, prune stale memory entries" }
      }
    }
  }
  ```
- Daemon (`src/daemon.ts`) starts the scheduler alongside bus + channels
- Phase: 5 (alongside Bus + Channels, since scheduler publishes to the bus)

**#41 — Crash Recovery via Task Journal**
- New directory: `src/recovery/`
- `src/recovery/journal.ts` — Write-ahead journal at `~/.bearclaw/journal.json`
  - Before starting a task: write `{ taskId, agentId, prompt, status: 'started', startedAt, spawned: [] }`
  - On subagent spawn: append session key to `spawned[]`
  - On completion: update `status: 'completed'`
  - On error: update `status: 'failed'` with error message
- Daemon startup (`src/daemon.ts`): check journal for `status: 'started'` entries → these are incomplete from a crash
  - For each incomplete entry: either resume (re-publish to bus with context "Resuming interrupted task: {prompt}") or notify user on the original channel
- Integrates with #38 (divided memory): `active-tasks` namespace in memory mirrors the journal for agent-side awareness
- Phase: 9 (Entry Points, since it hooks into daemon startup)

**#42 — Content-Aware Model Escalation**
- Files: `src/security/policy.ts`, `src/agent/loop.ts`
- New config: `security.modelEscalation: { enabled: boolean, externalContentModel: string, internalModel: string }`
- Agent loop tracks a `hasExternalContent` flag per iteration
- After a tool that fetches external content (`web_fetch`, `web_request`, `web_download`) returns, set `hasExternalContent = true`
- The next LLM call in that iteration uses `externalContentModel` instead of the agent's default
- Revert to `internalModel` on the next iteration if no external content tools were called
- Default: disabled. When enabled, `externalContentModel` defaults to most capable available (e.g., `claude-opus-4-6`), `internalModel` defaults to agent's configured model
- Rationale: weaker models are more susceptible to prompt injection from hostile web content
- Phase: 4 (Agent Loop, as a model selection hook between tool results and LLM call)

**#43 — Tiny Heartbeat**
- Files: `src/scheduler/scheduler.ts`, `src/scheduler/heartbeat.ts`
- Heartbeat is a **built-in scheduled task** (depends on #40 cron scheduler) with a hardcoded minimal prompt:
  ```
  Quick health check (keep brief):
  1. Read active-tasks — flag any started > 1h ago with no update
  2. Check session count — archive if any exceed {maxMessages} messages
  3. Report issues found. If nothing, respond "all clear."
  ```
- Runs at `monitoring.heartbeatInterval` (default 1 hour) — expressed as cron internally
- Enforced low token budget: `maxTotalTokens: 2000`
- Uses cheapest configured model (not the agent's default — picks lowest-cost provider/model available)
- Heavy work (research, content generation) belongs in user-defined cron jobs, not heartbeat
- Phase: 5 (alongside scheduler)

**#44 — Skill Routing Logic and Learning**
- Files: `src/skills/types.ts`, `src/skills/registry.ts` (extends #34)
- Extend skill YAML frontmatter:
  ```yaml
  use_when:
    - "User asks for code review or mentions reviewing changes"
    - "A git diff or PR is referenced"
  dont_use_when:
    - "User is asking to write new code from scratch"
    - "User wants a refactor without review"
  ```
- When no explicit `/slash` trigger, system prompt includes a skill catalog with routing hints:
  ```
  Available skills (invoke by name if relevant):
  - code-review: Use when reviewing existing code. Don't use when writing new code.
  - refactor: Use when restructuring. Don't use for new features.
  ```
- The LLM decides which skill to activate — routing logic lives in skill definitions, interpreted by the model, not hardcoded pattern matching
- **Learning mechanism**: after-hook asks "Was this the right skill?" when a skill was activated. Log mismatches to `~/.bearclaw/skill-feedback.json`. Periodically surface refinement suggestions (like policy learning mode does for security rules). Over time, `use_when`/`dont_use_when` improve.
- Phase: 4b (Skills)

---

### Remaining: Addressed by Composition

- **#35 (external service integrations)** — addressed by #20 (plugins) + #33 (MCP) + web tools
- **#37 (CLI delegation as only integration)** — addressed by #33 (MCP) + #20 (plugins); CLI delegation becomes one of three patterns
- **#21 (dynamic tool registration)** — addressed by MCP client reconnect + plugin hot-reload (post-MVP)

---

### Revised Phase Order

| Phase | Content | New items |
|---|---|---|
| 1 | Config + Security | Bundle D fixes, scoped rate limiter, event bus, structured logging |
| 2 | Providers | Streaming, retry/backoff, CLI delegation warning |
| 3 | Tool System | search tool, file size limits, download limits, message scope, after-hook flush |
| **3b** | **MCP Client** | **Custom JSON-RPC client, stdio+SSE transports, tool-adapter** |
| **3c** | **Plugins** | **Plugin types, loader (tools + hooks + channels)** |
| 4 | Agent Loop | Parallel tool exec, token budget, spawn tool w/ success criteria (#39), model escalation (#42) |
| **4b** | **Skills** | **Skill types, loader, registry, builtins, routing logic + learning (#44)** |
| 5 | Bus + Channels | Channel interface, Telegram approval UX, REPL help, **cron scheduler (#40), heartbeat (#43)** |
| 6 | Orchestration | Blackboard for agent communication |
| 7 | Memory | **Namespace-aware loading, tiered injection, auto-archival (#38)** |
| 8 | Gateway + Pairing | Pairing persistence, MCP server mode |
| 9 | Entry Points + CLI | init, conf.d, list commands, secret rotation, metrics, history, plugin discovery, **crash recovery journal (#41)** |
