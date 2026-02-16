import { describe, it, expect } from 'vitest';
import { ToolRegistryImpl } from '../../src/tools/registry.js';
import type { Tool, ToolContext } from '../../src/tools/types.js';
import { toolResult, errorResult } from '../../src/tools/types.js';

function makeTool(name: string): Tool {
  return {
    name,
    description: `Test tool: ${name}`,
    parameters: {
      type: 'object',
      properties: {
        input: { type: 'string' },
      },
      required: ['input'],
    },
    async execute(_ctx, args) {
      return toolResult(`executed ${name} with ${args.input}`);
    },
  };
}

const dummyCtx = {} as ToolContext;

describe('ToolRegistryImpl', () => {
  it('registers and retrieves tools', () => {
    const registry = new ToolRegistryImpl();
    registry.register(makeTool('test1'));
    registry.register(makeTool('test2'));

    expect(registry.get('test1')).toBeDefined();
    expect(registry.get('test2')).toBeDefined();
    expect(registry.get('nonexistent')).toBeUndefined();
  });

  it('lists all tool names', () => {
    const registry = new ToolRegistryImpl();
    registry.register(makeTool('a'));
    registry.register(makeTool('b'));

    expect(registry.list()).toEqual(['a', 'b']);
  });

  it('executes a tool', async () => {
    const registry = new ToolRegistryImpl();
    registry.register(makeTool('test'));

    const result = await registry.execute(dummyCtx, 'test', { input: 'hello' });
    expect(result.forLLM).toBe('executed test with hello');
    expect(result.isError).toBe(false);
  });

  it('returns error for unknown tool', async () => {
    const registry = new ToolRegistryImpl();
    const result = await registry.execute(dummyCtx, 'nonexistent', {});
    expect(result.isError).toBe(true);
    expect(result.forLLM).toContain('Unknown tool');
  });

  it('validates required arguments', async () => {
    const registry = new ToolRegistryImpl();
    registry.register(makeTool('test'));

    const result = await registry.execute(dummyCtx, 'test', {});
    expect(result.isError).toBe(true);
    expect(result.forLLM).toContain('Missing required parameter');
  });

  it('catches tool execution errors', async () => {
    const registry = new ToolRegistryImpl();
    registry.register({
      name: 'failing',
      description: 'Fails on execute',
      parameters: { type: 'object', properties: {} },
      async execute() {
        throw new Error('boom');
      },
    });

    const result = await registry.execute(dummyCtx, 'failing', {});
    expect(result.isError).toBe(true);
    expect(result.forLLM).toContain('boom');
  });

  it('generates provider definitions', () => {
    const registry = new ToolRegistryImpl();
    registry.register(makeTool('test'));

    const defs = registry.toProviderDefs();
    expect(defs).toHaveLength(1);
    expect(defs[0].name).toBe('test');
    expect(defs[0].description).toBe('Test tool: test');
    expect(defs[0].parameters).toBeDefined();
  });
});
