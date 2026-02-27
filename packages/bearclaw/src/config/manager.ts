import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { InstanceConfig } from './instance-schema.js';
import { saveConfig, stripJsonc } from './config.js';

export type ConfigReloadListener = (config: InstanceConfig) => void;

/**
 * Paths that belong to the agent-level config (bearclaw.jsonc).
 * Everything else is instance-level (~/.bearclaw/config.jsonc).
 */
const AGENT_PATH_PREFIXES = [
  'workspace.',
  'security.autonomy',
  'security.workspaceOnly',
  'security.allowedCommands',
  'security.allowSubshells',
  'memory.',
  'policy.',
];

function isAgentLevelPath(dottedPath: string): boolean {
  return AGENT_PATH_PREFIXES.some(prefix => dottedPath === prefix || dottedPath.startsWith(prefix));
}

export class ConfigManager {
  private config: InstanceConfig;
  private listeners: ConfigReloadListener[] = [];
  private agentDirPath: string | undefined;

  constructor(config: InstanceConfig, agentDirPath?: string) {
    this.config = config;
    this.agentDirPath = agentDirPath;
  }

  /** Get a value by dotted path (e.g. "security.autonomy"). Returns undefined for missing paths. */
  get(dottedPath: string): unknown {
    const parts = dottedPath.split('.');
    let current: unknown = this.config;
    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== 'object') {
        return undefined;
      }
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }

  /** Set a value by dotted path, persist to disk, and notify listeners. */
  set(dottedPath: string, value: unknown): void {
    const parts = dottedPath.split('.');
    let current: Record<string, unknown> = this.config as unknown as Record<string, unknown>;

    // Traverse to the parent of the target field
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (current[part] === undefined || current[part] === null || typeof current[part] !== 'object') {
        current[part] = {};
      }
      current = current[part] as Record<string, unknown>;
    }

    const lastKey = parts[parts.length - 1];
    current[lastKey] = value;

    // Expand ~ in workspace path
    // Expand ~ in allowedPaths
    if (dottedPath === 'security.allowedPaths' && Array.isArray(value)) {
      this.config.security.allowedPaths = value.map((p: string) =>
        p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p
      );
    }

    // Route the write to the correct config file
    if (this.agentDirPath && isAgentLevelPath(dottedPath)) {
      this.saveAgentConfig(dottedPath, value);
    } else {
      saveConfig(this.config);
    }

    for (const listener of this.listeners) {
      listener(this.config);
    }
  }

  /** Register a callback to run after any config change. */
  onReload(listener: ConfigReloadListener): void {
    this.listeners.push(listener);
  }

  /** Get the full config object (read-only reference). */
  getConfig(): InstanceConfig {
    return this.config;
  }

  /**
   * Save an agent-level setting to the agent's bearclaw.jsonc.
   * Maps from resolved BearClawConfig paths to AgentDirConfig paths.
   */
  private saveAgentConfig(dottedPath: string, value: unknown): void {
    const configPath = path.join(this.agentDirPath!, 'bearclaw.jsonc');
    let agentConfig: Record<string, unknown> = {};

    try {
      const raw = fs.readFileSync(configPath, 'utf8');
      agentConfig = JSON.parse(stripJsonc(raw));
    } catch {
      // Start with empty config if file doesn't exist
    }

    // Set the value in the agent config using the same dotted path
    const parts = dottedPath.split('.');
    let current: Record<string, unknown> = agentConfig;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (current[part] === undefined || current[part] === null || typeof current[part] !== 'object') {
        current[part] = {};
      }
      current = current[part] as Record<string, unknown>;
    }
    current[parts[parts.length - 1]] = value;

    fs.writeFileSync(configPath, JSON.stringify(agentConfig, null, 2));
  }
}
