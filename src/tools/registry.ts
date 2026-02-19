import type { Tool, ToolResult, ToolContext } from './types.js';
import { errorResult } from './types.js';
import { validateArgs } from './validate.js';
import { createLogger } from '../logging.js';

const log = createLogger('tool-registry');

export class ToolRegistryImpl {
  private tools = new Map<string, Tool>();
  private hiddenTools = new Set<string>();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  registerHidden(tool: Tool): void {
    this.tools.set(tool.name, tool);
    this.hiddenTools.add(tool.name);
  }

  setHidden(name: string, hidden: boolean): void {
    if (hidden) {
      this.hiddenTools.add(name);
    } else {
      this.hiddenTools.delete(name);
    }
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): string[] {
    return [...this.tools.keys()];
  }

  async execute(ctx: ToolContext, name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return errorResult(`Unknown tool: ${name}`);
    }

    // Validate arguments
    const { valid, errors } = validateArgs(tool.parameters, args);
    if (!valid) {
      return errorResult(`Invalid arguments: ${errors.join('; ')}`);
    }

    try {
      return await tool.execute(ctx, args);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error('Tool execution error', { tool: name, error: message });
      return errorResult(`Tool error: ${message}`);
    }
  }

  toProviderDefs(): Array<{ name: string; description: string; parameters: Record<string, unknown> }> {
    return [...this.tools.values()]
      .filter(t => !this.hiddenTools.has(t.name))
      .map(t => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      }));
  }
}
