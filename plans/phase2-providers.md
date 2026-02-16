# Phase 2: Provider Layer

## Status: COMPLETE

## Steps
16. `src/providers/types.ts` — LLMProvider, Message, ToolCall, LLMResponse, ChatOptions
17. `src/providers/retry.ts` — fetchWithRetry()
18. `src/providers/anthropic.ts` — Anthropic API with streaming
19. `src/providers/openai.ts` — OpenAI API with streaming
20. `src/providers/ollama.ts` — Ollama local HTTP
21. `src/providers/cli-delegation.ts` — generic CLI subprocess provider
22. Tests: `tests/providers/*`

## Progress
- [x] Step 16: Provider types
- [x] Step 17: Retry utility
- [x] Step 18: Anthropic provider
- [x] Step 19: OpenAI provider
- [x] Step 20: Ollama provider
- [x] Step 21: CLI delegation provider
- [x] Step 22: Tests

## Results
- 9 new tests (59 total), all passing
- TypeScript compiles cleanly

## How It Works

### Provider Abstraction
All providers implement `LLMProvider` interface with `chat()` method returning normalized `LLMResponse`.

### Anthropic Provider
- System messages extracted and sent as separate `system` parameter
- Tool calls use `tool_use` content blocks, tool results become `user` messages with `tool_result` blocks
- Streaming via SSE: tracks `content_block_start/delta/stop` and `message_delta` events

### OpenAI Provider
- Standard chat completions format with `function` tool definitions
- Tool call arguments JSON-stringified in requests, parsed on response
- Streaming via SSE with delta accumulation for tool call arguments

### Ollama Provider
- HTTP to local Ollama API (`/api/chat`), OpenAI-compatible tool calling format
- Generates synthetic tool call IDs since Ollama doesn't provide them
- Native NDJSON streaming

### CLI Delegation Provider
- Generic subprocess spawner for any CLI tool (claude, codex, aider, etc.)
- Known CLI patterns in `buildArgs()` (extensible), JSONL output parser for codex
- AbortSignal support for graceful termination

### Retry Utility
- Exponential backoff (1s, 2s, 4s) for 429 and 5xx errors
- Immediate failure for 401 (auth errors)
- Retries on ECONNREFUSED/TypeError (network errors)
