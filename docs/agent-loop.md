# Agent Loop

The agent loop is the core execution cycle that drives BearClaw's AI agents. It handles LLM communication, tool execution, and conversation management.

## How It Works

```
┌─────────────────┐
│   User Message   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Call LLM with   │◄──────────────────┐
│  messages + tools │                   │
└────────┬────────┘                    │
         │                             │
         ▼                             │
    ┌────────────┐                     │
    │ Tool calls? │──── No ──► Return response
    └────┬───────┘
         │ Yes
         ▼
┌─────────────────┐
│ Run before-hooks │
│ (sequential)     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Execute tools    │
│ (in parallel)    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Run after-hooks  │
│ (parallel, async)│
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Append results   │────────────────────┘
│ to messages      │
└─────────────────┘
```

### Loop Termination

The loop ends when:
- The LLM returns a response with no tool calls (normal completion)
- `maxIterations` is reached
- `maxTotalTokens` budget is exceeded
- The `AbortSignal` fires

### Parallel Tool Execution

When the LLM requests multiple tool calls in a single response, BearClaw executes them in parallel using `Promise.all()`. This significantly reduces latency when tools are independent (e.g., reading multiple files).

Each tool call still runs through the full hook pipeline individually:
1. Before-hooks (sequential, blocking)
2. Tool execution
3. After-hooks (parallel, fire-and-forget)

Results are appended to the conversation in the original order, regardless of which tool finishes first.

## Configuration

```typescript
interface AgentLoopConfig {
  provider: LLMProvider;       // Which LLM to call
  model: string;               // Model identifier
  tools: ToolRegistry;         // Available tools
  hooks: ToolHookRegistry;     // Hook pipeline
  maxIterations: number;       // Max loop iterations (default: 25)
  maxTotalTokens?: number;     // Token budget per turn
  options?: {
    maxTokens?: number;        // Max tokens per LLM call
    temperature?: number;      // LLM temperature
    onToken?: (token: string) => void;  // Streaming callback
  };
}
```

### Token Budget

If `maxTotalTokens` is set, the loop tracks cumulative token usage across all LLM calls and stops when the budget is exceeded. This prevents runaway agents from consuming excessive tokens.

## Result

```typescript
interface AgentLoopResult {
  content: string;             // Final text response
  iterations: number;          // How many loop iterations ran
  toolsUsed: Array<{           // All tool calls made
    name: string;
    result: ToolResult;
  }>;
  totalTokens: number;         // Total tokens consumed
}
```

## Session Persistence

Sessions are stored as JSON files at `~/.bearclaw/sessions/{agentId}_{channel}_{chatId}.json`.

### Loading

On startup, the session file is loaded and trimmed to the most recent `MAX_SESSION_MESSAGES` (100) messages. If the file doesn't exist, an empty array is returned.

### Saving

After each conversation turn, the session is saved. Messages are trimmed before writing to prevent unbounded growth.

### Session Scope

Sessions are scoped by three dimensions:
- **Agent ID** — Each agent has its own conversation history
- **Channel** — CLI and Telegram sessions are separate
- **Chat ID** — Different Telegram chats have separate sessions; CLI uses `"repl"` as the chat ID

## Context Assembly

The system prompt is built by `buildSystemPrompt()` from multiple sources, concatenated in order:

### 1. System Prompt Files

Files listed in `AgentConfig.systemPromptFiles` are loaded and concatenated. These are your agent's identity and instructions:

```json
{
  "agents": {
    "default": {
      "systemPromptFiles": ["prompts/SOUL.md", "prompts/IDENTITY.md"]
    }
  }
}
```

### 2. Tool Descriptions

A summary of available tools (names and short descriptions) is appended so the agent knows what tools it can use.

### 3. Memory Files

If memory is enabled, files listed in `memory.alwaysLoad` (default: `["active-tasks.md"]`) are loaded from the memory directory and appended to the system prompt. This gives agents persistent context across sessions.

### 4. Team Context

If the agent is part of a team, teammate names, team purpose, and mention syntax (`[@agent: message]`) are appended.

## CLI vs Daemon

### CLI Mode

The CLI entry point (`src/index.ts`) runs a single default agent in a REPL loop:
1. Load config, initialize subsystems
2. Create provider for default agent
3. Load session, build system prompt
4. REPL: read user input → parse inline allows → run agent loop with streaming → display results
5. Save session on exit

### Daemon Mode

The daemon (`src/daemon.ts`) runs multiple agents with message bus routing:
1. Full startup sequence (config → security → providers → tools → hooks → bus → channels → gateway)
2. Inbound loop: consume from bus → route to agent → load session → run agent loop → parse mentions → fan-out
3. Outbound loop: consume from bus → dispatch via channel
4. Graceful shutdown: abort signals → drain queues → flush hooks → stop channels
