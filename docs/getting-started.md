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

BearClaw looks for configuration at `~/.bearclaw/config.json`. Create the directory and a minimal config:

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
  },
  "agents": {
    "default": {
      "name": "default",
      "provider": "openai"
    }
  }
}
```

You only need to specify values you want to override — BearClaw deep-merges your config over sensible defaults.

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
Type "quit" to exit.

>
```

Type your message and press Enter. The agent will respond, using tools as needed. Type `quit` or `exit` to save your session and exit.

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
npm test              # Run all 117 tests
npm run test:watch    # Watch mode
npm run typecheck     # Type check without emitting
```

## Next Steps

- [Configuration](configuration.md) — Full config reference
- [Security](security.md) — Understanding the security model
- [Tools](tools.md) — Available built-in tools
