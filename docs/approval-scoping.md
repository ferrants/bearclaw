# Approval Scoping

When a tool call requires approval, WebSocket clients can specify how long that approval should last. This avoids repeatedly approving the same tool in a session with many tool calls.

## The `allow` field

Add an `allow` field to your `approval_response` message:

```json
{
  "type": "approval_response",
  "requestId": "apr_123",
  "approved": true,
  "allow": "session"
}
```

| Value | Behavior |
|-------|----------|
| `"once"` | Approve this single call only (default when `allow` is omitted) |
| `"session"` | Approve this tool for the rest of the daemon process lifetime |
| `"day"` | Approve this tool for `dayScopeHours` (default 24h, configurable in `policy.inlineAllow.dayScopeHours`) |
| `"always"` | Persist to disk — survives daemon restart (stored in `~/.bearclaw/user-rules.json`) |

The `allow` field is only honored when `approved` is `true`.

## The `deny` field

When denying a tool call, you can optionally make it permanent:

```json
{
  "type": "approval_response",
  "requestId": "apr_123",
  "approved": false,
  "deny": "always"
}
```

| Value | Behavior |
|-------|----------|
| `"always"` | Persist deny to disk — tool is blocked without prompting on future calls |

## Reject vs deny

Reject tells the agent "wrong approach, try something else" and feeds optional guidance back as the tool result. The agent sees the feedback and pivots to a different strategy. No persistent rule is created.

```json
{
  "type": "approval_response",
  "requestId": "apr_123",
  "approved": false,
  "reject": true,
  "feedback": "Use a safer approach — rename instead of delete"
}
```

| Response | Effect on agent | Creates rule? |
|----------|----------------|---------------|
| Deny | Tool blocked, generic error | No (unless `deny: "always"`) |
| Reject | Tool blocked, feedback injected as tool result | Never |

## How it works

1. Client sends `approval_response` with `allow: "session"` (or `"day"`, `"always"`)
2. The daemon resolves the approval and registers the tool:
   - `"session"` / `"day"`: stored in the agent's in-memory `InlineAllowStore`
   - `"always"`: stored in the persistent `UserRuleStore` and injected into all `PolicyEngine` instances
3. On subsequent tool calls, the policy engine's before-hook checks user rules first, then `InlineAllowStore`, before broadcasting `approval_needed`
4. A matching rule hits, so the tool proceeds (or is blocked) without prompting

This uses the same `InlineAllowStore` that powers inline text directives like `[allow: session exec]`. The `"always"` scope uses a separate `UserRuleStore` that persists to `~/.bearclaw/user-rules.json`.

## Scoping details

- **Per-agent**: Allows are registered against the specific agent that triggered the approval. If agent A gets `exec` approved with `allow: "session"`, agent B still needs its own approval.
- **Tool name only**: The allow matches by tool name (e.g. `exec`, `web_fetch`, `read_file`). It does not filter by arguments — approving `exec` once covers all subsequent `exec` calls for that agent.
- **Session scope**: Lives in memory for the daemon process lifetime. Restarting the daemon clears all session-scoped allows.
- **Day scope**: Expires after `dayScopeHours` (default 24). Survives within a running process but does not persist to disk.
- **Always scope**: Persists to `~/.bearclaw/user-rules.json`. Survives daemon restart. Only humans can create these (via WS approval or CLI). Agents cannot self-approve.

## Managing persistent rules

Persistent rules can be listed and removed via WebSocket:

```json
{"type": "list_user_rules", "id": "q_1"}
{"type": "remove_user_rule", "id": "q_2", "ruleId": "ur_abc12345"}
```

## Schedule approval mode: `user-rules`

Schedules can use `approvalMode: 'user-rules'` so that scheduled runs check persistent user rules first. Tools covered by a user rule auto-approve/deny; uncovered tools pause for WebSocket approval (or timeout).

```yaml
schedules:
  - cron: "0 */6 * * *"
    agent: worker
    message: "Run maintenance tasks"
    approvalMode: user-rules
```

This is distinct from `auto-approve` (approves everything) and `auto-deny` (denies everything).

## Example: UI with "Allow for session" button

A typical UI flow:

```javascript
ws.on('message', (data) => {
  const msg = JSON.parse(data);

  if (msg.type === 'approval_needed') {
    // Show approval dialog with scope options
    showApprovalDialog(msg, (approved, scope) => {
      ws.send(JSON.stringify({
        type: 'approval_response',
        requestId: msg.requestId,
        approved,
        allow: scope,  // 'once', 'session', or 'day'
      }));
    });
  }
});
```

## Inline allows (text directives)

The same scopes work in message text via inline allow directives:

```
[allow: session exec] Run whatever shell commands you need
[allow: day web_fetch] Fetch any URLs for the next 24 hours
[allow: once read_file ./secret.env] Read this one file
```

See [Security > Inline Allows](./security.md#inline-allows) for details.
