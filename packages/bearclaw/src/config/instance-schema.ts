
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
}
