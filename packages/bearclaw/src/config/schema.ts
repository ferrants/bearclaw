export enum AutonomyLevel {
  ReadOnly = "readonly",
  Supervised = "supervised",
  Full = "full",
}

export interface BearClawConfig {
  workspace: {
    path: string;
  };
  security: {
    autonomy: AutonomyLevel;
    workspaceOnly: boolean;
    allowedCommands: string[];
    restrictedCommands: Record<string, string[]>;
    forbiddenPaths: string[];
    allowedPaths: string[];
    allowMemoryWrite?: boolean;
    allowSubshells: boolean;
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
    approvalMode?: 'auto-approve' | 'auto-deny' | 'wait';
    apiKeys?: Array<{ label: string; key: string }>;
  };
  providers: {
    anthropic?: {
      apiKey: string;
      defaultModel: string;
    };
    openai?: {
      apiKey: string;
      defaultModel: string;
    };
    ollama?: {
      baseUrl: string;
      defaultModel: string;
    };
    cliDelegation?: {
      command: string;
      flags?: string[];
      outputParser?: "text" | "jsonl";
      jsonlMessageType?: string;
    };
  };
  channels: {
    enabled: string[];
  };
  mcp: {
    servers: Record<string, McpServerConfig>;
  };
  agents: Record<string, AgentConfig>;
  teams: Record<string, TeamConfig>;
  memory: {
    enabled: boolean;
    dir: string;
    alwaysLoad: string[];
  };
  policy: PolicyConfig;
  schedules: ScheduleRule[];
  monitoring: {
    logLevel: "debug" | "info" | "warn" | "error";
    heartbeatInterval: number;
  };
}

export interface ScheduleRule {
  cron?: string;
  interval?: string;
  agent?: string;
  message: string;
  newThread?: boolean;
  allow?: string[];
  approvalMode?: 'auto-approve' | 'auto-deny' | 'user-rules';
}

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface AgentConfig {
  name: string;
  provider: string;
  model?: string;
  workingDirectory?: string;
  autonomy?: AutonomyLevel;
  maxIterations?: number;
  maxTotalTokens?: number;
  systemPromptFiles?: string[];
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
export type InlineAllowScope = "once" | "day" | "session" | "always";

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
  defaultAction: PolicyAction;
  denyPrecedence: boolean;
  approvalScope: ApprovalScope;
  learningMode: LearningMode;
  rules: PolicyRule[];
  approvals: {
    cache: boolean;
    defaultTTLSeconds: number;
  };
  inlineAllow: {
    enabled: boolean;
    dayScopeHours: number;
  };
  web: {
    mode: "allow_with_blocklist";
    blockedDomains: string[];
    blockedCidrs: string[];
    blockedHosts: string[];
  };
}
