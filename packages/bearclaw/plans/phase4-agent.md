# Phase 4: Agent Loop

## Status: COMPLETE

## Results
- 6 new tests (92 total), all passing
- TypeScript compiles cleanly

## How It Works

### Agent Loop (`src/agent/loop.ts`)
Core agentic loop: LLM call → tool execution → append results → loop until no tool calls or max iterations/token budget. Tool calls executed in parallel. Before-hooks can block, after-hooks fire-and-forget.

### Session Persistence (`src/agent/session.ts`)
JSON file persistence at `{sessionsDir}/{agentId}_{channel}_{chatId}.json`. Load trims to MAX_SESSION_MESSAGES. Save creates dirs recursively.

### Context Assembly (`src/agent/context.ts`)
System prompt built from: agent's prompt files → tool descriptions summary → memory files (always-load) → team context (if applicable).
