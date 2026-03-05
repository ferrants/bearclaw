import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import type { Tool, ToolContext, ToolResult } from '../types.js';
import { toolResult, errorResult } from '../types.js';
import { ToolRegistryImpl } from '../registry.js';
import { filterToolNames } from '../filter.js';
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
      contextFiles: {
        type: 'array',
        items: { type: 'string' },
        description: 'File paths (relative to agent directory) to read and inject as context for the subagent',
      },
      skills: {
        type: 'array',
        items: { type: 'string' },
        description: 'Skill names to activate; their instructions get injected as context messages',
      },
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
    const contextFiles = args.contextFiles as string[] | undefined;
    const skillNames = args.skills as string[] | undefined;

    // Resolve agent config
    const agentConfig = ctx.agentConfigs[agentId];
    if (!agentConfig) return errorResult(`Unknown agent: ${agentId}`);

    // Resolve provider
    const providerName = providerOverride ?? agentConfig.provider;
    const provider = ctx.providerFactory(providerName);

    // Build restricted tool registry (no spawn, no message, filtered by agent config)
    const childRegistry = new ToolRegistryImpl();
    const allNames = ctx.toolRegistry.list().filter(n => n !== 'spawn' && n !== 'message');
    const filtered = filterToolNames(allNames, agentConfig.allowedTools, agentConfig.excludeTools);
    for (const name of filtered) {
      const tool = ctx.toolRegistry.get(name);
      if (tool) childRegistry.register(tool);
    }

    // If skills request allowedTools, register those too
    if (skillNames && ctx.skills) {
      for (const skillName of skillNames) {
        const skill = ctx.skills.find(s => s.name === skillName);
        if (skill?.allowedTools) {
          for (const toolPattern of skill.allowedTools) {
            const matching = filterToolNames(ctx.toolRegistry.list(), [toolPattern]);
            for (const name of matching) {
              if (!childRegistry.get(name)) {
                const tool = ctx.toolRegistry.get(name);
                if (tool) childRegistry.register(tool);
              }
            }
          }
        }
      }
    }

    // Build system prompt with task and success criteria
    const systemPrompt = successCriteria
      ? `${task}\n\nYour task is complete when: ${successCriteria}. State whether you met the criteria and summarize what you did.`
      : task;

    const messages: Message[] = [
      { role: 'system', content: systemPrompt },
    ];

    // Inject context files before the task message
    if (contextFiles && ctx.agentDir) {
      for (const filePath of contextFiles) {
        const resolved = path.resolve(ctx.agentDir, filePath);
        // Prevent path escape outside agentDir
        if (!resolved.startsWith(ctx.agentDir + path.sep) && resolved !== ctx.agentDir) {
          return errorResult(`contextFiles path escapes agent directory: ${filePath}`);
        }
        try {
          const content = await fs.readFile(resolved, 'utf-8');
          messages.push({ role: 'user', content: `[File: ${filePath}]\n\n${content}` });
        } catch (err) {
          return errorResult(`Failed to read context file ${filePath}: ${(err as Error).message}`);
        }
      }
    } else if (contextFiles && !ctx.agentDir) {
      return errorResult('contextFiles requires agentDir in tool context');
    }

    // Inject skill instructions before the task message
    if (skillNames && ctx.skills) {
      for (const skillName of skillNames) {
        const skill = ctx.skills.find(s => s.name === skillName);
        if (!skill) {
          return errorResult(`Unknown skill: ${skillName}`);
        }
        messages.push({ role: 'user', content: `[Skill: ${skill.name}]\n\n${skill.instructions}` });
      }
    } else if (skillNames && !ctx.skills) {
      return errorResult('skills requires skills in tool context');
    }

    // Task message always comes last
    messages.push({ role: 'user', content: task });

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
