import { describe, it, expect, vi } from 'vitest';
import { ToolHookRegistryImpl } from '../../src/tools/hooks.js';
import type { ToolContext, ToolResult } from '../../src/tools/types.js';

const dummyCtx = {} as ToolContext;
const dummyResult: ToolResult = { forLLM: 'ok', isError: false, async: false };

describe('ToolHookRegistryImpl', () => {
  it('runs before hooks sequentially', async () => {
    const hooks = new ToolHookRegistryImpl();
    const order: number[] = [];

    hooks.registerBefore(async (_tool, args) => {
      order.push(1);
      return { proceed: true, args };
    });
    hooks.registerBefore(async (_tool, args) => {
      order.push(2);
      return { proceed: true, args };
    });

    const result = await hooks.runBefore('test', { foo: 'bar' }, dummyCtx);
    expect(result.proceed).toBe(true);
    expect(order).toEqual([1, 2]);
  });

  it('stops on first blocking before-hook', async () => {
    const hooks = new ToolHookRegistryImpl();
    const called: string[] = [];

    hooks.registerBefore(async (_tool, args) => {
      called.push('first');
      return { proceed: false, args };
    });
    hooks.registerBefore(async (_tool, args) => {
      called.push('second');
      return { proceed: true, args };
    });

    const result = await hooks.runBefore('test', {}, dummyCtx);
    expect(result.proceed).toBe(false);
    expect(called).toEqual(['first']);
  });

  it('passes modified args through before-hooks', async () => {
    const hooks = new ToolHookRegistryImpl();

    hooks.registerBefore(async (_tool, args) => {
      return { proceed: true, args: { ...args, added: true } };
    });

    const result = await hooks.runBefore('test', { original: true }, dummyCtx);
    expect(result.args).toEqual({ original: true, added: true });
  });

  it('runs after hooks in parallel', async () => {
    const hooks = new ToolHookRegistryImpl();
    const results: number[] = [];

    hooks.registerAfter(async () => { results.push(1); });
    hooks.registerAfter(async () => { results.push(2); });

    await hooks.runAfter('test', {}, dummyResult, dummyCtx);
    await hooks.flush();

    expect(results).toContain(1);
    expect(results).toContain(2);
  });

  it('catches errors in before-hooks gracefully', async () => {
    const hooks = new ToolHookRegistryImpl();

    hooks.registerBefore(async () => {
      throw new Error('hook error');
    });

    const result = await hooks.runBefore('test', {}, dummyCtx);
    expect(result.proceed).toBe(false);
  });

  it('catches errors in after-hooks gracefully', async () => {
    const hooks = new ToolHookRegistryImpl();

    hooks.registerAfter(async () => {
      throw new Error('after hook error');
    });

    // Should not throw
    await hooks.runAfter('test', {}, dummyResult, dummyCtx);
    await hooks.flush();
  });

  it('flush respects timeout', async () => {
    const hooks = new ToolHookRegistryImpl();

    hooks.registerAfter(async () => {
      await new Promise(resolve => setTimeout(resolve, 10000));
    });

    await hooks.runAfter('test', {}, dummyResult, dummyCtx);

    const start = Date.now();
    await hooks.flush(100);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(500);
  });
});
