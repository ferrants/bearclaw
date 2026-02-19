# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build          # Compile TypeScript (tsc)
npm run dev            # Run CLI with tsx (no build needed)
npm run daemon         # Run daemon with tsx
npm test               # Run all tests (vitest run)
npm run test:watch     # Tests in watch mode
npm run typecheck      # Type check without emitting
npx vitest run tests/security/policy.test.ts   # Run a single test file
```

## Architecture

BearClaw is an AI agent framework with two entry points: a CLI REPL (`src/index.ts`) and a multi-channel daemon (`src/daemon.ts`). Both share the same core subsystems wired up in `main()`.

### Core Loop

The agent loop (`src/agent/loop.ts`) drives everything: call LLM → execute tool calls in parallel (`Promise.all`) → append results → repeat until no tool calls or limits hit. Before-hooks run sequentially and can block; after-hooks run in parallel fire-and-forget.

### Provider Abstraction

All providers (`src/providers/`) implement `LLMProvider` with a single `chat()` method. Each translates to/from its API format internally. All use `fetch()` directly — no SDKs. The `fetchWithRetry()` utility handles exponential backoff.

### Tool System

Tools implement `Tool` interface with JSON Schema `parameters` and an `execute(ctx, args)` method returning `ToolResult`. The registry validates args against the schema before execution. Result variants: `toolResult` (LLM only), `userResult` (LLM + user), `silentResult`, `errorResult`, `asyncResult`.

The `ToolContext` is the DI container — every tool receives it with access to security policy, hooks, registry, agent config, and provider factory.

### Security Pipeline

Every tool call passes through: PolicyEngine (before-hook, rule-based allow/deny) → SecurityPolicy (path/command validation) → rate limiter → tool-specific checks (SSRF, size limits). Security modules are in `src/security/`.

### Daemon-Specific

The daemon adds: message bus (`src/bus/`) with async queues, channels (`src/channels/` — CLI, Telegram), multi-agent orchestration (`src/orchestrator/` — routing, mentions, conversation fan-out/fan-in), and HTTP gateway (`src/gateway/`) with pairing auth.

## Key Conventions

- **ESM with `.js` extensions** in all imports (Node16 module resolution): `import { Foo } from './foo.js'`
- **`import type`** for type-only imports
- **Strict TypeScript** — `unknown` over `any`, explicit types on all function params
- **File naming**: kebab-case (`policy-engine.ts`, `read-file.ts`)
- **Two runtime deps only**: `@noble/ciphers` (encryption) and `node-telegram-bot-api`
- **Deferred wiring**: spawn tool and message tool use `setAgentLoopFn()` / `setPublishOutbound()` to break circular dependencies between modules

## Skills

Skills follow the [Agent Skills spec](https://agentskills.io/specification.md). No BearClaw-specific extensions to the SKILL.md format — a skill that works in Claude Code or any other spec-compliant tool must work here unmodified. Only standard frontmatter fields (`name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools`). All skills are available as `/skill-name` slash commands in the CLI.

## Workflow

Always run `npm run typecheck` and `npm test` after making changes to verify nothing is broken. Fix any errors before moving on.

## Test Patterns

Tests are in `tests/` mirroring `src/` structure. Tests use vitest globals (`describe`, `it`, `expect`, `vi`). Common patterns:

- Mock providers by creating objects implementing `LLMProvider` with canned responses
- Mock `fetch` with `vi.stubGlobal('fetch', vi.fn()...)`
- Build partial `ToolContext` with `as ToolContext` casts for unit tests
- `ToolRegistryImpl` and `ToolHookRegistryImpl` are the concrete classes; `ToolRegistry` and `ToolHookRegistry` are the interfaces used in `AgentLoopConfig`
