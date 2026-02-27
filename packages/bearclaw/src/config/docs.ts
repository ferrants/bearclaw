export interface ConfigFieldDoc {
  path: string;
  type: string;
  description: string;
  defaultValue: unknown;
  isSecurity: boolean;
}

export const CONFIG_DOCS: ConfigFieldDoc[] = [
  // security (instance-level)
  {
    path: 'security.forbiddenPaths',
    type: 'string[]',
    description: 'Paths the agent may never access.',
    defaultValue: '["/etc","/root","/boot","~/.ssh","~/.gnupg","~/.aws",...]',
    isSecurity: true,
  },
  {
    path: 'security.allowedPaths',
    type: 'string[]',
    description: 'Additional paths outside the workspace the agent may access.',
    defaultValue: '[]',
    isSecurity: true,
  },
  {
    path: 'security.rateLimits.global',
    type: 'number',
    description: 'Maximum tool calls per minute across all agents.',
    defaultValue: 20,
    isSecurity: true,
  },
  {
    path: 'security.rateLimits.perAgent',
    type: 'number',
    description: 'Maximum tool calls per minute per agent (optional).',
    defaultValue: undefined,
    isSecurity: true,
  },
  {
    path: 'security.rateLimits.perToolClass',
    type: 'Record<string, number>',
    description: 'Maximum tool calls per minute per tool class (optional).',
    defaultValue: undefined,
    isSecurity: true,
  },
  {
    path: 'security.encrypt',
    type: 'boolean',
    description: 'Encrypt API keys and tokens at rest in config.json.',
    defaultValue: true,
    isSecurity: true,
  },

  // gateway
  {
    path: 'gateway.enabled',
    type: 'boolean',
    description: 'Enable the HTTP gateway for external integrations.',
    defaultValue: false,
    isSecurity: false,
  },
  {
    path: 'gateway.host',
    type: 'string',
    description: 'Host to bind the gateway server to.',
    defaultValue: '127.0.0.1',
    isSecurity: false,
  },
  {
    path: 'gateway.port',
    type: 'number',
    description: 'Port for the gateway server.',
    defaultValue: 3000,
    isSecurity: false,
  },
  {
    path: 'gateway.bodyLimit',
    type: 'number',
    description: 'Maximum request body size in bytes.',
    defaultValue: 65536,
    isSecurity: false,
  },
  {
    path: 'gateway.timeout',
    type: 'number',
    description: 'Gateway request timeout in milliseconds.',
    defaultValue: 30000,
    isSecurity: false,
  },
  {
    path: 'gateway.requirePairing',
    type: 'boolean',
    description: 'Require pairing authentication for gateway access.',
    defaultValue: true,
    isSecurity: true,
  },
  {
    path: 'gateway.allowPublicBind',
    type: 'boolean',
    description: 'Allow binding gateway to 0.0.0.0 (public). Dangerous on untrusted networks.',
    defaultValue: false,
    isSecurity: true,
  },
  {
    path: 'gateway.apiKeys',
    type: 'Array<{ label: string; key: string }>',
    description: 'Pre-provisioned API keys for gateway authentication. Keys are encrypted on first startup. Each entry needs a label (for identification) and a key (the secret). Tokens verified through the same mechanism as pairing tokens.',
    defaultValue: '[]',
    isSecurity: true,
  },

  // providers
  {
    path: 'providers.anthropic.apiKey',
    type: 'string',
    description: 'Anthropic API key. Stored encrypted if security.encrypt is true.',
    defaultValue: undefined,
    isSecurity: false,
  },
  {
    path: 'providers.anthropic.defaultModel',
    type: 'string',
    description: 'Default Anthropic model to use.',
    defaultValue: undefined,
    isSecurity: false,
  },
  {
    path: 'providers.openai.apiKey',
    type: 'string',
    description: 'OpenAI API key. Stored encrypted if security.encrypt is true.',
    defaultValue: undefined,
    isSecurity: false,
  },
  {
    path: 'providers.openai.defaultModel',
    type: 'string',
    description: 'Default OpenAI model to use.',
    defaultValue: undefined,
    isSecurity: false,
  },
  {
    path: 'providers.ollama.baseUrl',
    type: 'string',
    description: 'Base URL for the Ollama server.',
    defaultValue: undefined,
    isSecurity: false,
  },
  {
    path: 'providers.ollama.defaultModel',
    type: 'string',
    description: 'Default Ollama model to use.',
    defaultValue: undefined,
    isSecurity: false,
  },

  // channels
  {
    path: 'channels.enabled',
    type: 'string[]',
    description: 'List of enabled channel names (e.g. "cli").',
    defaultValue: '["cli"]',
    isSecurity: false,
  },

  // monitoring
  {
    path: 'monitoring.logLevel',
    type: '"debug" | "info" | "warn" | "error"',
    description: 'Minimum log level for output.',
    defaultValue: 'info',
    isSecurity: false,
  },
  {
    path: 'monitoring.heartbeatInterval',
    type: 'number',
    description: 'Heartbeat interval in seconds (daemon mode).',
    defaultValue: 3600,
    isSecurity: false,
  },
];
