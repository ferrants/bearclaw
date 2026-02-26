# Feature Request: Dashboard Data Stream

## Background

The Bearclaw TUI is adding a `/dashboard` mode inspired by btop — a dense, real-time visualization of agent activity, token usage, tool performance, and system health. The TUI already receives granular tool lifecycle events (`tool_pending`, `tool_started`, `tool_completed`) and streaming tokens, which is great. But to build the full dashboard we need a few additional data streams from the server.

## What we're building

A full-screen dashboard with:
- Per-agent activity sparkline graphs (tokens/sec over time)
- Context window usage gauges per agent
- Running cost tracking with burn-rate visualization
- Tool call frequency, latency, and error rate bars
- Live activity feed (already possible with existing events)
- Session-wide summary stats
- WS throughput graph (client-side, no server changes needed)

---

## 1. Agent Status Events

**Purpose:** Track when each agent transitions between states so we can show real-time activity indicators and build the activity-over-time sparkline graphs. Without this, the TUI can only infer "busy" from tool events, which misses pure thinking time.

**Trigger:** Emit whenever an agent's state changes — when it starts thinking, starts using a tool, returns to idle, etc.

**Message spec:**
```typescript
interface WsAgentStatus {
  type: "agent_status"
  chatId: string
  agentId: string
  status: "idle" | "thinking" | "tool_use"
  // Current context window consumption for this agent's conversation
  contextTokens: number
  // The model's maximum context window size
  maxContextTokens: number
}
```

**Notes:**
- `contextTokens` / `maxContextTokens` let us draw a context window gauge (e.g., `[████████░░░░] 67%`). This is the single most useful health metric for long-running agents — when they hit the limit, things break.
- If computing exact token counts on every transition is expensive, an approximation is fine, or these fields could be optional and only populated periodically.
- The `status` field drives the per-agent sparkline: we sample it on a timer client-side to build the activity graph over time.
- `tool_use` status is technically redundant with `tool_started`/`tool_completed`, but having it here means the dashboard doesn't need to cross-reference multiple event streams to show a single agent's current state.

---

## 2. Token Usage / Cost Events

**Purpose:** Track per-response token consumption and model info so we can compute running cost and show input/output/cache token breakdowns.

**Trigger:** Emit once after each complete agent response (alongside or just after `agent_response`).

**Message spec:**
```typescript
interface WsUsage {
  type: "usage"
  chatId: string
  agentId: string
  // Tokens consumed for this response
  inputTokens: number
  outputTokens: number
  // Cache tokens if applicable (Anthropic prompt caching)
  cacheReadTokens?: number
  cacheWriteTokens?: number
  // Which model produced this response — needed for cost calculation
  // since different models have different $/token rates
  model: string
}
```

**Notes:**
- The TUI will maintain a cost lookup table mapping model IDs to per-token rates. We just need the model string to be the actual model identifier (e.g., `claude-sonnet-4-20250514`, not a display name).
- `cacheReadTokens` and `cacheWriteTokens` are optional but valuable — cache hits are significantly cheaper and showing cache hit rate is useful for understanding cost efficiency.
- The TUI accumulates these over time to show: total session cost, cost per agent, cost trend ($/min sparkline), and input vs output token ratio.
- If the server already has this data from the Anthropic API response, this is likely just forwarding the `usage` block from the API response.

---

## 3. Periodic Server Stats

**Purpose:** Show session-wide summary metrics that span all chats/agents — things the TUI can't compute from its single-chat perspective.

**Trigger:** Either:
- **(a) Request/response:** Client sends `get_stats`, server responds with `stats`. The TUI would poll this every 5 seconds when the dashboard is open.
- **(b) Periodic push:** Server pushes `stats` every N seconds to all connected clients. Simpler for the server but slightly wasteful when dashboard isn't open.
- **(c) Subscribe model:** Client sends `subscribe_stats` / `unsubscribe_stats`. Cleanest but most work.

Option (a) is probably the best balance. We only fetch when the dashboard is visible.

**Client request:**
```typescript
interface WsGetStats {
  type: "get_stats"
  id: string
}
```

**Server response:**
```typescript
interface WsStats {
  type: "stats"
  id: string
  // Number of chats with active (non-idle) agents
  activeChatCount: number
  // Total chats the server is managing
  totalChatCount: number
  // Total messages across all chats
  totalMessages: number
  // Approvals waiting across all chats (not just the current one)
  pendingApprovals: number
  // Server uptime
  uptimeSeconds: number
  // Per-agent summary so the dashboard can show all agents at once,
  // not just the one the TUI is currently chatting with
  agents: {
    agentId: string
    status: "idle" | "thinking" | "tool_use"
    activeChatId: string | null
    contextTokens: number
    maxContextTokens: number
  }[]
}
```

**Notes:**
- The `agents` array is the key piece — it lets the dashboard show all agents side-by-side even though the TUI's main chat view only shows one at a time. Without this, switching agents in the dashboard would require loading each chat individually.
- `pendingApprovals` across all chats is useful for surfacing "something needs your attention in another chat" — could flash an indicator.
- If any of these fields are expensive to compute, they can be omitted or approximated. The dashboard degrades gracefully — we just show "N/A" for missing data.

---

## Summary of changes

| Message | Direction | Trigger | Priority |
|---|---|---|---|
| `agent_status` | server -> client | On agent state change | **High** — drives the main sparkline graph and status indicators |
| `usage` | server -> client | After each `agent_response` | **High** — needed for cost tracking, the #1 thing people want to monitor |
| `get_stats` / `stats` | client -> server -> client | On request (TUI polls when dashboard open) | **Medium** — nice for multi-agent overview, but dashboard works without it |

None of these require changes to the existing message types — they're purely additive. The TUI will handle missing messages gracefully (showing "no data" for panels that depend on them), so these can be rolled out incrementally.
