# BearClaw v2 — Lean Architecture & Implementation Plan

## Context

BearClaw is an AI agent framework cherry-picking the best patterns from five projects:

| Pattern | Source | Why |
|---|---|---|
| Security model | ZeroClaw | Defense-in-depth: sandboxing, allowlists, encrypted secrets, auth, rate limiting |
| Multi-agent orchestration | TinyClaw | Queue-based fan-out, handoffs, conversation aggregation via pending counter |
| Tool result types | PicoClaw | ForLLM/ForUser/Silent/Async — cleanest separation of concerns |
| Tool hooks | OpenClaw | before/after hooks, AbortSignal, streaming progress |
| Hybrid tool calling | TinyClaw + PicoClaw | Native agentic loop by default, CLI delegation as optional provider |
| Provider abstraction | PicoClaw | Per-provider translation, explicit and transparent |
| Memory system | OpenClaw | Markdown files: active-tasks, lessons, projects, daily logs |
| Message bus | PicoClaw | Async inbound/outbound queues, channel-keyed handlers |

This plan supersedes `ARCHITECTURE.md`, incorporating all fixes from `ARCHITECTURE-REVIEW.md` and `GAPS.md`, while cutting scope to stay lean.

**Location**: `/home/matt/code/bearclaw`
**Language**: TypeScript (ESM, Node 20+)
**Channels**: CLI + Telegram
**Providers**: Anthropic + OpenAI + Ollama + CLI Delegation (generic)
**Config**: `~/.bearclaw/config.json` with encrypted secrets

---

## Key Design Decisions

### 1. Memory = Markdown Files (not SQLite)

Following the OpenClaw pattern, memory lives in the workspace as plain markdown:

```
~/.bearclaw/workspace/memory/
  active-tasks.md       # "save game" — always loaded into system prompt
  lessons.md            # long-term learnings
  projects.md           # project-specific context
  YYYY-MM-DD.md         # daily logs
```

Agents read/write these with `read_file`/`write_file` tools. No FTS5, no vectors, no embedding cache. The agent's intelligence IS the search. This eliminates `better-sqlite3`, the `src/memory/` directory, and ~500 lines of hybrid search code.

### 2. Custom MCP Client (stdio + HTTP Streamable)

BearClaw has a custom MCP client with zero SDK dependencies — just JSON-RPC 2.0 over two transports:

- **Stdio transport** (`McpClient`): spawns MCP server as subprocess, newline-delimited JSON-RPC over stdin/stdout
- **HTTP Streamable transport** (`McpHttpClient`): POST JSON-RPC to a URL endpoint, supports both `application/json` and `text/event-stream` responses, `Mcp-Session-Id` tracking, and auto-retry on 404 session expiry

Both implement the `McpTransport` interface (`start`, `listTools`, `callTool`, `stop`). Transport selection is automatic based on config — `url` field → HTTP, `command` field → stdio.

```jsonc
{
  "mcp": {
    "servers": {
      "stripe": {
        "url": "https://mcp.stripe.com",
        "headers": { "Authorization": "Bearer ${STRIPE_API_KEY}" }
      },
      "local-server": {
        "command": "npx",
        "args": ["some-mcp-server@latest"]
      }
    }
  }
}
```

CLI delegation (`providers.cliDelegation`) still exists as an alternative for tools that have MCP built in (e.g., `claude -p "..."`), but direct MCP integration is preferred.

### 3. Sessions = JSON Files (not SQLite)

With no SQLite dependency, sessions use simple file persistence:
- `~/.bearclaw/sessions/{agent_id}_{channel}_{chatId}.json`
- JSON array of Message objects
- Load on agent loop start, save on end
- Max 100 messages, older dropped on load

### 4. No Dependencies Beyond Essentials

```json
{
  "dependencies": {
    "@noble/ciphers": "^1.0.0",
    "node-telegram-bot-api": "^0.67.0"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vitest": "^2.0.0",
    "@types/node": "^22.0.0"
  }
}
```

`@noble/ciphers` is pure JS (works on Raspberry Pi). No LLM SDKs — all providers use `fetch()` directly.

---

## Directory Structure

```
bearclaw/
  package.json
  tsconfig.json
  vitest.config.ts
  .gitignore

  src/
    index.ts                          # CLI entry point (REPL mode)
    daemon.ts                         # Daemon mode (channels + bus + orchestrator)
    logging.ts                        # Structured JSON logging
    events.ts                         # Typed EventBus

    cli/
      policy-status.ts                # `bearclaw policy status`

    config/
      schema.ts                       # All config TypeScript types
      defaults.ts                     # Default values, model ID mappings
      config.ts                       # Load/save ~/.bearclaw/config.json

    security/
      policy.ts                       # SecurityPolicy: path validation, command allowlist
      policy-engine.ts                # PolicyEngine: deny precedence, rule evaluation
      approvals.ts                    # ApprovalManager: per-user+channel approvals
      inline-allow.ts                 # Inline allow parsing + day-scoped storage
      secrets.ts                      # ChaCha20-Poly1305 AEAD encryption
      pairing.ts                      # 6-digit CSPRNG codes, SHA-256 tokens, lockout
      rate-limiter.ts                 # Sliding window + scoped rate limiting
      ssrf.ts                         # DNS pinning, proper CIDR blocking

    providers/
      types.ts                        # LLMProvider, Message, ToolCall, LLMResponse
      retry.ts                        # fetchWithRetry() with exponential backoff
      anthropic.ts                    # Anthropic API (tool_use content blocks)
      openai.ts                       # OpenAI API (function_call format)
      ollama.ts                       # Ollama local HTTP
      cli-delegation.ts               # Generic CLI subprocess provider

    tools/
      types.ts                        # Tool, ToolResult, ToolContext, factory functions
      registry.ts                     # ToolRegistry: register, get, execute, toProviderDefs
      hooks.ts                        # before/after hooks with flush()
      validate.ts                     # Recursive JSON Schema parameter validation
      builtin/
        read-file.ts                  # read_file (double path validation, 10MB limit)
        write-file.ts                 # write_file (path validation, autonomy check)
        edit-file.ts                  # edit_file (exact string find-and-replace)
        list-dir.ts                   # list_dir (non-recursive default, depth param)
        search.ts                     # search (grep-like, skip binary/.git/node_modules)
        exec.ts                       # exec (allowlist + restricted args, direct spawn)
        web-fetch.ts                  # web_fetch (SSRF guard, strip HTML, 50K truncate)
        spawn.ts                      # spawn (provider-agnostic subagent)
        message.ts                    # message (cross-channel send, policy-gated)

    agent/
      loop.ts                         # Core agentic loop: chat → hooks → tools → loop
      context.ts                      # System prompt assembly, memory file injection
      session.ts                      # JSON file session persistence

    bus/
      types.ts                        # InboundMessage, OutboundMessage
      bus.ts                          # Async inbound/outbound queues

    channels/
      types.ts                        # Channel interface
      cli.ts                          # stdin/stdout REPL
      telegram.ts                     # Telegram bot API

    orchestrator/
      conversation.ts                 # Conversation tracker with pending counter + reaper
      router.ts                       # @agent/@team prefix routing
      mentions.ts                     # [@agent: message] tag parsing
      team.ts                         # Team config resolution

    gateway/
      server.ts                       # HTTP gateway with pairing auth

  tests/
    security/
      policy.test.ts
      secrets.test.ts
      rate-limiter.test.ts
      ssrf.test.ts
    tools/
      registry.test.ts
      hooks.test.ts
      exec.test.ts
      validate.test.ts
    providers/
      anthropic.test.ts
      openai.test.ts
    orchestrator/
      conversation.test.ts
      mentions.test.ts
      router.test.ts
    agent/
      loop.test.ts
    bus/
      bus.test.ts
```

---

## Complete Type Definitions

### Config Schema (`src/config/schema.ts`)

```typescript
export enum AutonomyLevel {
  ReadOnly = "readonly",
  Supervised = "supervised",
  Full = "full",
}

export interface BearClawConfig {
  workspace: {
    path: string;                    // e.g. "~/.bearclaw/workspace"
  };
  security: {
    autonomy: AutonomyLevel;         // default: "supervised"
    workspaceOnly: boolean;          // default: true
    allowedCommands: string[];
    restrictedCommands: Record<string, string[]>;  // command → blocked arg patterns
    forbiddenPaths: string[];
    rateLimits: {
      global: number;               // default: 20 actions/hour
      perAgent?: number;            // optional per-agent limit
      perToolClass?: Record<string, number>;  // e.g. { "exec": 10, "web": 5 }
    };
    encrypt: boolean;                // default: true
  };
  gateway: {
    enabled: boolean;                // default: false
    host: string;                    // default: "127.0.0.1"
    port: number;                    // default: 3000
    bodyLimit: number;               // default: 65536 (64KB)
    timeout: number;                 // default: 30000 (30s)
    requirePairing: boolean;         // default: true
    allowPublicBind: boolean;        // default: false
  };
  providers: {
    anthropic?: {
      apiKey: string;                // encrypted as "enc2:..." when encrypt=true
      defaultModel: string;          // default: "claude-sonnet-4-5-20250929"
    };
    openai?: {
      apiKey: string;
      defaultModel: string;          // default: "gpt-4o"
    };
    ollama?: {
      baseUrl: string;               // default: "http://127.0.0.1:11434"
      defaultModel: string;          // default: "llama3"
    };
    cliDelegation?: {
      command: string;               // "claude", "codex", "aider", or any CLI tool
      flags?: string[];
      outputParser?: "text" | "jsonl";  // default: "text"
      jsonlMessageType?: string;        // for jsonl: type to extract
    };
  };
  channels: {
    enabled: string[];               // e.g. ["cli", "telegram"]
    telegram?: {
      botToken: string;              // encrypted
      allowFrom?: string[];          // sender ID allowlist
    };
  };
  agents: Record<string, AgentConfig>;
  teams: Record<string, TeamConfig>;
  memory: {
    enabled: boolean;                // default: true
    dir: string;                     // default: "memory" (relative to workspace)
    alwaysLoad: string[];            // default: ["active-tasks.md"]
  };
  policy: PolicyConfig;
  monitoring: {
    logLevel: "debug" | "info" | "warn" | "error";  // default: "info"
    heartbeatInterval: number;       // default: 3600 (1 hour, seconds)
  };
}

export interface AgentConfig {
  name: string;
  provider: string;                  // "anthropic" | "openai" | "ollama" | "cli-delegation"
  model?: string;                    // override provider default
  workingDirectory?: string;         // relative to workspace, or absolute
  autonomy?: AutonomyLevel;          // override global
  maxIterations?: number;            // default: 25
  maxTotalTokens?: number;           // token budget per turn
  systemPromptFiles?: string[];      // e.g. ["SOUL.md", "IDENTITY.md"]
}

export interface TeamConfig {
  name: string;
  agents: string[];
  leaderAgent: string;
}

export type PolicyAction = "allow" | "deny" | "approve";
export type PolicyScope = "tool" | "exec" | "web" | "cli_delegation" | "message";
export type ApprovalScope = "user+channel" | "conversation" | "global";
export type LearningMode = "suggest_rules" | "auto_allow_prompt" | "auto_allow";
export type InlineAllowScope = "once" | "day";

export interface PolicyRule {
  id: string;
  action: PolicyAction;
  scope: PolicyScope;
  match: {
    toolName?: string;
    command?: string;
    commandRegex?: string;
    argsRegex?: string;
    pathPattern?: string;
    urlDomain?: string;
    channel?: string;
    agentId?: string;
  };
  approvals?: {
    prompt?: string;
    expiresInSeconds?: number;
    maxApprovalsPerHour?: number;
  };
}

export interface PolicyConfig {
  defaultAction: PolicyAction;       // default: "approve"
  denyPrecedence: boolean;           // default: true
  approvalScope: ApprovalScope;      // default: "user+channel"
  learningMode: LearningMode;        // default: "suggest_rules"
  rules: PolicyRule[];
  approvals: {
    cache: boolean;                  // default: false
    defaultTTLSeconds: number;       // default: 300
  };
  inlineAllow: {
    enabled: boolean;                // default: true
    dayScopeHours: number;           // default: 24
  };
  web: {
    mode: "allow_with_blocklist";
    blockedDomains: string[];
    blockedCidrs: string[];
    blockedHosts: string[];
  };
}
```

### Default Values (`src/config/defaults.ts`)

```typescript
export const ALLOWED_COMMANDS = [
  "git", "npm", "npx", "node", "cargo", "go", "python", "python3", "pip",
  "ls", "cat", "grep", "find", "echo", "pwd", "wc", "head", "tail",
  "sort", "uniq", "diff", "date", "which", "mkdir", "cp", "mv",
  "touch", "chmod",
  // NOTE: curl, wget, env intentionally excluded (security review #1, #3)
];

// Commands allowed but with restricted arguments
export const RESTRICTED_COMMANDS: Record<string, string[]> = {
  curl: ["-o", "--output", "-O", "-T", "--upload-file"],
  wget: ["-O", "--output-document"],
  tee: ["*"],  // blocked entirely in supervised mode
};

export const FORBIDDEN_PATHS = [
  "/etc", "/root", "/boot", "/dev", "/proc", "/sys", "/var",
  "/bin", "/sbin", "/lib", "/usr", "/opt", "/tmp",
  "~/.ssh", "~/.gnupg", "~/.aws", "~/.config/gcloud",
];

export const POLICY_DEFAULTS = {
  defaultAction: "approve" as const,
  denyPrecedence: true,
  approvalScope: "user+channel" as const,
  learningMode: "suggest_rules" as const,
  approvals: { cache: false, defaultTTLSeconds: 300 },
  inlineAllow: { enabled: true, dayScopeHours: 24 },
  web: {
    mode: "allow_with_blocklist" as const,
    blockedDomains: [],
    blockedCidrs: [],
    blockedHosts: [],
  },
};

export const MAX_CONVERSATION_MESSAGES = 50;
export const MAX_CONVERSATION_DURATION_MS = 600_000;  // 10 minutes
export const MAX_SESSION_MESSAGES = 100;
export const LONG_RESPONSE_THRESHOLD = 4000;
export const SHELL_TIMEOUT_MS = 60_000;
export const SHELL_OUTPUT_LIMIT = 1_048_576;  // 1MB
export const WEB_FETCH_MAX_CHARS = 50_000;
export const WEB_FETCH_TIMEOUT_MS = 30_000;
export const READ_FILE_MAX_SIZE = 10_485_760;   // 10MB
export const WRITE_FILE_MAX_SIZE = 10_485_760;  // 10MB
```

---

## Security Implementation

### SecurityPolicy (`src/security/policy.ts`)

Ported from ZeroClaw with all review fixes applied.

```typescript
export class SecurityPolicy {
  constructor(
    public readonly autonomy: AutonomyLevel,
    public readonly workspaceDir: string,
    public readonly workspaceOnly: boolean,
    public readonly allowedCommands: string[],
    public readonly restrictedCommands: Record<string, string[]>,
    public readonly forbiddenPaths: string[],
    private readonly rateLimiter: ScopedRateLimiter,
  ) {}

  /**
   * Validate a raw path string before any filesystem access.
   * Fix #2: proper forbidden path matching + normalize instead of includes('..')
   */
  isPathAllowed(rawPath: string): boolean {
    if (rawPath.includes('\0')) return false;

    // Normalize and check if it escapes upward
    const normalized = path.normalize(rawPath);
    if (normalized.startsWith('..')) return false;

    if (this.workspaceOnly && path.isAbsolute(rawPath)) return false;

    const resolved = path.resolve(this.workspaceDir, rawPath);
    const expandedForbidden = this.forbiddenPaths.map(p =>
      p.startsWith('~') ? p.replace('~', os.homedir()) : p
    );
    for (const forbidden of expandedForbidden) {
      // Fix #2: exact match OR path-separator-delimited prefix
      if (resolved === forbidden || resolved.startsWith(forbidden + path.sep)) return false;
    }

    return true;
  }

  /** Catch symlink escapes after resolution. */
  async isResolvedPathAllowed(resolvedPath: string): Promise<boolean> {
    try {
      const realWorkspace = await fs.realpath(this.workspaceDir);
      const realPath = await fs.realpath(resolvedPath);
      return realPath.startsWith(realWorkspace + path.sep) || realPath === realWorkspace;
    } catch {
      return false;
    }
  }

  /**
   * Validate a shell command against the allowlist.
   * Fix #1: also checks restricted commands for blocked arguments.
   */
  isCommandAllowed(command: string): boolean {
    if (this.autonomy === AutonomyLevel.ReadOnly) return false;
    if (this.autonomy === AutonomyLevel.Full) return true;

    // Block subshell operators
    if (command.includes('`')) return false;
    if (command.includes('$(')) return false;
    if (command.includes('${')) return false;

    // Block output redirection
    if (command.includes('>')) return false;

    // Split on command separators
    let normalized = command;
    for (const sep of ['&&', '||']) {
      normalized = normalized.replaceAll(sep, '\x00');
    }
    for (const sep of ['\n', ';', '|']) {
      normalized = normalized.replaceAll(sep, '\x00');
    }

    let hasCommand = false;
    for (const segment of normalized.split('\x00')) {
      const trimmed = segment.trim();
      if (!trimmed) continue;

      const cmdPart = this.skipEnvAssignments(trimmed);
      if (!cmdPart) continue;

      const parts = cmdPart.split(/\s+/);
      const baseCmd = parts[0]?.split('/').pop() || '';
      if (!baseCmd) continue;

      hasCommand = true;

      // Check restricted commands first (allowed but with arg restrictions)
      const blockedArgs = this.restrictedCommands[baseCmd];
      if (blockedArgs) {
        if (blockedArgs[0] === '*') return false;  // entirely blocked (e.g., tee)
        for (const arg of parts.slice(1)) {
          if (blockedArgs.some(blocked => arg.startsWith(blocked))) return false;
        }
        continue;  // command is in restricted list and args are clean
      }

      // Check standard allowlist
      if (!this.allowedCommands.includes(baseCmd)) return false;
    }

    return hasCommand;
  }

  private skipEnvAssignments(s: string): string {
    let rest = s;
    while (true) {
      const word = rest.split(/\s+/)[0];
      if (!word) return rest;
      if (word.includes('=') && /^[a-zA-Z_]/.test(word)) {
        rest = rest.slice(word.length).trimStart();
      } else {
        return rest;
      }
    }
  }

  canAct(): boolean {
    return this.autonomy !== AutonomyLevel.ReadOnly;
  }

  recordAction(scope?: string, agentId?: string): boolean {
    return this.rateLimiter.record(scope, agentId);
  }

  isRateLimited(scope?: string, agentId?: string): boolean {
    return this.rateLimiter.isLimited(scope, agentId);
  }
}
```

### SlidingWindowRateLimiter + ScopedRateLimiter (`src/security/rate-limiter.ts`)

```typescript
export class SlidingWindowRateLimiter {
  private actions: number[] = [];

  constructor(
    private readonly maxActions: number,
    private readonly windowMs: number = 3_600_000,
  ) {}

  record(): boolean {
    this.prune();
    if (this.actions.length >= this.maxActions) return false;
    this.actions.push(Date.now());
    return true;
  }

  count(): number {
    this.prune();
    return this.actions.length;
  }

  isLimited(): boolean {
    this.prune();
    return this.actions.length >= this.maxActions;
  }

  private prune(): void {
    const cutoff = Date.now() - this.windowMs;
    this.actions = this.actions.filter(t => t > cutoff);
  }
}

/**
 * Scoped rate limiting: global + per-agent + per-tool-class.
 * Fix #4: prevents one noisy agent from locking out all others.
 */
export class ScopedRateLimiter {
  private global: SlidingWindowRateLimiter;
  private perAgent = new Map<string, SlidingWindowRateLimiter>();
  private perToolClass = new Map<string, SlidingWindowRateLimiter>();

  constructor(private config: {
    global: number;
    perAgent?: number;
    perToolClass?: Record<string, number>;
  }) {
    this.global = new SlidingWindowRateLimiter(config.global);
  }

  record(toolClass?: string, agentId?: string): boolean {
    if (!this.global.record()) return false;

    if (agentId && this.config.perAgent) {
      if (!this.perAgent.has(agentId)) {
        this.perAgent.set(agentId, new SlidingWindowRateLimiter(this.config.perAgent));
      }
      if (!this.perAgent.get(agentId)!.record()) return false;
    }

    if (toolClass && this.config.perToolClass?.[toolClass]) {
      if (!this.perToolClass.has(toolClass)) {
        this.perToolClass.set(toolClass, new SlidingWindowRateLimiter(this.config.perToolClass[toolClass]));
      }
      if (!this.perToolClass.get(toolClass)!.record()) return false;
    }

    return true;
  }

  isLimited(toolClass?: string, agentId?: string): boolean {
    if (this.global.isLimited()) return true;
    if (agentId && this.perAgent.get(agentId)?.isLimited()) return true;
    if (toolClass && this.perToolClass.get(toolClass)?.isLimited()) return true;
    return false;
  }
}
```

### SecretStore (`src/security/secrets.ts`)

Ported from ZeroClaw. ChaCha20-Poly1305 AEAD, `enc2:` prefix, key at `~/.bearclaw/.secret_key` with 0o600 permissions.

```typescript
import { chacha20poly1305 } from '@noble/ciphers/chacha';
import { randomBytes } from 'node:crypto';

const ENC2_PREFIX = 'enc2:';
const NONCE_LENGTH = 12;
const KEY_LENGTH = 32;

export class SecretStore {
  private key: Uint8Array;

  constructor(private configDir: string, private enabled: boolean) {
    this.key = enabled ? this.loadOrCreateKey() : new Uint8Array(KEY_LENGTH);
  }

  encrypt(plaintext: string): string {
    if (!this.enabled) return plaintext;
    const nonce = randomBytes(NONCE_LENGTH);
    const cipher = chacha20poly1305(this.key, nonce);
    const ciphertext = cipher.encrypt(Buffer.from(plaintext, 'utf8'));
    const blob = Buffer.concat([nonce, ciphertext]);
    return ENC2_PREFIX + blob.toString('hex');
  }

  decrypt(value: string): string {
    if (!value.startsWith(ENC2_PREFIX)) return value;
    const blob = Buffer.from(value.slice(ENC2_PREFIX.length), 'hex');
    const nonce = blob.subarray(0, NONCE_LENGTH);
    const ciphertext = blob.subarray(NONCE_LENGTH);
    const cipher = chacha20poly1305(this.key, nonce);
    const plaintext = cipher.decrypt(ciphertext);
    return Buffer.from(plaintext).toString('utf8');
  }

  static isEncrypted(value: string): boolean {
    return value.startsWith(ENC2_PREFIX);
  }

  private loadOrCreateKey(): Uint8Array {
    const keyPath = path.join(this.configDir, '.secret_key');
    try {
      const hex = fs.readFileSync(keyPath, 'utf8').trim();
      return Buffer.from(hex, 'hex');
    } catch {
      const key = randomBytes(KEY_LENGTH);
      fs.writeFileSync(keyPath, key.toString('hex'), { mode: 0o600 });
      return key;
    }
  }
}
```

### PairingGuard (`src/security/pairing.ts`)

Ported from ZeroClaw with persistence fix (#5):
- CSPRNG 6-digit codes with rejection sampling (no modulo bias)
- Constant-time comparison via `timingSafeEqual`
- Lockout after 5 failed attempts (5 min)
- **Tokens persisted** to `~/.bearclaw/paired-tokens.json` (encrypted via SecretStore)
- Load on startup, save on each new pairing

### SSRF Guard (`src/security/ssrf.ts`)

Fix #6 applied: proper numeric range checks instead of prefix matching.

```typescript
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const METADATA_HOSTS = [
  '169.254.169.254',
  'metadata.google.internal',
];

export async function validateUrl(url: string): Promise<{ allowed: boolean; reason?: string }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { allowed: false, reason: 'Invalid URL' };
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { allowed: false, reason: 'Only HTTP(S) allowed' };
  }

  const hostname = parsed.hostname;
  let ip: string;

  if (isIP(hostname)) {
    ip = hostname;
  } else {
    if (METADATA_HOSTS.includes(hostname)) {
      return { allowed: false, reason: 'Metadata endpoint blocked' };
    }
    try {
      const result = await lookup(hostname);
      ip = result.address;
    } catch {
      return { allowed: false, reason: 'DNS resolution failed' };
    }
  }

  if (isPrivateIP(ip)) {
    return { allowed: false, reason: `Private IP blocked: ${ip}` };
  }

  return { allowed: true };
}

function isPrivateIP(ip: string): boolean {
  // IPv6
  if (ip === '::1') return true;
  if (ip.startsWith('fe80:')) return true;
  if (ip.startsWith('fc') || ip.startsWith('fd')) return true;  // ULA
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);

  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => isNaN(p))) return false;

  const [a, b] = parts;
  if (a === 10) return true;                              // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true;       // 172.16.0.0/12
  if (a === 192 && b === 168) return true;                 // 192.168.0.0/16
  if (a === 127) return true;                              // 127.0.0.0/8
  if (a === 169 && b === 254) return true;                 // 169.254.0.0/16
  if (a === 0) return true;                                // 0.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return true;       // 100.64.0.0/10 (CGNAT)
  if (a === 198 && (b === 18 || b === 19)) return true;    // 198.18.0.0/15
  if (a >= 224) return true;                               // 224.0.0.0/4 + 240.0.0.0/4

  return false;
}

/**
 * Exported for PolicyEngine blockedCidrs config.
 */
export function matchesCidr(ip: string, cidr: string): boolean {
  const [network, bits] = cidr.split('/');
  const mask = ~(2 ** (32 - parseInt(bits)) - 1) >>> 0;
  return ipToUint32(ip) !== null &&
    (ipToUint32(ip)! & mask) === (ipToUint32(network)! & mask);
}

function ipToUint32(ip: string): number | null {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}
```

### PolicyEngine (`src/security/policy-engine.ts`)

Registered as the **first** before-hook. Evaluates policy rules for every tool call.

Rule evaluation:
1. Collect matching rules (scope + match conditions)
2. If any `deny` rule matches → deny (deny precedence)
3. Else first matching rule decides (allow/approve)
4. If no rule matches → `defaultAction` (approve)

Learning mode: `suggest_rules` logs candidate rules after an approval to `~/.bearclaw/policy-suggestions.json`.

### Inline Allow (`src/security/inline-allow.ts`)

User tags in messages: `[allow: exec git status]` (one-shot) or `[allow: day read_file ./docs/**/*.md]` (24h). Tags stripped before LLM input. Wildcards are match-only (no file expansion).

---

## Provider Implementation

### Types (`src/providers/types.ts`)

```typescript
export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LLMResponse {
  content: string;
  toolCalls: ToolCall[];
  finishReason: "stop" | "tool_calls" | "length" | "error";
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatOptions {
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  onToken?: (token: string) => void;  // streaming callback
}

export interface LLMProvider {
  chat(
    messages: Message[],
    tools: ToolDefinition[],
    model: string,
    options?: ChatOptions,
  ): Promise<LLMResponse>;
  defaultModel: string;
}
```

### Retry Utility (`src/providers/retry.ts`)

```typescript
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  maxRetries = 3,
): Promise<Response> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const resp = await fetch(url, init);

      if (resp.ok) return resp;

      if (resp.status === 401) {
        throw new Error(`Authentication failed (${resp.status})`);
      }

      if (resp.status === 429 || resp.status >= 500) {
        lastError = new Error(`HTTP ${resp.status}`);
        if (attempt < maxRetries) {
          await sleep(1000 * 2 ** attempt);  // 1s, 2s, 4s
          continue;
        }
      }

      const body = await resp.text();
      throw new Error(`Provider error ${resp.status}: ${body.slice(0, 500)}`);
    } catch (err) {
      if (err instanceof TypeError || (err as any)?.code === 'ECONNREFUSED') {
        lastError = err as Error;
        if (attempt < maxRetries) {
          await sleep(1000 * 2 ** attempt);
          continue;
        }
      }
      throw err;
    }
  }

  throw lastError ?? new Error('Max retries exceeded');
}
```

### Anthropic Provider (`src/providers/anthropic.ts`)

Uses `fetchWithRetry()`. Translates:
- System messages → separate `system` array parameter
- Tool results → user messages with `tool_result` content blocks
- Assistant + tool calls → `text` + `tool_use` content blocks
- Response: iterate `content` blocks, extract `text` and `tool_use`
- Streaming: when `onToken` provided, use `stream: true` and parse SSE events

### OpenAI Provider (`src/providers/openai.ts`)

Standard chat completions format. Tool calls use `function` nested objects with JSON-stringified arguments. SSE streaming with `stream: true`.

### Ollama Provider (`src/providers/ollama.ts`)

HTTP to `http://127.0.0.1:11434/api/chat`. OpenAI-compatible tool calling format. Native streaming.

### CLI Delegation Provider (`src/providers/cli-delegation.ts`)

**Generic and extensible.** Not hardcoded to claude/codex.

```typescript
export interface CliDelegationConfig {
  command: string;              // "claude", "codex", "aider", or any CLI tool
  flags?: string[];
  outputParser?: "text" | "jsonl";
  jsonlMessageType?: string;    // for jsonl: which type to extract
}

export class CliDelegationProvider implements LLMProvider {
  constructor(
    private config: CliDelegationConfig,
    public defaultModel: string = '',
  ) {}

  async chat(messages, tools, model, options): Promise<LLMResponse> {
    const lastUserMsg = messages.filter(m => m.role === 'user').pop();
    const prompt = lastUserMsg?.content ?? '';

    const args = this.buildArgs(prompt);
    const output = await spawnCommand(this.config.command, args, options?.signal);

    const content = this.config.outputParser === 'jsonl'
      ? this.parseJsonl(output)
      : output;

    return { content, toolCalls: [], finishReason: 'stop' };
  }

  private buildArgs(prompt: string): string[] {
    const cmd = this.config.command;
    const flags = this.config.flags ?? [];

    // Known CLI patterns — expand as new tools are added
    if (cmd === 'claude') {
      return ['--dangerously-skip-permissions', ...flags, '-p', prompt];
    }
    if (cmd === 'codex') {
      return ['exec', '--dangerously-bypass-approvals-and-sandbox', '--json', ...flags, prompt];
    }
    // Generic: just pass prompt as last arg
    return [...flags, prompt];
  }

  private parseJsonl(output: string): string {
    const targetType = this.config.jsonlMessageType ?? 'agent_message';
    const lines = output.trim().split('\n');
    for (const line of lines) {
      try {
        const json = JSON.parse(line);
        if (json.type === 'item.completed' && json.item?.type === targetType) {
          return json.item.text;
        }
      } catch { /* ignore non-JSON lines */ }
    }
    return output;
  }
}
```

**Adding a new CLI tool** = adding to config + optionally extending `buildArgs()` if it needs special arg patterns. No other code changes needed.

**Policy**: requires explicit `{ action: "allow", scope: "cli_delegation" }`. Startup warning:
> CLI delegation bypasses BearClaw's security model — the spawned CLI runs with full permissions and BearClaw has zero visibility into what tools it uses.

---

## Tool System

### Types (`src/tools/types.ts`)

```typescript
export interface ToolResult {
  forLLM: string;
  forUser?: string;
  silent?: boolean;
  isError: boolean;
  async: boolean;
  error?: Error;
}

export function toolResult(forLLM: string): ToolResult {
  return { forLLM, isError: false, async: false };
}

export function silentResult(forLLM: string): ToolResult {
  return { forLLM, silent: true, isError: false, async: false };
}

export function asyncResult(forLLM: string): ToolResult {
  return { forLLM, isError: false, async: true };
}

export function errorResult(message: string): ToolResult {
  return { forLLM: message, isError: true, async: false };
}

export function userResult(content: string): ToolResult {
  return { forLLM: content, forUser: content, isError: false, async: false };
}

export interface ToolContext {
  signal: AbortSignal;
  channel?: string;
  chatId?: string;
  onUpdate?: (partial: string) => void;
  policy: SecurityPolicy;
  policyEngine: PolicyEngine;
  approvalManager: ApprovalManager;
  inlineAllowStore: InlineAllowStore;
  // For spawn tool
  toolRegistry: ToolRegistry;
  hooks: ToolHookRegistry;
  agentConfigs: Record<string, AgentConfig>;
  currentAgentConfig: AgentConfig;
  providerFactory: (providerName: string) => LLMProvider;
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult>;
}
```

### Tool Registry (`src/tools/registry.ts`)

Register, get, execute (with JSON Schema validation), `toProviderDefs()`. Error wrapping around tool execution.

### Tool Hooks (`src/tools/hooks.ts`)

```typescript
export class ToolHookRegistry {
  private beforeHooks: BeforeToolCallHook[] = [];
  private afterHooks: AfterToolCallHook[] = [];
  private pendingAfterHooks: Promise<void>[] = [];

  // Before: sequential, blocking, can modify args
  async runBefore(toolName, args, ctx): Promise<{ proceed: boolean; args: Record<string, unknown> }>;

  // After: parallel, fire-and-forget (but tracked for flush)
  async runAfter(toolName, args, result, ctx): Promise<void>;

  // Flush: await all pending after-hooks (called on shutdown)
  async flush(timeoutMs = 5000): Promise<void>;
}
```

PolicyEngine registered as first before-hook.

### Built-in Tools

**read_file**: Double path validation (raw + resolved/symlink). `fs.stat()` size check (10MB limit) before read. Returns `toolResult()`.

**write_file**: Path validation, autonomy check (ReadOnly blocks), `Buffer.byteLength()` size check (10MB), auto-create parents with `fs.mkdir(recursive: true)`. Returns `toolResult()`.

**edit_file**: Read file → validate path → find exact string match (error if 0 or 2+ matches) → replace → write back. Returns `toolResult()` with diff summary.

**list_dir**: Non-recursive default, optional `depth` param (default 1). Returns formatted listing with file/dir indicators and sizes. Same path validation.

**search**: Grep-like recursive search. Parameters: `pattern`, `path`, `literal`, `glob`, `caseSensitive`, `maxResults` (default 100, cap 500), `contextLines`. Skip binary files (null byte in first 8KB), skip >10MB, skip `.git`/`node_modules`. Double path validation.

**exec**: Command allowlist + restricted args check. Fix #8: `isSimpleCommand()` → direct `spawn(cmd, args)` when no `|`, `&&`, `||`, `;`, newlines. Complex: `spawn('sh', ['-c', command])`. Timeout (`SHELL_TIMEOUT_MS`), output limit (`SHELL_OUTPUT_LIMIT`). Rate limit check. Returns `userResult()`.

**web_fetch**: SSRF guard → `fetch(url, { signal, timeout })` → if HTML, strip tags to text → truncate at 50K. Returns `toolResult()` (LLM-only).

**spawn**: Provider-agnostic subagent. See next section.

**message**: Publishes `OutboundMessage` to bus targeting specific channel+chatId. PolicyEngine controls access via `"message"` scope.

### Spawn Tool — Provider-Agnostic Subagents (`src/tools/builtin/spawn.ts`)

```typescript
export const spawnTool: Tool = {
  name: 'spawn',
  description: 'Spawn a subagent to handle a task. The subagent runs its own agent loop with the specified provider.',
  parameters: {
    type: 'object',
    properties: {
      task: { type: 'string', description: 'What the subagent should do' },
      agentId: { type: 'string', description: 'Agent config to use (default: current agent)' },
      provider: { type: 'string', description: 'Override provider (e.g., "cli-delegation" for MCP access)' },
      successCriteria: { type: 'string', description: 'What "done" looks like' },
      maxIterations: { type: 'number', description: 'Max iterations (default 10)' },
    },
    required: ['task'],
  },

  async execute(ctx: ToolContext, args): Promise<ToolResult> {
    const task = args.task as string;
    const agentId = (args.agentId as string) ?? ctx.currentAgentConfig.name;
    const providerOverride = args.provider as string | undefined;
    const successCriteria = args.successCriteria as string | undefined;
    const maxIterations = Math.min(
      (args.maxIterations as number) ?? 10,
      ctx.currentAgentConfig.maxIterations ?? 25,
    );

    // Resolve agent config
    const agentConfig = ctx.agentConfigs[agentId];
    if (!agentConfig) return errorResult(`Unknown agent: ${agentId}`);

    // Resolve provider
    const providerName = providerOverride ?? agentConfig.provider;
    const provider = ctx.providerFactory(providerName);

    // Build restricted tool registry (no spawn, no message)
    const childRegistry = new ToolRegistry();
    for (const name of ctx.toolRegistry.list()) {
      if (name === 'spawn' || name === 'message') continue;
      const tool = ctx.toolRegistry.get(name);
      if (tool) childRegistry.register(tool);
    }

    // Build system prompt with task and success criteria
    const systemPrompt = successCriteria
      ? `${task}\n\nYour task is complete when: ${successCriteria}. State whether you met the criteria and summarize what you did.`
      : task;

    const messages: Message[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: task },
    ];

    // Run subagent loop (in-process, same Node process)
    const childCtx = { ...ctx, toolRegistry: childRegistry };
    const result = await runAgentLoop(
      { provider, model: agentConfig.model ?? provider.defaultModel, tools: childRegistry, hooks: ctx.hooks, maxIterations },
      messages,
      childCtx,
    );

    return toolResult(
      successCriteria
        ? `Subagent result (criteria: ${successCriteria}):\n${result.content}`
        : `Subagent result:\n${result.content}`
    );
  },
};
```

---

## Agent Loop (`src/agent/loop.ts`)

```typescript
export interface AgentLoopConfig {
  provider: LLMProvider;
  model: string;
  tools: ToolRegistry;
  hooks: ToolHookRegistry;
  maxIterations: number;
  maxTotalTokens?: number;
  options?: { maxTokens?: number; temperature?: number; onToken?: (token: string) => void };
}

export interface AgentLoopResult {
  content: string;
  iterations: number;
  toolsUsed: Array<{ name: string; result: ToolResult }>;
  totalTokens: number;
}

export async function runAgentLoop(
  config: AgentLoopConfig,
  messages: Message[],
  ctx: ToolContext,
): Promise<AgentLoopResult> {
  const { provider, model, tools, hooks, maxIterations, maxTotalTokens, options } = config;
  let iteration = 0;
  let totalTokens = 0;
  const toolsUsed: Array<{ name: string; result: ToolResult }> = [];

  while (iteration < maxIterations) {
    iteration++;

    // Check token budget
    if (maxTotalTokens && totalTokens >= maxTotalTokens) {
      return { content: 'Token budget exceeded.', iterations: iteration, toolsUsed, totalTokens };
    }

    // Call LLM
    const toolDefs = tools.toProviderDefs();
    const response = await provider.chat(messages, toolDefs, model, {
      ...options,
      signal: ctx.signal,
    });

    // Track tokens
    if (response.usage) {
      totalTokens += response.usage.totalTokens;
    }

    // No tool calls → done
    if (response.toolCalls.length === 0) {
      return { content: response.content, iterations: iteration, toolsUsed, totalTokens };
    }

    // Append assistant message
    messages.push({
      role: 'assistant',
      content: response.content,
      toolCalls: response.toolCalls,
    });

    // Execute tool calls IN PARALLEL (fix #10)
    const toolResults = await Promise.all(
      response.toolCalls.map(async (tc) => {
        // Before hook (blocking)
        const hookResult = await hooks.runBefore(tc.name, tc.arguments, ctx);

        let result: ToolResult;
        if (!hookResult.proceed) {
          result = errorResult(`Tool call blocked by policy: ${tc.name}`);
        } else {
          result = await tools.execute(ctx, tc.name, hookResult.args);
        }

        // After hook (fire-and-forget, tracked for flush)
        hooks.runAfter(tc.name, hookResult.args, result, ctx);

        return { tc, result };
      })
    );

    // Append results in original order
    for (const { tc, result } of toolResults) {
      toolsUsed.push({ name: tc.name, result });
      messages.push({
        role: 'tool',
        content: result.forLLM,
        toolCallId: tc.id,
      });
    }
  }

  return {
    content: 'Reached maximum iterations without a final response.',
    iterations: iteration,
    toolsUsed,
    totalTokens,
  };
}
```

---

## Context Assembly (`src/agent/context.ts`)

System prompt built in order:
1. Load each file from `AgentConfig.systemPromptFiles` (e.g., `SOUL.md`, `IDENTITY.md`)
2. Append tool descriptions summary (names + short descriptions)
3. If memory enabled: always load `memory/active-tasks.md` contents (if exists)
4. If team context: append teammate names, team purpose, mention syntax
5. Combine into single system message

---

## Session Persistence (`src/agent/session.ts`)

```typescript
const SESSIONS_DIR = path.join(configDir, 'sessions');

function sessionPath(agentId: string, channel: string, chatId: string): string {
  return path.join(SESSIONS_DIR, `${agentId}_${channel}_${chatId}.json`);
}

export function loadSession(agentId, channel, chatId): Message[] {
  try {
    const data = fs.readFileSync(sessionPath(agentId, channel, chatId), 'utf8');
    const messages: Message[] = JSON.parse(data);
    // Keep last MAX_SESSION_MESSAGES
    return messages.slice(-MAX_SESSION_MESSAGES);
  } catch {
    return [];
  }
}

export function saveSession(agentId, channel, chatId, messages: Message[]): void {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  const trimmed = messages.slice(-MAX_SESSION_MESSAGES);
  fs.writeFileSync(sessionPath(agentId, channel, chatId), JSON.stringify(trimmed, null, 2));
}
```

---

## Message Bus (`src/bus/bus.ts`)

### Types (`src/bus/types.ts`)

```typescript
export interface InboundMessage {
  channel: string;
  sender: string;
  chatId: string;
  messageId: string;
  message: string;
  conversationId?: string;
  files?: string[];
  timestamp: number;
}

export interface OutboundMessage {
  channel: string;
  chatId: string;
  content: string;
  replyToMessageId?: string;
  files?: string[];
  agentId?: string;
  conversationId?: string;
}
```

### MessageBus

Async inbound/outbound queues with capacity limits (default 100). Waiter pattern: `publishInbound()` resolves a waiting consumer directly, or enqueues if no waiter. `consumeInbound()` dequeues or waits. AbortSignal for graceful shutdown. Same pattern for outbound.

---

## Channels

### Interface (`src/channels/types.ts`)

```typescript
export interface Channel {
  name: string;
  start(bus: MessageBus): Promise<void>;
  stop(): Promise<void>;
  send(msg: OutboundMessage): Promise<void>;
}
```

### CLI Channel (`src/channels/cli.ts`)

stdin/stdout REPL. Handles: `help`/`?`, `agents`, `teams`, `policy`, `quit`/`exit`. Publishes user input as `InboundMessage` to bus.

### Telegram Channel (`src/channels/telegram.ts`)

Telegram Bot API via `node-telegram-bot-api`. Sender allowlisting from config. Inline keyboard for approval UX: Approve / Deny / Allow-for-day. Implements `ApprovalPrompt` interface from `src/security/approvals.ts`.

---

## Multi-Agent Orchestration

### ConversationTracker (`src/orchestrator/conversation.ts`)

Pending counter pattern from TinyClaw. `fanOut(count)` increments, `branchComplete()` decrements. When `pending === 0`, conversation is complete — aggregate responses.

**Reaper**: `setInterval` every 60s, sweeps conversations past `MAX_CONVERSATION_DURATION_MS` (10 min). On timeout: publish partial aggregation with note about timed-out agents.

### Mention Parsing (`src/orchestrator/mentions.ts`)

Format: `[@agent_id: message]`. Supports comma-separated: `[@agent1,agent2: shared message]`. Text outside tags = shared context prepended to directed messages. Validates teammates are in same team.

### Router (`src/orchestrator/router.ts`)

`@agent fix bug` → agent: coder, message: "fix bug". `@team fix bug` → team → leader agent. No prefix → default agent.

---

## Gateway (`src/gateway/server.ts`)

HTTP server using Node's built-in `http` module. Pairing auth required by default. Body limit 64KB. Request timeout 30s. Only binds to `127.0.0.1` unless `allowPublicBind: true`.

Endpoints:
- `POST /pair` — initiate pairing
- `POST /pair/verify` — submit code, receive token
- `POST /message` — send message (requires bearer token)
- `GET /health` — health check

---

## EventBus (`src/events.ts`)

Typed event emitter for cross-cutting concerns:

```typescript
interface EventMap {
  'agent:started': { agentId: string; conversationId: string };
  'agent:stopped': { agentId: string; reason: string };
  'tool:executed': { tool: string; duration: number; isError: boolean };
  'policy:decision': { tool: string; ruleId?: string; action: string };
  'provider:call': { provider: string; model: string; tokens: number; latency: number };
  'provider:error': { provider: string; status: number; retries: number };
  'conversation:created': { id: string; channel: string };
  'conversation:completed': { id: string; pending: number };
  'conversation:timeout': { id: string; elapsed: number };
}
```

Logging subscriber (`src/logging.ts`) listens to all events and emits structured JSON to stderr.

---

## Structured Logging (`src/logging.ts`)

```typescript
export function createLogger(subsystem: string) {
  return {
    debug: (msg: string, data?: Record<string, unknown>) => emit('debug', subsystem, msg, data),
    info:  (msg: string, data?: Record<string, unknown>) => emit('info',  subsystem, msg, data),
    warn:  (msg: string, data?: Record<string, unknown>) => emit('warn',  subsystem, msg, data),
    error: (msg: string, data?: Record<string, unknown>) => emit('error', subsystem, msg, data),
  };
}

// Output: {"ts":"...","level":"info","sub":"agent","msg":"...","data":{...}}
```

Config: `monitoring.logLevel` (default: "info").

---

## Daemon Entry Point (`src/daemon.ts`)

Startup sequence:
1. Load + validate config
2. Initialize SecretStore, decrypt provider keys
3. Create SecurityPolicy, PolicyEngine, ApprovalManager, InlineAllowStore
4. Create providers (Anthropic, OpenAI, Ollama, CLI delegation)
5. Create ToolRegistry, register all builtin tools
6. Create ToolHookRegistry, register PolicyEngine as first before-hook
7. Create MessageBus
8. Start channels (CLI, Telegram)
9. Start conversation reaper
10. Main loop: per-agent promise chains consuming from bus

Main loop:
- Consume inbound → route message → resolve agent → load session → build context → run agent loop → save session
- Agent response → parse mentions → fan-out to teammates → branchComplete → aggregate when done
- Outbound loop: consume → dispatch via `channel.send()`

Graceful shutdown:
- AbortController signals all loops
- Drain outbound queue
- Flush after-hooks (`hooks.flush()`)
- Stop channels
- Save all active sessions

---

## Implementation Order

### Phase 1: Foundation (Config + Security)
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

### Phase 2: Provider Layer
16. `src/providers/types.ts` — LLMProvider, Message, ToolCall, LLMResponse, ChatOptions
17. `src/providers/retry.ts` — fetchWithRetry()
18. `src/providers/anthropic.ts` — Anthropic API with streaming
19. `src/providers/openai.ts` — OpenAI API with streaming
20. `src/providers/ollama.ts` — Ollama local HTTP
21. `src/providers/cli-delegation.ts` — generic CLI subprocess provider
22. Tests: `tests/providers/*`

### Phase 3: Tool System
23. `src/tools/types.ts` — Tool, ToolResult, ToolContext, factory functions
24. `src/tools/validate.ts` — JSON Schema validation
25. `src/tools/registry.ts` — ToolRegistry
26. `src/tools/hooks.ts` — ToolHookRegistry with flush()
27. `src/tools/builtin/read-file.ts`
28. `src/tools/builtin/write-file.ts`
29. `src/tools/builtin/edit-file.ts`
30. `src/tools/builtin/list-dir.ts`
31. `src/tools/builtin/search.ts`
32. `src/tools/builtin/exec.ts`
33. `src/tools/builtin/web-fetch.ts`
34. `src/tools/builtin/spawn.ts`
35. `src/tools/builtin/message.ts`
36. Tests: `tests/tools/*`

### Phase 4: Agent Loop
37. `src/agent/session.ts` — JSON file session persistence
38. `src/agent/context.ts` — system prompt assembly + memory file injection
39. `src/agent/loop.ts` — core agentic loop (parallel tools, token budget)
40. Tests: `tests/agent/loop.test.ts`

### Phase 5: Bus + Channels
41. `src/bus/types.ts` — InboundMessage, OutboundMessage
42. `src/bus/bus.ts` — MessageBus
43. `src/channels/types.ts` — Channel interface
44. `src/channels/cli.ts` — CLI REPL
45. `src/channels/telegram.ts` — Telegram bot
46. Tests: `tests/bus/bus.test.ts`

### Phase 6: Multi-Agent Orchestration
47. `src/orchestrator/conversation.ts` — ConversationTracker + reaper
48. `src/orchestrator/mentions.ts` — mention parsing
49. `src/orchestrator/router.ts` — message routing
50. `src/orchestrator/team.ts` — team config resolution
51. Tests: `tests/orchestrator/*`

### Phase 7: Gateway + Pairing
52. `src/security/pairing.ts` — PairingGuard (persistent)
53. `src/gateway/server.ts` — HTTP gateway

### Phase 8: Entry Points
54. `src/index.ts` — CLI REPL entry point
55. `src/daemon.ts` — daemon mode

---

## File Count

| Phase | Source | Tests | Total |
|---|---|---|---|
| 1: Foundation | 14 | 4 | 18 |
| 2: Providers | 6 | 2 | 8 |
| 3: Tools | 13 | 4 | 17 |
| 4: Agent | 3 | 1 | 4 |
| 5: Bus + Channels | 5 | 1 | 6 |
| 6: Orchestration | 4 | 3 | 7 |
| 7: Gateway | 2 | 0 | 2 |
| 8: Entry | 2 | 0 | 2 |
| **Total** | **49** | **15** | **64** |

---

## Verification Plan

1. **Security tests**: `npx vitest tests/security/` — SSRF CIDR (172.17-31 blocked, 172.32 allowed, CGNAT), path traversal (null bytes, symlinks, `..`), command injection (backticks, `$()`, redirects, restricted args), encryption roundtrip + tamper detection, pairing lockout, scoped rate limits
2. **Single agent CLI**: `npx tsx src/index.ts` → type message → get LLM response with tool use (read a file, run a command)
3. **Policy approvals**: Trigger `exec` with no rule → approval requested → approve → suggestion logged
4. **Inline allow**: `[allow: day read_file ./docs/**/*.md]` → verify 24h persistence in `bearclaw policy status`
5. **Tool hooks**: Register before-hook blocking `exec rm` → verify blocked
6. **Spawn + CLI delegation**: Agent spawns subagent with `provider: "cli-delegation"` → Claude Code runs → result returned
7. **Multi-agent team**: 2 agents + 1 team → `@team review` → leader delegates via `[@teammate: ...]` → responses aggregated
8. **Telegram**: Bot configured → send message → response with approval inline keyboard
9. **Memory files**: Agent writes to `memory/active-tasks.md` → next session loads it automatically in system prompt
10. **Rate limiting**: 21 rapid tool calls → 21st rejected (scoped: per-agent limit works independently of global)
11. **Streaming**: Long response → tokens appear incrementally in CLI
12. **Pairing**: Unauthorized sender → pairing code flow → token auth works → restart preserves tokens

---

## Post-MVP Roadmap (by value)

1. **Custom MCP client** — direct tool discovery without CLI delegation overhead
2. **Skills system** — YAML frontmatter + prompt templates, `use_when`/`dont_use_when` routing
3. **Plugin system** — tools + hooks + channels from npm/local packages
4. **Cron scheduler + heartbeat** — recurring tasks in fresh sessions
5. **Crash recovery journal** — beyond `active-tasks.md`, structured task journaling
6. **Content-aware model escalation** — stronger models for external content
7. **Blackboard** — shared key-value store for agent coordination
8. **`bearclaw init`** — guided setup wizard
9. **Config splitting** — `~/.bearclaw/conf.d/*.json` overlay merge
10. **Secret rotation** — `bearclaw secrets rotate`

---

## Reference Files

| Pattern | Source | File |
|---|---|---|
| Path/command validation | ZeroClaw | `src/security/policy.rs` lines 166-269 |
| ChaCha20-Poly1305 encryption | ZeroClaw | `src/security/secrets.rs` lines 56-148 |
| Pairing auth + lockout | ZeroClaw | `src/security/pairing.rs` lines 83-228 |
| Agentic tool loop | PicoClaw | `pkg/tools/toolloop.go` |
| Agent loop + session | PicoClaw | `pkg/agent/loop.go` lines 412-569 |
| ToolResult (ForLLM/ForUser) | PicoClaw | `pkg/tools/result.go` lines 8-144 |
| Tool interface | PicoClaw | `pkg/tools/base.go` lines 5-70 |
| Provider translation (Claude) | PicoClaw | `pkg/providers/claude_provider.go` |
| Provider translation (OpenAI) | PicoClaw | `pkg/providers/http_provider.go` |
| Message bus | PicoClaw | `pkg/bus/bus.go` |
| before_tool_call hooks | OpenClaw | `src/agents/pi-tools.before-tool-call.ts` lines 19-66 |
| after_tool_call hooks | OpenClaw | `src/agents/pi-embedded-subscribe.handlers.tools.ts` lines 289-314 |
| Hook runner (sequential/parallel) | OpenClaw | `src/plugins/hooks.ts` lines 100-327 |
| SSRF protection | OpenClaw | `src/agents/tools/web-fetch.ts` |
| Conversation tracking | TinyClaw | `src/queue-processor.ts` lines 395-460 |
| Mention parsing | TinyClaw | `src/lib/routing.ts` lines 39-73 |
| Message routing | TinyClaw | `src/lib/routing.ts` lines 137-164 |
| CLI delegation | TinyClaw | `src/lib/invoke.ts` |
| Memory pattern | OpenClaw | `plans/OPENCLAW_TIPS.md` |
