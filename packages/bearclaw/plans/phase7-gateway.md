# Phase 7: Gateway + Pairing

## Status: COMPLETE

## How It Works

### PairingGuard (`src/security/pairing.ts`)
- CSPRNG 6-digit codes with rejection sampling (no modulo bias)
- Constant-time comparison via SHA-256 hash + timingSafeEqual
- Lockout after 5 failed attempts (5 minutes)
- Tokens persisted to `~/.bearclaw/paired-tokens.json` encrypted via SecretStore
- Load on startup, save on each new pairing

### Gateway Server (`src/gateway/server.ts`)
- Node.js built-in http module
- Endpoints: POST /pair, POST /pair/verify, POST /message, GET /health
- Pairing auth required by default (Bearer token)
- Body limit 64KB, request timeout 30s
- Only binds to 127.0.0.1 unless allowPublicBind enabled
