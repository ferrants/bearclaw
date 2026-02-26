import { describe, it, expect, vi } from 'vitest';
import { runAgentLoop, type AgentLoopConfig } from '../../src/agent/loop.js';
import { ToolRegistryImpl } from '../../src/tools/registry.js';
import { ToolHookRegistryImpl } from '../../src/tools/hooks.js';
import { EventBus } from '../../src/events.js';
import type { LLMProvider, LLMResponse, Message } from '../../src/providers/types.js';
import type { ToolContext, Tool } from '../../src/tools/types.js';
import { toolResult } from '../../src/tools/types.js';

function makeProvider(responses: LLMResponse[]): LLMProvider {
  let callIdx = 0;
  return {
    defaultModel: 'test-model',
    async chat() {
      return responses[callIdx++] ?? { content: 'done', toolCalls: [], finishReason: 'stop' };
    },
  };
}

function makeRegistry(tools: Tool[]): ToolRegistryImpl {
  const registry = new ToolRegistryImpl();
  for (const tool of tools) {
    registry.register(tool);
  }
  return registry;
}

function makeCtx(overrides?: Partial<ToolContext>): ToolContext {
  return {
    signal: AbortSignal.timeout(10000),
    currentAgentConfig: { name: 'test', provider: 'test' },
    ...overrides,
  } as ToolContext;
}

describe('runAgentLoop', () => {
  it('returns content when LLM responds with no tool calls', async () => {
    const provider = makeProvider([
      { content: 'Hello!', toolCalls: [], finishReason: 'stop' },
    ]);

    const config: AgentLoopConfig = {
      provider,
      model: 'test',
      tools: makeRegistry([]),
      hooks: new ToolHookRegistryImpl(),
      maxIterations: 5,
    };

    const result = await runAgentLoop(config, [{ role: 'user', content: 'hi' }], makeCtx());
    expect(result.content).toBe('Hello!');
    expect(result.iterations).toBe(1);
    expect(result.toolsUsed).toHaveLength(0);
  });

  it('executes tool calls and loops', async () => {
    const provider = makeProvider([
      {
        content: 'Let me check.',
        toolCalls: [{ id: 'tc1', name: 'test_tool', arguments: { input: 'hello' } }],
        finishReason: 'tool_calls',
      },
      { content: 'Done!', toolCalls: [], finishReason: 'stop' },
    ]);

    const tools = makeRegistry([{
      name: 'test_tool',
      description: 'A test tool',
      parameters: { type: 'object', properties: { input: { type: 'string' } } },
      async execute(_ctx, args) {
        return toolResult(`got: ${args.input}`);
      },
    }]);

    const config: AgentLoopConfig = {
      provider,
      model: 'test',
      tools,
      hooks: new ToolHookRegistryImpl(),
      maxIterations: 5,
    };

    const result = await runAgentLoop(config, [{ role: 'user', content: 'test' }], makeCtx());
    expect(result.content).toBe('Done!');
    expect(result.iterations).toBe(2);
    expect(result.toolsUsed).toHaveLength(1);
    expect(result.toolsUsed[0].name).toBe('test_tool');
  });

  it('stops at max iterations', async () => {
    const provider = makeProvider([
      { content: '', toolCalls: [{ id: 'tc1', name: 't', arguments: {} }], finishReason: 'tool_calls' },
      { content: '', toolCalls: [{ id: 'tc2', name: 't', arguments: {} }], finishReason: 'tool_calls' },
      { content: '', toolCalls: [{ id: 'tc3', name: 't', arguments: {} }], finishReason: 'tool_calls' },
    ]);

    const tools = makeRegistry([{
      name: 't',
      description: 'test',
      parameters: { type: 'object', properties: {} },
      async execute() { return toolResult('ok'); },
    }]);

    const config: AgentLoopConfig = {
      provider,
      model: 'test',
      tools,
      hooks: new ToolHookRegistryImpl(),
      maxIterations: 2,
    };

    const result = await runAgentLoop(config, [{ role: 'user', content: 'test' }], makeCtx());
    expect(result.content).toContain('maximum iterations');
    expect(result.iterations).toBe(2);
  });

  it('tracks token usage', async () => {
    const provider = makeProvider([
      {
        content: 'result',
        toolCalls: [],
        finishReason: 'stop',
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      },
    ]);

    const config: AgentLoopConfig = {
      provider,
      model: 'test',
      tools: makeRegistry([]),
      hooks: new ToolHookRegistryImpl(),
      maxIterations: 5,
    };

    const result = await runAgentLoop(config, [{ role: 'user', content: 'test' }], makeCtx());
    expect(result.totalTokens).toBe(150);
  });

  it('stops when token budget exceeded', async () => {
    const provider = makeProvider([
      {
        content: '',
        toolCalls: [{ id: 'tc1', name: 't', arguments: {} }],
        finishReason: 'tool_calls',
        usage: { promptTokens: 500, completionTokens: 500, totalTokens: 1000 },
      },
      { content: 'should not reach', toolCalls: [], finishReason: 'stop' },
    ]);

    const tools = makeRegistry([{
      name: 't',
      description: 'test',
      parameters: { type: 'object', properties: {} },
      async execute() { return toolResult('ok'); },
    }]);

    const config: AgentLoopConfig = {
      provider,
      model: 'test',
      tools,
      hooks: new ToolHookRegistryImpl(),
      maxIterations: 10,
      maxTotalTokens: 500,
    };

    const result = await runAgentLoop(config, [{ role: 'user', content: 'test' }], makeCtx());
    expect(result.content).toContain('Token budget exceeded');
  });

  it('returns detailed usage breakdown', async () => {
    const provider = makeProvider([
      {
        content: 'Let me check.',
        toolCalls: [{ id: 'tc1', name: 'test_tool', arguments: {} }],
        finishReason: 'tool_calls',
        usage: { promptTokens: 100, completionTokens: 30, totalTokens: 130, cacheReadTokens: 50, cacheWriteTokens: 10 },
      },
      {
        content: 'Done!',
        toolCalls: [],
        finishReason: 'stop',
        usage: { promptTokens: 200, completionTokens: 20, totalTokens: 220, cacheReadTokens: 150 },
      },
    ]);

    const tools = makeRegistry([{
      name: 'test_tool',
      description: 'A test tool',
      parameters: { type: 'object', properties: {} },
      async execute() { return toolResult('ok'); },
    }]);

    const config: AgentLoopConfig = {
      provider, model: 'test', tools,
      hooks: new ToolHookRegistryImpl(), maxIterations: 5,
    };

    const result = await runAgentLoop(config, [{ role: 'user', content: 'test' }], makeCtx());
    expect(result.usage.inputTokens).toBe(300);
    expect(result.usage.outputTokens).toBe(50);
    expect(result.usage.cacheReadTokens).toBe(200);
    expect(result.usage.cacheWriteTokens).toBe(10);
    expect(result.totalTokens).toBe(350);
  });

  it('omits cache tokens from usage when zero', async () => {
    const provider = makeProvider([
      {
        content: 'result',
        toolCalls: [],
        finishReason: 'stop',
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      },
    ]);

    const config: AgentLoopConfig = {
      provider, model: 'test', tools: makeRegistry([]),
      hooks: new ToolHookRegistryImpl(), maxIterations: 5,
    };

    const result = await runAgentLoop(config, [{ role: 'user', content: 'test' }], makeCtx());
    expect(result.usage.inputTokens).toBe(100);
    expect(result.usage.outputTokens).toBe(50);
    expect(result.usage.cacheReadTokens).toBeUndefined();
    expect(result.usage.cacheWriteTokens).toBeUndefined();
  });

  it('emits agent:status events at state transitions', async () => {
    const eventBus = new EventBus();
    const statusEvents: Array<{ status: string }> = [];
    eventBus.on('agent:status', (data) => statusEvents.push({ status: data.status }));

    const provider = makeProvider([
      {
        content: 'checking',
        toolCalls: [{ id: 'tc1', name: 'test_tool', arguments: {} }],
        finishReason: 'tool_calls',
        usage: { promptTokens: 100, completionTokens: 30, totalTokens: 130 },
      },
      { content: 'Done!', toolCalls: [], finishReason: 'stop' },
    ]);

    const tools = makeRegistry([{
      name: 'test_tool',
      description: 'A test tool',
      parameters: { type: 'object', properties: {} },
      async execute() { return toolResult('ok'); },
    }]);

    const config: AgentLoopConfig = {
      provider, model: 'test', tools,
      hooks: new ToolHookRegistryImpl(), maxIterations: 5,
      eventBus,
    };

    await runAgentLoop(config, [{ role: 'user', content: 'test' }], makeCtx());

    // Iteration 1: thinking → tool_use → thinking (after results)
    // Iteration 2: thinking (before LLM call, no tools so loop ends)
    expect(statusEvents.map(e => e.status)).toEqual([
      'thinking', 'tool_use', 'thinking', 'thinking',
    ]);
  });

  it('uses real promptTokens for contextTokens after LLM call', async () => {
    const eventBus = new EventBus();
    const statusEvents: Array<{ status: string; contextTokens: number }> = [];
    eventBus.on('agent:status', (data) => statusEvents.push({ status: data.status, contextTokens: data.contextTokens }));

    const provider = makeProvider([
      {
        content: 'result',
        toolCalls: [],
        finishReason: 'stop',
        usage: { promptTokens: 5000, completionTokens: 100, totalTokens: 5100 },
      },
    ]);

    const config: AgentLoopConfig = {
      provider, model: 'test', tools: makeRegistry([]),
      hooks: new ToolHookRegistryImpl(), maxIterations: 5,
      eventBus,
    };

    await runAgentLoop(config, [{ role: 'user', content: 'short message' }], makeCtx());

    // First emission is the estimate before LLM call
    const firstEstimate = statusEvents[0].contextTokens;
    // Should be the char-based estimate (short message ~3-4 tokens)
    expect(firstEstimate).toBeLessThan(100);
  });

  it('respects maxContextTokens from config over model lookup', async () => {
    const eventBus = new EventBus();
    const statusEvents: Array<{ maxContextTokens: number }> = [];
    eventBus.on('agent:status', (data) => statusEvents.push({ maxContextTokens: data.maxContextTokens }));

    const provider = makeProvider([
      { content: 'result', toolCalls: [], finishReason: 'stop' },
    ]);

    const config: AgentLoopConfig = {
      provider, model: 'test', tools: makeRegistry([]),
      hooks: new ToolHookRegistryImpl(), maxIterations: 5,
      maxContextTokens: 50000,
      eventBus,
    };

    await runAgentLoop(config, [{ role: 'user', content: 'test' }], makeCtx());

    expect(statusEvents[0].maxContextTokens).toBe(50000);
  });

  it('runs before hooks and blocks tool calls', async () => {
    const provider = makeProvider([
      {
        content: 'trying',
        toolCalls: [{ id: 'tc1', name: 'blocked_tool', arguments: {} }],
        finishReason: 'tool_calls',
      },
      { content: 'ok', toolCalls: [], finishReason: 'stop' },
    ]);

    const tools = makeRegistry([{
      name: 'blocked_tool',
      description: 'test',
      parameters: { type: 'object', properties: {} },
      async execute() { return toolResult('should not run'); },
    }]);

    const hooks = new ToolHookRegistryImpl();
    hooks.registerBefore(async (toolName, args) => {
      if (toolName === 'blocked_tool') return { proceed: false, args };
      return { proceed: true, args };
    });

    const config: AgentLoopConfig = {
      provider,
      model: 'test',
      tools,
      hooks,
      maxIterations: 5,
    };

    const result = await runAgentLoop(config, [{ role: 'user', content: 'test' }], makeCtx());
    expect(result.toolsUsed[0].result.isError).toBe(true);
    expect(result.toolsUsed[0].result.forLLM).toContain('blocked by policy');
  });
});
