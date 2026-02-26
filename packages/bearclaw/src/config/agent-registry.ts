import type { AgentRuntime } from './agent-runtime.js';

/**
 * Registry of all loaded agent runtimes.
 * Provides lookup by agent name and iteration.
 */
export class AgentRegistry {
  private runtimes = new Map<string, AgentRuntime>();
  private defaultName: string | undefined;

  /** Register an agent runtime. First registered becomes the default. */
  register(runtime: AgentRuntime): void {
    if (this.runtimes.has(runtime.name)) {
      throw new Error(`Duplicate agent name: ${runtime.name}`);
    }
    this.runtimes.set(runtime.name, runtime);
    if (!this.defaultName) {
      this.defaultName = runtime.name;
    }
  }

  /** Get a runtime by agent name. */
  get(name: string): AgentRuntime | undefined {
    return this.runtimes.get(name);
  }

  /** Get the default runtime (first registered, or _default). */
  getDefault(): AgentRuntime | undefined {
    if (this.runtimes.has('_default')) {
      return this.runtimes.get('_default');
    }
    return this.defaultName ? this.runtimes.get(this.defaultName) : undefined;
  }

  /** Resolve an agent name, falling back to default. */
  resolve(name?: string): AgentRuntime | undefined {
    if (name) {
      return this.runtimes.get(name) ?? this.getDefault();
    }
    return this.getDefault();
  }

  /** Check if an agent name is a primary agent (externally addressable). */
  isPrimary(name: string): boolean {
    return this.runtimes.has(name);
  }

  /** List all registered agent names. */
  names(): string[] {
    return [...this.runtimes.keys()];
  }

  /** List all registered runtimes. */
  all(): AgentRuntime[] {
    return [...this.runtimes.values()];
  }

  /** Number of registered agents. */
  get size(): number {
    return this.runtimes.size;
  }
}
