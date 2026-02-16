import type { Tool, ToolContext, ToolResult } from '../types.js';
import { toolResult, errorResult } from '../types.js';
import { ToolRegistryImpl } from '../registry.js';
import type { Message } from '../../providers/types.js';

// Forward reference - will be imported by the actual agent loop
export type RunAgentLoopFn = (
  config: {
    provider: import('../../providers/types.js').LLMProvider;
    model: string;
    tools: ToolRegistryImpl;
    hooks: import('../types.js').ToolHookRegistry;
    maxIterations: number;
  },
  messages: Message[],
  ctx: ToolContext,
) => Promise<{ content: string; iterations: number; toolsUsed: unknown[]; totalTokens: number }>;

let runAgentLoopFn: RunAgentLoopFn | null = null;

export function setAgentLoopFn(fn: RunAgentLoopFn): void {
  runAgentLoopFn = fn;
}

export const spawnTool: Tool = {
  name: 'spawn',
  description: 'Spawn a subagent to handle a task. The subagent runs its own agent loop with the specified provider.',
  parameters: {
    type: 'object',
    properties: {
      task: { type: 'string', description: 'What the subagent should do' },
      agentId: { type: 'string', description: 'Agent config to use (default: current agent)' },
      provider: { type: 'string', description: 'Override provider (e.g., "cli-delegation" for MCP access)' },
      successCriteria: { type: 'string', description: 'What "done" looks like' },
      maxIterations: { type: 'number', description: 'Max iterations (default 10)' },
    },
    required: ['task'],
  },

  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    if (!runAgentLoopFn) {
      return errorResult('Agent loop not initialized');
    }

    const task = args.task as string;
    const agentId = (args.agentId as string) ?? ctx.currentAgentConfig.name;
    const providerOverride = args.provider as string | undefined;
    const successCriteria = args.successCriteria as string | undefined;
    const maxIterations = Math.min(
      (args.maxIterations as number) ?? 10,
      ctx.currentAgentConfig.maxIterations ?? 25,
    );

    // Resolve agent config
    const agentConfig = ctx.agentConfigs[agentId];
    if (!agentConfig) return errorResult(`Unknown agent: ${agentId}`);

    // Resolve provider
    const providerName = providerOverride ?? agentConfig.provider;
    const provider = ctx.providerFactory(providerName);

    // Build restricted tool registry (no spawn, no message)
    const childRegistry = new ToolRegistryImpl();
    for (const name of ctx.toolRegistry.list()) {
      if (name === 'spawn' || name === 'message') continue;
      const tool = ctx.toolRegistry.get(name);
      if (tool) childRegistry.register(tool);
    }

    // Build system prompt with task and success criteria
    const systemPrompt = successCriteria
      ? `${task}\n\nYour task is complete when: ${successCriteria}. State whether you met the criteria and summarize what you did.`
      : task;

    const messages: Message[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: task },
    ];

    // Run subagent loop
    const childCtx = { ...ctx, toolRegistry: childRegistry };
    const result = await runAgentLoopFn(
      {
        provider,
        model: agentConfig.model ?? provider.defaultModel,
        tools: childRegistry,
        hooks: ctx.hooks,
        maxIterations,
      },
      messages,
      childCtx,
    );

    return toolResult(
      successCriteria
        ? `Subagent result (criteria: ${successCriteria}):\n${result.content}`
        : `Subagent result:\n${result.content}`
    );
  },
};
