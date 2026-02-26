<p align="center">
  <img src="packages/bearclaw/img/bearclaw_logo.png" alt="BearClaw" width="400">
</p>

<p align="center">
  <strong>AI agent framework with defense-in-depth security, multi-agent orchestration, and provider abstraction.</strong>
</p>

<p align="center">
  <a href="#features">Features</a> &bull;
  <a href="#installation">Installation</a> &bull;
  <a href="#quick-start">Quick Start</a> &bull;
  <a href="#configuration">Configuration</a> &bull;
  <a href="#architecture">Architecture</a> &bull;
  <a href="#license">License</a>
</p>

---

## Features

**Security-first design** — BearClaw treats security as a core architectural concern, not an afterthought.

- **Defense-in-depth security** — SecurityPolicy, PolicyEngine with rule evaluation, SSRF guard, rate limiting (sliding window, scoped per-agent/per-tool), approval workflows, and inline allow directives
- **Encrypted secrets** — API keys encrypted at rest with ChaCha20-Poly1305 (via `@noble/ciphers`), automatic encrypt-on-startup
- **Multi-provider LLM abstraction** — Anthropic, OpenAI, Ollama, and CLI Delegation (claude, codex, etc.) with streaming support and exponential backoff retry
- **Multi-agent orchestration** — Team-based routing, `[@agent: message]` mention parsing, conversation tracking with fan-out/fan-in pattern
- **Multi-channel messaging** — CLI REPL and HTTP gateway with a unified message bus
- **Skills system** — Drop a `SKILL.md` into `skills/` and BearClaw picks it up automatically. Follows the [Agent Skills spec](https://agentskills.io/specification.md) — the same skill files work in Claude Code and other compatible tools. Multi-source loading with workspace precedence over user-level skills. All skills available as `/skill-name` slash commands in the CLI.
- **MCP support** — Configure MCP servers in `config.json` and their tools are discovered and registered automatically via JSON-RPC 2.0 over stdio.
- **Headless mode** — Run one-shot prompts with `bearclaw -p "your prompt"` for scripting and automation.
- **Tool system** — 10 built-in tools with JSON Schema validation, before/after hooks, parallel execution, and structured results (forLLM/forUser/silent/async)
- **HTTP gateway** — Pairing-based authentication with CSPRNG codes, SHA-256 token verification, and brute-force lockout
- **Session persistence** — Conversations saved as JSON, memory as markdown files
- **Zero SDK dependencies** — All provider integrations use `fetch()` directly. Only 1 runtime dependency total.

## Installation

### From npm

```bash
npm install -g bearclaw
```

### From source

```bash
git clone https://github.com/ferrants/bearclaw.git
cd bearclaw
pnpm install
pnpm -C packages/bearclaw build
pnpm -C packages/bearclaw link --global
```

Requires Node.js 20+.

## Quick Start

### 1. Create a config

BearClaw looks for its configuration at `~/.bearclaw/config.json` (override with `BEARCLAW_CONFIG_DIR` env var).

```json
{
  "providers": {
    "openai": {
      "apiKey": "sk-...",
      "defaultModel": "gpt-4o-mini"
    }
  },
  "agents": {
    "default": {
      "name": "default",
      "provider": "openai"
    }
  }
}
```

On first run, BearClaw will encrypt your API key in-place and generate a secret key at `~/.bearclaw/.secret_key`.

### 2. Start the CLI

```bash
bearclaw
```

This launches an interactive REPL with the default agent. Type your message and press enter. Type `/help` to see commands and available skills. Type `/exit` to save your session and exit.

### 3. Headless mode

```bash
bearclaw -p "explain what BearClaw is"
```

Runs a single prompt, prints the response, and exits. Useful for scripting and automation. Add `-s my-session` to persist conversation state across invocations.

### 4. Start the daemon (multi-channel)

```bash
bearclaw-daemon
```

The daemon supports multiple channels (CLI + gateway), multi-agent routing, team orchestration, and the HTTP gateway.

### 5. Terminal UI

For a full terminal interface with streaming responses, tool call visibility, and approval workflows, see [BearClaw TUI](https://github.com/ferrants/bearclaw-tui). It connects to the daemon over WebSocket and requires Bun at runtime.

```bash
pnpm -C packages/bearclaw-tui install
pnpm -C packages/bearclaw-tui dev
```

## Configuration

BearClaw uses a single `config.json` with sensible defaults. You only need to specify what you want to override.

### Providers

```json
{
  "providers": {
    "anthropic": {
      "apiKey": "sk-ant-...",
      "defaultModel": "claude-sonnet-4-20250514"
    },
    "openai": {
      "apiKey": "sk-...",
      "defaultModel": "gpt-4o-mini"
    },
    "ollama": {
      "baseUrl": "http://localhost:11434",
      "defaultModel": "llama3"
    },
    "cliDelegation": {
      "command": "claude",
      "args": ["--print"],
      "pattern": "claude"
    }
  }
}
```

### Agents

```json
{
  "agents": {
    "default": {
      "name": "default",
      "provider": "openai",
      "model": "gpt-4o",
      "maxIterations": 25,
      "systemPromptFiles": ["prompts/system.md"]
    },
    "researcher": {
      "name": "researcher",
      "provider": "anthropic",
      "systemPromptFiles": ["prompts/researcher.md"]
    }
  }
}
```

### Security

```json
{
  "security": {
    "autonomy": "supervised",
    "workspaceOnly": true,
    "encrypt": true,
    "rateLimits": {
      "global": 20
    }
  }
}
```

Autonomy levels: `locked` (no tool use), `supervised` (all tools need approval), `auto` (allowed commands run freely), `full` (everything runs).

### Teams

```json
{
  "teams": {
    "dev": {
      "leader": "architect",
      "members": ["coder", "reviewer"],
      "strategy": "fan-out"
    }
  }
}
```

### Channels

```json
{
  "channels": {
    "enabled": ["cli"]
  }
}
```

### Multiple Instances

Set `BEARCLAW_CONFIG_DIR` to run separate instances with different configurations:

```bash
BEARCLAW_CONFIG_DIR=~/.bearclaw-work bearclaw
BEARCLAW_CONFIG_DIR=~/.bearclaw-personal bearclaw
```

## Architecture

```
packages/
└── bearclaw/
    ├── src/
    │   ├── config/          Config schema, defaults, loader
    │   ├── security/        Policy, rate limiter, secrets, SSRF, approvals, pairing
    │   ├── providers/       Anthropic, OpenAI, Ollama, CLI Delegation
    │   ├── tools/           Registry, hooks, validation, 10 built-in tools
    │   ├── skills/          Skill loader (Claude Code compatible)
    │   ├── mcp/             MCP client, tool discovery
    │   ├── agent/           Loop, context builder, session persistence
    │   ├── bus/             Message bus with async waiter pattern
    │   ├── channels/        CLI channel(s)
    │   ├── orchestrator/    Router, mentions, conversations, teams
    │   ├── gateway/         HTTP server with pairing auth
    │   ├── index.ts         CLI entry point
    │   └── daemon.ts        Daemon entry point
    └── tests/
```

### How it works

1. **Config loads** — merges `config.json` over defaults, encrypts plaintext API keys
2. **Security initializes** — policy engine, rate limiters, approval manager
3. **Provider creates** — LLM connections via `fetch()` with retry and streaming
4. **Tools register** — built-in tools with JSON Schema validation and hook pipeline
5. **Skills load** — scans workspace and user-level `skills/` directories for SKILL.md files with precedence
6. **Agent loop runs** — sends messages to LLM, executes tool calls in parallel, appends results, repeats until done
7. **Bus routes messages** — inbound from channels, outbound to channels, with agent routing and team orchestration

## Development

```bash
npm run build        # Compile TypeScript
npm run dev          # Run CLI with tsx (no build needed)
npm run daemon       # Run daemon with tsx
npm test             # Run tests (193 tests)
npm run typecheck    # Type check without emitting
```

## License

[MIT](LICENSE) — Matt Ferrante
