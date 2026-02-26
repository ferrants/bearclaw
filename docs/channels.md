# Channels

Channels are the interface between users and BearClaw. Each channel handles inbound messages from users and outbound messages from agents.

## Channel Interface

All channels implement:

```typescript
interface Channel {
  name: string;
  start(bus: MessageBus): Promise<void>;
  stop(): Promise<void>;
  send(msg: OutboundMessage): Promise<void>;
}
```

## CLI Channel

The CLI channel provides an interactive REPL via stdin/stdout.

### Configuration

```json
{
  "channels": {
    "enabled": ["cli"]
  }
}
```

### Usage

The CLI channel is active by default. In daemon mode, it provides the same REPL interface as the CLI entry point, but with multi-agent routing support.

Built-in commands:
- `help` or `?` — Show available commands
- `quit` or `exit` — Stop the daemon
- `@agent message` — Route to a specific agent
- `@team message` — Route to a team

All other input is published as an `InboundMessage` to the message bus.

## External Channels

BearClaw's built-in daemon channels are intentionally minimal. For external chat platforms, build a wrapper that connects to the daemon over WebSocket and forwards messages in and out. This keeps core security and approvals centralized in the gateway.

## Message Bus

The message bus (`src/bus/bus.ts`) connects channels to the processing pipeline:

### Inbound Flow

```
Channel → publishInbound() → [queue] → consumeInbound() → Router → Agent
```

### Outbound Flow

```
Agent → publishOutbound() → [queue] → consumeOutbound() → Channel.send()
```

### Message Types

**InboundMessage**:
| Field | Type | Description |
|---|---|---|
| `channel` | string | Source channel name |
| `sender` | string | Sender identifier |
| `chatId` | string | Chat/conversation identifier |
| `messageId` | string | Unique message ID |
| `message` | string | Message content |
| `conversationId` | string? | For multi-agent conversations |
| `files` | string[]? | Attached file paths |
| `timestamp` | number | Unix timestamp |

**OutboundMessage**:
| Field | Type | Description |
|---|---|---|
| `channel` | string | Target channel name |
| `chatId` | string | Target chat/conversation |
| `content` | string | Message content |
| `replyToMessageId` | string? | Reply to specific message |
| `files` | string[]? | Files to send |
| `agentId` | string? | Source agent |
| `conversationId` | string? | For multi-agent conversations |

### Bus Behavior

- **Capacity**: 100 messages per queue (inbound and outbound)
- **Delivery**: If a consumer is already waiting, messages are delivered directly (zero-copy). Otherwise, they're queued FIFO.
- **Shutdown**: `AbortSignal` support for graceful shutdown — consumers receive an error when the signal fires.

## Adding Channels

To add a new channel, implement the `Channel` interface:

1. Create `src/channels/your-channel.ts`
2. Implement `start()` to begin listening and publish `InboundMessage` to the bus
3. Implement `send()` to deliver `OutboundMessage` to the external service
4. Implement `stop()` for graceful shutdown
5. Register it in `src/daemon.ts` alongside the existing channels
