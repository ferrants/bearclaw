# API Reference

TypeScript interfaces and types that define BearClaw's public API.

## Config Types

### BearClawConfig

The root configuration object. See [Configuration](configuration.md) for usage.

```typescript
interface BearClawConfig {
  workspace: { path: string };
  security: {
    autonomy: AutonomyLevel;
    workspaceOnly: boolean;
    allowedCommands: string[];
    restrictedCommands: Record<string, string[]>;
    forbiddenPaths: string[];
    rateLimits: {
      global: number;
      perAgent?: number;
      perToolClass?: Record<string, number>;
    };
    encrypt: boolean;
  };
  gateway: {
    enabled: boolean;
    host: string;
    port: number;
    bodyLimit: number;
    timeout: number;
    requirePairing: boolean;
    allowPublicBind: boolean;
  };
  providers: {
    anthropic?: { apiKey: string; defaultModel: string };
    openai?: { apiKey: string; defaultModel: string };
    ollama?: { baseUrl: string; defaultModel: string };
    cliDelegation?: CliDelegationConfig;
  };
  channels: {
    enabled: string[];
    telegram?: { botToken: string; allowFrom?: string[] };
  };
  agents: Record<string, AgentConfig>;
  teams: Record<string, TeamConfig>;
  memory: { enabled: boolean; dir: string; alwaysLoad: string[] };
  policy: PolicyConfig;
  monitoring: { logLevel: string; heartbeatInterval: number };
}
```

### AgentConfig

```typescript
interface AgentConfig {
  name: string;
  provider: string;
  model?: string;
  workingDirectory?: string;
  autonomy?: AutonomyLevel;
  maxIterations?: number;
  maxTotalTokens?: number;
  systemPromptFiles?: string[];
}
```

### TeamConfig

```typescript
interface TeamConfig {
  name: string;
  agents: string[];
  leaderAgent: string;
}
```

### AutonomyLevel

```typescript
enum AutonomyLevel {
  ReadOnly = "readonly",
  Supervised = "supervised",
  Full = "full",
}
```

### PolicyConfig

```typescript
interface PolicyConfig {
  defaultAction: PolicyAction;
  denyPrecedence: boolean;
  approvalScope: ApprovalScope;
  learningMode: LearningMode;
  rules: PolicyRule[];
  approvals: { cache: boolean; defaultTTLSeconds: number };
  inlineAllow: { enabled: boolean; dayScopeHours: number };
  web: {
    mode: "allow_with_blocklist";
    blockedDomains: string[];
    blockedCidrs: string[];
    blockedHosts: string[];
  };
}
```

### PolicyRule

```typescript
interface PolicyRule {
  id: string;
  action: PolicyAction;        // "allow" | "deny" | "approve"
  scope: PolicyScope;          // "tool" | "exec" | "web" | "cli_delegation" | "message"
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
```

## Provider Types

### LLMProvider

```typescript
interface LLMProvider {
  chat(
    messages: Message[],
    tools: ToolDefinition[],
    model: string,
    options?: ChatOptions,
  ): Promise<LLMResponse>;
  defaultModel: string;
}
```

### Message

```typescript
interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}
```

### ToolCall

```typescript
interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}
```

### LLMResponse

```typescript
interface LLMResponse {
  content: string;
  toolCalls: ToolCall[];
  finishReason: "stop" | "tool_calls" | "length" | "error";
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}
```

### ChatOptions

```typescript
interface ChatOptions {
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  onToken?: (token: string) => void;
}
```

### ToolDefinition

```typescript
interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
```

### CliDelegationConfig

```typescript
interface CliDelegationConfig {
  command: string;
  flags?: string[];
  outputParser?: "text" | "jsonl";
  jsonlMessageType?: string;
}
```

## Tool Types

### Tool

```typescript
interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;  // JSON Schema
  execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult>;
}
```

### ToolResult

```typescript
interface ToolResult {
  forLLM: string;
  forUser?: string;
  silent?: boolean;
  isError: boolean;
  async: boolean;
  error?: Error;
}
```

### ToolResult Factory Functions

```typescript
function toolResult(forLLM: string): ToolResult;
function silentResult(forLLM: string): ToolResult;
function asyncResult(forLLM: string): ToolResult;
function errorResult(message: string): ToolResult;
function userResult(content: string): ToolResult;
```

### ToolContext

```typescript
interface ToolContext {
  signal: AbortSignal;
  channel?: string;
  chatId?: string;
  onUpdate?: (partial: string) => void;
  policy: SecurityPolicy;
  policyEngine: PolicyEngine;
  approvalManager: ApprovalManager;
  inlineAllowStore: InlineAllowStore;
  toolRegistry: ToolRegistry;
  hooks: ToolHookRegistry;
  agentConfigs: Record<string, AgentConfig>;
  currentAgentConfig: AgentConfig;
  providerFactory: (providerName: string) => LLMProvider;
}
```

### ToolRegistry

```typescript
interface ToolRegistry {
  register(tool: Tool): void;
  get(name: string): Tool | undefined;
  list(): string[];
  execute(ctx: ToolContext, name: string, args: Record<string, unknown>): Promise<ToolResult>;
  toProviderDefs(): ToolDefinition[];
}
```

### ToolHookRegistry

```typescript
interface ToolHookRegistry {
  registerBefore(hook: BeforeToolCallHook): void;
  registerAfter(hook: AfterToolCallHook): void;
  runBefore(
    toolName: string,
    args: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<{ proceed: boolean; args: Record<string, unknown> }>;
  runAfter(
    toolName: string,
    args: Record<string, unknown>,
    result: ToolResult,
    ctx: ToolContext,
  ): Promise<void>;
  flush(timeoutMs?: number): Promise<void>;
}
```

## Agent Loop Types

### AgentLoopConfig

```typescript
interface AgentLoopConfig {
  provider: LLMProvider;
  model: string;
  tools: ToolRegistry;
  hooks: ToolHookRegistry;
  maxIterations: number;
  maxTotalTokens?: number;
  options?: {
    maxTokens?: number;
    temperature?: number;
    onToken?: (token: string) => void;
  };
}
```

### AgentLoopResult

```typescript
interface AgentLoopResult {
  content: string;
  iterations: number;
  toolsUsed: Array<{ name: string; result: ToolResult }>;
  totalTokens: number;
}
```

## Bus Types

### InboundMessage

```typescript
interface InboundMessage {
  channel: string;
  sender: string;
  chatId: string;
  messageId: string;
  message: string;
  conversationId?: string;
  files?: string[];
  timestamp: number;
}
```

### OutboundMessage

```typescript
interface OutboundMessage {
  channel: string;
  chatId: string;
  content: string;
  replyToMessageId?: string;
  files?: string[];
  agentId?: string;
  conversationId?: string;
}
```

## Channel Types

### Channel

```typescript
interface Channel {
  name: string;
  start(bus: MessageBus): Promise<void>;
  stop(): Promise<void>;
  send(msg: OutboundMessage): Promise<void>;
}
```

## Event Types

### EventMap

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

## Constants

```typescript
const MAX_CONVERSATION_MESSAGES = 50;
const MAX_CONVERSATION_DURATION_MS = 600_000;  // 10 minutes
const MAX_SESSION_MESSAGES = 100;
const LONG_RESPONSE_THRESHOLD = 4000;
const SHELL_TIMEOUT_MS = 60_000;               // 1 minute
const SHELL_OUTPUT_LIMIT = 1_048_576;           // 1MB
const WEB_FETCH_MAX_CHARS = 50_000;
const WEB_FETCH_TIMEOUT_MS = 30_000;            // 30 seconds
const READ_FILE_MAX_SIZE = 10_485_760;           // 10MB
const WRITE_FILE_MAX_SIZE = 10_485_760;          // 10MB
```
