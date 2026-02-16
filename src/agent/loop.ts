import type { LLMProvider, Message } from '../providers/types.js';
import type { ToolContext, ToolResult, ToolRegistry, ToolHookRegistry } from '../tools/types.js';
import { errorResult } from '../tools/types.js';
import { createLogger } from '../logging.js';

const log = createLogger('agent-loop');

export interface AgentLoopConfig {
  provider: LLMProvider;
  model: string;
  tools: ToolRegistry;
  hooks: ToolHookRegistry;
  maxIterations: number;
  maxTotalTokens?: number;
  options?: { maxTokens?: number; temperature?: number; onToken?: (token: string) => void };
}

export interface AgentLoopResult {
  content: string;
  iterations: number;
  toolsUsed: Array<{ name: string; result: ToolResult }>;
  totalTokens: number;
}

export async function runAgentLoop(
  config: AgentLoopConfig,
  messages: Message[],
  ctx: ToolContext,
): Promise<AgentLoopResult> {
  const { provider, model, tools, hooks, maxIterations, maxTotalTokens, options } = config;
  let iteration = 0;
  let totalTokens = 0;
  const toolsUsed: Array<{ name: string; result: ToolResult }> = [];

  while (iteration < maxIterations) {
    iteration++;

    // Check token budget
    if (maxTotalTokens && totalTokens >= maxTotalTokens) {
      return { content: 'Token budget exceeded.', iterations: iteration, toolsUsed, totalTokens };
    }

    // Call LLM
    const toolDefs = tools.toProviderDefs();
    log.debug('LLM call', { iteration, model, toolCount: toolDefs.length });

    const response = await provider.chat(messages, toolDefs, model, {
      ...options,
      signal: ctx.signal,
    });

    // Track tokens
    if (response.usage) {
      totalTokens += response.usage.totalTokens;
    }

    // No tool calls → done
    if (response.toolCalls.length === 0) {
      log.debug('Agent loop complete', { iteration, reason: response.finishReason });
      return { content: response.content, iterations: iteration, toolsUsed, totalTokens };
    }

    // Append assistant message
    messages.push({
      role: 'assistant',
      content: response.content,
      toolCalls: response.toolCalls,
    });

    // Execute tool calls in parallel
    const toolResults = await Promise.all(
      response.toolCalls.map(async (tc) => {
        // Before hook (blocking)
        const hookResult = await hooks.runBefore(tc.name, tc.arguments, ctx);

        let result: ToolResult;
        if (!hookResult.proceed) {
          result = errorResult(`Tool call blocked by policy: ${tc.name}`);
        } else {
          result = await tools.execute(ctx, tc.name, hookResult.args);
        }

        // After hook (fire-and-forget, tracked for flush)
        hooks.runAfter(tc.name, hookResult.args, result, ctx);

        return { tc, result };
      })
    );

    // Append results in original order
    for (const { tc, result } of toolResults) {
      toolsUsed.push({ name: tc.name, result });
      messages.push({
        role: 'tool',
        content: result.forLLM,
        toolCallId: tc.id,
      });
    }
  }

  return {
    content: 'Reached maximum iterations without a final response.',
    iterations: iteration,
    toolsUsed,
    totalTokens,
  };
}
