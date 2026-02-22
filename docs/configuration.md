# Configuration

BearClaw uses a single `config.json` file located at `~/.bearclaw/config.json` (or the directory specified by `BEARCLAW_CONFIG_DIR`). All fields are optional — unspecified values use sensible defaults.

## Full Config Structure

```json
{
  "workspace": {
    "path": "~/.bearclaw/workspace"
  },
  "security": {
    "autonomy": "supervised",
    "workspaceOnly": true,
    "allowedCommands": ["git", "npm", "node", "..."],
    "restrictedCommands": { "curl": ["-o", "--output"] },
    "forbiddenPaths": ["/etc", "/root", "~/.ssh", "..."],
    "rateLimits": {
      "global": 20,
      "perAgent": 10,
      "perToolClass": { "exec": 10, "web": 5 }
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
  "mcp": {
    "servers": {}
  },
  "agents": {
    "default": {
      "name": "default",
      "provider": "anthropic",
      "maxIterations": 25,
      "systemPromptFiles": []
    }
  },
  "teams": {},
  "memory": {
    "enabled": true,
    "dir": "memory",
    "alwaysLoad": ["active-tasks.md"]
  },
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
  },
  "monitoring": {
    "logLevel": "info",
    "heartbeatInterval": 3600
  }
}
```

## Workspace

| Field | Type | Default | Description |
|---|---|---|---|
| `path` | string | `~/.bearclaw/workspace` | Root directory for agent file operations |

When `security.workspaceOnly` is `true`, agents can only read/write files within this directory.

## Security

| Field | Type | Default | Description |
|---|---|---|---|
| `autonomy` | string | `"supervised"` | Global autonomy level |
| `workspaceOnly` | boolean | `true` | Restrict file access to workspace |
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

## Agents

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

## Teams

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

## Channels

```json
{
  "channels": {
    "enabled": ["cli", "telegram"],
    "telegram": {
      "botToken": "123456:ABC...",
      "allowFrom": ["your_username"]
    }
  }
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `enabled` | string[] | `["cli"]` | Active channels |
| `telegram.botToken` | string | — | Telegram bot token (encrypted at rest) |
| `telegram.allowFrom` | string[] | — | Allowed sender usernames |

See [Channels](channels.md) for details.

## Gateway

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

## Policy

See [Security](security.md) for the full policy rule system.

## Memory

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

## Skills

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

## MCP Servers

MCP (Model Context Protocol) servers are configured in `config.json`. Each server is spawned over stdio at startup and its tools are discovered and registered automatically.

```json
{
  "mcp": {
    "servers": {
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
| `command` | string | yes | Command to spawn the MCP server |
| `args` | string[] | no | Arguments for the command |
| `env` | object | no | Environment variables (supports `${VAR}` expansion from process env) |

Tools discovered from each server are registered with a `{serverName}_{toolName}` prefix (e.g., `jira_create_issue`, `github_list_repos`). They go through the same security pipeline as built-in tools.

Servers are started at startup and stopped during graceful shutdown.

## Schedules

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

The first example creates a tight sandbox: fresh thread every 6 hours, auto-allows 5 specific tools, denies anything else. The second reuses its conversation, allows read + exec, and auto-approves everything else.

## Monitoring

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
