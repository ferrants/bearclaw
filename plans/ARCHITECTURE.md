# BearClaw — Complete Architecture & Implementation Plan

## Context

After deep-diving into five AI agent projects (TinyClaw, ZeroClaw, PicoClaw, Nanobot, OpenClaw), we found that no single project combines strong security, multi-agent orchestration, a full tool system, and lightweight deployment. BearClaw fills that gap — cherry-picking the best patterns from each:

| Pattern | Source | Why |
|---|---|---|
| Security model | ZeroClaw | Defense-in-depth: sandboxing, allowlists, encrypted secrets, auth, rate limiting |
| Multi-agent orchestration | TinyClaw | Queue-based fan-out, handoffs, conversation aggregation via pending counter |
| Tool result types | PicoClaw | ForLLM/ForUser/Silent/Async — cleanest separation of concerns |
| Tool hooks | OpenClaw | before/after hooks, AbortSignal, streaming progress, result persistence |
| Hybrid tool calling | TinyClaw + PicoClaw | Native agentic loop by default, CLI delegation as optional provider |
| Provider abstraction | PicoClaw | Per-provider translation, explicit and transparent |
| Memory system | ZeroClaw | SQLite FTS5 + vector cosine similarity hybrid search |
| Message bus | PicoClaw | Async inbound/outbound queues, channel-keyed handlers |

**Location**: `/home/matt/code/bearclaw`
**Language**: TypeScript (ESM, Node 20+)
**MVP Channels**: CLI + Telegram
**MVP Providers**: Anthropic + OpenAI + Ollama
**Config**: `~/.bearclaw/config.json` with encrypted secrets

---

## Directory Structure

```
bearclaw/
  package.json
  tsconfig.json
  vitest.config.ts
  .gitignore
  README.md

  src/
    index.ts                          # CLI entry point (REPL mode)
    daemon.ts                         # Daemon mode (channels + bus + orchestrator)
    logging.ts                        # Structured JSON logging

    cli/
      policy-status.ts                # `bearclaw policy status`

    config/
      schema.ts                       # All config TypeScript types
      defaults.ts                     # Default values, model ID mappings
      config.ts                       # Load/save ~/.bearclaw/config.json

    security/
      policy.ts                       # SecurityPolicy: path validation, command allowlist, autonomy levels
      policy-engine.ts                # PolicyEngine: allow/deny/approve, deny precedence
      approvals.ts                    # ApprovalManager: per-user+channel approvals
      inline-allow.ts                 # Inline allow parsing + day-scoped storage
      secrets.ts                      # ChaCha20-Poly1305 AEAD encryption for config values
      pairing.ts                      # 6-digit CSPRNG codes, SHA-256 hashed bearer tokens, lockout
      rate-limiter.ts                 # Sliding window (default 20 actions/hour)
      ssrf.ts                         # DNS pinning, private IP range blocking

    providers/
      types.ts                        # LLMProvider interface, Message, ToolCall, LLMResponse
      anthropic.ts                    # Anthropic API (tool_use content blocks)
      openai.ts                       # OpenAI API (function_call format)
      ollama.ts                       # Ollama local HTTP
      cli-delegation.ts               # Spawn claude/codex CLI as subprocess

    tools/
      types.ts                        # Tool interface, ToolResult, ToolContext, factory functions
      registry.ts                     # ToolRegistry: register, get, execute, toProviderDefs
      hooks.ts                        # before_tool_call (blocking) + after_tool_call (fire-and-forget)
      validate.ts                     # Recursive JSON Schema parameter validation
      builtin/
        read-file.ts                  # read_file tool
        write-file.ts                 # write_file tool
        edit-file.ts                  # edit_file tool (find-and-replace)
        list-dir.ts                   # list_dir tool
        exec.ts                       # exec tool (shell with command allowlist)
        web-fetch.ts                  # web_fetch tool (HTTP with SSRF guard)
        web-request.ts                # web_request tool (method/headers/body)
        web-download.ts               # web_download tool (stream to workspace)
        spawn.ts                      # spawn tool (subagent)
        message.ts                    # message tool (cross-channel send)

    agent/
      loop.ts                         # Core agentic loop: chat → hooks → tools → loop
      context.ts                      # System prompt assembly, memory injection
      session.ts                      # Per-agent message history, persistence

    bus/
      bus.ts                          # Async inbound/outbound queues, channel handler registry

    channels/
      types.ts                        # Channel interface
      cli.ts                          # stdin/stdout REPL
      telegram.ts                     # Telegram bot API

    orchestrator/
      conversation.ts                 # Conversation tracker with pending counter
      router.ts                       # @agent/@team prefix routing
      mentions.ts                     # [@agent: message] tag parsing
      team.ts                         # Team config resolution

    memory/
      types.ts                        # Memory interface, MemoryEntry
      sqlite.ts                       # SQLite FTS5 + vector cosine similarity, hybrid merge

    gateway/
      server.ts                       # HTTP gateway with pairing auth, body limits, timeouts

  tests/
    security/
      policy.test.ts                  # Path traversal, symlink escape, injection tests
      secrets.test.ts                 # Encrypt/decrypt roundtrip, tamper detection
      pairing.test.ts                 # Code generation, lockout, constant-time comparison
      rate-limiter.test.ts            # Sliding window boundary tests
      ssrf.test.ts                    # Private IP blocking, DNS pinning
    tools/
      registry.test.ts                # Register/get/execute
      hooks.test.ts                   # before/after hook execution order
      exec.test.ts                    # Command allowlist enforcement
      validate.test.ts                # JSON Schema validation
    providers/
      anthropic.test.ts               # Message format translation
      openai.test.ts                  # Function call format translation
    orchestrator/
      conversation.test.ts            # Fan-out/aggregation, pending counter
      mentions.test.ts                # Tag parsing, shared context extraction
      router.test.ts                  # Routing logic
    agent/
      loop.test.ts                    # Tool loop iteration, max iterations
    bus/
      bus.test.ts                     # Pub/sub, capacity limits
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
    allowedCommands: string[];       // default: see ALLOWED_COMMANDS below
    forbiddenPaths: string[];        // default: see FORBIDDEN_PATHS below
    maxActionsPerHour: number;       // default: 20
    encrypt: boolean;                // default: true
  };
  gateway: {
    enabled: boolean;                // default: false
    host: string;                    // default: "127.0.0.1"
    port: number;                    // default: 3000
    bodyLimit: number;               // default: 65536 (64KB)
    timeout: number;                 // default: 30000 (30s)
    requirePairing: boolean;         // default: true
    allowPublicBind: boolean;        // default: false — must explicitly opt in to 0.0.0.0
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
      command: "claude" | "codex";
      flags?: string[];              // additional CLI flags
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
    vectorWeight: number;            // default: 0.7
    keywordWeight: number;           // default: 0.3
    cacheMax: number;                // default: 10000
    archiveDays: number;             // default: 7
    purgeDays: number;               // default: 30
  };
  policy: PolicyConfig;
  monitoring: {
    heartbeatInterval: number;       // default: 3600 (1 hour, in seconds)
  };
}

export interface AgentConfig {
  name: string;                      // display name
  provider: string;                  // "anthropic" | "openai" | "ollama" | "cli-delegation"
  model?: string;                    // override provider default
  workingDirectory?: string;         // relative to workspace.path, or absolute
  autonomy?: AutonomyLevel;          // override global autonomy for this agent
  maxIterations?: number;            // default: 25
  systemPromptFiles?: string[];      // e.g. ["SOUL.md", "IDENTITY.md"]
}

export interface TeamConfig {
  name: string;
  agents: string[];                  // agent IDs that belong to this team
  leaderAgent: string;               // agent ID that receives team-routed messages
}

export type PolicyAction = "allow" | "deny" | "approve";
export type PolicyScope = "tool" | "exec" | "web" | "cli_delegation";
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
    pathPattern?: string;            // wildcard match only (no expansion)
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
    mode: "allow_with_blocklist";    // default: "allow_with_blocklist"
    blockedDomains: string[];        // default: []
    blockedCidrs: string[];          // default: []
    blockedHosts: string[];          // default: []
  };
}
```

### Default Values (`src/config/defaults.ts`)

```typescript
export const ALLOWED_COMMANDS = [
  "git", "npm", "npx", "node", "cargo", "go", "python", "python3", "pip",
  "ls", "cat", "grep", "find", "echo", "pwd", "wc", "head", "tail",
  "sort", "uniq", "diff", "date", "which", "env", "mkdir", "cp", "mv",
  "touch", "chmod", "curl", "wget",
];

export const FORBIDDEN_PATHS = [
  "/etc", "/root", "/boot", "/dev", "/proc", "/sys", "/var",
  "/bin", "/sbin", "/lib", "/usr", "/opt", "/tmp",
  "~/.ssh", "~/.gnupg", "~/.aws", "~/.config/gcloud",
];

export const POLICY_DEFAULTS = {
  defaultAction: "approve",
  denyPrecedence: true,
  approvalScope: "user+channel",
  learningMode: "suggest_rules",
  approvals: { cache: false, defaultTTLSeconds: 300 },
  inlineAllow: { enabled: true, dayScopeHours: 24 },
  web: {
    mode: "allow_with_blocklist",
    blockedDomains: [],
    blockedCidrs: [],
    blockedHosts: [],
  },
};

export const MAX_CONVERSATION_MESSAGES = 50;
export const LONG_RESPONSE_THRESHOLD = 4000;
export const SHELL_TIMEOUT_MS = 60_000;
export const SHELL_OUTPUT_LIMIT = 1_048_576;  // 1MB
export const WEB_FETCH_MAX_CHARS = 50_000;
export const WEB_FETCH_TIMEOUT_MS = 30_000;
```

---

## Security Implementation Details

### PolicyEngine + ApprovalManager (`src/security/policy-engine.ts`, `src/security/approvals.ts`)

New enforcement layer that sits in `before_tool_call` and evaluates policy rules for **every** tool call.

**Rule evaluation:**
1. Collect matching rules (scope + match conditions)
2. If any `deny` rule matches → deny (deny precedence)
3. Else first matching rule decides (allow/approve)
4. If no rule matches → `defaultAction` (approve)

**Approval flow (per user+channel):**
- `ApprovalManager` tracks pending approvals and optional TTL caching
- `approvalScope` default is `user+channel`
- Approvals can be issued via CLI prompt or channel UI (e.g. Telegram buttons)

**Learning mode:**
- `suggest_rules` logs candidate rules after an approval
- Suggestions are stored in `~/.bearclaw/policy-suggestions.json`
- `bearclaw policy suggestions` lets users review and accept

### Policy Examples

**Config rules (deny precedence):**
```json
{
  "policy": {
    "defaultAction": "approve",
    "denyPrecedence": true,
    "rules": [
      { "id": "deny-shell", "action": "deny", "scope": "exec", "match": { "commandRegex": ".*" } },
      { "id": "allow-git", "action": "allow", "scope": "exec", "match": { "command": "git" } },
      { "id": "approve-web", "action": "approve", "scope": "web", "match": { "urlDomain": "example.com" } }
    ]
  }
}
```

**Inline allow tags (one-shot vs day-scoped):**
- One-shot: `[allow: exec git status]`
- Day-scoped: `[allow: day read_file ./docs/**/*.md]`

### Inline Allow Tags (`src/security/inline-allow.ts`)

Users can explicitly allow a tool call in a message:
- One-shot: `[allow: exec git status]`
- Day-scoped: `[allow: day read_file ./docs/**/*.md]`

**Behavior:**
- Tags are stripped before LLM input
- One-shot applies to next matching tool call only
- Day-scoped persists 24 hours within the conversation
- Wildcards are **match-only** (no file expansion)

### Policy Status Command (`src/cli/policy-status.ts`)

`bearclaw policy status` shows:
- Active day-scoped inline allows (tool, pattern, expiresAt, user, channel, conversation)
- Cached approvals (if enabled)
- Recent policy decisions (optional)

### SecurityPolicy (`src/security/policy.ts`)

Ported from ZeroClaw (`/home/matt/code/zeroclaw/src/security/policy.rs`).

```typescript
export class SecurityPolicy {
  constructor(
    public readonly autonomy: AutonomyLevel,
    public readonly workspaceDir: string,
    public readonly workspaceOnly: boolean,
    public readonly allowedCommands: string[],
    public readonly forbiddenPaths: string[],
    private readonly rateLimiter: SlidingWindowRateLimiter,
  ) {}

  /**
   * Validate a raw path string before any filesystem access.
   * Ported from ZeroClaw policy.rs lines 232-256.
   */
  isPathAllowed(rawPath: string): boolean {
    // 1. Block null bytes (can truncate paths in C syscalls)
    if (rawPath.includes('\0')) return false;

    // 2. Block .. traversal (may cause false positives on "my..file.txt" but safe)
    if (rawPath.includes('..')) return false;

    // 3. Block absolute paths when workspace-only
    if (this.workspaceOnly && path.isAbsolute(rawPath)) return false;

    // 4. Block forbidden paths
    const resolved = path.resolve(this.workspaceDir, rawPath);
    const expandedForbidden = this.forbiddenPaths.map(p =>
      p.startsWith('~') ? p.replace('~', os.homedir()) : p
    );
    for (const forbidden of expandedForbidden) {
      if (resolved.startsWith(forbidden)) return false;
    }

    return true;
  }

  /**
   * Validate a resolved (canonicalized) path hasn't escaped the workspace.
   * This catches symlink escapes.
   * Ported from ZeroClaw policy.rs lines 260-269.
   */
  async isResolvedPathAllowed(resolvedPath: string): Promise<boolean> {
    try {
      const realWorkspace = await fs.realpath(this.workspaceDir);
      const realPath = await fs.realpath(resolvedPath);
      return realPath.startsWith(realWorkspace + path.sep) || realPath === realWorkspace;
    } catch {
      return false; // path doesn't exist or can't be resolved
    }
  }

  /**
   * Validate a shell command against the allowlist.
   * Ported from ZeroClaw policy.rs lines 166-229.
   *
   * Logic:
   * 1. Block subshell/expansion: backticks, $(), ${}
   * 2. Block output redirection: >
   * 3. Split on separators: &&, ||, ;, |, newlines
   * 4. For each segment: strip env-var assignments, extract base command, check allowlist
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

      // Strip leading env-var assignments (FOO=bar cmd → cmd)
      const cmdPart = this.skipEnvAssignments(trimmed);
      if (!cmdPart) continue;

      // Extract base command name (handles /usr/bin/git → git)
      const baseCmd = cmdPart.split(/\s+/)[0]?.split('/').pop() || '';
      if (!baseCmd) continue;

      hasCommand = true;
      if (!this.allowedCommands.includes(baseCmd)) return false;
    }

    return hasCommand;
  }

  /**
   * Strip leading environment variable assignments.
   * "FOO=bar BAZ=1 git status" → "git status"
   * Ported from ZeroClaw policy.rs lines 135-156.
   */
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

  recordAction(): boolean {
    return this.rateLimiter.record();
  }

  isRateLimited(): boolean {
    return this.rateLimiter.isLimited();
  }
}
```

### SlidingWindowRateLimiter (`src/security/rate-limiter.ts`)

Ported from ZeroClaw (`policy.rs` lines 21-59).

```typescript
export class SlidingWindowRateLimiter {
  private actions: number[] = [];

  constructor(
    private readonly maxActions: number,  // default: 20
    private readonly windowMs: number,    // default: 3_600_000 (1 hour)
  ) {}

  /** Record an action. Returns false if rate-limited. */
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
```

### SecretStore (`src/security/secrets.ts`)

Ported from ZeroClaw (`/home/matt/code/zeroclaw/src/security/secrets.rs`).

```typescript
import { chacha20poly1305 } from '@noble/ciphers/chacha';
import { randomBytes } from 'node:crypto';

const ENC2_PREFIX = 'enc2:';
const NONCE_LENGTH = 12;
const KEY_LENGTH = 32;

export class SecretStore {
  private key: Uint8Array;

  constructor(private configDir: string, private enabled: boolean) {
    if (enabled) {
      this.key = this.loadOrCreateKey();
    } else {
      this.key = new Uint8Array(KEY_LENGTH);
    }
  }

  /**
   * Encrypt plaintext → "enc2:<hex(nonce || ciphertext || tag)>"
   * Ported from ZeroClaw secrets.rs lines 56-76.
   */
  encrypt(plaintext: string): string {
    if (!this.enabled) return plaintext;

    const nonce = randomBytes(NONCE_LENGTH);
    const cipher = chacha20poly1305(this.key, nonce);
    const ciphertext = cipher.encrypt(Buffer.from(plaintext, 'utf8'));

    // Prepend nonce to ciphertext+tag
    const blob = Buffer.concat([nonce, ciphertext]);
    return ENC2_PREFIX + blob.toString('hex');
  }

  /**
   * Decrypt "enc2:<hex>" → plaintext.
   * Handles plaintext passthrough for unencrypted values.
   * Ported from ZeroClaw secrets.rs lines 127-148.
   */
  decrypt(value: string): string {
    if (!value.startsWith(ENC2_PREFIX)) return value; // plaintext passthrough

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

  /**
   * Load key from ~/.bearclaw/.secret_key or create new one.
   * Key file has 0o600 permissions.
   */
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

Ported from ZeroClaw (`/home/matt/code/zeroclaw/src/security/pairing.rs`).

```typescript
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const MAX_PAIR_ATTEMPTS = 5;
const LOCKOUT_MS = 300_000; // 5 minutes

export class PairingGuard {
  private codes: Map<string, { code: string; createdAt: number }> = new Map();
  private tokens: Map<string, string> = new Map(); // senderId → SHA-256 hash
  private failedAttempts: number = 0;
  private lockoutTime: number = 0;

  /**
   * Generate a 6-digit pairing code using CSPRNG with rejection sampling
   * to eliminate modulo bias.
   * Ported from ZeroClaw pairing.rs lines 167-189.
   */
  generateCode(senderId: string): string {
    const UPPER_BOUND = 1_000_000;
    const REJECT_THRESHOLD = Math.floor((2 ** 32 / UPPER_BOUND)) * UPPER_BOUND;

    let code: string;
    while (true) {
      const bytes = randomBytes(4);
      const raw = bytes.readUInt32LE(0);
      if (raw < REJECT_THRESHOLD) {
        code = (raw % UPPER_BOUND).toString().padStart(6, '0');
        break;
      }
    }

    this.codes.set(senderId, { code, createdAt: Date.now() });
    return code;
  }

  /**
   * Attempt to pair with a code. Returns bearer token on success.
   * Ported from ZeroClaw pairing.rs lines 83-130.
   */
  attemptPair(senderId: string, submittedCode: string): { token?: string; error?: string } {
    // Check lockout
    if (this.failedAttempts >= MAX_PAIR_ATTEMPTS) {
      const elapsed = Date.now() - this.lockoutTime;
      if (elapsed < LOCKOUT_MS) {
        const remaining = Math.ceil((LOCKOUT_MS - elapsed) / 1000);
        return { error: `Locked out. Try again in ${remaining}s.` };
      }
      this.failedAttempts = 0;
    }

    const entry = this.codes.get(senderId);
    if (!entry) return { error: 'No pending pairing code.' };

    // Constant-time comparison
    if (!this.constantTimeEq(submittedCode, entry.code)) {
      this.failedAttempts++;
      this.lockoutTime = Date.now();
      return { error: 'Invalid code.' };
    }

    // Success — generate bearer token, store as SHA-256 hash
    this.failedAttempts = 0;
    const token = `bc_${randomBytes(16).toString('hex')}`;
    const hash = createHash('sha256').update(token).digest('hex');
    this.tokens.set(senderId, hash);
    this.codes.delete(senderId);

    return { token };
  }

  /**
   * Validate a bearer token.
   * Ported from ZeroClaw pairing.rs lines 207-228.
   */
  validateToken(senderId: string, token: string): boolean {
    const storedHash = this.tokens.get(senderId);
    if (!storedHash) return false;

    const hash = createHash('sha256').update(token).digest('hex');
    return this.constantTimeEq(hash, storedHash);
  }

  /**
   * Constant-time string comparison to prevent timing attacks.
   */
  private constantTimeEq(a: string, b: string): boolean {
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    if (bufA.length !== bufB.length) {
      // Still compare to maintain constant time
      timingSafeEqual(bufA, bufA);
      return false;
    }
    return timingSafeEqual(bufA, bufB);
  }
}
```

### SSRF Guard (`src/security/ssrf.ts`)

Ported from OpenClaw (`/home/matt/code/openclaw/src/agents/tools/web-fetch.ts`).

```typescript
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const PRIVATE_RANGES = [
  { prefix: '10.', mask: 8 },
  { prefix: '172.16.', mask: 12 },    // 172.16.0.0 - 172.31.255.255
  { prefix: '192.168.', mask: 16 },
  { prefix: '127.', mask: 8 },
  { prefix: '169.254.', mask: 16 },   // link-local
  { prefix: '0.', mask: 8 },
];

const METADATA_HOSTS = [
  '169.254.169.254',                   // AWS/GCP metadata
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

  // Resolve hostname to IP (DNS pinning)
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

  // Check private ranges
  if (isPrivateIP(ip)) {
    return { allowed: false, reason: `Private IP blocked: ${ip}` };
  }

  return { allowed: true };
}

function isPrivateIP(ip: string): boolean {
  if (ip === '::1') return true;                          // IPv6 loopback
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);        // IPv4-mapped IPv6
  if (ip.startsWith('fe80:')) return true;                // IPv6 link-local

  for (const range of PRIVATE_RANGES) {
    if (ip.startsWith(range.prefix)) return true;
  }

  return false;
}
```

**Policy note:** Web tools are **open by default** (empty blocklist). `PolicyEngine` applies domain/host/CIDR blocklist checks after SSRF validation and before tool execution.

---

## Provider Implementation Details

### Provider Types (`src/providers/types.ts`)

Ported from PicoClaw (`/home/matt/code/picoclaw/pkg/providers/types.go`).

```typescript
export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ToolCall[];            // present when assistant requests tools
  toolCallId?: string;               // present when role="tool" (result)
}

export interface ToolCall {
  id: string;                        // unique ID generated by LLM
  name: string;                      // tool name
  arguments: Record<string, unknown>; // parsed arguments
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
  parameters: Record<string, unknown>; // JSON Schema
}

export interface LLMProvider {
  chat(
    messages: Message[],
    tools: ToolDefinition[],
    model: string,
    options?: {
      maxTokens?: number;
      temperature?: number;
      signal?: AbortSignal;
    },
  ): Promise<LLMResponse>;
  defaultModel: string;
}
```

### Anthropic Provider (`src/providers/anthropic.ts`)

Uses `fetch()` directly (no SDK). Translates between BearClaw's internal format and Anthropic's wire format.

Key translation rules (from PicoClaw's `claude_provider.go`):
- System messages → extracted into separate `system` array parameter
- Tool results → sent as user messages with `tool_result` content blocks (Anthropic convention)
- Assistant messages with tool calls → assistant messages with `text` + `tool_use` content blocks
- Response parsing: iterate `content` blocks, extract `text` and `tool_use` blocks

```typescript
export class AnthropicProvider implements LLMProvider {
  constructor(private apiKey: string, public defaultModel: string) {}

  async chat(messages, tools, model, options): Promise<LLMResponse> {
    // 1. Separate system messages
    const systemBlocks = messages.filter(m => m.role === 'system').map(m => ({ type: 'text', text: m.content }));

    // 2. Translate messages to Anthropic format
    const anthropicMessages = [];
    for (const msg of messages.filter(m => m.role !== 'system')) {
      if (msg.role === 'tool') {
        // Tool results are user messages with tool_result blocks
        anthropicMessages.push({
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: msg.toolCallId, content: msg.content }]
        });
      } else if (msg.role === 'assistant' && msg.toolCalls?.length) {
        // Assistant with tool calls
        const content = [];
        if (msg.content) content.push({ type: 'text', text: msg.content });
        for (const tc of msg.toolCalls) {
          content.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.arguments });
        }
        anthropicMessages.push({ role: 'assistant', content });
      } else {
        anthropicMessages.push({ role: msg.role, content: msg.content });
      }
    }

    // 3. Translate tool definitions
    const anthropicTools = tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: { type: 'object', ...t.parameters },
    }));

    // 4. Make API call
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model, system: systemBlocks, messages: anthropicMessages,
        tools: anthropicTools, max_tokens: options?.maxTokens ?? 8192,
        ...(options?.temperature != null && { temperature: options.temperature }),
      }),
      signal: options?.signal,
    });

    const data = await resp.json();

    // 5. Parse response
    let content = '';
    const toolCalls: ToolCall[] = [];
    for (const block of data.content ?? []) {
      if (block.type === 'text') content += block.text;
      if (block.type === 'tool_use') {
        toolCalls.push({ id: block.id, name: block.name, arguments: block.input });
      }
    }

    return {
      content,
      toolCalls,
      finishReason: data.stop_reason === 'tool_use' ? 'tool_calls' : 'stop',
      usage: data.usage ? {
        promptTokens: data.usage.input_tokens,
        completionTokens: data.usage.output_tokens,
        totalTokens: data.usage.input_tokens + data.usage.output_tokens,
      } : undefined,
    };
  }
}
```

### OpenAI Provider (`src/providers/openai.ts`)

Standard OpenAI chat completions format. Tool calls use `function` nested objects with JSON-stringified arguments.

### Ollama Provider (`src/providers/ollama.ts`)

HTTP calls to `http://127.0.0.1:11434/api/chat`. Same format as OpenAI (Ollama supports OpenAI-compatible tool calling).

### CLI Delegation Provider (`src/providers/cli-delegation.ts`)

Spawns `claude` or `codex` CLI as a subprocess. Ported from TinyClaw (`/home/matt/code/tinyclaw/src/lib/invoke.ts`).

```typescript
export class CliDelegationProvider implements LLMProvider {
  constructor(
    private command: 'claude' | 'codex',
    private flags: string[] = [],
    public defaultModel: string = '',
  ) {}

  async chat(messages, tools, model, options): Promise<LLMResponse> {
    // Extract the last user message as the prompt
    const lastUserMsg = messages.filter(m => m.role === 'user').pop();
    const prompt = lastUserMsg?.content ?? '';

    if (this.command === 'claude') {
      const args = ['--dangerously-skip-permissions', ...this.flags, '-p', prompt];
      const output = await spawnCommand('claude', args);
      return { content: output, toolCalls: [], finishReason: 'stop' };
    }

    if (this.command === 'codex') {
      const args = ['exec', '--dangerously-bypass-approvals-and-sandbox', '--json', ...this.flags, prompt];
      const output = await spawnCommand('codex', args);
      // Parse JSONL for final agent_message
      const lines = output.trim().split('\n');
      for (const line of lines) {
        try {
          const json = JSON.parse(line);
          if (json.type === 'item.completed' && json.item?.type === 'agent_message') {
            return { content: json.item.text, toolCalls: [], finishReason: 'stop' };
          }
        } catch { /* ignore non-JSON lines */ }
      }
      return { content: output, toolCalls: [], finishReason: 'stop' };
    }

    throw new Error(`Unknown CLI command: ${this.command}`);
  }
}
```

Note: CLI delegation always returns `toolCalls: []` because the CLI handles tool execution internally. The response is final text only.

Policy note: CLI delegation is only allowed when the target agent has explicit policy permission or when a user provides an inline allow (one-shot or day-scoped). Otherwise, delegation requests trigger approval flow.

---

## Tool System Implementation Details

### Tool Types (`src/tools/types.ts`)

Merged from PicoClaw (`/home/matt/code/picoclaw/pkg/tools/base.go`, `result.go`) and OpenClaw.

```typescript
export interface ToolResult {
  forLLM: string;
  forUser?: string;
  visibility: "llm" | "user" | "both" | "hidden";
  isError: boolean;
  async: boolean;
  error?: Error;
}

// Factory functions (from PicoClaw)
export function toolResult(forLLM: string): ToolResult {
  return { forLLM, visibility: "llm", isError: false, async: false };
}

export function silentResult(forLLM: string): ToolResult {
  return { forLLM, visibility: "hidden", isError: false, async: false };
}

export function asyncResult(forLLM: string): ToolResult {
  return { forLLM, visibility: "llm", isError: false, async: true };
}

export function errorResult(message: string): ToolResult {
  return { forLLM: message, visibility: "llm", isError: true, async: false };
}

export function userResult(content: string): ToolResult {
  return { forLLM: content, forUser: content, visibility: "both", isError: false, async: false };
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
  sandbox?: Sandbox;
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult>;
}

export interface AsyncTool extends Tool {
  setCallback(cb: (result: ToolResult) => void): void;
}
```

### Tool Registry (`src/tools/registry.ts`)

```typescript
export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  async execute(ctx: ToolContext, name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) return errorResult(`Tool '${name}' not found`);

    // Validate parameters against JSON Schema
    const errors = validateParams(args, tool.parameters);
    if (errors.length > 0) return errorResult(`Invalid parameters: ${errors.join('; ')}`);

    try {
      return await tool.execute(ctx, args);
    } catch (err) {
      return errorResult(`Error executing ${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  toProviderDefs(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
  }

  list(): string[] {
    return Array.from(this.tools.keys());
  }
}
```

### Tool Hooks (`src/tools/hooks.ts`)

Ported from OpenClaw (`/home/matt/code/openclaw/src/agents/pi-tools.before-tool-call.ts` and `hooks.ts`).

**Policy integration:** `PolicyEngine` is registered as the **first** before hook to enforce deny-precedence, approvals, and inline allows before any tool executes.

```typescript
export type BeforeToolCallHook = (
  toolName: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
) => Promise<{ proceed: boolean; args?: Record<string, unknown> }>;

export type AfterToolCallHook = (
  toolName: string,
  args: Record<string, unknown>,
  result: ToolResult,
  ctx: ToolContext,
) => Promise<void>;

export class ToolHookRegistry {
  private beforeHooks: BeforeToolCallHook[] = [];
  private afterHooks: AfterToolCallHook[] = [];

  registerBefore(hook: BeforeToolCallHook): void {
    this.beforeHooks.push(hook);
  }

  registerAfter(hook: AfterToolCallHook): void {
    this.afterHooks.push(hook);
  }

  /**
   * Run before hooks SEQUENTIALLY. Any hook can block or modify args.
   * Ported from OpenClaw's runModifyingHook pattern (hooks.ts lines 296-327).
   */
  async runBefore(
    toolName: string,
    args: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<{ proceed: boolean; args: Record<string, unknown> }> {
    let currentArgs = args;

    for (const hook of this.beforeHooks) {
      try {
        const result = await hook(toolName, currentArgs, ctx);
        if (!result.proceed) {
          return { proceed: false, args: currentArgs };
        }
        if (result.args) {
          currentArgs = result.args;
        }
      } catch (err) {
        // Hook errors are logged but don't block execution
        console.warn(`before_tool_call hook failed: ${err}`);
      }
    }

    return { proceed: true, args: currentArgs };
  }

  /**
   * Run after hooks IN PARALLEL (fire-and-forget).
   * Ported from OpenClaw's runVoidHook pattern (hooks.ts lines 100-129).
   */
  async runAfter(
    toolName: string,
    args: Record<string, unknown>,
    result: ToolResult,
    ctx: ToolContext,
  ): Promise<void> {
    await Promise.allSettled(
      this.afterHooks.map(hook =>
        hook(toolName, args, result, ctx).catch(err =>
          console.warn(`after_tool_call hook failed: ${err}`)
        )
      )
    );
  }
}
```

### Example Built-in Tool: exec (`src/tools/builtin/exec.ts`)

```typescript
import { spawn } from 'node:child_process';
import { SHELL_TIMEOUT_MS, SHELL_OUTPUT_LIMIT } from '../../config/defaults.js';

export const execTool: Tool = {
  name: 'exec',
  description: 'Execute a shell command. Commands are validated against an allowlist.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The shell command to execute' },
      cwd: { type: 'string', description: 'Working directory (optional)' },
    },
    required: ['command'],
  },

  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const command = args.command as string;
    const cwd = args.cwd as string | undefined;

    // 1. Security: check command against allowlist
    if (!ctx.policy.isCommandAllowed(command)) {
      return errorResult(`Command not allowed: ${command}`);
    }

    // 2. Security: check rate limit
    if (!ctx.policy.recordAction()) {
      return errorResult('Rate limited. Too many actions this hour.');
    }

    // 3. Execute with timeout
    return new Promise((resolve) => {
      const child = spawn('sh', ['-c', command], {
        cwd: cwd || ctx.policy.workspaceDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        signal: ctx.signal,
      });

      let stdout = '';
      let stderr = '';
      const timeout = setTimeout(() => child.kill('SIGTERM'), SHELL_TIMEOUT_MS);

      child.stdout.on('data', (chunk) => {
        stdout += chunk;
        if (stdout.length > SHELL_OUTPUT_LIMIT) {
          child.kill('SIGTERM');
        }
      });
      child.stderr.on('data', (chunk) => { stderr += chunk; });

      child.on('close', (code) => {
        clearTimeout(timeout);
        const output = (stdout + (stderr ? `\n[stderr]\n${stderr}` : '')).trim();
        const truncated = output.length > SHELL_OUTPUT_LIMIT
          ? output.slice(0, SHELL_OUTPUT_LIMIT) + '\n[truncated]'
          : output;

        if (code === 0) {
          resolve(userResult(truncated)); // ForLLM + ForUser (user sees command output)
        } else {
          resolve({ forLLM: truncated, forUser: truncated, silent: false, isError: true, async: false });
        }
      });

      child.on('error', (err) => {
        clearTimeout(timeout);
        resolve(errorResult(`exec error: ${err.message}`));
      });
    });
  },
};
```

### Example Built-in Tool: read_file (`src/tools/builtin/read-file.ts`)

```typescript
export const readFileTool: Tool = {
  name: 'read_file',
  description: 'Read the contents of a file.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path (relative to workspace)' },
    },
    required: ['path'],
  },

  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const filePath = args.path as string;

    // 1. Pre-check: validate raw path
    if (!ctx.policy.isPathAllowed(filePath)) {
      return errorResult(`Path not allowed: ${filePath}`);
    }

    // 2. Resolve path
    const resolved = path.resolve(ctx.policy.workspaceDir, filePath);

    // 3. Post-check: validate resolved path (catches symlink escapes)
    if (!(await ctx.policy.isResolvedPathAllowed(resolved))) {
      return errorResult(`Path escapes workspace: ${filePath}`);
    }

    try {
      const content = await fs.readFile(resolved, 'utf8');
      return toolResult(content); // ForLLM only — user doesn't need to see file contents
    } catch (err) {
      return errorResult(`Failed to read file: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
};
```

---

## Agent Loop Implementation

### Core Loop (`src/agent/loop.ts`)

Ported from PicoClaw (`/home/matt/code/picoclaw/pkg/tools/toolloop.go` and `pkg/agent/loop.go`), with hook integration from OpenClaw.

```typescript
export interface AgentLoopConfig {
  provider: LLMProvider;
  model: string;
  tools: ToolRegistry;
  hooks: ToolHookRegistry;
  maxIterations: number;       // default: 25
  options?: { maxTokens?: number; temperature?: number };
}

export interface AgentLoopResult {
  content: string;
  iterations: number;
  toolsUsed: Array<{ name: string; result: ToolResult }>;
}

export async function runAgentLoop(
  config: AgentLoopConfig,
  messages: Message[],
  ctx: ToolContext,
): Promise<AgentLoopResult> {
  const { provider, model, tools, hooks, maxIterations, options } = config;
  let iteration = 0;
  const toolsUsed: Array<{ name: string; result: ToolResult }> = [];

  while (iteration < maxIterations) {
    iteration++;

    // 1. Call LLM with tool definitions
    const toolDefs = tools.toProviderDefs();
    const response = await provider.chat(messages, toolDefs, model, {
      ...options,
      signal: ctx.signal,
    });

    // 2. No tool calls → done
    if (response.toolCalls.length === 0) {
      return { content: response.content, iterations: iteration, toolsUsed };
    }

    // 3. Append assistant message (with tool calls) to conversation
    messages.push({
      role: 'assistant',
      content: response.content,
      toolCalls: response.toolCalls,
    });

    // 4. Execute each tool call
    for (const tc of response.toolCalls) {
      // 4a. Before hook (blocking, sequential)
      const hookResult = await hooks.runBefore(tc.name, tc.arguments, ctx);

      let result: ToolResult;
      if (!hookResult.proceed) {
        result = errorResult(`Tool call blocked by policy: ${tc.name}`);
      } else {
        // 4b. Execute tool
        result = await tools.execute(ctx, tc.name, hookResult.args);
      }

      // 4c. After hook (fire-and-forget)
      hooks.runAfter(tc.name, hookResult.args, result, ctx); // intentionally no await

      // 4d. Track
      toolsUsed.push({ name: tc.name, result });

      // 4e. Append tool result to conversation
      messages.push({
        role: 'tool',
        content: result.forLLM,
        toolCallId: tc.id,
      });
    }
  }

  // Max iterations reached
  return {
    content: 'Reached maximum iterations without a final response.',
    iterations: iteration,
    toolsUsed,
  };
}
```

---

## Multi-Agent Orchestration Implementation

### Conversation Tracker (`src/orchestrator/conversation.ts`)

Ported from TinyClaw (`/home/matt/code/tinyclaw/src/queue-processor.ts` lines 395-460).

```typescript
export interface ChainStep {
  agentId: string;
  response: string;
}

export interface Conversation {
  id: string;
  channel: string;
  sender: string;
  originalMessage: string;
  messageId: string;
  pending: number;
  responses: ChainStep[];
  files: Set<string>;
  totalMessages: number;
  maxMessages: number;
  teamContext: { teamId: string; team: TeamConfig };
  startTime: number;
  outgoingMentions: Map<string, number>;
}

export class ConversationTracker {
  private conversations = new Map<string, Conversation>();

  create(opts: {
    channel: string; sender: string; messageId: string;
    originalMessage: string; teamContext: { teamId: string; team: TeamConfig };
  }): Conversation {
    const id = `${opts.messageId}_${Date.now()}`;
    const conv: Conversation = {
      ...opts, id,
      pending: 1,
      responses: [],
      files: new Set(),
      totalMessages: 0,
      maxMessages: MAX_CONVERSATION_MESSAGES,
      startTime: Date.now(),
      outgoingMentions: new Map(),
    };
    this.conversations.set(id, conv);
    return conv;
  }

  get(id: string): Conversation | undefined {
    return this.conversations.get(id);
  }

  recordResponse(id: string, agentId: string, response: string): void {
    const conv = this.conversations.get(id);
    if (!conv) return;
    conv.responses.push({ agentId, response });
    conv.totalMessages++;
  }

  /** Fan-out: increase pending count by number of mentions */
  fanOut(id: string, count: number): void {
    const conv = this.conversations.get(id);
    if (conv) conv.pending += count;
  }

  /** Branch complete: decrement pending. Returns true if conversation is done (pending === 0). */
  branchComplete(id: string): boolean {
    const conv = this.conversations.get(id);
    if (!conv) return true;
    conv.pending--;
    return conv.pending === 0;
  }

  /** Aggregate final response from all branches */
  complete(id: string): { responses: ChainStep[]; files: string[] } | undefined {
    const conv = this.conversations.get(id);
    if (!conv) return undefined;
    const result = { responses: [...conv.responses], files: Array.from(conv.files) };
    this.conversations.delete(id);
    return result;
  }

  canEnqueueMore(id: string): boolean {
    const conv = this.conversations.get(id);
    return conv ? conv.totalMessages < conv.maxMessages : false;
  }
}
```

### Mention Parsing (`src/orchestrator/mentions.ts`)

Ported from TinyClaw (`/home/matt/code/tinyclaw/src/lib/routing.ts` lines 39-73).

```typescript
/**
 * Parse teammate mentions from an agent's response.
 * Format: [@agent_id: directed message]
 * Supports comma-separated: [@agent1,agent2: shared message]
 * Text outside tags becomes shared context prepended to all directed messages.
 */
export function extractTeammateMentions(
  response: string,
  currentAgentId: string,
  teamId: string,
  teams: Record<string, TeamConfig>,
  agents: Record<string, AgentConfig>,
): Array<{ teammateId: string; message: string }> {
  const results: Array<{ teammateId: string; message: string }> = [];
  const seen = new Set<string>();
  const tagRegex = /\[@(\S+?):\s*([\s\S]*?)\]/g;

  // Extract shared context (text outside all tags)
  const sharedContext = response.replace(tagRegex, '').trim();

  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(response)) !== null) {
    const directMessage = match[2].trim();
    const fullMessage = sharedContext
      ? `${sharedContext}\n\n------\n\nDirected to you:\n${directMessage}`
      : directMessage;

    // Support comma-separated agent IDs
    const candidateIds = match[1].toLowerCase().split(',').map(id => id.trim()).filter(Boolean);

    for (const candidateId of candidateIds) {
      if (seen.has(candidateId)) continue;
      if (candidateId === currentAgentId) continue;

      // Validate: must be a teammate in the same team
      const team = teams[teamId];
      if (team && team.agents.includes(candidateId) && agents[candidateId]) {
        results.push({ teammateId: candidateId, message: fullMessage });
        seen.add(candidateId);
      }
    }
  }

  return results;
}
```

### Message Router (`src/orchestrator/router.ts`)

Ported from TinyClaw (`/home/matt/code/tinyclaw/src/lib/routing.ts`).

```typescript
export interface RoutingResult {
  agentId: string;
  message: string;
  isTeam: boolean;
}

/**
 * Route a message based on @agent or @team prefix.
 * "@coder fix bug" → agent: coder, message: "fix bug"
 * "@dev fix bug" → team dev → leader agent
 * "help me" → default agent
 */
export function routeMessage(
  rawMessage: string,
  agents: Record<string, AgentConfig>,
  teams: Record<string, TeamConfig>,
): RoutingResult {
  const match = rawMessage.match(/^@(\S+)\s+([\s\S]*)$/);
  if (!match) {
    return { agentId: 'default', message: rawMessage, isTeam: false };
  }

  const candidateId = match[1].toLowerCase();
  const message = match[2];

  // Direct agent match
  if (agents[candidateId]) {
    return { agentId: candidateId, message, isTeam: false };
  }

  // Team match → route to leader
  if (teams[candidateId]) {
    const team = teams[candidateId];
    return { agentId: team.leaderAgent, message, isTeam: true };
  }

  // No match → default
  return { agentId: 'default', message: rawMessage, isTeam: false };
}
```

---

## Message Bus Implementation

### MessageBus (`src/bus/bus.ts`)

Ported from PicoClaw (`/home/matt/code/picoclaw/pkg/bus/bus.go`).

```typescript
export class MessageBus {
  private inboundQueue: InboundMessage[] = [];
  private outboundQueue: OutboundMessage[] = [];
  private inboundWaiters: Array<(msg: InboundMessage) => void> = [];
  private outboundWaiters: Array<(msg: OutboundMessage) => void> = [];
  private closed = false;

  constructor(private capacity: number = 100) {}

  publishInbound(msg: InboundMessage): void {
    if (this.inboundWaiters.length > 0) {
      this.inboundWaiters.shift()!(msg);
    } else if (this.inboundQueue.length < this.capacity) {
      this.inboundQueue.push(msg);
    }
    // drop if over capacity
  }

  async consumeInbound(signal: AbortSignal): Promise<InboundMessage | null> {
    if (this.inboundQueue.length > 0) return this.inboundQueue.shift()!;
    if (this.closed) return null;

    return new Promise((resolve) => {
      const onAbort = () => { resolve(null); cleanup(); };
      signal.addEventListener('abort', onAbort, { once: true });

      const cleanup = () => {
        signal.removeEventListener('abort', onAbort);
        const idx = this.inboundWaiters.indexOf(resolve as any);
        if (idx >= 0) this.inboundWaiters.splice(idx, 1);
      };

      this.inboundWaiters.push((msg) => { cleanup(); resolve(msg); });
    });
  }

  publishOutbound(msg: OutboundMessage): void {
    if (this.outboundWaiters.length > 0) {
      this.outboundWaiters.shift()!(msg);
    } else if (this.outboundQueue.length < this.capacity) {
      this.outboundQueue.push(msg);
    }
  }

  async consumeOutbound(signal: AbortSignal): Promise<OutboundMessage | null> {
    // Same pattern as consumeInbound but for outbound queue
    if (this.outboundQueue.length > 0) return this.outboundQueue.shift()!;
    if (this.closed) return null;

    return new Promise((resolve) => {
      const onAbort = () => { resolve(null); cleanup(); };
      signal.addEventListener('abort', onAbort, { once: true });
      const cleanup = () => {
        signal.removeEventListener('abort', onAbort);
        const idx = this.outboundWaiters.indexOf(resolve as any);
        if (idx >= 0) this.outboundWaiters.splice(idx, 1);
      };
      this.outboundWaiters.push((msg) => { cleanup(); resolve(msg); });
    });
  }

  close(): void {
    this.closed = true;
    this.inboundWaiters.forEach(w => w(null as any));
    this.outboundWaiters.forEach(w => w(null as any));
    this.inboundWaiters = [];
    this.outboundWaiters = [];
  }
}
```

---

## Memory System

### Hybrid Search (`src/memory/sqlite.ts`)

Ported from ZeroClaw (`/home/matt/code/zeroclaw/src/memory/sqlite.rs`).

**SQLite schema:**
```sql
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  content TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'core',
  embedding BLOB,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE memories_fts USING fts5(key, content, content=memories, content_rowid=rowid);

-- Auto-sync triggers for FTS
CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, key, content) VALUES (new.rowid, new.key, new.content);
END;
CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, key, content) VALUES('delete', old.rowid, old.key, old.content);
END;
CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, key, content) VALUES('delete', old.rowid, old.key, old.content);
  INSERT INTO memories_fts(rowid, key, content) VALUES (new.rowid, new.key, new.content);
END;

CREATE TABLE embedding_cache (
  content_hash TEXT PRIMARY KEY,
  embedding BLOB NOT NULL,
  created_at TEXT NOT NULL,
  accessed_at TEXT NOT NULL
);
```

**Hybrid search algorithm:**
1. FTS5 keyword search (BM25 scoring) → top N*2 results
2. Vector cosine similarity search → top N*2 results
3. Weighted merge: `finalScore = vectorScore * vectorWeight + keywordScore * keywordWeight`
4. Fallback to LIKE search if no results from either
5. LRU cache for embeddings (evict oldest when exceeding cacheMax)

---

## Implementation Order

### Phase 1: Foundation (Config + Security)
1. Project setup: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`
2. `src/config/schema.ts` — all TypeScript types
3. `src/config/defaults.ts` — default values and constants
4. `src/config/config.ts` — load/save config from `~/.bearclaw/config.json`
5. `src/logging.ts` — structured JSON logging to stdout
6. `src/security/policy.ts` — SecurityPolicy class (path + command validation)
7. `src/security/policy-engine.ts` — PolicyEngine (deny precedence, rule eval)
8. `src/security/approvals.ts` — ApprovalManager (per user+channel)
9. `src/security/inline-allow.ts` — inline allow parsing + day-scoped storage
10. `src/security/rate-limiter.ts` — SlidingWindowRateLimiter
11. `src/security/secrets.ts` — SecretStore (ChaCha20-Poly1305)
12. `src/security/ssrf.ts` — SSRF guard (DNS pinning, private IP blocking)
13. `src/cli/policy-status.ts` — `bearclaw policy status`
14. `tests/security/*` — TDD: write security tests first

### Phase 2: Provider Layer
11. `src/providers/types.ts` — LLMProvider, Message, ToolCall, LLMResponse
12. `src/providers/anthropic.ts` — Anthropic API provider
13. `src/providers/openai.ts` — OpenAI API provider
14. `src/providers/ollama.ts` — Ollama local provider
15. `src/providers/cli-delegation.ts` — CLI subprocess provider
16. `tests/providers/*` — format translation tests

### Phase 3: Tool System
17. `src/tools/types.ts` — Tool, ToolResult, ToolContext, factory functions
18. `src/tools/validate.ts` — recursive JSON Schema validation
19. `src/tools/registry.ts` — ToolRegistry
20. `src/tools/hooks.ts` — ToolHookRegistry (before/after)
21. `src/tools/builtin/read-file.ts`
22. `src/tools/builtin/write-file.ts`
23. `src/tools/builtin/edit-file.ts`
24. `src/tools/builtin/list-dir.ts`
25. `src/tools/builtin/exec.ts`
26. `src/tools/builtin/web-fetch.ts`
27. `src/tools/builtin/web-request.ts`
28. `src/tools/builtin/web-download.ts`
29. `src/tools/builtin/spawn.ts`
30. `src/tools/builtin/message.ts`
31. `tests/tools/*`

### Phase 4: Agent Loop
32. `src/agent/session.ts` — per-agent message history + persistence
33. `src/agent/context.ts` — system prompt assembly + memory injection
34. `src/agent/loop.ts` — the core agentic loop
35. `tests/agent/loop.test.ts`

### Phase 5: Bus + Channels
36. `src/bus/bus.ts` — MessageBus
37. `src/channels/types.ts` — Channel interface
38. `src/channels/cli.ts` — CLI REPL
39. `src/channels/telegram.ts` — Telegram bot
40. `tests/bus/bus.test.ts`

### Phase 6: Multi-Agent Orchestration
41. `src/orchestrator/conversation.ts` — ConversationTracker
42. `src/orchestrator/mentions.ts` — mention parsing
43. `src/orchestrator/router.ts` — message routing
44. `src/orchestrator/team.ts` — team config resolution
45. `tests/orchestrator/*`

### Phase 7: Memory
46. `src/memory/types.ts`
47. `src/memory/sqlite.ts`

### Phase 8: Gateway + Pairing
48. `src/security/pairing.ts` — PairingGuard
49. `src/gateway/server.ts` — HTTP gateway

### Phase 9: Entry Points
50. `src/index.ts` — CLI REPL entry point
51. `src/daemon.ts` — daemon mode (all channels + bus + orchestrator)

---

## Dependencies

```json
{
  "type": "module",
  "engines": { "node": ">=20" },
  "dependencies": {
    "better-sqlite3": "^11.0.0",
    "@noble/ciphers": "^1.0.0",
    "node-telegram-bot-api": "^0.67.0"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vitest": "^2.0.0",
    "@types/node": "^22.0.0",
    "@types/better-sqlite3": "^7.6.0"
  }
}
```

No LLM SDK dependencies. All providers use `fetch()` directly for minimal footprint and full control over request/response translation.

`@noble/ciphers` is pure JavaScript (no native compilation) — works on Raspberry Pi without build tools.

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
| Hybrid memory search | ZeroClaw | `src/memory/sqlite.rs` lines 369-433 |
| Embedding cache | ZeroClaw | `src/memory/sqlite.rs` lines 142-202 |

---

## Verification Plan

1. **Security tests**: `npx vitest tests/security/` — path traversal (null bytes, `..`, absolute paths, symlink escape), command injection (backticks, `$()`, redirects, env-var bypass), encryption roundtrip + tamper detection, pairing lockout after 5 attempts, SSRF (private IPs, metadata endpoints), policy deny precedence
2. **Single agent CLI**: `npx tsx src/index.ts` → type a message → get LLM response with tool use (read a file, run a command)
3. **Policy approvals**: Trigger an `exec` call with no rule → approval requested → approve once → verify suggestion logged
4. **Inline allow**: Send `[allow: day read_file ./docs/**/*.md]` → verify allowed for 24 hours, visible in `bearclaw policy status`, expires after TTL
5. **Tool hooks**: Register a before_hook that blocks `exec` calls containing `rm`, verify it fires and blocks
6. **Multi-agent team**: Configure 2 agents + 1 team, send "@team review this", verify leader responds with `[@teammate: check security]`, teammate processes, responses aggregated
7. **Telegram channel**: Configure bot token and allowFrom, send a message via Telegram, get response
8. **CLI delegation**: Set provider to `cli-delegation` with `claude`, verify it spawns CLI and returns response (only if explicitly allowed)
9. **Memory**: Store a fact via tool call, recall it in a subsequent message via hybrid search
10. **Rate limiting**: Make 21 tool calls in rapid succession, verify the 21st is rejected
11. **Pairing**: Connect from unauthorized sender, verify pairing code flow, verify token auth works after pairing
