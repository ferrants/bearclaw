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

const CONFIG_DIR = path.join(os.homedir(), '.bearclaw');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

export function getConfigDir(): string {
  return CONFIG_DIR;
}

export function getConfigPath(): string {
  return CONFIG_PATH;
}

export function defaultConfig(): BearClawConfig {
  return {
    workspace: {
      path: path.join(CONFIG_DIR, 'workspace'),
    },
    security: {
      autonomy: AutonomyLevel.Supervised,
      workspaceOnly: true,
      allowedCommands: [...ALLOWED_COMMANDS],
      restrictedCommands: { ...RESTRICTED_COMMANDS },
      forbiddenPaths: [...FORBIDDEN_PATHS],
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
    },
    providers: {},
    channels: {
      enabled: ['cli'],
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
    monitoring: {
      logLevel: 'info',
      heartbeatInterval: 3600,
    },
  };
}

export function loadConfig(): BearClawConfig {
  const defaults = defaultConfig();

  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return deepMerge(defaults as unknown as Record<string, unknown>, parsed) as unknown as BearClawConfig;
  } catch {
    return defaults;
  }
}

export function saveConfig(config: BearClawConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
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
