import type { McpServerConfig, PolicyConfig, AutonomyLevel } from './schema.js';

/**
 * Instance-level configuration (~/.bearclaw/config.jsonc).
 * Contains infrastructure, credentials, and system-level security.
 * Shared across all agents in this instance.
 */
export interface InstanceConfig {
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
      outputParser?: 'text' | 'jsonl';
      jsonlMessageType?: string;
    };
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
  channels: {
    enabled: string[];
  };
  security: {
    encrypt: boolean;
    forbiddenPaths: string[];
    allowedPaths?: string[];
    rateLimits: {
      global: number;
      perAgent?: number;
      perToolClass?: Record<string, number>;
    };
  };
  monitoring: {
    logLevel: 'debug' | 'info' | 'warn' | 'error';
    heartbeatInterval: number;
  };

  // Legacy fields — when present, treated as _default agent config
  workspace?: { path: string };
  agents?: Record<string, import('./schema.js').AgentConfig>;
  teams?: Record<string, import('./schema.js').TeamConfig>;
  memory?: { enabled: boolean; dir: string; alwaysLoad: string[] };
  policy?: PolicyConfig;
  schedules?: import('./schema.js').ScheduleRule[];
  mcp?: { servers: Record<string, McpServerConfig> };
}

/**
 * Fields that indicate legacy config with embedded agent definitions.
 * When any of these exist in instance config, we synthesize a _default agent.
 */
export const LEGACY_AGENT_FIELDS = [
  'agents', 'teams', 'memory', 'policy', 'schedules', 'mcp', 'workspace',
] as const;
