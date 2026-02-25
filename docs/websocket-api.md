# BearClaw WebSocket API

The WebSocket API provides a bidirectional connection to the BearClaw daemon, enabling external UIs to send messages and receive the full agent lifecycle: streaming tokens, tool call events, approval requests, and final responses.

## Connecting

```
ws://localhost:3000/ws?token=YOUR_PAIRING_TOKEN
```

If `gateway.requirePairing` is `false`, the token parameter can be omitted.

### Obtaining a token

There are three ways to get a token (see [Gateway Authentication](gateway.md#authentication)):

**Option A: Static API key** (simplest for automated clients)

Add a key to `gateway.apiKeys` in your config — use it directly as the token:

```bash
npx wscat -c 'ws://localhost:3000/ws?token=your-api-key'
```

**Option B: CLI token**

```bash
bearclaw token create my-ui
# Prints a token — use it as the connection token
```

**Option C: Interactive pairing**

```bash
# 1. Request a pairing code (displayed in the BearClaw console)
curl -X POST http://localhost:3000/pair \
  -H 'Content-Type: application/json' \
  -d '{"sessionId": "my-ui"}'

# 2. Submit the code shown in the console
curl -X POST http://localhost:3000/pair/verify \
  -H 'Content-Type: application/json' \
  -d '{"sessionId": "my-ui", "code": "123456"}'
# Response: {"token": "abc123..."}
```

### Quick test with wscat

```bash
npx wscat -c 'ws://localhost:3000/ws?token=YOUR_TOKEN'
```

## Client → Server Messages

### `message` — Send a user message

```json
{
  "type": "message",
  "id": "msg_1",
  "message": "What files are in the current directory?",
  "chatId": "session-1",
  "agentId": "default"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `id` | yes | Client-generated message ID |
| `message` | yes | The user message text |
| `chatId` | no | Conversation/session ID. Defaults to `ws_default` |
| `agentId` | no | Route to a specific agent. If omitted, the daemon's normal routing logic applies (mentions, default agent) |

Slash commands (`/config`, `/new`, `/{skill-name}`) are intercepted by the daemon before routing. Instead of an `agent_response`, you'll receive a `command_result` message. See [command_result](#command_result--slash-command-confirmation) below.

### `approval_response` — Approve, deny, or reject a tool call

Sent in response to an `approval_needed` event from the server.

```json
{
  "type": "approval_response",
  "requestId": "apr_1234567890_1",
  "approved": true,
  "allow": "session"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `requestId` | yes | The `requestId` from the `approval_needed` message |
| `approved` | yes | `true` to allow the tool to execute, `false` to block it |
| `allow` | no | Durability scope for approvals. Values: `once` (default), `session`, `day`, `always` (persists to disk, survives restart) |
| `deny` | no | Set to `"always"` when `approved` is `false` to create a persistent deny rule |
| `reject` | no | Set to `true` to reject the approach (agent receives feedback and tries something else) |
| `feedback` | no | Guidance message sent to the agent when `reject` is `true` |

**Approve with `allow: "always"`** creates a persistent user rule that survives daemon restarts. The rule is stored in `~/.bearclaw/user-rules.json`.

**Deny with `deny: "always"`** creates a persistent deny rule — the tool will be blocked without prompting on future calls.

**Reject** is distinct from deny: it tells the agent "wrong approach, try something else" and feeds the optional `feedback` as the tool result. No persistent rule is created. Example:

```json
{
  "type": "approval_response",
  "requestId": "apr_123",
  "approved": false,
  "reject": true,
  "feedback": "Don't delete that file, rename it instead"
}
```

### `query_mentionables` — Get autocomplete items

Returns available agents, teams, skills, and tools for autocomplete/mentions.

```json
{
  "type": "query_mentionables",
  "id": "q_1",
  "filter": "dep"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `id` | yes | Client-generated request ID (returned in response) |
| `filter` | no | Case-insensitive substring filter on name/description |

### `list_chats` — List existing chat sessions

Returns all stored chat sessions across all agents.

```json
{
  "type": "list_chats",
  "id": "q_1",
  "channel": "websocket",
  "agentId": "default"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `id` | yes | Client-generated request ID (returned in response) |
| `channel` | no | Filter by channel (`cli`, `websocket`, `telegram`, `scheduler`, `gateway`) |
| `agentId` | no | Filter by agent ID |

### `get_chat_history` — Load chat history

Returns the message history for a specific chat session. System messages are excluded.

```json
{
  "type": "get_chat_history",
  "id": "q_1",
  "chatId": "session-1",
  "agentId": "default",
  "channel": "websocket"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `id` | yes | Client-generated request ID (returned in response) |
| `chatId` | yes | The chat/session ID to load history for |
| `agentId` | no | Agent ID. Defaults to `default` |
| `channel` | no | Channel name. Defaults to `websocket` |

### `list_pending_approvals` — Query pending approvals

Returns all unanswered approval requests across all agents/threads. Useful for UIs that need to show a global approval queue or recover after reconnection.

```json
{
  "type": "list_pending_approvals",
  "id": "q_1",
  "chatId": "schedule_0",
  "agentId": "default"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `id` | yes | Client-generated request ID |
| `chatId` | no | Filter by chat/session ID |
| `agentId` | no | Filter by agent ID |

### `list_user_rules` — List persistent rules

Returns all persistent allow/deny rules created via `allow: "always"` or `deny: "always"`.

```json
{
  "type": "list_user_rules",
  "id": "q_1"
}
```

### `remove_user_rule` — Remove a persistent rule

```json
{
  "type": "remove_user_rule",
  "id": "q_1",
  "ruleId": "ur_abc12345"
}
```

## Server → Client Messages

### `token` — Streaming LLM token

Emitted as the LLM generates each token. Use these to display a live typing indicator.

```json
{
  "type": "token",
  "chatId": "session-1",
  "agentId": "default",
  "token": "Hello"
}
```

### `agent_response` — Final complete response

Emitted when the agent loop finishes (all iterations complete, no more tool calls).

```json
{
  "type": "agent_response",
  "chatId": "session-1",
  "agentId": "default",
  "content": "Here are the files in the current directory:\n- src/\n- package.json\n...",
  "iterations": 2,
  "toolsUsed": ["exec", "read_file"]
}
```

### `tool_pending` — Tool call about to be evaluated

Emitted before the policy engine / before-hooks run. The tool may still be blocked or require approval.

```json
{
  "type": "tool_pending",
  "toolCallId": "call_abc123",
  "toolName": "exec",
  "args": { "command": "ls -la" },
  "agentId": "default",
  "chatId": "session-1"
}
```

### `approval_needed` — Needs user approval

Emitted when a tool call requires explicit approval. The agent loop is paused on this tool until you respond with `approval_response`.

```json
{
  "type": "approval_needed",
  "requestId": "apr_1234567890_1",
  "toolName": "exec",
  "args": { "command": "rm -rf /tmp/build" },
  "agentId": "default",
  "chatId": "session-1"
}
```

If no response is received within the timeout (120s with a client connected, 600s in `wait` mode), the tool is automatically denied.

### `tool_started` — Tool execution began

Emitted after hooks pass and the tool begins executing.

```json
{
  "type": "tool_started",
  "toolCallId": "call_abc123",
  "toolName": "exec",
  "args": { "command": "ls -la" },
  "agentId": "default",
  "chatId": "session-1"
}
```

### `tool_completed` — Tool execution finished

```json
{
  "type": "tool_completed",
  "toolCallId": "call_abc123",
  "toolName": "exec",
  "args": { "command": "ls -la" },
  "isError": false,
  "durationMs": 42,
  "agentId": "default",
  "chatId": "session-1"
}
```

### `mentionables` — Autocomplete response

Response to `query_mentionables`.

```json
{
  "type": "mentionables",
  "id": "q_1",
  "items": [
    { "type": "skill", "name": "deploy", "description": "Deploy to prod", "trigger": "/deploy" },
    { "type": "agent", "name": "deployer", "trigger": "@deployer" }
  ]
}
```

Each item has:

| Field | Description |
|-------|-------------|
| `type` | `agent`, `team`, `skill`, or `tool` |
| `name` | Display name |
| `description` | Optional description |
| `trigger` | Trigger syntax: `@name` for agents/teams, `/name` for skills |

### `command_result` — Slash command confirmation

Emitted when the daemon handles a slash command (`/config`, `/new`, `/{skill-name}`) sent via `message`. This replaces the normal `agent_response` flow — the command is handled directly without invoking the LLM.

```json
{
  "type": "command_result",
  "chatId": "session-1",
  "command": "config",
  "message": "Configuration mode activated."
}
```

| Field | Description |
|-------|-------------|
| `chatId` | The session the command applies to |
| `command` | The command name (`new`, `config`, or skill name) |
| `message` | Human-readable confirmation |
| `newChatId` | *(only for `/new` via WebSocket)* The new session ID to use for subsequent messages |

For `/config <args>` and `/{skill} <args>`, you'll receive both a `command_result` (confirming activation) and the normal `agent_response` flow for the args.

**`/new` behavior by channel:**
- **WebSocket**: The old session is preserved. The response includes a `newChatId` — switch to this ID for subsequent messages. Old sessions remain accessible via `list_chats` and `get_chat_history`.
- **CLI / Telegram**: The old session is deleted (single-session UIs).

### `schedule_triggered` — Scheduled task activated

Emitted when a configured schedule fires, before the agent begins processing. Use this to display context in the UI for why the agent is running (e.g. "Scheduled task: every 6h").

```json
{
  "type": "schedule_triggered",
  "chatId": "schedule_0",
  "agentId": "bearclaw-agent-1",
  "message": "Continue active tasks, or pick up the next queued task...",
  "schedule": "every 6h"
}
```

| Field | Description |
|-------|-------------|
| `chatId` | The schedule's session ID (`schedule_0`, `schedule_1`, etc.) |
| `agentId` | The agent the schedule targets (or `default` if none specified) |
| `message` | The message being sent to the agent |
| `schedule` | The schedule expression (cron or interval, e.g. `every 6h`, `0 9 * * *`) |

This event arrives before any `tool_pending` or `token` events from the resulting agent run. The `chatId` can be used to correlate subsequent tool and response events back to this schedule.

### `chat_list` — Chat session list

Response to `list_chats`.

```json
{
  "type": "chat_list",
  "id": "q_1",
  "chats": [
    {
      "agentId": "default",
      "channel": "websocket",
      "chatId": "session-1",
      "lastModified": 1708531200000,
      "messageCount": 12
    }
  ]
}
```

### `chat_history` — Chat message history

Response to `get_chat_history`. System messages are excluded; only user, assistant, and tool messages are returned.

```json
{
  "type": "chat_history",
  "id": "q_1",
  "chatId": "session-1",
  "agentId": "default",
  "messages": [
    { "role": "user", "content": "What files are here?" },
    { "role": "assistant", "content": "Here are the files..." }
  ]
}
```

### `pending_approvals` — Pending approvals list

Response to `list_pending_approvals`.

```json
{
  "type": "pending_approvals",
  "id": "q_1",
  "approvals": [
    {
      "requestId": "apr_123_1",
      "toolName": "exec",
      "args": { "command": "rm -rf /tmp/build" },
      "agentId": "default",
      "chatId": "schedule_0",
      "createdAt": 1708531200000
    }
  ]
}
```

### `user_rules` — Persistent rules list

Response to `list_user_rules`.

```json
{
  "type": "user_rules",
  "id": "q_1",
  "rules": [
    {
      "id": "ur_abc12345",
      "action": "allow",
      "toolName": "exec",
      "agentId": "default",
      "createdAt": "2025-01-15T10:30:00.000Z",
      "createdBy": "ws-approval"
    }
  ]
}
```

### `user_rule_removed` — Rule removal confirmation

Response to `remove_user_rule`.

```json
{
  "type": "user_rule_removed",
  "id": "q_1",
  "ruleId": "ur_abc12345",
  "success": true
}
```

### `error` — Error

```json
{
  "type": "error",
  "id": "msg_1",
  "code": "MISSING_FIELD",
  "message": "message required"
}
```

Error codes: `INVALID_JSON`, `UNKNOWN_TYPE`, `MISSING_FIELD`, `APPROVAL_NOT_FOUND`.

## Tool Lifecycle

For each tool call, events arrive in this order:

```
tool_pending → [approval_needed → approval_response] → tool_started → tool_completed
```

The approval step only occurs when the policy engine flags the tool for approval and a WebSocket client is connected.

Multiple tool calls within a single LLM iteration execute in parallel, so you may see interleaved events from different `toolCallId`s.

## Approval Modes

Set `gateway.approvalMode` in your BearClaw config to control behavior when a tool needs approval:

| Mode | WS client connected | No WS client |
|------|---------------------|--------------|
| `auto-approve` (default) | Asks client | Auto-approves |
| `auto-deny` | Asks client | Auto-denies |
| `wait` | Asks client | Queues; sends to client when one connects |

### Reconnection

When a client connects, the server immediately sends all pending `approval_needed` messages. This means a UI can reconnect after a brief disconnect and pick up where it left off.

## REST Alternative

The mentionables and chat endpoints are also available via REST:

```bash
# List mentionables
curl http://localhost:3000/mentionables?filter=dep \
  -H 'Authorization: Bearer YOUR_TOKEN'

# List chat sessions (with optional filters)
curl 'http://localhost:3000/chats?channel=websocket&agentId=default' \
  -H 'Authorization: Bearer YOUR_TOKEN'

# Get chat history
curl 'http://localhost:3000/chats/history?chatId=session-1&agentId=default&channel=websocket' \
  -H 'Authorization: Bearer YOUR_TOKEN'
```

## Example: Minimal Node.js Client

```javascript
import { WebSocket } from 'ws';  // or use the browser WebSocket API

const ws = new WebSocket('ws://localhost:3000/ws?token=YOUR_TOKEN');

ws.on('open', () => {
  ws.send(JSON.stringify({
    type: 'message',
    id: 'msg_1',
    message: 'List the files in the current directory',
    chatId: 'my-session',
  }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data);

  switch (msg.type) {
    case 'token':
      process.stdout.write(msg.token);
      break;

    case 'tool_started':
      console.log(`\n[tool] ${msg.toolName} started`);
      break;

    case 'tool_completed':
      console.log(`[tool] ${msg.toolName} done (${msg.durationMs}ms)`);
      break;

    case 'approval_needed':
      console.log(`[approval] ${msg.toolName}: ${JSON.stringify(msg.args)}`);
      // Auto-approve for the rest of the session
      ws.send(JSON.stringify({
        type: 'approval_response',
        requestId: msg.requestId,
        approved: true,
        allow: 'session',
      }));
      break;

    case 'agent_response':
      console.log(`\n\nFinal response (${msg.iterations} iterations):\n${msg.content}`);
      break;

    case 'schedule_triggered':
      console.log(`\n[schedule] ${msg.schedule} → ${msg.agentId}: ${msg.message}`);
      break;

    case 'command_result':
      console.log(`[${msg.command}] ${msg.message}`);
      break;

    case 'error':
      console.error(`Error [${msg.code}]: ${msg.message}`);
      break;
  }
});
```
