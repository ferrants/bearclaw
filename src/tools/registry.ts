import type { Tool, ToolResult, ToolContext } from './types.js';
import { errorResult } from './types.js';
import { validateArgs } from './validate.js';
import { createLogger } from '../logging.js';

const log = createLogger('tool-registry');

export class ToolRegistryImpl {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
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
    return [...this.tools.values()].map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
  }
}
