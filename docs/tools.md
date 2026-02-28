# Tools

BearClaw provides a tool system with 10 built-in tools, user-defined skill tools (script-based and MCP), JSON Schema validation, and a hook pipeline for policy enforcement and extensibility.

## Tool Result Types

Every tool returns a `ToolResult` with different variants for different use cases:

| Factory | `forLLM` | `forUser` | `silent` | Use Case |
|---|---|---|---|---|
| `toolResult(msg)` | msg | — | — | Standard result, shown to LLM |
| `userResult(msg)` | msg | msg | — | Shown to both LLM and user |
| `silentResult(msg)` | msg | — | yes | LLM sees it but no user output |
| `asyncResult(msg)` | msg | — | — | Background task acknowledged |
| `errorResult(msg)` | msg | — | — | Error, `isError: true` |

## Built-in Tools

### read_file

Read a file from the filesystem.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `path` | string | yes | File path (relative to workspace or absolute if allowed) |

**Security**: Double path validation — raw path checked against forbidden paths, then resolved (real) path checked against workspace boundary to catch symlink escapes. Files over 10MB are rejected.

### write_file

Write content to a file.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `path` | string | yes | File path |
| `content` | string | yes | File content |

**Security**: Autonomy check (blocked in `readonly` mode), path validation, 10MB size limit. Parent directories are created automatically.

### edit_file

Find and replace an exact string in a file.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `path` | string | yes | File path |
| `old_string` | string | yes | Exact string to find |
| `new_string` | string | yes | Replacement string |

The `old_string` must appear exactly once in the file. If it appears zero times or more than once, the operation fails with an error. Returns a diff summary.

### list_dir

List directory contents.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `path` | string | yes | Directory path |
| `depth` | number | no | Recursion depth (default: 1, max: 5) |

Returns formatted listing with file/directory indicators and file sizes. Skips `.git` and `node_modules` directories.

### search

Search file contents with grep-like functionality.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `pattern` | string | yes | Search pattern (regex or literal) |
| `path` | string | no | Directory to search (default: workspace root) |
| `literal` | boolean | no | Treat pattern as literal string |
| `glob` | string | no | Filter files by glob pattern (e.g., `"*.ts"`) |
| `caseSensitive` | boolean | no | Case-sensitive search (default: true) |
| `maxResults` | number | no | Max results (default: 100, cap: 500) |
| `contextLines` | number | no | Lines of context around matches |

**Skips**: Binary files (null byte in first 8KB), files over 10MB, `.git` directory, `node_modules` directory. Double path validation applied.

### exec

Execute a shell command.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `command` | string | yes | Shell command to run |
| `timeout` | number | no | Timeout in ms (default: 60,000) |

**Security**: Command validated against allowlist and restricted commands. Rate limit checked. Simple commands (no pipes, `&&`, etc.) are optimized to `spawn(cmd, args)` directly instead of `spawn('sh', ['-c', command])`.

**Limits**: Output capped at 1MB. Default timeout 60 seconds.

### web_fetch

Fetch content from a URL.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `url` | string | yes | URL to fetch |

**Security**: SSRF guard validates the URL, resolves DNS, and blocks private IPs and metadata endpoints. Only HTTP and HTTPS protocols are allowed.

HTML responses are stripped to plain text. Content is truncated at 50,000 characters. Rate limit checked.

### web_search_exa

Search the web via Exa's free MCP endpoint.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | string | yes | Search query |
| `numResults` | number | no | Number of results (default: 8) |
| `type` | string | no | `"auto"`, `"fast"`, or `"deep"` (default: `"auto"`) |
| `livecrawl` | string | no | `"fallback"` or `"preferred"` (default: `"fallback"`) |
| `contextMaxCharacters` | number | no | Max characters per result context (default: 10,000) |

Results are returned as a plain-text summary. Content is truncated at 50,000 characters. Rate limit checked.

### spawn

Spawn a subagent to handle a task.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `task` | string | yes | What the subagent should do |
| `agentId` | string | no | Agent config to use (default: current agent) |
| `provider` | string | no | Override provider |
| `successCriteria` | string | no | What "done" looks like |
| `maxIterations` | number | no | Max iterations (default: 10) |

The subagent runs its own agent loop in the same Node process. It gets a restricted tool registry (no `spawn` or `message` tools to prevent recursive spawning). The subagent's final response is returned as the tool result.

### message

Send a message to a specific channel and chat.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `channel` | string | yes | Target channel (e.g., `"gateway"`) |
| `chatId` | string | yes | Target chat ID |
| `content` | string | yes | Message content |

Used for cross-channel communication. The PolicyEngine controls access via the `"message"` scope.

## MCP Tools

BearClaw can connect to MCP (Model Context Protocol) servers configured in `bearclaw.jsonc`, via either **stdio** (local subprocess) or **HTTP Streamable** (remote URL) transport. Tools discovered from each server are registered with a `{serverName}_{toolName}` prefix and go through the same security pipeline (hooks, policy, rate limiting) as built-in tools.

See [Configuration](configuration.md#mcp-servers) for setup.

## Tool Registry

The `ToolRegistryImpl` manages tool registration and execution:

- **`register(tool)`** — Add a tool to the registry
- **`get(name)`** — Get a tool by name
- **`list()`** — List all registered tool names
- **`execute(ctx, name, args)`** — Validate args against JSON Schema, execute tool, catch errors
- **`toProviderDefs()`** — Convert registered tools to provider-compatible `ToolDefinition[]`

## JSON Schema Validation

Tool arguments are validated against their JSON Schema before execution (`src/tools/validate.ts`). The validator supports:

- Required field checking
- Type validation: `string`, `number`, `integer`, `boolean`, `array`, `object`
- Enum values
- Min/max for numbers
- Nested object and array validation

Invalid arguments produce a descriptive error result without executing the tool.

## Tool Hooks

Hooks allow intercepting tool calls before and after execution:

### Before Hooks

- Run **sequentially** (each hook sees the result of the previous)
- Can **block** execution by returning `{ proceed: false }`
- Can **modify** arguments by returning `{ proceed: true, args: modifiedArgs }`
- The PolicyEngine is registered as the first before-hook

### After Hooks

- Run **in parallel** (fire-and-forget)
- Cannot modify results
- Tracked internally for graceful shutdown via `flush()`

### Hook Registration

```typescript
hooks.registerBefore(async (toolName, args, ctx) => {
  if (toolName === 'exec' && args.command?.includes('rm -rf')) {
    return { proceed: false, args };
  }
  return { proceed: true, args };
});

hooks.registerAfter(async (toolName, args, result, ctx) => {
  console.log(`Tool ${toolName} completed: ${result.isError ? 'error' : 'success'}`);
});
```

### Flush

On shutdown, `hooks.flush(timeoutMs)` awaits all pending after-hooks with a configurable timeout (default: 5 seconds) to ensure cleanup completes.
