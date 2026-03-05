# Configuration

BearClaw uses an **instance config** at `~/.bearclaw/config.jsonc` (or `BEARCLAW_CONFIG_DIR`) for infrastructure/credentials, and a **per-agent config** (`bearclaw.jsonc`) in each agent directory. Unspecified values use sensible defaults.

## Instance Config Structure

```json
{
  "security": {
    "forbiddenPaths": ["/etc", "/root", "~/.ssh", "..."],
    "allowedPaths": ["/home/user/projects/shared-app"],
    "rateLimits": {
      "global": 20,
      "perAgent": 10
    },
    "encrypt": true
  },
  "gateway": {
    "enabled": false,
    "host": "127.0.0.1",
    "port": 3000,
    "bodyLimit": 65536,
    "timeout": 30000,
    "requirePairing": true,
    "allowPublicBind": false,
    "apiKeys": []
  },
  "providers": {},
  "channels": {
    "enabled": ["cli"]
  },
  "monitoring": {
    "logLevel": "info",
    "heartbeatInterval": 3600
  }
}
```

## Agent Config Structure (`bearclaw.jsonc`)

```json
{
  "name": "my-agent",
  "provider": "openai",
  "workspace": "./workspace",
  "systemPromptFiles": ["prompts/system.md"],
  "maxIterations": 25,
  "subagents": {
    "ollama_worker": {
      "name": "ollama_worker",
      "provider": "ollama",
      "model": "llama3.2",
      "maxIterations": 10
    }
  },
  "security": {
    "autonomy": "supervised",
    "workspaceOnly": true
  },
  "memory": {
    "enabled": true,
    "dir": "memory",
    "alwaysLoad": ["focus.md"]
  }
}
```

## Workspace (agent config)

| Field | Type | Default | Description |
|---|---|---|---|
| `path` | string | `~/.bearclaw/workspace` | Root directory for agent file operations |

When `security.workspaceOnly` is `true`, agents can only read/write files within this directory and any paths listed in `security.allowedPaths`.

## Security (agent config unless noted)

Instance-level security fields: `forbiddenPaths`, `allowedPaths`, `rateLimits.*`, `encrypt`.

| Field | Type | Default | Description |
|---|---|---|---|
| `autonomy` | string | `"supervised"` | Global autonomy level |
| `workspaceOnly` | boolean | `true` | Restrict file access to workspace + `allowedPaths` |
| `allowedPaths` | string[] | `[]` | Absolute paths agents may access when `workspaceOnly` is true |
| `allowedCommands` | string[] | *(see defaults)* | Commands agents can execute |
| `restrictedCommands` | object | *(see defaults)* | Commands with blocked argument patterns |
| `allowMemoryWrite` | boolean | `false` | Allow agents to write to the memory directory (adds it to `allowedPaths`) |
| `forbiddenPaths` | string[] | *(see defaults)* | Paths agents cannot access |
| `rateLimits.global` | number | `20` | Max actions per hour (global) |
| `rateLimits.perAgent` | number | — | Max actions per hour per agent |
| `rateLimits.perToolClass` | object | — | Max actions per hour per tool class |
| `encrypt` | boolean | `true` | Encrypt API keys at rest |

### Autonomy Levels

- **`readonly`** — No tool use allowed, agents can only respond with text
- **`supervised`** — All tool calls require approval (or inline allows)
- **`auto`** — Allowed commands run freely, others need approval
- **`full`** — Everything runs without approval

## Providers

Providers are configured in the instance config (`~/.bearclaw/config.jsonc`).

### Anthropic

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

### OpenAI

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

### Ollama

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

No API key needed — Ollama runs locally.

### CLI Delegation

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

| Field | Type | Default | Description |
|---|---|---|---|
| `command` | string | — | CLI command to run (claude, codex, aider, etc.) |
| `flags` | string[] | `[]` | Additional flags to pass |
| `outputParser` | string | `"text"` | `"text"` or `"jsonl"` |
| `jsonlMessageType` | string | `"agent_message"` | For jsonl: which type to extract |

## Agents (agent config)

```json
{
  "agents": {
    "default": {
      "name": "default",
      "provider": "openai",
      "model": "gpt-4o",
      "workingDirectory": "projects/my-app",
      "autonomy": "auto",
      "maxIterations": 25,
      "maxTotalTokens": 100000,
      "systemPromptFiles": ["prompts/system.md"]
    }
  }
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `name` | string | — | Agent identifier |
| `provider` | string | — | Provider to use |
| `model` | string | Provider default | Override model |
| `workingDirectory` | string | — | Relative to workspace, or absolute |
| `autonomy` | string | Global setting | Override autonomy level |
| `maxIterations` | number | `25` | Max agent loop iterations per turn |
| `maxTotalTokens` | number | — | Token budget per turn |
| `systemPromptFiles` | string[] | `[]` | Markdown files loaded into system prompt |

The `"default"` agent is used by the CLI entry point. The daemon routes to agents by name.

## Teams (agent config)

```json
{
  "teams": {
    "engineering": {
      "name": "engineering",
      "agents": ["coder", "reviewer", "architect"],
      "leaderAgent": "architect"
    }
  }
}
```

| Field | Type | Description |
|---|---|---|
| `name` | string | Team identifier |
| `agents` | string[] | Agent names in the team |
| `leaderAgent` | string | Agent that receives `@team` messages first |

See [Multi-Agent](multi-agent.md) for routing and orchestration details.

## Channels (instance config)

```json
{
  "channels": {
    "enabled": ["cli"]
  }
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `enabled` | string[] | `["cli"]` | Active channels |

See [Channels](channels.md) for details.

## Gateway (instance config)

```jsonc
{
  "gateway": {
    "enabled": true,
    "host": "127.0.0.1",
    "port": 3000,
    "requirePairing": true,
    "allowPublicBind": false,
    "apiKeys": [
      { "label": "web-ui", "key": "your-secret-key" }
    ]
  }
}
```

The `apiKeys` array lets you pre-provision bearer tokens for automated clients and web UIs without interactive pairing. Keys are encrypted at rest on first startup. You can also manage tokens via the CLI: `bearclaw token create/list/revoke`.

See [Gateway](gateway.md) for authentication methods and endpoints.

## Policy (agent config)

Policy controls how BearClaw evaluates tool calls — whether to allow, deny, or require approval. Configured in `bearclaw.jsonc`.

```jsonc
{
  "policy": {
    "defaultAction": "approve",
    "denyPrecedence": true,
    "approvalScope": "user+channel",
    "learningMode": "suggest_rules",
    "rules": [],
    "approvals": {
      "cache": false,
      "defaultTTLSeconds": 300
    },
    "inlineAllow": {
      "enabled": true,
      "dayScopeHours": 24
    },
    "web": {
      "mode": "allow_with_blocklist",
      "blockedDomains": [],
      "blockedCidrs": [],
      "blockedHosts": []
    }
  }
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `defaultAction` | string | `"approve"` | Default action when no rule matches: `"allow"`, `"deny"`, or `"approve"` (require approval) |
| `denyPrecedence` | boolean | `true` | When true, deny rules take precedence over allow rules |
| `approvalScope` | string | `"user+channel"` | Scope for approval caching: `"global"`, `"user"`, `"user+channel"` |
| `learningMode` | string | `"suggest_rules"` | `"suggest_rules"` logs suggested allow/deny rules based on approval decisions |
| `rules` | array | `[]` | Explicit allow/deny rules (see below) |

### Approvals

| Field | Type | Default | Description |
|---|---|---|---|
| `approvals.cache` | boolean | `false` | Cache approval decisions for the TTL duration |
| `approvals.defaultTTLSeconds` | number | `300` | How long cached approvals last (seconds) |

### Inline Allows

Inline allows let users grant temporary tool permissions directly in chat messages (e.g., `!allow exec`).

| Field | Type | Default | Description |
|---|---|---|---|
| `inlineAllow.enabled` | boolean | `true` | Enable inline allow directives |
| `inlineAllow.dayScopeHours` | number | `24` | How long `day` scoped inline allows last (hours) |

### Web Filtering

| Field | Type | Default | Description |
|---|---|---|---|
| `web.mode` | string | `"allow_with_blocklist"` | Web access mode |
| `web.blockedDomains` | string[] | `[]` | Domains to block for web_fetch/web_search |
| `web.blockedCidrs` | string[] | `[]` | CIDR ranges to block (SSRF protection) |
| `web.blockedHosts` | string[] | `[]` | Hostnames to block |

### Policy Rules

Rules are evaluated in order. Each rule matches against tool name, scope, command, and agent, then applies an action.

```jsonc
{
  "rules": [
    { "action": "allow", "toolName": "read_file" },
    { "action": "deny", "toolName": "exec", "command": "rm *" },
    { "action": "approve", "scope": "web" }
  ]
}
```

See [Security](security.md) for the full policy rule system and evaluation details.

## Memory (agent config)

```json
{
  "memory": {
    "enabled": true,
    "dir": "memory",
    "alwaysLoad": ["active-tasks.md"]
  }
}
```

Memory lives as markdown files in `{workspace}/{memory.dir}/`. Files listed in `alwaysLoad` are injected into the system prompt at the start of each conversation. Agents read and write memory files using the standard `read_file` and `write_file` tools.

Typical memory structure:
```
~/.bearclaw/workspace/memory/
  active-tasks.md       # Always loaded — current task state
  lessons.md            # Long-term learnings
  projects.md           # Project-specific context
  YYYY-MM-DD.md         # Daily logs
```

## Skills (agent config)

Skills are discovered from the filesystem. By default, BearClaw looks for skill directories in `{workspace}/skills/` and `~/.bearclaw/skills/`:

```
~/.bearclaw/workspace/skills/
  tmux/
    SKILL.md
  code-review/
    SKILL.md
    checklist.md
```

Each `SKILL.md` has YAML frontmatter with `name` and `description`, plus a markdown body with instructions. Skills are loaded automatically at startup and their metadata is injected into the system prompt.

### Custom skills directories (agent directory mode)

In a `bearclaw.jsonc` agent config, use `skillsDirs` to load skills from additional directories:

```jsonc
{
  "skillsDirs": [
    ".agents/skills",            // relative to agent dir
    "/home/user/shared-skills"   // absolute path
  ]
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `skillsDirs` | string[] | `[]` | Extra directories containing skill subdirectories. Relative paths resolve from the agent directory. Searched before the default locations. |

See [Skills](skills.md) for the full format and precedence rules. BearClaw skills are compatible with Claude Code Agent Skills — the same `SKILL.md` works in both.

## MCP Servers (agent config)

MCP (Model Context Protocol) servers are configured in `bearclaw.jsonc`. BearClaw supports two transports — **stdio** (spawn a local process) and **HTTP Streamable** (connect to a remote URL). Each server's tools are discovered via `tools/list` and registered automatically at startup.

A server config must have either `command` (stdio) or `url` (HTTP). Transport selection is automatic.

```jsonc
{
  "mcp": {
    "servers": {
      // HTTP Streamable transport — remote API-based servers
      "stripe": {
        "url": "https://mcp.stripe.com",
        "headers": { "Authorization": "Bearer ${STRIPE_API_KEY}" }
      },
      // Stdio transport — local subprocess servers
      "jira": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-jira"],
        "env": {
          "JIRA_URL": "https://mycompany.atlassian.net",
          "JIRA_TOKEN": "${JIRA_TOKEN}"
        }
      },
      "github": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-github"],
        "env": {
          "GITHUB_TOKEN": "${GITHUB_TOKEN}"
        }
      }
    }
  }
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `command` | string | one of `command` or `url` | Command to spawn the MCP server (stdio transport) |
| `args` | string[] | no | Arguments for the command (stdio only) |
| `env` | object | no | Environment variables for the subprocess (supports `${VAR}` expansion; stdio only) |
| `url` | string | one of `command` or `url` | Endpoint URL for the MCP server (HTTP Streamable transport) |
| `headers` | object | no | Custom HTTP headers, e.g. `Authorization` (supports `${VAR}` expansion; HTTP only) |
| `timeout` | number | no | Request timeout in milliseconds (default: 30000; HTTP only) |

### Stdio transport

Spawns the MCP server as a child process and communicates via newline-delimited JSON-RPC 2.0 over stdin/stdout. Use this for locally-installed MCP servers (npm packages, binaries, etc.).

### HTTP Streamable transport

Sends JSON-RPC 2.0 requests via POST to the configured URL. Supports both `application/json` and `text/event-stream` (SSE) responses. Tracks `Mcp-Session-Id` headers automatically and re-initializes on 404 (session expiry). Use this for remote/cloud MCP servers like Stripe, or any server that requires API key authentication via headers.

### Common behavior

Tools discovered from each server are registered with a `{serverName}_{toolName}` prefix (e.g., `stripe_create_payment_link`, `jira_create_issue`). They go through the same security pipeline as built-in tools.

Servers are started at startup and stopped during graceful shutdown.

## Schedules (agent config)

Schedules allow agents to run on a timer without manual invocation. Each schedule can be configured with execution controls for autonomous operation.

```jsonc
{
  "schedules": [
    {
      "interval": "every 6h",
      "agent": "researcher",
      "message": "Continue active tasks",
      "newThread": true,
      "allow": ["exec", "read_file", "write_file", "web_fetch", "search"],
      "approvalMode": "auto-deny"
    },
    {
      "cron": "0 9 * * 1",
      "agent": "reporter",
      "message": "Generate the weekly report",
      "allow": ["read_file", "exec"],
      "approvalMode": "auto-approve"
    }
  ]
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `cron` | string | — | Cron expression (mutually exclusive with `interval`) |
| `interval` | string | — | Human-readable interval, e.g. `"every 6h"` (mutually exclusive with `cron`) |
| `agent` | string | — | Target agent name |
| `message` | string | — | Message sent to the agent on each firing |
| `newThread` | boolean | `false` | When true, each run gets a fresh session (unique chatId) instead of accumulating history |
| `allow` | string[] | `[]` | Tool names to auto-approve for this schedule via the inline allow store (`session` scope) |
| `approvalMode` | string | — | Fallback for tools not in the `allow` list: `"auto-approve"` or `"auto-deny"`. If unset, falls through to the global gateway approval mode |
| `contextFiles` | string[] | `[]` | File paths (relative to agent directory) injected as context before the message |
| `skills` | string[] | `[]` | Skill names whose instructions are injected as context before the message |
| `requireContext` | boolean | `false` | If true, abort the scheduled run when any context file or skill is missing |

The first example creates a tight sandbox: fresh thread every 6 hours, auto-allows 5 specific tools, denies anything else. The second reuses its conversation, allows read + exec, and auto-approves everything else.

Context files and skills are injected as user messages before the schedule's message, giving the agent relevant context without relying on it to read files itself. With `requireContext: true`, the schedule silently skips execution if any file is unreadable or skill is unknown — useful for schedules that are meaningless without their context.

## Hooks (agent config)

Hooks let you run shell commands or scripts at key lifecycle points in the agent loop. They execute as subprocesses via `sh -c`, receive JSON context on stdin, and use exit codes for control flow. Hooks are configured per-agent in `bearclaw.jsonc`.

```jsonc
{
  "hooks": {
    "tool:before": [
      { "command": "./hooks/validate-exec.sh", "toolNames": ["exec"], "timeout": 5000 },
      { "command": "node ./hooks/log-tool-call.js" }
    ],
    "tool:after": [
      { "command": "node ./hooks/audit-log.js", "toolNames": ["write_file", "exec"] }
    ],
    "agent:start": [
      { "command": "echo 'Agent starting' >> /tmp/bearclaw.log" }
    ],
    "agent:end": [
      { "command": "curl -s -X POST https://example.com/webhook -d @-" }
    ]
  }
}
```

### Hook Events

| Event | Fires when | Can block? | Can modify args? |
|---|---|---|---|
| `agent:start` | Agent loop begins | No | No |
| `tool:before` | Before each tool call (after policy) | Yes (exit 2) | Yes (stdout JSON) |
| `tool:after` | After each tool call | No | No |
| `agent:end` | Agent loop completes | No | No |

### Hook Config Fields

| Field | Type | Default | Description |
|---|---|---|---|
| `command` | string | — | Shell command run via `sh -c`. Working directory is the agent directory |
| `timeout` | number | `10000` | Max execution time in ms. Hook is killed if exceeded |
| `toolNames` | string[] | — | Only run for these tool names (`tool:before` / `tool:after` only). Omit to match all tools |

### Execution Model

- **Stdin**: Each hook receives a JSON object on stdin with event-specific context
- **Exit codes**: `0` = success (allow), `2` = block the tool call (`tool:before` only), any other = logged warning
- **Stdout**: For `tool:before` hooks, valid JSON on stdout replaces the tool arguments. Non-JSON stdout is ignored
- **Sequential**: Hooks within each event run in array order. For `tool:before`, modified args chain through each hook
- **Timeout**: If a hook exceeds its timeout, the subprocess is killed and execution continues

### Stdin JSON by Event

**`agent:start`**:
```json
{ "event": "agent:start", "agentId": "my-agent", "model": "claude-sonnet-4-5-20250929", "chatId": "abc123" }
```

**`tool:before`**:
```json
{ "event": "tool:before", "toolName": "exec", "args": { "command": "ls -la" }, "agentId": "my-agent", "chatId": "abc123" }
```

**`tool:after`**:
```json
{ "event": "tool:after", "toolName": "exec", "args": { "command": "ls -la" }, "resultSummary": "...", "agentId": "my-agent", "chatId": "abc123" }
```

**`agent:end`**:
```json
{ "event": "agent:end", "agentId": "my-agent", "content": "Here is my response...", "iterations": 3, "toolsUsed": ["exec", "read_file"], "chatId": "abc123" }
```

### Examples

**Block dangerous exec commands** (`hooks/validate-exec.sh`):
```bash
#!/bin/sh
INPUT=$(cat)
CMD=$(echo "$INPUT" | jq -r '.args.command // ""')
case "$CMD" in
  *rm\ -rf*|*mkfs*|*dd\ if=*) exit 2 ;;  # Block
  *) exit 0 ;;                              # Allow
esac
```

**Log all tool calls** (`hooks/log-tool-call.js`):
```javascript
let data = '';
process.stdin.on('data', chunk => data += chunk);
process.stdin.on('end', () => {
  const event = JSON.parse(data);
  const line = `${new Date().toISOString()} ${event.toolName} ${JSON.stringify(event.args)}\n`;
  require('fs').appendFileSync('/tmp/bearclaw-tools.log', line);
});
```

**Rewrite args** — a `tool:before` hook can output JSON to replace tool arguments:
```bash
#!/bin/sh
# Force all exec commands to run with timeout
INPUT=$(cat)
CMD=$(echo "$INPUT" | jq -r '.args.command // ""')
echo "{\"command\": \"timeout 30 $CMD\"}"
```

## Monitoring (instance config)

| Field | Type | Default | Description |
|---|---|---|---|
| `logLevel` | string | `"info"` | `"debug"`, `"info"`, `"warn"`, `"error"` |
| `heartbeatInterval` | number | `3600` | Heartbeat interval in seconds |

Logs are structured JSON written to stderr.

## Deep Merge Behavior

BearClaw deep-merges your config over defaults:
- Objects are merged recursively
- Arrays are replaced (not merged)
- Scalar values are overwritten

This means you only need to specify what you want to change.
