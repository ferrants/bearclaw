# Getting Started

## Requirements

- Node.js 20 or later
- npm

## Installation

### From npm

```bash
npm install -g bearclaw
```

### From source

```bash
git clone https://github.com/ferrants/bearclaw.git
cd bearclaw
npm install
npm run build
npm link
```

## Creating Your First Config

BearClaw looks for instance config at `~/.bearclaw/config.jsonc`. Create the directory and a minimal config:

```bash
mkdir -p ~/.bearclaw
```

```json
{
  "providers": {
    "openai": {
      "apiKey": "sk-your-key-here",
      "defaultModel": "gpt-4o-mini"
    }
  }
}
```

You only need to specify values you want to override — BearClaw deep-merges your instance config over sensible defaults.

Create an agent directory with a `bearclaw.jsonc`:

```json
{
  "name": "default",
  "provider": "openai",
  "workspace": "./workspace"
}
```

### Automatic Key Encryption

On first startup, BearClaw encrypts any plaintext API keys in your config using ChaCha20-Poly1305 AEAD. Your key will be rewritten from `sk-...` to `enc2:...` and a secret key is generated at `~/.bearclaw/.secret_key` with 0600 permissions.

This is automatic and idempotent — already-encrypted values are skipped.

## Running the CLI

```bash
bearclaw
```

You'll see:

```
BearClaw CLI
Agent: default (openai/gpt-4o-mini)
Workspace: ~/.bearclaw/workspace
Type /help for commands.

>
```

Type your message and press Enter. The agent will respond, using tools as needed.

### CLI Commands

| Command | Description |
|---|---|
| `/help` | Show commands and available skills |
| `/new` | Clear conversation and start fresh |
| `/config` | Enter configuration mode (exposes config tools) |
| `/config query` | Enter config mode and immediately run a query |
| `/exit` | Save session and exit |
| `/{skill-name}` | Activate a skill (see [Skills](skills.md)) |
| `/{skill-name} task` | Activate a skill and run a task immediately |

These commands also work over the [WebSocket API](websocket-api.md) — the daemon intercepts them before routing to the agent. `/help` and `/exit` are CLI-only.

### Headless Mode

Run a single prompt and exit — useful for scripting and automation:

```bash
bearclaw -p "explain what this project does"
```

| Flag | Description |
|---|---|
| `-p`, `--prompt` | The prompt to run (required for headless mode) |
| `-s`, `--session` | Named session ID for multi-turn headless conversations |

```bash
# One-shot (no session persistence)
bearclaw -p "what is 2+2"

# Multi-turn with named session
bearclaw -p "read the README" -s my-task
bearclaw -p "now summarize it" -s my-task

# Pipe-friendly
bearclaw -p "explain this error: $(cat error.log)"
```

Logs are suppressed in headless mode (only errors shown). Tool calls requiring interactive approval are denied — use `auto` or `full` autonomy for unattended use.

### Development Mode

If running from source without building:

```bash
npm run dev       # CLI mode
npm run daemon    # Daemon mode
```

## Running the Daemon

The daemon supports multiple channels, multi-agent routing, and the HTTP gateway:

```bash
bearclaw-daemon
```

See [Channels](channels.md) and [Multi-Agent](multi-agent.md) for daemon-specific configuration.

## Multiple Instances

Use the `BEARCLAW_CONFIG_DIR` environment variable to run separate instances with different configurations:

```bash
BEARCLAW_CONFIG_DIR=~/.bearclaw-work bearclaw
BEARCLAW_CONFIG_DIR=~/.bearclaw-personal bearclaw
```

Each instance has its own config, secrets, sessions, and memory.

## Running Tests

```bash
npm test              # Run all 193 tests
npm run test:watch    # Watch mode
npm run typecheck     # Type check without emitting
```

## Next Steps

- [Configuration](configuration.md) — Full config reference
- [Security](security.md) — Understanding the security model
- [Tools](tools.md) — Available built-in tools
