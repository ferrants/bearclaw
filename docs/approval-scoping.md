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

The `allow` field is only honored when `approved` is `true`. Denied requests are never persisted regardless of the `allow` value.

## How it works

1. Client sends `approval_response` with `allow: "session"` (or `"day"`)
2. The daemon resolves the approval and registers the tool in the agent's `InlineAllowStore`
3. On subsequent tool calls, the policy engine's before-hook checks the `InlineAllowStore` before broadcasting `approval_needed`
4. The store hits, so the tool proceeds without prompting

This uses the same `InlineAllowStore` that powers inline text directives like `[allow: session exec]`. The WebSocket `allow` field is just another way to populate it.

## Scoping details

- **Per-agent**: Allows are registered against the specific agent that triggered the approval. If agent A gets `exec` approved with `allow: "session"`, agent B still needs its own approval.
- **Tool name only**: The allow matches by tool name (e.g. `exec`, `web_fetch`, `read_file`). It does not filter by arguments — approving `exec` once covers all subsequent `exec` calls for that agent.
- **Session scope**: Lives in memory for the daemon process lifetime. Restarting the daemon clears all session-scoped allows.
- **Day scope**: Expires after `dayScopeHours` (default 24). Survives within a running process but does not persist to disk.

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
