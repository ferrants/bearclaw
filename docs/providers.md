# Providers

BearClaw abstracts LLM interactions behind a unified `LLMProvider` interface. All providers use `fetch()` directly — no SDK dependencies.

## Provider Interface

Every provider implements:

```typescript
interface LLMProvider {
  chat(
    messages: Message[],
    tools: ToolDefinition[],
    model: string,
    options?: ChatOptions,
  ): Promise<LLMResponse>;
  defaultModel: string;
}
```

The `chat()` method accepts a conversation history, available tool definitions, and returns a normalized response with content, tool calls, finish reason, and token usage.

## Anthropic

```json
{
  "providers": {
    "anthropic": {
      "apiKey": "sk-ant-...",
      "defaultModel": "claude-sonnet-4-5-20250929"
    }
  }
}
```

### Translation Details

- **System messages** — Extracted from the message array and sent as the separate `system` API parameter
- **Tool calls** — Anthropic uses `tool_use` content blocks in assistant messages. BearClaw normalizes these to `ToolCall` objects
- **Tool results** — Sent as `user` messages with `tool_result` content blocks, keyed by `tool_use_id`
- **Streaming** — When `onToken` callback is provided, uses `stream: true` and parses Server-Sent Events (`content_block_start`, `content_block_delta`, `content_block_stop`, `message_delta`)

## OpenAI

```json
{
  "providers": {
    "openai": {
      "apiKey": "sk-...",
      "defaultModel": "gpt-4o"
    }
  }
}
```

### Translation Details

- **Tool definitions** — Wrapped in `{ type: "function", function: { name, description, parameters } }`
- **Tool calls** — OpenAI nests tool calls under `tool_calls[].function` with JSON-stringified arguments. BearClaw parses these back to objects
- **Tool results** — Sent as messages with `role: "tool"` and `tool_call_id`
- **Streaming** — SSE with `stream: true`, delta accumulation for tool call arguments that arrive in chunks

## Ollama

```json
{
  "providers": {
    "ollama": {
      "baseUrl": "http://127.0.0.1:11434",
      "defaultModel": "llama3"
    }
  }
}
```

### Translation Details

- **API endpoint** — `POST {baseUrl}/api/chat`
- **Format** — OpenAI-compatible tool calling format
- **Tool call IDs** — Ollama doesn't provide tool call IDs, so BearClaw generates synthetic ones (`ollama_call_0`, `ollama_call_1`, etc.)
- **Streaming** — Native NDJSON streaming

No API key needed. Ollama runs locally and handles its own model management.

## CLI Delegation

```json
{
  "providers": {
    "cliDelegation": {
      "command": "claude",
      "flags": ["--allowedTools", "mcp__*"],
      "outputParser": "text",
      "jsonlMessageType": "agent_message"
    }
  }
}
```

CLI Delegation spawns an external CLI tool as a subprocess and captures its output. This is how BearClaw integrates with tools that have their own capabilities (like MCP support).

### How It Works

1. The last user message is extracted as the prompt
2. The command is built using known CLI patterns:
   - **claude**: `claude --dangerously-skip-permissions [flags] -p "prompt"`
   - **codex**: `codex exec --dangerously-bypass-approvals-and-sandbox --json [flags] "prompt"`
   - **generic**: `command [flags] "prompt"`
3. The subprocess runs with `AbortSignal` support for graceful termination
4. Output is parsed based on `outputParser`:
   - `text` — Raw stdout returned as content
   - `jsonl` — Lines parsed as JSON, extracting the message matching `jsonlMessageType`

### Security Warning

CLI Delegation bypasses BearClaw's security model. The spawned CLI runs with its own permissions and BearClaw has no visibility into what tools it uses. The PolicyEngine requires an explicit `{ action: "allow", scope: "cli_delegation" }` rule.

### Adding New CLI Tools

Adding support for a new CLI tool requires only a config entry. If the tool needs special argument patterns, extend `buildArgs()` in `src/providers/cli-delegation.ts`.

## Retry Behavior

All HTTP-based providers (Anthropic, OpenAI, Ollama) use `fetchWithRetry()`:

- **Max retries**: 3 (configurable)
- **Backoff**: Exponential — 1s, 2s, 4s
- **Retried errors**: HTTP 429 (rate limit), 5xx (server errors), `ECONNREFUSED`, `TypeError` (network errors)
- **Immediate failures**: HTTP 401 (authentication errors)

## Streaming

All providers support streaming when an `onToken` callback is provided in `ChatOptions`:

```typescript
interface ChatOptions {
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  onToken?: (token: string) => void;
}
```

The `onToken` callback receives text tokens as they arrive. In the CLI entry point, this is wired to `process.stdout.write()` for real-time output.

## Choosing a Provider

| Provider | Use Case | Tool Calling | Streaming | Local |
|---|---|---|---|---|
| Anthropic | Production, strong reasoning | Native | SSE | No |
| OpenAI | Production, broad model selection | Native | SSE | No |
| Ollama | Local development, privacy | Native | NDJSON | Yes |
| CLI Delegation | MCP access, external tools | Via delegated CLI | No | Depends |
