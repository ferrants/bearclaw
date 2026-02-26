# BearClaw Architecture

## The Big Picture

BearClaw is a **self-hosted AI agent framework** — think of it as "build your own Claude Code / ChatGPT" that you run locally, with multiple LLM providers, multiple agents, and a serious security model. It has two modes:

1. **CLI REPL** (`src/index.ts`) — single-agent, interactive, like a chatbot in your terminal
2. **Daemon** (`src/daemon.ts`) — multi-agent, multi-channel server that can listen on CLI and HTTP simultaneously

## Multi-Agent Architecture

BearClaw uses a **two-tier config model**:

- **Instance config** (`~/.bearclaw/config.jsonc`) — infrastructure: API keys, gateway settings, channels, system-level security, monitoring
- **Agent config** (`bearclaw.jsonc` in an agent directory) — self-contained, cloneable agent definition: name, provider, model, security, policy, skills, memory, schedules

Each agent directory is a git repo with everything the agent needs:

```
~/code/my-agent/
├── bearclaw.jsonc          # agent config
├── prompts/                # system prompt files
├── skills/                 # agent-specific skills
├── memory/                 # agent memory files
├── .bearclaw/              # runtime state (.gitignore'd)
│   └── sessions/
└── workspace/              # where the agent operates
```

**One agent per directory.** Each directory has one externally-addressable **primary agent**. Any agents defined in `subagents` are internal — callable via the `spawn` tool but not routable by WS clients or `@mentions`.

**Agent names are flat** — no namespacing. The name comes from the `name` field in `bearclaw.jsonc`, or defaults to the directory name.

### Per-Agent Isolation

Each agent gets its own isolated instances of:
- `SecurityPolicy` (merged from instance + agent security, agent cannot weaken instance)
- `PolicyEngine` (agent rules evaluated first, instance defaults as fallback)
- `InlineAllowStore`
- Skills (loaded from agent dir, then instance dir)
- MCP client connections
- Session directory

Shared across all agents (singletons): built-in tool registry, provider factory, gateway, channels, event bus, message bus.

The merge rules enforce that **agents cannot weaken instance security**: `forbiddenPaths` is a union, `rateLimits` are capped by instance ceiling, `autonomy` takes the more restrictive level, and `allowedPaths` are filtered to the agent's directory tree.

### AgentRuntime and AgentRegistry

`AgentRuntime` (`src/config/agent-runtime.ts`) bundles all per-agent state. `AgentRegistry` (`src/config/agent-registry.ts`) holds all runtimes and provides lookups by name. The registry prefers `_default` as the default agent, otherwise uses the first registered.

### Backward Compatibility

When the instance config contains legacy agent-level fields (`agents`, `teams`, `memory`, `policy`, `schedules`, `mcp`, `workspace`), these are synthesized into an implicit `_default` agent. Existing setups work unchanged. A deprecation warning encourages migration to per-agent `bearclaw.jsonc` files.

### CLI Agent Discovery

The CLI walks up from `cwd` looking for `bearclaw.jsonc` (like git finds `.git`). The `--agent`/`-a` flag overrides with an explicit path. If no agent dir is found, the CLI falls back to legacy instance config. The `/agent` command shows the active agent.

## The Agent Loop (the core)

Everything revolves around `src/agent/loop.ts`, which is a classic **ReAct-style loop**:

```
while (iterations < max):
    1. Call LLM with conversation history + tool definitions
    2. If LLM returns no tool calls → done, return the text response
    3. Otherwise, for each tool call:
       a. Run before-hooks (blocking) — PolicyEngine can deny the call
       b. Execute the tool
       c. Run after-hooks (fire-and-forget)
    4. Append tool results to message history
    5. Go back to step 1
```

Tool calls execute **in parallel** via `Promise.all` — if the LLM requests 3 tools at once, they all run concurrently.

## Security Pipeline (defense-in-depth)

Every tool call passes through multiple layers before it actually executes:

- **PolicyEngine** (registered as a before-hook in daemon mode) — evaluates rules to allow/deny/require-approval per tool, per agent, per channel
- **SecurityPolicy** — validates paths stay within the workspace, commands are on an allowlist, blocks shell injection patterns (`$()`, backticks, redirects), resolves symlinks to prevent escapes
- **ScopedRateLimiter** — sliding-window rate limits scoped per agent and per tool
- **InlineAllowStore** — lets users grant temporary permissions inline in their message
- **ApprovalManager** — manages approval workflows with TTL and caching
- Individual tools do their own checks too (e.g., `web-fetch` has SSRF guards, `exec` validates commands)

The autonomy level (`locked`, `supervised`, `auto`, `full`) acts as a global dial for how much freedom agents have.

## Sub-Agent Spawning

An agent can spawn child agents via the `spawn` tool (`src/tools/builtin/spawn.ts`). The child gets:
- Its own agent loop with its own iteration budget
- A **restricted tool registry** — no `spawn` and no `message` (prevents recursive spawning and direct channel access)
- The same security context as the parent

This is the **within-a-conversation** way to delegate work.

## Multi-Agent Orchestration (daemon only)

The daemon supports loading multiple agent directories as CLI args: `bearclaw daemon ~/agents/a1 ~/agents/a2`. Each gets its own `AgentRuntime` registered in the `AgentRegistry`. WS clients target agents by flat name via the `agentId` field. Sub-agents are NOT externally addressable — only primary agents appear in the mentionables list and can receive WS messages.

On top of that, the daemon adds **team-based routing with mention-driven fan-out/fan-in**:

1. **Message arrives** from a channel (CLI, HTTP gateway)
2. **Router** (`src/orchestrator/router.ts`) checks for `@agent` or `@team` prefix to decide who handles it
3. The agent is resolved from the `AgentRegistry` — each agent's message is processed with its own security policy, policy engine, and inline allow store
4. If it's a **team**, the message goes to the team's **leader agent** first
5. The leader's response is scanned for **mentions** like `[@coder: implement this] [@reviewer: review the code]`
6. Each mention triggers a new `processAgentMessage()` call — this is the **fan-out**
7. The **ConversationTracker** (`src/orchestrator/conversation.ts`) counts pending branches and collects responses
8. When all branches complete, it **aggregates** all agent responses and sends the combined result back — this is the **fan-in**

So a team interaction looks like: User → Leader → (Coder + Reviewer in parallel) → aggregated response back to user.

## Message Bus

The daemon's communication layer is a simple async queue (`src/bus/bus.ts`) with two sides:
- **Inbound queue** — channels push user messages in, the daemon's main loop consumes them
- **Outbound queue** — agent results get published here, the outbound loop dispatches them to the right channel

The bus uses an **async waiter pattern** — consumers block on a promise until a message arrives, so there's no polling. The `message` tool lets agents publish directly to the outbound bus, enabling agent-to-channel communication from within the loop.

## Provider Abstraction

All LLM providers (Anthropic, OpenAI, Ollama, CLI delegation) implement a single `chat()` method. Every provider uses raw `fetch()` — no SDKs. There's also a `CliDelegationProvider` that shells out to tools like `claude --print`, which is how BearClaw can leverage other AI CLIs as providers (though it logs a warning because this bypasses BearClaw's security model).

## Session Persistence

Conversations are saved as JSON files keyed by `{agentId}/{channel}/{chatId}`. In agent-dir mode, sessions are stored in `{agentDir}/.bearclaw/sessions/` (per-agent isolation). In legacy mode, they're stored in `~/.bearclaw/sessions/`. When you reconnect, the full message history is reloaded, so agents have memory across restarts.

---

**In short**: BearClaw is a security-hardened ReAct loop with pluggable LLM backends, a tool system with multi-layered policy enforcement, and a daemon mode that adds a message bus and team orchestration for multi-agent fan-out/fan-in workflows across CLI and WebSocket channels. Agents are self-contained, cloneable directories with per-agent security isolation.
