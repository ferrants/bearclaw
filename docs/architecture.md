# Architecture

BearClaw is designed around a few key principles: defense-in-depth security, minimal dependencies, and clean separation of concerns.

## Design Decisions

### Memory = Markdown Files

Memory lives in the workspace as plain markdown files:

```
~/.bearclaw/workspace/memory/
  active-tasks.md       # Always loaded into system prompt
  lessons.md            # Long-term learnings
  projects.md           # Project-specific context
  YYYY-MM-DD.md         # Daily logs
```

Agents read and write these with `read_file`/`write_file` tools. No database, no vector search, no embedding cache. The agent's intelligence is the search engine.

### Skills = SKILL.md Files

Skills live in `{workspace}/skills/{name}/SKILL.md` with YAML frontmatter and markdown instructions. BearClaw scans the directory at startup, parses frontmatter with a zero-dependency YAML parser, and injects skill metadata into the system prompt. Skills are purely instruction-based — compatible with Claude Code's Agent Skills format. The same `SKILL.md` works in both tools.

### MCP Client

BearClaw includes a built-in MCP client that communicates over stdio using JSON-RPC 2.0. MCP servers are configured in `config.json` and spawned at startup, with tools discovered via `tools/list` and registered automatically. Additionally, CLI Delegation remains available for tools that need full MCP support via external processes.

### Sessions = JSON Files

Session history is stored as JSON arrays of Message objects. Simple, readable, no database dependency. Files are trimmed to 100 messages on load to prevent unbounded growth.

### No SDK Dependencies

All LLM providers use `fetch()` directly. This eliminates heavy SDK dependencies, gives full control over request/response handling, and makes the provider translation logic explicit and transparent.

The only runtime dependencies are:
- `@noble/ciphers` — Pure JavaScript ChaCha20-Poly1305 encryption
- `node-telegram-bot-api` — Telegram Bot API client

## Directory Structure

```
bearclaw/
  src/
    index.ts                          # CLI entry point (REPL + headless)
    daemon.ts                         # Daemon (channels + bus + orchestrator)
    logging.ts                        # Structured JSON logging
    events.ts                         # Typed EventBus

    config/
      schema.ts                       # All TypeScript types
      defaults.ts                     # Default values, constants
      config.ts                       # Load/save config, deep merge, encrypt-on-startup

    security/
      policy.ts                       # Path validation, command allowlist
      policy-engine.ts                # Rule-based allow/deny/approve
      approvals.ts                    # Scoped approval caching
      inline-allow.ts                 # [allow: once|day tool pattern] parsing
      secrets.ts                      # ChaCha20-Poly1305 AEAD
      pairing.ts                      # CSPRNG codes, SHA-256 tokens, lockout
      rate-limiter.ts                 # Sliding window, global + per-agent + per-tool
      ssrf.ts                         # DNS pinning, private IP blocking

    providers/
      types.ts                        # LLMProvider, Message, ToolCall, LLMResponse
      retry.ts                        # fetchWithRetry() with exponential backoff
      anthropic.ts                    # Anthropic API translation + streaming
      openai.ts                       # OpenAI API translation + streaming
      ollama.ts                       # Ollama local HTTP
      cli-delegation.ts               # Generic CLI subprocess provider

    tools/
      types.ts                        # Tool, ToolResult, ToolContext
      validate.ts                     # JSON Schema validation
      registry.ts                     # Registration, execution, provider defs
      hooks.ts                        # Before/after hooks with flush
      builtin/
        read-file.ts                  # Double path validation, 10MB limit
        write-file.ts                 # Autonomy check, auto-create parents
        edit-file.ts                  # Exact string find-and-replace
        list-dir.ts                   # Recursive with depth, skip .git/node_modules
        search.ts                     # Grep-like, binary skip, glob filter
        exec.ts                       # Allowlist, simple command optimization
        web-fetch.ts                  # SSRF guard, HTML strip, truncate
        spawn.ts                      # Provider-agnostic subagent
        message.ts                    # Cross-channel send

    skills/
      types.ts                        # SkillDef
      frontmatter.ts                  # Zero-dependency YAML frontmatter parser
      loader.ts                       # Scan skills/, parse SKILL.md, validate
      index.ts                        # Barrel exports

    mcp/
      client.ts                       # JSON-RPC 2.0 over stdio
      tool.ts                         # MCP tools → Tool[]
      index.ts                        # Barrel exports

    agent/
      loop.ts                         # LLM call → parallel tools → loop
      context.ts                      # System prompt assembly with truncation
      session.ts                      # JSON file persistence

    bus/
      types.ts                        # InboundMessage, OutboundMessage
      bus.ts                          # Async queues, waiter pattern

    channels/
      types.ts                        # Channel interface
      cli.ts                          # stdin/stdout REPL
      telegram.ts                     # Telegram bot

    orchestrator/
      conversation.ts                 # Pending counter, fan-out/fan-in, reaper
      router.ts                       # @agent/@team prefix routing
      mentions.ts                     # [@agent: message] parsing
      team.ts                         # Team config resolution

    gateway/
      server.ts                       # HTTP server with pairing auth

    cli/
      policy-status.ts                # Policy status display

  tests/                              # 193 tests across 22 files
    security/                         # policy, secrets, rate-limiter, ssrf
    tools/                            # registry, hooks, exec, validate
    providers/                        # anthropic, openai
    orchestrator/                     # conversation, mentions, router
    agent/                            # loop, context
    skills/                           # frontmatter, loader
    mcp/                              # client
    bus/                              # bus
```

## Data Flow

### CLI Mode

```
User Input → Inline Allow Parsing → Agent Loop → LLM
                                        ↕
                                   Tool Execution
                                   (with hooks)
                                        │
                                        ▼
                                   Display Response
```

### Daemon Mode

```
Channel (CLI/Telegram)
    │
    ▼
Message Bus (inbound queue)
    │
    ▼
Router (@agent/@team/default)
    │
    ▼
Agent Loop ◄──► Tool Execution (with hooks)
    │
    ▼
Mention Parsing → Fan-out to other agents
    │
    ▼
Conversation Tracker (pending counter)
    │
    ▼ (pending === 0)
Aggregate Responses
    │
    ▼
Message Bus (outbound queue)
    │
    ▼
Channel.send()
```

### Security Pipeline (per tool call)

```
Tool Call Request
    │
    ▼
PolicyEngine (before-hook) ──► deny → Error result
    │ allow/approve
    ▼
SecurityPolicy checks (paths, commands)
    │
    ▼
Rate Limit check
    │
    ▼
Tool-specific validation (SSRF, size limits, etc.)
    │
    ▼
Execute
    │
    ▼
After-hooks (parallel, async)
```

## Pattern Origins

BearClaw cherry-picks patterns from five projects:

| Pattern | Source | Why |
|---|---|---|
| Security model | ZeroClaw | Defense-in-depth: sandboxing, allowlists, encrypted secrets, auth, rate limiting |
| Multi-agent orchestration | TinyClaw | Queue-based fan-out, handoffs, conversation aggregation via pending counter |
| Tool result types | PicoClaw | ForLLM/ForUser/Silent/Async — cleanest separation of concerns |
| Tool hooks | OpenClaw | Before/after hooks, AbortSignal, streaming progress |
| Hybrid tool calling | TinyClaw + PicoClaw | Native agentic loop by default, CLI delegation as optional provider |
| Provider abstraction | PicoClaw | Per-provider translation, explicit and transparent |
| Memory system | OpenClaw | Markdown files: active-tasks, lessons, projects, daily logs |
| Message bus | PicoClaw | Async inbound/outbound queues, channel-keyed handlers |

## Post-MVP Roadmap

1. ~~Custom MCP client~~ — ✅ Built-in MCP client with JSON-RPC 2.0 over stdio
2. ~~Skills system~~ — ✅ SKILL.md files with script tools and MCP servers
3. Plugin system — tools + hooks + channels from npm packages
4. Cron scheduler + heartbeat — recurring tasks in fresh sessions
5. Crash recovery journal — structured task journaling beyond active-tasks.md
6. Content-aware model escalation — stronger models for external content
7. Blackboard — shared key-value store for agent coordination
8. `bearclaw init` — guided setup wizard
9. Config splitting — `~/.bearclaw/conf.d/*.json` overlay merge
10. Secret rotation — `bearclaw secrets rotate`
