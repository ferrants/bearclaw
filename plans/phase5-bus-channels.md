# Phase 5: Bus + Channels

## Status: COMPLETE

## Results
- 8 new tests (100 total), all passing

## How It Works

### MessageBus (`src/bus/bus.ts`)
Async inbound/outbound queues with capacity limits (default 100). Waiter pattern: if a consumer is already waiting, messages deliver directly (zero-copy). AbortSignal for graceful shutdown. FIFO ordering.

### CLI Channel (`src/channels/cli.ts`)
stdin/stdout REPL via readline. Built-in commands: help/?, quit/exit. All other input published as InboundMessage to bus.

### Telegram Channel (`src/channels/telegram.ts`)
node-telegram-bot-api with polling. Sender allowlist from config. Publishes inbound messages, sends outbound with optional reply_to_message_id.
