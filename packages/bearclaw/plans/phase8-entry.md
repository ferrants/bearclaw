# Phase 8: Entry Points

## Status: COMPLETE

## How It Works

### CLI Entry (`src/index.ts`)
Interactive REPL mode for single-agent use:
1. Loads config and initializes all subsystems (secrets, security, providers, tools, hooks)
2. Creates provider for default agent
3. Loads/creates session, builds system prompt
4. readline REPL: user input → inline allow parsing → agent loop → stream tokens → show results
5. Session saved on quit

### Daemon Entry (`src/daemon.ts`)
Full multi-agent daemon with channels and bus:
1. Complete startup sequence: config → secrets → security → providers → tools → hooks → bus → channels → conversation tracker → gateway
2. PolicyEngine registered as first before-hook
3. Channels started (CLI + Telegram)
4. Main loops: inbound processing (route → agent loop → mention parsing → fan-out) and outbound dispatch
5. Graceful shutdown: abort → drain → flush hooks → stop channels
