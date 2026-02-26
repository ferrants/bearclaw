# Tool Calling: Technical Reference

This document describes how BearClaw implements tool calling end-to-end — from tool definition and registration, through the agent loop, to provider-specific wire formats and back.

---

## 1. Tool Definition

Every tool implements the `Tool` interface (`src/tools/types.ts:68-73`):

```typescript
interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;  // JSON Schema
  execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult>;
}
```

The `parameters` field is a JSON Schema object that describes the tool's arguments. For example, the `exec` tool:

```typescript
parameters: {
  type: 'object',
  properties: {
    command: { type: 'string', description: 'The shell command to execute' },
  },
  required: ['command'],
}
```

### Tool Results

Tools return a `ToolResult` (`src/tools/types.ts:8-15`) with these fields:

| Field     | Purpose |
|-----------|---------|
| `forLLM`  | String content sent back to the LLM as the tool call result |
| `forUser` | Optional string shown to the human user (e.g., command output) |
| `silent`  | If true, result is sent to LLM but hidden from user |
| `isError` | Whether the tool call failed |
| `async`   | Whether the tool is running asynchronously |

Five factory functions create these variants:

- `toolResult(forLLM)` — standard result, LLM-only
- `userResult(content)` — same content to both LLM and user
- `silentResult(forLLM)` — LLM-only, flagged as silent
- `asyncResult(forLLM)` — marks the result as async (tool still running)
- `errorResult(message)` — error result with `isError: true`

### Built-in Tools

BearClaw ships with 10 tools:

| Tool | File | Description |
|------|------|-------------|
| `read_file` | `src/tools/builtin/read-file.ts` | Read file contents |
| `write_file` | `src/tools/builtin/write-file.ts` | Write content to a file |
| `edit_file` | `src/tools/builtin/edit-file.ts` | Edit a file |
| `list_dir` | `src/tools/builtin/list-dir.ts` | List directory contents |
| `search` | `src/tools/builtin/search.ts` | Search files |
| `exec` | `src/tools/builtin/exec.ts` | Execute shell commands |
| `web_fetch` | `src/tools/builtin/web-fetch.ts` | Fetch a URL |
| `web_search_exa` | `src/tools/builtin/web-search-exa.ts` | Web search via Exa MCP endpoint |
| `spawn` | `src/tools/builtin/spawn.ts` | Spawn a sub-agent |
| `message` | `src/tools/builtin/message.ts` | Send a message to a channel (daemon only) |

---

## 2. Tool Registration

At startup, both entry points (`src/index.ts`, `src/daemon.ts`) create a `ToolRegistryImpl` (`src/tools/registry.ts`) and register each tool:

```typescript
const toolRegistry = new ToolRegistryImpl();
toolRegistry.register(readFileTool);
toolRegistry.register(writeFileTool);
// ... etc
```

The registry is a `Map<string, Tool>` that provides:

- **`register(tool)`** — stores the tool by name
- **`get(name)`** — retrieves a tool by name
- **`list()`** — returns all registered tool names
- **`execute(ctx, name, args)`** — validates args against the tool's JSON Schema, then calls `tool.execute()`
- **`toProviderDefs()`** — converts all tools to the provider-agnostic `ToolDefinition` format for sending to the LLM

### Argument Validation

Before any tool executes, the registry calls `validateArgs()` (`src/tools/validate.ts`). This performs JSON Schema validation:

1. Checks all `required` fields are present (not `undefined` or `null`)
2. Type-checks each provided argument against the schema (`string`, `number`, `integer`, `boolean`, `array`, `object`)
3. Validates `enum`, `minimum`, `maximum` constraints

If validation fails, the tool call short-circuits with an `errorResult` — the tool's `execute()` is never called.

---

## 3. The Agent Loop

The core loop lives in `src/agent/loop.ts`. Here's the complete flow:

```
runAgentLoop(config, messages, ctx)
│
├── while (iteration < maxIterations)
│   │
│   ├── 1. Check token budget
│   │      If totalTokens >= maxTotalTokens → return early
│   │
│   ├── 2. Convert tools to provider format
│   │      toolDefs = tools.toProviderDefs()
│   │
│   ├── 3. Call LLM
│   │      response = provider.chat(messages, toolDefs, model, options)
│   │      │
│   │      └── Returns: { content, toolCalls[], finishReason, usage }
│   │
│   ├── 4. Track token usage
│   │      totalTokens += response.usage.totalTokens
│   │
│   ├── 5. Check for tool calls
│   │      If toolCalls is empty → DONE, return response.content
│   │
│   ├── 6. Append assistant message to history
│   │      messages.push({ role: 'assistant', content, toolCalls })
│   │
│   ├── 7. Execute ALL tool calls in parallel
│   │      Promise.all(response.toolCalls.map(tc => {
│   │      │
│   │      │  a. Run before-hooks (sequential, blocking)
│   │      │     hookResult = hooks.runBefore(tc.name, tc.arguments, ctx)
│   │      │     │
│   │      │     └── If !hookResult.proceed → errorResult("blocked by policy")
│   │      │
│   │      │  b. Execute the tool
│   │      │     result = tools.execute(ctx, tc.name, hookResult.args)
│   │      │     │
│   │      │     ├── validateArgs() against JSON Schema
│   │      │     └── tool.execute(ctx, args)
│   │      │
│   │      │  c. Run after-hooks (parallel, fire-and-forget)
│   │      │     hooks.runAfter(tc.name, hookResult.args, result, ctx)
│   │      │
│   │      │  return { tc, result }
│   │      }))
│   │
│   └── 8. Append tool results to message history (in original order)
│          for each { tc, result }:
│            messages.push({ role: 'tool', content: result.forLLM, toolCallId: tc.id })
│
└── Return: { content, iterations, toolsUsed, totalTokens }
```

### Key Design Decisions

**Parallel tool execution.** All tool calls from a single LLM response run concurrently via `Promise.all`. If the LLM requests `read_file`, `list_dir`, and `exec` in one turn, all three execute simultaneously. Results are appended to the message history in the original order the LLM requested them, not in completion order.

**Before-hooks are blocking and sequential.** Each before-hook runs one at a time. If any hook returns `{ proceed: false }`, the tool call is replaced with an error result — the tool never executes. Hooks can also modify `args` (the modified args are passed to the next hook and eventually to the tool).

**After-hooks are fire-and-forget.** They run in parallel and don't block the loop. Failed after-hooks are logged but don't affect the result. Pending after-hooks are tracked for graceful shutdown via `hooks.flush()`.

**The loop terminates when:**
1. The LLM returns a response with no tool calls (natural completion)
2. The iteration limit is reached (`maxIterations`, default 25)
3. The token budget is exhausted (`maxTotalTokens`)

---

## 4. The Hook Pipeline

Hooks are registered on a `ToolHookRegistryImpl` (`src/tools/hooks.ts`). The interface:

```typescript
type BeforeToolCallHook = (
  toolName: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
) => Promise<{ proceed: boolean; args: Record<string, unknown> }>;

type AfterToolCallHook = (
  toolName: string,
  args: Record<string, unknown>,
  result: ToolResult,
  ctx: ToolContext,
) => Promise<void>;
```

### Before-Hook Chain

Before-hooks run as a sequential pipeline. Each hook receives the `args` object (potentially modified by the previous hook) and returns either:
- `{ proceed: true, args }` — continue to the next hook (or execute the tool)
- `{ proceed: false, args }` — abort the tool call

If any hook throws an exception, the tool call is also aborted (treated as `proceed: false`).

In daemon mode, the PolicyEngine is registered as the first before-hook (`src/daemon.ts:132-165`). It evaluates the policy rules against the tool call context and can deny execution. In CLI mode, no before-hooks are registered — tools only go through the `SecurityPolicy` checks within each tool's own `execute()` method.

### After-Hook Chain

After-hooks all run in parallel via `Promise.all`. Their promises are tracked in `pendingAfterHooks` so the daemon can await them during graceful shutdown (`flush()` waits up to 5 seconds).

---

## 5. The ToolContext (Dependency Injection)

Every tool receives a `ToolContext` (`src/tools/types.ts:52-66`) that provides access to the full security and runtime environment:

```typescript
interface ToolContext {
  signal: AbortSignal;            // Cancellation signal
  channel?: string;               // Channel name (e.g., "gateway", "cli")
  chatId?: string;                // Chat/conversation ID
  policy: SecurityPolicy;         // Path/command validation, rate limiting
  policyEngine: PolicyEngine;     // Rule-based policy evaluation
  approvalManager: ApprovalManager;
  inlineAllowStore: InlineAllowStore;
  toolRegistry: ToolRegistry;     // Access to other tools (used by spawn)
  hooks: ToolHookRegistry;        // Hook registry (used by spawn)
  agentConfigs: Record<string, AgentConfig>;
  currentAgentConfig: AgentConfig;
  providerFactory: (name: string) => LLMProvider;  // Create new providers (used by spawn)
}
```

This is the DI container — tools don't import security modules directly. They receive everything through `ctx`, which makes them testable (tests create partial contexts with `as ToolContext`).

In multi-agent mode, each agent's `ToolContext` is populated from its `AgentRuntime` — the `policy`, `policyEngine`, `inlineAllowStore`, and `agentConfigs` fields all come from the per-agent runtime, ensuring security isolation between agents.

---

## 6. Provider Translation Layer

The agent loop works with a provider-agnostic message format (`src/providers/types.ts`). Each provider translates to/from its API-specific format.

### Internal Message Format

```typescript
interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ToolCall[];     // Present on assistant messages with tool use
  toolCallId?: string;        // Present on tool result messages
}

interface ToolCall {
  id: string;                 // Provider-assigned ID for correlating results
  name: string;               // Tool name
  arguments: Record<string, unknown>;  // Parsed arguments
}
```

### Anthropic Translation (`src/providers/anthropic.ts`)

**Tools → API:**
```
{ name, description, parameters }  →  { name, description, input_schema: parameters }
```

**Assistant message with tool calls → API:**
```
{ role: 'assistant', toolCalls: [...] }
→
{ role: 'assistant', content: [
    { type: 'text', text: '...' },
    { type: 'tool_use', id: '...', name: '...', input: {...} }
  ]
}
```

**Tool result → API:**
```
{ role: 'tool', content: '...', toolCallId: '...' }
→
{ role: 'user', content: [{ type: 'tool_result', tool_use_id: '...', content: '...' }] }
```
Note: Anthropic requires tool results to be sent as `role: 'user'` with a `tool_result` content block.

**API response → Internal:**
The response `content` array is iterated. `text` blocks are concatenated into `content`. `tool_use` blocks become `ToolCall` objects. The `stop_reason` is mapped: `'tool_use'` → `'tool_calls'`, `'max_tokens'` → `'length'`, else `'stop'`.

**Streaming:** Tool call arguments arrive incrementally as `input_json_delta` events. The provider accumulates the JSON string and parses it on `content_block_stop`.

### OpenAI Translation (`src/providers/openai.ts`)

**Tools → API:**
```
{ name, description, parameters }
→
{ type: 'function', function: { name, description, parameters } }
```

**Assistant message with tool calls → API:**
```
{ role: 'assistant', toolCalls: [...] }
→
{ role: 'assistant', content: '...',
  tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(...) } }]
}
```
Note: OpenAI sends arguments as a JSON string, not a parsed object.

**Tool result → API:**
```
{ role: 'tool', content: '...', toolCallId: '...' }
→
{ role: 'tool', tool_call_id: '...', content: '...' }
```
OpenAI keeps the `role: 'tool'` directly (unlike Anthropic which wraps it in a `user` message).

**Streaming:** Tool calls arrive as indexed deltas. The provider maintains a `Map<number, { id, name, argsStr }>` and accumulates argument string fragments. On stream completion, each accumulated entry is parsed and added to the `toolCalls` array.

### CLI Delegation (`src/providers/cli-delegation.ts`)

This provider shells out to external CLIs (e.g., `claude`, `codex`). It extracts the last user message as a prompt, spawns the process, and returns the stdout as `content`. **Tool calls are never returned** — this provider always returns `{ toolCalls: [], finishReason: 'stop' }`, so the agent loop always terminates in one iteration when using CLI delegation.

Notably, it passes `--dangerously-skip-permissions` to Claude and `--dangerously-bypass-approvals-and-sandbox` to Codex.

---

## 7. Retry and Error Handling

### Provider Retry (`src/providers/retry.ts`)

`fetchWithRetry()` wraps all provider HTTP calls with exponential backoff:

- **Retries on:** HTTP 429 (rate limit), HTTP 5xx, `ECONNREFUSED`, `TypeError` (network errors)
- **Fails immediately on:** HTTP 401 (auth failure), other 4xx errors
- **Backoff:** `1000 * 2^attempt` ms (1s, 2s, 4s)
- **Max retries:** 3 (4 total attempts)

### Tool Execution Errors

The registry (`src/tools/registry.ts:35-41`) wraps every `tool.execute()` in a try/catch. Uncaught exceptions become `errorResult` messages, so the LLM sees the error and can adjust. The agent loop never crashes from a tool failure.

### Stream Parse Errors

Both Anthropic and OpenAI streaming implementations silently skip malformed JSON lines in the SSE stream. If tool call argument JSON fails to parse, the tool call is still emitted with empty `arguments: {}`.

---

## 8. Sub-Agent Tool Calls

The `spawn` tool (`src/tools/builtin/spawn.ts`) creates a nested agent loop. The key differences from the parent loop:

1. **Restricted tool registry** — the child gets a copy of the parent's tools but with `spawn` and `message` removed. This prevents recursive spawning and direct channel access.
2. **Separate iteration budget** — capped at `min(requested, parent's maxIterations)`, default 10.
3. **Own message history** — starts fresh with a system prompt derived from the task description.
4. **Same security context** — inherits the parent's `ToolContext` (same policy, same hooks, same rate limiters).
5. **Can use a different provider** — the `provider` argument lets the parent delegate to a different LLM backend.

The child's final response is returned as a `toolResult` to the parent agent, which sees it as a normal tool call result.

---

## 9. Complete Example: One Iteration

Here's what happens when the LLM requests `exec` with `{"command": "ls -la"}`:

```
1. LLM response arrives:
   { content: "Let me list the files.", toolCalls: [{ id: "tc_1", name: "exec", arguments: { command: "ls -la" } }] }

2. Assistant message appended to history:
   { role: "assistant", content: "Let me list the files.", toolCalls: [...] }

3. Before-hooks run (sequential):
   PolicyEngine.evaluate({ toolName: "exec", scope: "exec", command: "ls -la", agentId: "default" })
   → { action: "allow" }  →  { proceed: true, args: { command: "ls -la" } }

4. Registry validates args:
   validateArgs(execTool.parameters, { command: "ls -la" })
   → { valid: true, errors: [] }

5. exec tool executes:
   a. Rate limit check → not limited
   b. SecurityPolicy.isCommandAllowed("ls -la") → true ("ls" is on the allowlist)
   c. SecurityPolicy.recordAction("exec", "default")
   d. spawn("ls", ["-la"], { cwd: workspaceDir }) → "total 42\ndrwxr-xr-x ..."

6. Tool returns:
   userResult("total 42\ndrwxr-xr-x ...")
   → { forLLM: "total 42\n...", forUser: "total 42\n...", isError: false, async: false }

7. After-hooks run (fire-and-forget, parallel):
   (none registered in this example)

8. Tool result appended to history:
   { role: "tool", content: "total 42\ndrwxr-xr-x ...", toolCallId: "tc_1" }

9. Loop continues → LLM called again with the updated history
```

---

## 10. Message History Shape

After several iterations, the message array looks like this:

```
[0]  { role: "system",    content: "You are..." }
[1]  { role: "user",      content: "Find all TypeScript files" }
[2]  { role: "assistant", content: "I'll search for TS files.", toolCalls: [{ id: "tc_1", name: "exec", args: { command: "find . -name '*.ts'" } }] }
[3]  { role: "tool",      content: "src/index.ts\nsrc/daemon.ts\n...", toolCallId: "tc_1" }
[4]  { role: "assistant", content: "Let me read the main entry point.", toolCalls: [{ id: "tc_2", name: "read_file", args: { path: "src/index.ts" } }] }
[5]  { role: "tool",      content: "#!/usr/bin/env node\nimport ...", toolCallId: "tc_2" }
[6]  { role: "assistant", content: "Here's what I found: ..." }
```

Each provider's `translateMessages()` method converts this internal format into the API-specific shape before sending. The internal format is the source of truth, stored in session files as JSON.

Sessions are truncated to 100 messages (`MAX_SESSION_MESSAGES`) on both load and save to prevent unbounded growth.
