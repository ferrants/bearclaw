import { describe, it, expect, vi } from 'vitest';
import { runAgentLoop, type AgentLoopConfig } from '../../src/agent/loop.js';
import { ToolRegistryImpl } from '../../src/tools/registry.js';
import { ToolHookRegistryImpl } from '../../src/tools/hooks.js';
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
