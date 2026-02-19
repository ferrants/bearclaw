import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { type BearClawConfig, AutonomyLevel } from './schema.js';
import {
  ALLOWED_COMMANDS,
  RESTRICTED_COMMANDS,
  FORBIDDEN_PATHS,
  POLICY_DEFAULTS,
} from './defaults.js';
import { createLogger } from '../logging.js';

const log = createLogger('config');

function resolveConfigDir(): string {
  return process.env.BEARCLAW_CONFIG_DIR ?? path.join(os.homedir(), '.bearclaw');
}

export function getConfigDir(): string {
  return resolveConfigDir();
}

export function getConfigPath(): string {
  const dir = resolveConfigDir();
  const jsoncPath = path.join(dir, 'config.jsonc');
  if (fs.existsSync(jsoncPath)) return jsoncPath;
  return path.join(dir, 'config.json');
}

export function defaultConfig(): BearClawConfig {
  const configDir = resolveConfigDir();
  return {
    workspace: {
      path: path.join(configDir, 'workspace'),
    },
    security: {
      autonomy: AutonomyLevel.Supervised,
      workspaceOnly: true,
      allowedCommands: [...ALLOWED_COMMANDS],
      restrictedCommands: { ...RESTRICTED_COMMANDS },
      forbiddenPaths: [...FORBIDDEN_PATHS],
      allowedPaths: [],
      allowSubshells: false,
      rateLimits: {
        global: 20,
      },
      encrypt: true,
    },
    gateway: {
      enabled: false,
      host: '127.0.0.1',
      port: 3000,
      bodyLimit: 65536,
      timeout: 30000,
      requirePairing: true,
      allowPublicBind: false,
      apiKeys: [],
    },
    providers: {},
    channels: {
      enabled: ['cli'],
    },
    mcp: {
      servers: {},
    },
    agents: {
      default: {
        name: 'default',
        provider: 'anthropic',
        maxIterations: 25,
        systemPromptFiles: [],
      },
    },
    teams: {},
    memory: {
      enabled: true,
      dir: 'memory',
      alwaysLoad: ['active-tasks.md'],
    },
    policy: {
      ...POLICY_DEFAULTS,
      rules: [],
    },
    schedules: [],
    monitoring: {
      logLevel: 'info',
      heartbeatInterval: 3600,
    },
  };
}

export function loadConfig(): BearClawConfig {
  const defaults = defaultConfig();
  const configPath = getConfigPath();

  let config: BearClawConfig;
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(stripJsonc(raw));
    config = deepMerge(defaults as unknown as Record<string, unknown>, parsed) as unknown as BearClawConfig;
  } catch {
    config = defaults;
  }

  // Expand ~ in workspace path so all consumers get an absolute path
  if (config.workspace.path.startsWith('~/')) {
    config.workspace.path = path.join(os.homedir(), config.workspace.path.slice(2));
  }

  // Expand ~ in allowedPaths
  if (config.security.allowedPaths) {
    config.security.allowedPaths = config.security.allowedPaths.map(p =>
      p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p
    );
  } else {
    config.security.allowedPaths = [];
  }

  return config;
}

export function saveConfig(config: BearClawConfig): void {
  const configDir = resolveConfigDir();
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), { mode: 0o600 });
}

/**
 * Encrypt plaintext API keys in the config and rewrite config.json.
 * Called once at startup. Idempotent — already-encrypted values are skipped.
 */
export function encryptConfigSecrets(config: BearClawConfig, encrypt: (plaintext: string) => string, isEncrypted: (value: string) => boolean): boolean {
  let changed = false;

  if (config.providers.anthropic?.apiKey && !isEncrypted(config.providers.anthropic.apiKey)) {
    config.providers.anthropic.apiKey = encrypt(config.providers.anthropic.apiKey);
    changed = true;
  }

  if (config.providers.openai?.apiKey && !isEncrypted(config.providers.openai.apiKey)) {
    config.providers.openai.apiKey = encrypt(config.providers.openai.apiKey);
    changed = true;
  }

  if (config.channels.telegram?.botToken && !isEncrypted(config.channels.telegram.botToken)) {
    config.channels.telegram.botToken = encrypt(config.channels.telegram.botToken);
    changed = true;
  }

  if (config.gateway.apiKeys) {
    for (const entry of config.gateway.apiKeys) {
      if (entry.key && !isEncrypted(entry.key)) {
        entry.key = encrypt(entry.key);
        changed = true;
      }
    }
  }

  if (changed) {
    saveConfig(config);
    log.info('Encrypted plaintext secrets in config');
  }

  return changed;
}

/**
 * Strip // line comments, /* block comments *​/, and trailing commas from JSONC.
 * Respects quoted strings — comments inside strings are left alone.
 */
export function stripJsonc(text: string): string {
  let result = '';
  let i = 0;
  while (i < text.length) {
    // String literal — pass through unchanged
    if (text[i] === '"') {
      result += '"';
      i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\') {
          result += text[i] + (text[i + 1] ?? '');
          i += 2;
        } else {
          result += text[i];
          i++;
        }
      }
      if (i < text.length) {
        result += '"';
        i++;
      }
    }
    // Line comment
    else if (text[i] === '/' && text[i + 1] === '/') {
      i += 2;
      while (i < text.length && text[i] !== '\n') i++;
    }
    // Block comment
    else if (text[i] === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2; // skip */
    }
    // Trailing comma before ] or }
    else if (text[i] === ',') {
      // Look ahead past whitespace/comments for ] or }
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      // Also skip comments after the comma
      while (j < text.length) {
        if (text[j] === '/' && text[j + 1] === '/') {
          j += 2;
          while (j < text.length && text[j] !== '\n') j++;
          while (j < text.length && /\s/.test(text[j])) j++;
        } else if (text[j] === '/' && text[j + 1] === '*') {
          j += 2;
          while (j < text.length && !(text[j] === '*' && text[j + 1] === '/')) j++;
          j += 2;
          while (j < text.length && /\s/.test(text[j])) j++;
        } else {
          break;
        }
      }
      if (j < text.length && (text[j] === ']' || text[j] === '}')) {
        // Skip the trailing comma
        i++;
      } else {
        result += text[i];
        i++;
      }
    }
    else {
      result += text[i];
      i++;
    }
  }
  return result;
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const tVal = target[key];
    const sVal = source[key];
    if (
      tVal && sVal &&
      typeof tVal === 'object' && typeof sVal === 'object' &&
      !Array.isArray(tVal) && !Array.isArray(sVal)
    ) {
      result[key] = deepMerge(tVal as Record<string, unknown>, sVal as Record<string, unknown>);
    } else {
      result[key] = sVal;
    }
  }
  return result;
}
