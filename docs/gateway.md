# Gateway

The HTTP gateway allows external applications to interact with BearClaw agents over HTTP. It uses a pairing-based authentication flow to prevent unauthorized access.

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
    "allowPublicBind": false
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

## Pairing Flow

The pairing mechanism prevents unauthorized access without requiring pre-shared keys:

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

### Security Properties

- **CSPRNG codes** — 6-digit codes generated with rejection sampling to avoid modulo bias
- **Constant-time comparison** — Codes are SHA-256 hashed and compared with `timingSafeEqual`
- **Lockout** — After 5 failed verification attempts, the pairing is locked out for 5 minutes
- **Token persistence** — Paired tokens are encrypted via the SecretStore and saved to `~/.bearclaw/paired-tokens.json`, surviving daemon restarts
- **Token verification** — Bearer tokens are SHA-256 hashed and compared with `timingSafeEqual`

## Implementation

The gateway uses Node.js's built-in `http` module — no Express, Fastify, or other HTTP framework dependencies. Request routing is a simple path/method switch. JSON parsing includes body size validation against `bodyLimit`.
