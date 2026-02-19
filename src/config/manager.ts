import * as path from 'node:path';
import * as os from 'node:os';
import type { BearClawConfig } from './schema.js';
import { saveConfig } from './config.js';

export type ConfigReloadListener = (config: BearClawConfig) => void;

export class ConfigManager {
  private config: BearClawConfig;
  private listeners: ConfigReloadListener[] = [];

  constructor(config: BearClawConfig) {
    this.config = config;
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
    if (dottedPath === 'workspace.path' && typeof value === 'string' && value.startsWith('~/')) {
      this.config.workspace.path = path.join(os.homedir(), value.slice(2));
    }

    // Expand ~ in allowedPaths
    if (dottedPath === 'security.allowedPaths' && Array.isArray(value)) {
      this.config.security.allowedPaths = value.map((p: string) =>
        p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p
      );
    }

    saveConfig(this.config);

    for (const listener of this.listeners) {
      listener(this.config);
    }
  }

  /** Register a callback to run after any config change. */
  onReload(listener: ConfigReloadListener): void {
    this.listeners.push(listener);
  }

  /** Get the full config object (read-only reference). */
  getConfig(): BearClawConfig {
    return this.config;
  }
}
