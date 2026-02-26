# Phase 1: Foundation (Config + Security)

## Status: COMPLETE

## Steps
1. Project setup: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`
2. `src/config/schema.ts` — all TypeScript types
3. `src/config/defaults.ts` — default values and constants
4. `src/config/config.ts` — load/save config with validation
5. `src/logging.ts` — structured JSON logging
6. `src/events.ts` — typed EventBus
7. `src/security/rate-limiter.ts` — SlidingWindowRateLimiter + ScopedRateLimiter
8. `src/security/policy.ts` — SecurityPolicy (with all fixes: #1, #2, #3, #8)
9. `src/security/policy-engine.ts` — PolicyEngine (deny precedence, rule eval)
10. `src/security/approvals.ts` — ApprovalManager
11. `src/security/inline-allow.ts` — inline allow parsing + day-scoped storage
12. `src/security/secrets.ts` — SecretStore (ChaCha20-Poly1305)
13. `src/security/ssrf.ts` — SSRF guard (proper CIDR, fix #6)
14. `src/cli/policy-status.ts` — `bearclaw policy status`
15. Tests: `tests/security/*` (TDD — write first)

## Progress
- [x] Step 1: Project setup
- [x] Step 2: Config schema types
- [x] Step 3: Config defaults
- [x] Step 4: Config load/save
- [x] Step 5: Logging
- [x] Step 6: EventBus
- [x] Step 7: Rate limiter
- [x] Step 8: SecurityPolicy
- [x] Step 9: PolicyEngine
- [x] Step 10: ApprovalManager
- [x] Step 11: Inline allow
- [x] Step 12: SecretStore
- [x] Step 13: SSRF guard
- [x] Step 14: Policy status CLI
- [x] Step 15: Tests

## Results
- 50 tests passing across 4 test files
- TypeScript compiles cleanly with strict mode
- All architecture plan specifications implemented faithfully

## How It Works

### Config System
- `schema.ts` defines all TypeScript interfaces: `BearClawConfig`, `AgentConfig`, `TeamConfig`, `PolicyConfig`, `PolicyRule`
- `defaults.ts` provides security defaults: command allowlists, restricted commands, forbidden paths, constants
- `config.ts` loads from `~/.bearclaw/config.json` with deep merge against defaults

### Security Layer
- **SecurityPolicy**: Path validation (null byte check, upward escape, forbidden paths with separator-delimited prefix matching), command validation (allowlist + restricted args + subshell/redirect blocking)
- **PolicyEngine**: Rule-based evaluation with deny precedence, glob matching, learning mode that suggests rules after approvals
- **ApprovalManager**: Scoped approval caching (user+channel, conversation, global) with TTL
- **InlineAllowStore**: Parses `[allow: once|day tool pattern]` from messages, strips tags, supports wildcard patterns
- **SecretStore**: ChaCha20-Poly1305 AEAD encryption with `enc2:` prefix, auto-creates key at `~/.bearclaw/.secret_key`
- **SSRF Guard**: DNS pinning, private IP detection (all RFC ranges + CGNAT + link-local), CIDR matching
- **Rate Limiter**: Sliding window with scoped limits (global + per-agent + per-tool-class)

### Logging & Events
- Structured JSON logging to stderr with configurable log level
- Typed EventBus for cross-cutting concerns (agent lifecycle, tool execution, policy decisions, provider calls)
