import { describe, it, expect } from 'vitest';
import { ToolRegistryImpl } from '../../src/tools/registry.js';
import type { Tool, ToolContext } from '../../src/tools/types.js';
import { toolResult } from '../../src/tools/types.js';

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

describe('ToolRegistryImpl hidden tools', () => {
  it('toProviderDefs() excludes hidden tools', () => {
    const registry = new ToolRegistryImpl();
    registry.register(makeTool('visible'));
    registry.registerHidden(makeTool('hidden'));

    const defs = registry.toProviderDefs();
    expect(defs).toHaveLength(1);
    expect(defs[0].name).toBe('visible');
  });

  it('execute() still works on hidden tools', async () => {
    const registry = new ToolRegistryImpl();
    registry.registerHidden(makeTool('hidden'));

    const result = await registry.execute(dummyCtx, 'hidden', { input: 'test' });
    expect(result.isError).toBe(false);
    expect(result.forLLM).toBe('executed hidden with test');
  });

  it('get() returns hidden tools', () => {
    const registry = new ToolRegistryImpl();
    registry.registerHidden(makeTool('hidden'));

    expect(registry.get('hidden')).toBeDefined();
  });

  it('list() includes hidden tools', () => {
    const registry = new ToolRegistryImpl();
    registry.register(makeTool('visible'));
    registry.registerHidden(makeTool('hidden'));

    expect(registry.list()).toContain('hidden');
    expect(registry.list()).toContain('visible');
  });

  it('setHidden(false) makes tool visible in provider defs', () => {
    const registry = new ToolRegistryImpl();
    registry.registerHidden(makeTool('toggle'));

    expect(registry.toProviderDefs().find(d => d.name === 'toggle')).toBeUndefined();

    registry.setHidden('toggle', false);
    expect(registry.toProviderDefs().find(d => d.name === 'toggle')).toBeDefined();
  });

  it('setHidden(true) hides a previously visible tool', () => {
    const registry = new ToolRegistryImpl();
    registry.register(makeTool('toggle'));

    expect(registry.toProviderDefs().find(d => d.name === 'toggle')).toBeDefined();

    registry.setHidden('toggle', true);
    expect(registry.toProviderDefs().find(d => d.name === 'toggle')).toBeUndefined();
  });
});
