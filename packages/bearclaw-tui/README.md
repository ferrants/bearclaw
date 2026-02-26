# BearClaw TUI

Terminal user interface for the [BearClaw](https://github.com/ferrants/bearclaw) AI agent framework. Connects to the BearClaw daemon over WebSocket for real-time streaming, tool call visibility, and approval workflows — all from the terminal.

## Features

- **Streaming responses** — See LLM tokens as they arrive in real-time
- **Tool lifecycle** — Watch tool calls pending, executing, and completing
- **Approval workflows** — Approve or deny tool calls with Y/N when the daemon requests it
- **Session picker** — Browse and switch between chat sessions with `/sessions` or `Ctrl+\`
- **Slash commands** — `/new`, `/config`, `/sessions`, and any BearClaw skill, with autocomplete menu
- **Reconnection** — Auto-reconnects on disconnect, picks up pending approvals
- **Clipboard-friendly** — Native terminal text selection works (including in tmux)

## Installation

Requires [Bun](https://bun.sh) and a running [BearClaw daemon](https://github.com/ferrants/bearclaw).

```bash
git clone https://github.com/ferrants/bearclaw-tui.git
cd bearclaw-tui
bun install
```

## Quick Start

### 1. Configure your API key

Add a static API key to your BearClaw daemon config (`~/.bearclaw/config.json`):

```json
{
  "gateway": {
    "apiKeys": ["your-api-key"]
  }
}
```

### 2. Set the key for the TUI

Either set an environment variable (Bun auto-loads `.env`):

```bash
echo 'BEARCLAW_API_KEY=your-api-key' > .env
```

Or enter it interactively on first launch — it gets saved to `~/.bearclaw-tui-token`.

### 3. Start the TUI

```bash
bun start
```

The TUI connects to the daemon at `ws://localhost:3000` by default. Override with:

```bash
BEARCLAW_URL=ws://localhost:3014 bun start
```

## Usage

| Key | Action |
|-----|--------|
| **Enter** | Send message |
| **Tab** | Switch between chat and scroll mode |
| **Escape** | Return to chat mode (from scrolling, sessions, etc.) |
| **Ctrl+\\** | Toggle session picker sidebar |
| **Up/Down** | Navigate slash command menu or session list |
| **Y/S/D** | Approve tool call (once / session / day) |
| **N** | Deny tool call |

Type `/` to see available commands. `/exit`, `/quit`, and `:q` exit the TUI. `/sessions` opens the session picker. All other slash commands are forwarded to the BearClaw daemon.

### Session Picker

Browse and resume previous chat sessions. Open with `/sessions` or `Ctrl+\`.

- On wide terminals (>=100 columns), the session list appears as a sidebar alongside the chat
- On narrow terminals, it takes over the full screen
- **Up/Down** to navigate, **Enter** to load a session, **N** to start a new chat, **Esc** to close

## Configuration

All configuration is via environment variables (or `.env` file):

| Variable | Default | Description |
|----------|---------|-------------|
| `BEARCLAW_API_KEY` | — | API key for daemon authentication |
| `BEARCLAW_URL` | `ws://localhost:3000` | WebSocket URL of the BearClaw daemon |

## Development

```bash
bun run dev     # Run with --watch for auto-reload
bun start       # Run normally
```

Built with [OpenTUI](https://github.com/anomalyco/opentui) (React reconciler) and Bun.

## License

[MIT](LICENSE) — Matt Ferrante
