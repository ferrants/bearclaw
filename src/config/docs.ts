export interface ConfigFieldDoc {
  path: string;
  type: string;
  description: string;
  defaultValue: unknown;
  isSecurity: boolean;
}

export const CONFIG_DOCS: ConfigFieldDoc[] = [
  // workspace
  {
    path: 'workspace.path',
    type: 'string',
    description: 'Root directory for the workspace. Tools operate relative to this path.',
    defaultValue: '~/.bearclaw/workspace',
    isSecurity: false,
  },

  // security
  {
    path: 'security.autonomy',
    type: '"readonly" | "supervised" | "full"',
    description: 'Controls how much the agent can do without asking. "readonly" = read-only tools only, "supervised" = prompt for writes/exec, "full" = no prompts.',
    defaultValue: 'supervised',
    isSecurity: true,
  },
  {
    path: 'security.workspaceOnly',
    type: 'boolean',
    description: 'When true, file tools are restricted to the workspace directory.',
    defaultValue: true,
    isSecurity: true,
  },
  {
    path: 'security.allowedCommands',
    type: 'string[]',
    description: 'Shell commands the agent may run without approval.',
    defaultValue: '["git","cargo","go","ls","cat","grep","find","echo","pwd","wc","head","tail","sort","uniq","diff","date","which","mkdir","cp","mv","touch","chmod"]',
    isSecurity: true,
  },
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
    path: 'security.allowSubshells',
    type: 'boolean',
    description: 'Whether the exec tool may use shell operators (pipes, redirects, subshells).',
    defaultValue: false,
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
    description: 'List of enabled channel names (e.g. "cli", "telegram").',
    defaultValue: '["cli"]',
    isSecurity: false,
  },
  {
    path: 'channels.telegram.botToken',
    type: 'string',
    description: 'Telegram bot token. Stored encrypted if security.encrypt is true.',
    defaultValue: undefined,
    isSecurity: false,
  },
  {
    path: 'channels.telegram.allowFrom',
    type: 'string[]',
    description: 'Telegram usernames allowed to message the bot.',
    defaultValue: undefined,
    isSecurity: true,
  },

  // memory
  {
    path: 'memory.enabled',
    type: 'boolean',
    description: 'Enable agent memory (persistent notes across sessions).',
    defaultValue: true,
    isSecurity: false,
  },
  {
    path: 'memory.dir',
    type: 'string',
    description: 'Directory for memory files, relative to config dir.',
    defaultValue: 'memory',
    isSecurity: false,
  },
  {
    path: 'memory.alwaysLoad',
    type: 'string[]',
    description: 'Memory files to always include in context.',
    defaultValue: '["active-tasks.md"]',
    isSecurity: false,
  },

  // policy
  {
    path: 'policy.defaultAction',
    type: '"allow" | "deny" | "approve"',
    description: 'Default action when no policy rule matches a tool call.',
    defaultValue: 'approve',
    isSecurity: true,
  },
  {
    path: 'policy.denyPrecedence',
    type: 'boolean',
    description: 'When true, deny rules take precedence over allow rules.',
    defaultValue: true,
    isSecurity: true,
  },
  {
    path: 'policy.approvalScope',
    type: '"user+channel" | "conversation" | "global"',
    description: 'Scope at which approvals are tracked.',
    defaultValue: 'user+channel',
    isSecurity: true,
  },
  {
    path: 'policy.learningMode',
    type: '"suggest_rules" | "auto_allow_prompt" | "auto_allow"',
    description: 'How the policy engine learns from approved actions.',
    defaultValue: 'suggest_rules',
    isSecurity: true,
  },
  {
    path: 'policy.approvals.cache',
    type: 'boolean',
    description: 'Cache approval decisions to avoid re-prompting.',
    defaultValue: false,
    isSecurity: true,
  },
  {
    path: 'policy.approvals.defaultTTLSeconds',
    type: 'number',
    description: 'How long cached approvals last in seconds.',
    defaultValue: 300,
    isSecurity: true,
  },
  {
    path: 'policy.inlineAllow.enabled',
    type: 'boolean',
    description: 'Allow users to grant tool permissions inline (e.g. "!allow exec").',
    defaultValue: true,
    isSecurity: true,
  },
  {
    path: 'policy.inlineAllow.dayScopeHours',
    type: 'number',
    description: 'How long day-scoped inline allows last in hours.',
    defaultValue: 24,
    isSecurity: true,
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
