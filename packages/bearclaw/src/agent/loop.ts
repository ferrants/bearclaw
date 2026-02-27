import type { LLMProvider, Message } from '../providers/types.js';
import type { ToolContext, ToolResult, ToolRegistry, ToolHookRegistry } from '../tools/types.js';
import type { EventBus } from '../events.js';
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
  maxContextTokens?: number;
  eventBus?: EventBus;
  agentId?: string;
  chatId?: string;
  options?: { maxTokens?: number; temperature?: number; onToken?: (token: string) => void };
}

export interface AgentLoopResult {
  content: string;
  iterations: number;
  toolsUsed: Array<{ name: string; result: ToolResult }>;
  totalTokens: number;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
}

const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  'claude-sonnet-4-5-20250929': 200000,
  'claude-opus-4-6': 200000,
  'claude-haiku-4-5-20251001': 200000,
  'gpt-4o': 128000,
  'gpt-4-turbo': 128000,
};

export async function runAgentLoop(
  config: AgentLoopConfig,
  messages: Message[],
  ctx: ToolContext,
): Promise<AgentLoopResult> {
  const { provider, model, tools, hooks, maxIterations, maxTotalTokens, eventBus, options } = config;
  const evAgentId = config.agentId ?? ctx.currentAgentConfig.name;
  const evChatId = config.chatId ?? ctx.chatId ?? '';
  let iteration = 0;
  let totalTokens = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  const toolsUsed: Array<{ name: string; result: ToolResult }> = [];
  const maxContextTokens = config.maxContextTokens ?? MODEL_CONTEXT_LIMITS[model] ?? 128000;
  let contextTokens = 0;

  while (iteration < maxIterations) {
    iteration++;

    // Check token budget
    if (maxTotalTokens && totalTokens >= maxTotalTokens) {
      eventBus?.emit('agent:status', { agentId: evAgentId, chatId: evChatId, status: 'idle', contextTokens, maxContextTokens });
      const usage = { inputTokens, outputTokens, cacheReadTokens: cacheReadTokens > 0 ? cacheReadTokens : undefined, cacheWriteTokens: cacheWriteTokens > 0 ? cacheWriteTokens : undefined };
      return { content: 'Token budget exceeded.', iterations: iteration, toolsUsed, totalTokens, usage };
    }

    // Emit thinking status before LLM call (estimate context size from message content)
    contextTokens = Math.ceil(messages.reduce((sum, m) => sum + m.content.length, 0) / 4);
    eventBus?.emit('agent:status', { agentId: evAgentId, chatId: evChatId, status: 'thinking', contextTokens, maxContextTokens });

    // Call LLM
    const toolDefs = tools.toProviderDefs();
    const agentId = ctx.currentAgentConfig.name;
    log.info('LLM call', { agentId, iteration, model, messageCount: messages.length });

    const onToken = eventBus
      ? (token: string) => {
          eventBus.emit('token:received', { agentId: evAgentId, chatId: evChatId, token });
          options?.onToken?.(token);
        }
      : options?.onToken;

    const response = await provider.chat(messages, toolDefs, model, {
      ...options,
      onToken,
      signal: ctx.signal,
    });

    // Track tokens — use real promptTokens as contextTokens when available
    if (response.usage) {
      totalTokens += response.usage.totalTokens;
      inputTokens += response.usage.promptTokens;
      outputTokens += response.usage.completionTokens;
      cacheReadTokens += response.usage.cacheReadTokens ?? 0;
      cacheWriteTokens += response.usage.cacheWriteTokens ?? 0;
      contextTokens = response.usage.promptTokens;
      log.debug('Token usage', { agentId, iteration, tokens: response.usage });
    }

    // No tool calls → done
    if (response.toolCalls.length === 0) {
      log.info('Loop complete', { agentId, iteration, reason: response.finishReason, totalTokens, responseLength: response.content.length });
      eventBus?.emit('agent:status', { agentId: evAgentId, chatId: evChatId, status: 'idle', contextTokens, maxContextTokens });
      const usage = { inputTokens, outputTokens, cacheReadTokens: cacheReadTokens > 0 ? cacheReadTokens : undefined, cacheWriteTokens: cacheWriteTokens > 0 ? cacheWriteTokens : undefined };
      return { content: response.content, iterations: iteration, toolsUsed, totalTokens, usage };
    }

    // Log what the LLM wants to do
    const toolNames = response.toolCalls.map(tc => tc.name);
    log.info('Tool calls requested', { agentId, iteration, tools: toolNames });

    // Append assistant message
    messages.push({
      role: 'assistant',
      content: response.content,
      toolCalls: response.toolCalls,
    });

    // Emit tool_use status before execution
    eventBus?.emit('agent:status', { agentId: evAgentId, chatId: evChatId, status: 'tool_use', contextTokens, maxContextTokens });

    // Execute tool calls in parallel
    const toolResults = await Promise.all(
      response.toolCalls.map(async (tc) => {
        const argSummary = summarizeArgs(tc.name, tc.arguments);
        log.info('Tool executing', { agentId, tool: tc.name, ...argSummary });

        // Emit tool:pending before the before-hook
        eventBus?.emit('tool:pending', {
          agentId: evAgentId, chatId: evChatId,
          toolCallId: tc.id, toolName: tc.name, args: tc.arguments,
        });

        // Before hook (blocking)
        const hookResult = await hooks.runBefore(tc.name, tc.arguments, ctx);

        let result: ToolResult;
        if (!hookResult.proceed) {
          if (hookResult.rejected) {
            const feedback = hookResult.feedback
              ? `User rejected this approach: ${hookResult.feedback}`
              : `User rejected this tool call. Try a different approach.`;
            result = errorResult(feedback);
            log.info('Tool rejected by user', { agentId, tool: tc.name, feedback: hookResult.feedback });
          } else {
            result = errorResult(`Tool call blocked by policy: ${tc.name}`);
            log.warn('Tool blocked', { agentId, tool: tc.name });
          }
          eventBus?.emit('tool:completed', {
            agentId: evAgentId, chatId: evChatId,
            toolCallId: tc.id, toolName: tc.name, args: tc.arguments,
            isError: true, durationMs: 0,
          });
        } else {
          // Emit tool:started after hook passes
          eventBus?.emit('tool:started', {
            agentId: evAgentId, chatId: evChatId,
            toolCallId: tc.id, toolName: tc.name, args: hookResult.args,
          });

          const start = Date.now();
          result = await tools.execute(ctx, tc.name, hookResult.args);
          const durationMs = Date.now() - start;
          log.info('Tool completed', {
            agentId,
            tool: tc.name,
            durationMs,
            isError: result.isError,
            resultLength: result.forLLM.length,
            ...(result.isError ? { error: result.forLLM.slice(0, 200) } : {}),
          });

          eventBus?.emit('tool:completed', {
            agentId: evAgentId, chatId: evChatId,
            toolCallId: tc.id, toolName: tc.name, args: hookResult.args,
            isError: result.isError, durationMs,
          });
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

    // Emit thinking status before next iteration (estimate since we added tool results)
    const updatedContextTokens = contextTokens + toolResults.reduce((sum, { result }) => sum + Math.ceil(result.forLLM.length / 4), 0);
    eventBus?.emit('agent:status', { agentId: evAgentId, chatId: evChatId, status: 'thinking', contextTokens: updatedContextTokens, maxContextTokens });
  }

  log.warn('Max iterations reached', { agentId: ctx.currentAgentConfig.name, maxIterations, totalTokens });
  eventBus?.emit('agent:status', { agentId: evAgentId, chatId: evChatId, status: 'idle', contextTokens, maxContextTokens });
  const usage = { inputTokens, outputTokens, cacheReadTokens: cacheReadTokens > 0 ? cacheReadTokens : undefined, cacheWriteTokens: cacheWriteTokens > 0 ? cacheWriteTokens : undefined };
  return {
    content: 'Reached maximum iterations without a final response.',
    iterations: iteration,
    toolsUsed,
    totalTokens,
    usage,
  };
}

function summarizeArgs(toolName: string, args: Record<string, unknown>): Record<string, unknown> {
  switch (toolName) {
    case 'exec':
      return { command: args.command };
    case 'read_file':
    case 'write_file':
    case 'edit_file':
    case 'list_dir':
      return { path: args.path };
    case 'search':
      return { pattern: args.pattern, path: args.path };
    case 'web_fetch':
      return { url: args.url };
    case 'spawn':
      return { task: (args.task as string)?.slice(0, 100), agentId: args.agentId };
    case 'message':
      return { channel: args.channel, chatId: args.chatId };
    default:
      return {};
  }
}
