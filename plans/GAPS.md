# BearClaw Architecture — Gaps & Resolutions

Issues identified during review of `ARCHITECTURE.md`, with decisions and fixes for each.

---

## 1. Missing Type Definitions — RESOLVED

### InboundMessage / OutboundMessage

**Gap**: The `MessageBus` references these types but neither was defined.

**Resolution**: Added to plan as `src/bus/types.ts`:
```typescript
interface InboundMessage {
  channel: string;
  sender: string;
  chatId: string;
  messageId: string;
  message: string;
  conversationId?: string;  // for multi-agent continuation
  files?: string[];
  timestamp: number;
}

interface OutboundMessage {
  channel: string;
  chatId: string;
  content: string;
  replyToMessageId?: string;
  files?: string[];
  agentId?: string;         // which agent produced this
  conversationId?: string;
}
```

### Channel Interface

**Gap**: `src/channels/types.ts` was listed but had no definition.

**Resolution**: Added to plan. Channels call `bus.publishInbound()` in their listeners. The daemon consumes outbound and dispatches via `channel.send()`.
```typescript
interface Channel {
  name: string;
  start(bus: MessageBus): Promise<void>;   // begin listening, publish inbound to bus
  stop(): Promise<void>;                    // graceful shutdown
  send(msg: OutboundMessage): Promise<void>; // deliver outbound to end user
}
```

**Ref**: TinyClaw channel pattern in `/home/matt/code/tinyclaw/src/channels/telegram.ts`

---

## 2. Underdefined Implementations — RESOLVED

### Session Persistence (`src/agent/session.ts`)

**Gap**: No schema or implementation sketch. Where stored? How loaded? Max history? Keying?

**Decision**: SQLite, reusing the existing `better-sqlite3` dependency. Sessions table in shared `~/.bearclaw/bearclaw.db`:
```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,          -- agent_id + ":" + channel + ":" + chatId
  agent_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  messages TEXT NOT NULL,        -- JSON array of Message objects
  updated_at TEXT NOT NULL
);
```
- Keyed per agent+channel+chat
- Load on agent loop start, save on agent loop end
- Max 100 messages (configurable). Older messages dropped on load.

**Ref**: ZeroClaw session pattern in `/home/matt/code/zeroclaw/src/memory/sqlite.rs` (same DB approach)

### Context Assembly (`src/agent/context.ts`)

**Gap**: No detail on system prompt construction, memory injection, or team context.

**Resolution**: System prompt built in order:
1. Load each file from `AgentConfig.systemPromptFiles` (e.g., `SOUL.md`, `IDENTITY.md`)
2. Append tool descriptions summary
3. If memory enabled: query hybrid search with user's message text, inject top 5 results as "Relevant memories:" system section
4. If team context: append teammate names and team purpose
5. Combine into single system message

**Ref**: PicoClaw context builder in `/home/matt/code/picoclaw/pkg/agent/loop.go` lines 412-450

### Daemon Event Loop (`src/daemon.ts`)

**Gap**: No implementation sketch for the main orchestration entry point.

**Decision**: Sequential per-agent (one message at a time per agent, multiple agents run in parallel). No locking needed.

**Resolution**: Full pseudocode added to plan covering:
- Startup sequence (config → DB → security → providers → tools → hooks → bus → channels → reaper)
- Main loop: per-agent promise chains consuming from bus
- Multi-agent fan-out: agent response → mention parsing → re-enqueue to bus → branchComplete → aggregate when pending === 0
- Outbound loop: consume outbound → dispatch via channel.send()
- Graceful shutdown: abort signal → drain outbound → stop channels → save sessions → close DB

**Ref**: TinyClaw daemon pattern in `/home/matt/code/tinyclaw/src/queue-processor.ts` lines 60-120 (promise chain per agent), PicoClaw bus consumer in `/home/matt/code/picoclaw/pkg/bus/bus.go`

### JSON Schema Validation (`src/tools/validate.ts`)

**Gap**: Listed but no implementation.

**Resolution**: Recursive validation handling:
- Type checking: string, number, boolean, object, array, null
- Required fields on objects
- Enum values
- Min/max for numbers, minLength/maxLength for strings
- Nested object and array item validation
- Returns array of error strings (empty = valid)

**Ref**: Nanobot's `validate_params()` in `/home/matt/code/nanobot/nanobot/tools/base.py`

---

## 3. Missing Tool Implementations — RESOLVED

**Gap**: Only `exec` and `read_file` had full code. 6 other tools had no implementation detail.

**Resolutions**:

### write-file
Path validation (pre + post-resolve for symlink escape), workspace-only enforcement, auto-create parent dirs with `fs.mkdir(recursive: true)`, check autonomy level (ReadOnly blocks writes). Returns `toolResult()` (LLM-only confirmation).

**Ref**: PicoClaw `write_file` in `/home/matt/code/picoclaw/pkg/tools/filesystem.go`

### edit-file
Exact string match find-and-replace. `old_string` must appear exactly once in the file (error if 0 or 2+ matches). Read file → validate path → find match → replace → write back. Returns `toolResult()` with diff summary.

**Ref**: PicoClaw `edit_file` in `/home/matt/code/picoclaw/pkg/tools/filesystem.go`

### list-dir
Non-recursive by default. Optional `depth` param (default 1). Returns formatted listing with file/dir indicators and sizes. Path validation same as read-file.

**Ref**: PicoClaw `list_dir` in `/home/matt/code/picoclaw/pkg/tools/filesystem.go`

### web-fetch
SSRF guard first → `fetch(url, { signal, timeout })` → if HTML, strip tags to text → truncate at `WEB_FETCH_MAX_CHARS` (50K) → return `toolResult()` (LLM-only).

**Ref**: OpenClaw SSRF + fetch in `/home/matt/code/openclaw/src/agents/tools/web-fetch.ts`

### spawn
**Decision**: Lightweight in-process subagent. Creates a new `runAgentLoop()` call in same process with restricted tool registry (all tools except `spawn` and `message` — prevents recursion and cross-channel side effects). Shares provider instances. System prompt from spawning agent's config. Result delivered via callback → `conversationTracker.recordResponse()`. Returns `asyncResult("Spawned subagent for: <task>")` immediately to the parent agent.

**Ref**: PicoClaw spawn in `/home/matt/code/picoclaw/pkg/tools/spawn.go`, TinyClaw fan-out in `/home/matt/code/tinyclaw/src/queue-processor.ts` lines 395-460

### message
Publishes an `OutboundMessage` to the bus targeting a specific channel+chatId. Goes through the normal outbound flow. No special auth needed — the PolicyEngine's before-hook controls whether the agent is allowed to send to that channel.

**Ref**: TinyClaw cross-channel messaging in `/home/matt/code/tinyclaw/src/lib/routing.ts`

### web-request and web-download — DEFERRED

**Decision**: Removed from MVP. `web-fetch` covers the common case (GET + read). `web-request` (arbitrary method/headers/body) and `web-download` (stream to file) add complexity for uncommon use cases. Can be added post-MVP as needed. Tool count reduced from 10 to 8.

---

## 4. Bug: SSRF Private IP Range Check — FIXED

**Gap**: The `172.16.` prefix check only matches `172.16.x.x`, not `172.17-31.x.x`.

**Fix**: Replace prefix-based approach with numeric range checking:
```typescript
function isPrivateIP(ip: string): boolean {
  if (ip === '::1') return true;
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (ip.startsWith('fe80:')) return true;

  const parts = ip.split('.').map(Number);
  if (parts.length !== 4) return false;

  if (parts[0] === 10) return true;                           // 10.0.0.0/8
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;  // 172.16.0.0/12
  if (parts[0] === 192 && parts[1] === 168) return true;     // 192.168.0.0/16
  if (parts[0] === 127) return true;                           // 127.0.0.0/8
  if (parts[0] === 169 && parts[1] === 254) return true;     // 169.254.0.0/16
  if (parts[0] === 0) return true;                             // 0.0.0.0/8

  return false;
}
```

Updated in both the plan file and `ARCHITECTURE.md`.

**Ref**: OpenClaw SSRF implementation in `/home/matt/code/openclaw/src/agents/tools/web-fetch.ts`

---

## 5. No Error Handling / Retry for Provider Calls — RESOLVED

**Gap**: Anthropic provider had no `resp.ok` check. No retry strategy for transient errors.

**Resolution**: All providers implement:
```
try:
  resp = await fetch(url, { signal, ... })
  if !resp.ok:
    if resp.status === 401: throw AuthError (don't retry, surface clearly)
    if resp.status === 429 || resp.status >= 500:
      retry with exponential backoff (1s, 2s, 4s, max 3 retries)
    else: throw ProviderError(status, body)
  data = await resp.json()
  validate data has expected shape (content array, etc.)
  return parsed LLMResponse
catch NetworkError:
  retry with backoff (max 3)
```

Shared retry logic extracted to a `fetchWithRetry()` utility used by all three API providers.

---

## 6. No Logging Integration — RESOLVED

**Gap**: `src/logging.ts` listed but never referenced in any implementation.

**Resolution**: Structured JSON logger integrated into all subsystems:
- Tool calls: `{ event: "tool_call", tool, args_summary, duration_ms, is_error }`
- Policy decisions: `{ event: "policy_decision", tool, rule_id, action, reason }`
- Agent loop: `{ event: "agent_iteration", agent_id, iteration, tool_count }`
- Provider calls: `{ event: "provider_call", provider, model, tokens, latency_ms }`
- Security events: `{ event: "security", type: "path_blocked"|"rate_limited"|... }`
- Conversations: `{ event: "conversation", action: "created"|"fan_out"|"complete"|"timeout" }`

Config: `monitoring.logLevel: "debug" | "info" | "warn" | "error"` (default: "info")

---

## 7. No Conversation Timeout / Cleanup — RESOLVED

**Gap**: `ConversationTracker` stores `startTime` but nothing reaps stale conversations.

**Resolution**:
- `MAX_CONVERSATION_DURATION_MS = 600_000` (10 minutes)
- `startReaper()`: `setInterval` every 60s, sweeps all conversations, deletes those past max duration
- On timeout: log `{ event: "conversation", action: "timeout", id, pending, elapsed_ms }`, publish partial aggregation to user with note that some agents timed out

**Ref**: TinyClaw conversation tracking in `/home/matt/code/tinyclaw/src/queue-processor.ts` (has `MAX_CONVERSATION_MESSAGES` but no time-based reaper — this is an improvement)

---

## 8. Phase Numbering Error — FIXED

**Gap**: Phase 2 restarted at step 11. Steps 11-14 appeared in both Phase 1 and Phase 2.

**Fix**: Renumbered sequentially 1-28 across all 9 phases in the plan file.

---

## 9. Minor Gaps — RESOLVED

### Graceful degradation for memory
**Decision**: If `better-sqlite3` fails to load, log warning and set `memory.enabled = false`. Agent loop works without memory injection. Sessions also degrade to in-memory-only (lost on restart).

### Config validation
**Resolution**: Validate loaded JSON against TypeScript types at load time. Unknown fields → warning log. Wrong types on required fields → fatal error with clear message pointing to the specific field.

### Hot reload
**Decision**: Restart-only for MVP. Acceptable tradeoff — change config, restart daemon.

### `visibility` field redundancy
**Decision**: Drop the `visibility` enum from `ToolResult`. Simplified to: `forUser` set → show to user; `silent: true` → suppress entirely; absence of `forUser` → LLM-only. Fields: `forLLM`, `forUser?`, `silent`, `isError`, `async`.

### CLI delegation security
**Decision**: Requires explicit policy rule `{ action: "allow", scope: "cli_delegation" }`. Without it, all CLI delegation attempts are blocked. Config comments and any setup docs include prominent warning: **CLI delegation bypasses BearClaw's entire security model for the delegated work** — the spawned CLI runs with `--dangerously-skip-permissions` and BearClaw has zero visibility into what tools it uses or what files it modifies.

**Ref**: TinyClaw security audit at `/home/matt/code/tinyclaw/SECURITY-AUDIT.md` (documents this exact risk)
