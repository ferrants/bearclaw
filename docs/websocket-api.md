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

### `approval_response` — Approve or deny a tool call

Sent in response to an `approval_needed` event from the server.

```json
{
  "type": "approval_response",
  "requestId": "apr_1234567890_1",
  "approved": true
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `requestId` | yes | The `requestId` from the `approval_needed` message |
| `approved` | yes | `true` to allow the tool to execute, `false` to block it |

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

For `/config <args>` and `/{skill} <args>`, you'll receive both a `command_result` (confirming activation) and the normal `agent_response` flow for the args.

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

The mentionables endpoint is also available via REST:

```bash
curl http://localhost:3000/mentionables?filter=dep \
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
      // Auto-approve for demo purposes
      ws.send(JSON.stringify({
        type: 'approval_response',
        requestId: msg.requestId,
        approved: true,
      }));
      break;

    case 'agent_response':
      console.log(`\n\nFinal response (${msg.iterations} iterations):\n${msg.content}`);
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
