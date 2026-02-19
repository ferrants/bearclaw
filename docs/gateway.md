# Gateway

The HTTP gateway allows external applications to interact with BearClaw agents over HTTP. It supports multiple authentication methods to cover interactive, headless, and automated use cases.

## Configuration

```json
{
  "gateway": {
    "enabled": true,
    "host": "127.0.0.1",
    "port": 3000,
    "bodyLimit": 65536,
    "timeout": 30000,
    "requirePairing": true,
    "allowPublicBind": false,
    "apiKeys": [
      { "label": "web-ui", "key": "your-secret-key-here" }
    ]
  }
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `enabled` | boolean | `false` | Enable the HTTP gateway |
| `host` | string | `"127.0.0.1"` | Bind address |
| `port` | number | `3000` | Listen port |
| `bodyLimit` | number | `65536` | Max request body size (bytes) |
| `timeout` | number | `30000` | Request timeout (ms) |
| `requirePairing` | boolean | `true` | Require pairing authentication |
| `allowPublicBind` | boolean | `false` | Allow binding to `0.0.0.0` |
| `apiKeys` | array | `[]` | Pre-provisioned API keys (see [Authentication](#authentication)) |

### Security Note

By default, the gateway only binds to `127.0.0.1` (localhost). Set `allowPublicBind: true` to bind to `0.0.0.0`, but only do this on trusted networks or behind a reverse proxy.

## Endpoints

### `GET /health`

Health check endpoint. Always returns `200 OK`.

```bash
curl http://localhost:3000/health
```

### `POST /pair`

Initiate a pairing flow. Returns a 6-digit pairing code that must be verified.

```bash
curl -X POST http://localhost:3000/pair
```

Response:
```json
{
  "code": "483291",
  "expiresIn": 300
}
```

The code is displayed in the daemon's console output. The user must provide this code to the client application.

### `POST /pair/verify`

Submit the pairing code to receive a bearer token.

```bash
curl -X POST http://localhost:3000/pair/verify \
  -H "Content-Type: application/json" \
  -d '{"code": "483291"}'
```

Response:
```json
{
  "token": "bf3a7c..."
}
```

### `POST /message`

Send a message to an agent. Requires a bearer token from pairing.

```bash
curl -X POST http://localhost:3000/message \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer bf3a7c..." \
  -d '{"message": "What files are in the workspace?", "agentId": "default"}'
```

Response:
```json
{
  "content": "Here are the files in the workspace...",
  "agentId": "default"
}
```

## Authentication

BearClaw supports three ways to obtain a bearer token. All three produce tokens verified through the same mechanism — SHA-256 hashed and looked up in an in-memory map. Gateway and WebSocket code require no changes regardless of how the token was created.

### Method 1: Interactive Pairing

Best for: first-time setup, interactive sessions where someone is watching the daemon console.

```
Client                    Gateway                    User
  │                          │                         │
  ├── POST /pair ──────────► │                         │
  │                          ├── Display code ────────►│
  │◄── { code: "483291" } ──┤                         │
  │                          │                         │
  │  (user tells client      │                         │
  │   the code)              │                         │
  │                          │                         │
  ├── POST /pair/verify ───► │                         │
  │   { code: "483291" }     │                         │
  │                          │                         │
  │◄── { token: "bf3a..." } ─┤                         │
  │                          │                         │
  ├── POST /message ────────►│                         │
  │   Authorization: Bearer  │                         │
  │                          │                         │
  │◄── { content: "..." } ──┤                         │
```

### Method 2: Static API Keys in Config

Best for: web UIs, headless deployments, automated clients. Zero-touch — no human needs to relay a code.

Add keys to `config.jsonc` under `gateway.apiKeys`:

```jsonc
{
  "gateway": {
    "apiKeys": [
      { "label": "web-ui", "key": "my-secret-api-key" },
      { "label": "ci-bot", "key": "another-secret-key" }
    ]
  }
}
```

On first startup, plaintext keys are automatically encrypted in-place (same as provider API keys). The daemon decrypts them at startup and loads them into the pairing guard's in-memory token map.

Use the key directly as a bearer token:

```bash
curl -X POST http://localhost:3000/message \
  -H "Authorization: Bearer my-secret-api-key" \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello"}'
```

```bash
npx wscat -c 'ws://localhost:3000/ws?token=my-secret-api-key'
```

Static keys live in config only — they are **not** written to `paired-tokens.json`. To revoke a static key, remove it from config and restart the daemon.

### Method 3: CLI Token Management

Best for: operators who prefer not to put keys in config files, or who want to provision tokens without restarting the daemon's config.

```bash
# Create a token (printed once — save it)
bearclaw token create my-ui

# List all tokens
bearclaw token list

# Revoke a token by label
bearclaw token revoke my-ui
```

CLI tokens are written to `~/.bearclaw/paired-tokens.json` (encrypted via SecretStore). The daemon loads this file at startup, so a newly created token requires a daemon restart to take effect.

### Security Properties

- **CSPRNG codes** — 6-digit pairing codes generated with rejection sampling to avoid modulo bias
- **Constant-time comparison** — Codes are SHA-256 hashed and compared with `timingSafeEqual`
- **Lockout** — After 5 failed verification attempts, the pairing is locked out for 5 minutes
- **Token persistence** — Paired and CLI tokens are encrypted via the SecretStore and saved to `~/.bearclaw/paired-tokens.json`
- **Static key encryption** — API keys in config are encrypted at rest on first startup
- **Unified verification** — All token types (pairing, CLI, static) are verified through the same `verifyToken()` path

## Implementation

The gateway uses Node.js's built-in `http` module — no Express, Fastify, or other HTTP framework dependencies. Request routing is a simple path/method switch. JSON parsing includes body size validation against `bodyLimit`.
