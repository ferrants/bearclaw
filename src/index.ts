#!/usr/bin/env node

import * as path from 'node:path';
import * as readline from 'node:readline';
import { loadConfig, getConfigDir, encryptConfigSecrets } from './config/config.js';
import { setLogLevel, createLogger } from './logging.js';
import { SecretStore } from './security/secrets.js';
import { SecurityPolicy } from './security/policy.js';
import { ScopedRateLimiter } from './security/rate-limiter.js';
import { PolicyEngine } from './security/policy-engine.js';
import { ApprovalManager } from './security/approvals.js';
import { InlineAllowStore } from './security/inline-allow.js';
import { AnthropicProvider } from './providers/anthropic.js';
import { OpenAIProvider } from './providers/openai.js';
import { OllamaProvider } from './providers/ollama.js';
import { CliDelegationProvider } from './providers/cli-delegation.js';
import type { LLMProvider } from './providers/types.js';
import type { Message } from './providers/types.js';
import { ToolRegistryImpl } from './tools/registry.js';
import { ToolHookRegistryImpl } from './tools/hooks.js';
import { readFileTool } from './tools/builtin/read-file.js';
import { writeFileTool } from './tools/builtin/write-file.js';
import { editFileTool } from './tools/builtin/edit-file.js';
import { listDirTool } from './tools/builtin/list-dir.js';
import { searchTool } from './tools/builtin/search.js';
import { execTool } from './tools/builtin/exec.js';
import { webFetchTool } from './tools/builtin/web-fetch.js';
import { spawnTool, setAgentLoopFn } from './tools/builtin/spawn.js';
import { runAgentLoop } from './agent/loop.js';
import { buildSystemPrompt } from './agent/context.js';
import { loadSession, saveSession, clearSession } from './agent/session.js';
import { loadSkills } from './skills/index.js';
import { McpClient, createMcpTools } from './mcp/index.js';
import type { SkillDef } from './skills/types.js';
import type { ToolContext } from './tools/types.js';
import { setColorsEnabled, dim, bold, green, cyan, boldYellow, boldCyan, boldRed, boldGreen } from './cli/colors.js';

const log = createLogger('cli');

// Shared readline instance — set by runRepl, used by cliApproval
let replRl: readline.Interface | null = null;

function parseArgs(argv: string[]): { prompt?: string; sessionId?: string; noColor?: boolean } {
  const args = argv.slice(2);
  let prompt: string | undefined;
  let sessionId: string | undefined;
  let noColor: boolean | undefined;

  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '-p' || args[i] === '--prompt') && i + 1 < args.length) {
      prompt = args[i + 1];
      i++;
    } else if ((args[i] === '-s' || args[i] === '--session') && i + 1 < args.length) {
      sessionId = args[i + 1];
      i++;
    } else if (args[i] === '--no-color') {
      noColor = true;
    }
  }

  return { prompt, sessionId, noColor };
}

function cliApproval(toolName: string, args: Record<string, unknown>): Promise<boolean> {
  return new Promise((resolve) => {
    const argSummary = args.command ? ` "${args.command}"` : args.path ? ` "${args.path}"` : '';
    process.stdout.write(boldYellow(`\n[approval] Allow ${toolName}${argSummary}? (y/N) `));

    if (replRl) {
      // Reuse the REPL's readline — no competing listeners
      replRl.once('line', (answer: string) => {
        resolve(answer.trim().toLowerCase() === 'y');
      });
    } else {
      // Fallback for non-REPL contexts (shouldn't happen, but safe)
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.once('line', (answer: string) => {
        rl.close();
        resolve(answer.trim().toLowerCase() === 'y');
      });
    }
  });
}

async function main() {
  const cliArgs = parseArgs(process.argv);
  const headless = cliArgs.prompt !== undefined;

  if (cliArgs.noColor || process.env.NO_COLOR !== undefined || !process.stdout.isTTY) {
    setColorsEnabled(false);
  }

  const config = loadConfig();
  const configDir = getConfigDir();
  setLogLevel(headless ? 'error' : config.monitoring.logLevel);

  log.info('BearClaw CLI starting');

  // Initialize secrets and encrypt any plaintext keys
  const secrets = new SecretStore(configDir, config.security.encrypt);
  if (config.security.encrypt) {
    encryptConfigSecrets(config, (v) => secrets.encrypt(v), SecretStore.isEncrypted);
  }

  // Initialize security
  const rateLimiter = new ScopedRateLimiter(config.security.rateLimits);
  const policy = new SecurityPolicy(
    config.security.autonomy,
    path.resolve(config.workspace.path),
    config.security.workspaceOnly,
    config.security.allowedCommands,
    config.security.restrictedCommands,
    config.security.forbiddenPaths,
    config.security.allowedPaths,
    rateLimiter,
    config.security.allowSubshells,
  );
  const policyEngine = new PolicyEngine(config.policy, configDir);
  const approvalManager = new ApprovalManager(
    config.policy.approvalScope,
    config.policy.approvals.defaultTTLSeconds,
    config.policy.approvals.cache,
  );
  const inlineAllowStore = new InlineAllowStore(
    config.policy.inlineAllow.enabled,
    config.policy.inlineAllow.dayScopeHours,
  );

  // Initialize providers
  function createProvider(name: string): LLMProvider {
    switch (name) {
      case 'anthropic': {
        const cfg = config.providers.anthropic;
        if (!cfg) throw new Error('Anthropic provider not configured');
        const key = secrets.decrypt(cfg.apiKey);
        return new AnthropicProvider(key, cfg.defaultModel);
      }
      case 'openai': {
        const cfg = config.providers.openai;
        if (!cfg) throw new Error('OpenAI provider not configured');
        const key = secrets.decrypt(cfg.apiKey);
        return new OpenAIProvider(key, cfg.defaultModel);
      }
      case 'ollama': {
        const cfg = config.providers.ollama;
        if (!cfg) throw new Error('Ollama provider not configured');
        return new OllamaProvider(cfg.baseUrl, cfg.defaultModel);
      }
      case 'cli-delegation': {
        const cfg = config.providers.cliDelegation;
        if (!cfg) throw new Error('CLI delegation provider not configured');
        return new CliDelegationProvider(cfg);
      }
      default:
        throw new Error(`Unknown provider: ${name}`);
    }
  }

  // Initialize tools
  const toolRegistry = new ToolRegistryImpl();
  toolRegistry.register(readFileTool);
  toolRegistry.register(writeFileTool);
  toolRegistry.register(editFileTool);
  toolRegistry.register(listDirTool);
  toolRegistry.register(searchTool);
  toolRegistry.register(execTool);
  toolRegistry.register(webFetchTool);
  toolRegistry.register(spawnTool);

  // Wire up spawn tool
  setAgentLoopFn(runAgentLoop);

  // Load skills (workspace takes precedence over user-level)
  const skills = loadSkills(path.resolve(config.workspace.path), configDir);

  // Start MCP servers
  const mcpClients: McpClient[] = [];
  for (const [name, serverConfig] of Object.entries(config.mcp.servers)) {
    const env = expandMcpEnv(serverConfig.env);
    const client = new McpClient(serverConfig.command, serverConfig.args ?? [], env);
    await client.start();
    mcpClients.push(client);
    for (const tool of await createMcpTools(name, client)) {
      toolRegistry.register(tool);
    }
  }

  // Initialize hooks
  const hooks = new ToolHookRegistryImpl();

  // PolicyEngine as first before-hook
  hooks.registerBefore(async (toolName, args, ctx) => {
    const scope = toolName === 'exec' ? 'exec' as const
      : toolName === 'web_fetch' ? 'web' as const
      : toolName === 'message' ? 'message' as const
      : 'tool' as const;

    const decision = policyEngine.evaluate({
      toolName,
      scope,
      command: args.command as string | undefined,
      agentId: ctx.currentAgentConfig.name,
    });

    if (decision.action === 'deny') {
      return { proceed: false, args };
    }

    if (decision.action === 'approve') {
      // Check inline allows first
      if (inlineAllowStore.isAllowed(toolName)) {
        return { proceed: true, args };
      }

      // Auto-approve if SecurityPolicy already validates the call
      if (toolName === 'exec' && typeof args.command === 'string') {
        if (policy.isCommandAllowed(args.command)) {
          return { proceed: true, args };
        }
      } else if (['read_file', 'write_file', 'edit_file', 'list_dir', 'search'].includes(toolName) && typeof args.path === 'string') {
        if (policy.isPathAllowed(args.path)) {
          return { proceed: true, args };
        }
      }

      if (headless) {
        // No interactive approval in headless mode — deny
        return { proceed: false, args };
      }

      // Prompt user for approval in CLI mode
      const approved = await cliApproval(toolName, args);
      if (!approved) {
        return { proceed: false, args };
      }
    }

    return { proceed: true, args };
  });

  // Resolve default agent
  const agentId = 'default';
  const agentConfig = config.agents[agentId];
  if (!agentConfig) {
    console.error(boldRed('No default agent configured'));
    process.exit(1);
  }

  const provider = createProvider(agentConfig.provider);
  const model = agentConfig.model ?? provider.defaultModel;

  // Build base context (signal added per-turn)
  const baseCtx: Omit<ToolContext, 'signal'> = {
    policy,
    policyEngine,
    approvalManager,
    inlineAllowStore,
    toolRegistry,
    hooks,
    agentConfigs: config.agents,
    currentAgentConfig: agentConfig,
    providerFactory: createProvider,
  };

  function makeCtx(): ToolContext {
    return { ...baseCtx, signal: AbortSignal.timeout(600_000) };
  }

  // Build system prompt
  const systemPrompt = buildSystemPrompt(agentConfig, config, toolRegistry, undefined, skills);

  const sessionsDir = path.join(configDir, 'sessions');

  if (headless) {
    await runHeadless(cliArgs.prompt!, cliArgs.sessionId, systemPrompt, sessionsDir, agentId, provider, model, toolRegistry, hooks, agentConfig, makeCtx, skills, mcpClients);
  } else {
    await runRepl(systemPrompt, sessionsDir, agentId, provider, model, toolRegistry, hooks, agentConfig, makeCtx, skills, mcpClients, inlineAllowStore, path.resolve(config.workspace.path));
  }
}

async function runHeadless(
  prompt: string,
  sessionId: string | undefined,
  systemPrompt: string,
  sessionsDir: string,
  agentId: string,
  provider: LLMProvider,
  model: string,
  toolRegistry: ToolRegistryImpl,
  hooks: ToolHookRegistryImpl,
  agentConfig: { maxIterations?: number; maxTotalTokens?: number },
  makeCtx: () => ToolContext,
  skills: SkillDef[],
  mcpClients: McpClient[],
): Promise<void> {
  const chatId = sessionId ?? `headless-${Date.now()}`;
  const messages: Message[] = sessionId
    ? loadSession(sessionsDir, agentId, 'cli', chatId)
    : [];

  // Set system prompt
  if (messages.length > 0 && messages[0].role === 'system') {
    messages[0].content = systemPrompt;
  } else {
    messages.unshift({ role: 'system', content: systemPrompt });
  }

  messages.push({ role: 'user', content: prompt });

  try {
    const result = await runAgentLoop(
      { provider, model, tools: toolRegistry, hooks, maxIterations: agentConfig.maxIterations ?? 25, maxTotalTokens: agentConfig.maxTotalTokens },
      messages,
      makeCtx(),
    );

    // Print just the response
    process.stdout.write(result.content + '\n');

    // Save session if using a named session
    if (sessionId) {
      messages.push({ role: 'assistant', content: result.content });
      saveSession(sessionsDir, agentId, 'cli', chatId, messages);
    }
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }

  // Cleanup
  for (const client of mcpClients) {
    await client.stop();
  }
}

async function runRepl(
  systemPrompt: string,
  sessionsDir: string,
  agentId: string,
  provider: LLMProvider,
  model: string,
  toolRegistry: ToolRegistryImpl,
  hooks: ToolHookRegistryImpl,
  agentConfig: { name: string; maxIterations?: number; maxTotalTokens?: number; provider: string },
  makeCtx: () => ToolContext,
  skills: SkillDef[],
  mcpClients: McpClient[],
  inlineAllowStore: InlineAllowStore,
  workspacePath: string,
): Promise<void> {
  // Load session
  const messages: Message[] = loadSession(sessionsDir, agentId, 'cli', 'repl');

  // Always refresh system prompt (replace if exists, insert if not)
  if (systemPrompt) {
    if (messages.length > 0 && messages[0].role === 'system') {
      messages[0].content = systemPrompt;
    } else {
      messages.unshift({ role: 'system', content: systemPrompt });
    }
  }

  // REPL
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  replRl = rl;

  console.log(boldCyan('\nBearClaw CLI'));
  console.log(cyan(`Agent: ${agentConfig.name} (${agentConfig.provider}/${model})`));
  console.log(cyan(`Workspace: ${workspacePath}`));

  // Show session context
  const nonSystemMessages = messages.filter(m => m.role !== 'system');
  if (nonSystemMessages.length > 0) {
    console.log(cyan(`Resuming session (${nonSystemMessages.length} messages). /new to start fresh.`));
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
    if (lastUser) {
      const userPreview = lastUser.content.length > 120
        ? lastUser.content.slice(0, 120) + '...'
        : lastUser.content;
      console.log(dim(`  You: ${userPreview}`));
    }
    if (lastAssistant) {
      const assistantPreview = lastAssistant.content.length > 120
        ? lastAssistant.content.slice(0, 120) + '...'
        : lastAssistant.content;
      console.log(dim(`  Agent: ${assistantPreview}`));
    }
  } else {
    console.log('New session.');
  }

  console.log('Type /help for commands.\n');

  const prompt = () => {
    rl.question(boldGreen('> '), async (input: string) => {
      const trimmed = input.trim();
      if (!trimmed) return prompt();

      if (trimmed === '/exit' || trimmed === 'quit' || trimmed === 'exit') {
        saveSession(sessionsDir, agentId, 'cli', 'repl', messages);
        for (const client of mcpClients) {
          await client.stop();
        }
        console.log('Session saved. Goodbye.');
        process.exit(0);
      }

      if (trimmed === '/new') {
        clearSession(sessionsDir, agentId, 'cli', 'repl');
        messages.length = 0;
        if (systemPrompt) {
          messages.push({ role: 'system', content: systemPrompt });
        }
        console.log('Conversation cleared.\n');
        return prompt();
      }

      if (trimmed === '/help') {
        const lines = [
          bold('Commands:'),
          `  ${bold('/new')}     — Clear conversation and start fresh`,
          `  ${bold('/exit')}    — Save session and exit`,
          `  ${bold('/help')}    — Show this help`,
        ];
        if (skills.length > 0) {
          lines.push('');
          lines.push(bold('Skills:'));
          for (const s of skills) {
            lines.push(`  ${bold('/' + s.name)}  — ${s.description}`);
          }
        }
        console.log(lines.join('\n') + '\n');
        return prompt();
      }

      // Check for skill slash command (e.g. /tmux or /tmux list sessions)
      if (trimmed.startsWith('/')) {
        const spaceIdx = trimmed.indexOf(' ');
        const cmdName = spaceIdx === -1 ? trimmed.slice(1) : trimmed.slice(1, spaceIdx);
        const cmdArgs = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1).trim();
        const skill = skills.find(s => s.name === cmdName);

        if (skill) {
          // Inject skill instructions into context
          messages.push({ role: 'user', content: `[Skill: ${skill.name}]\n\n${skill.instructions}` });
          messages.push({ role: 'assistant', content: `Skill "${skill.name}" activated. I'll follow these instructions for the rest of this conversation.` });
          console.log(green(`Skill "${skill.name}" activated.\n`));

          if (cmdArgs) {
            // If args provided, run them immediately as the next user message
            messages.push({ role: 'user', content: cmdArgs });

            try {
              const result = await runAgentLoop(
                { provider, model, tools: toolRegistry, hooks, maxIterations: agentConfig.maxIterations ?? 25, maxTotalTokens: agentConfig.maxTotalTokens, options: { onToken: (t: string) => process.stdout.write(t) } },
                messages,
                makeCtx(),
              );

              process.stdout.write('\n\n');
              for (const tu of result.toolsUsed) {
                if (tu.result.forUser) {
                  console.log(green(`[${tu.name}] ${tu.result.forUser.slice(0, 200)}`));
                }
              }
              messages.push({ role: 'assistant', content: result.content });
            } catch (err) {
              console.error(boldRed(`\nError: ${(err as Error).message}`));
            }
          }

          return prompt();
        }
      }

      // Parse inline allows
      const cleaned = inlineAllowStore.parseAndStore(trimmed);

      messages.push({ role: 'user', content: cleaned });

      try {
        const result = await runAgentLoop(
          { provider, model, tools: toolRegistry, hooks, maxIterations: agentConfig.maxIterations ?? 25, maxTotalTokens: agentConfig.maxTotalTokens, options: { onToken: (t: string) => process.stdout.write(t) } },
          messages,
          makeCtx(),
        );

        process.stdout.write('\n\n');

        // Show tool results to user
        for (const tu of result.toolsUsed) {
          if (tu.result.forUser) {
            console.log(green(`[${tu.name}] ${tu.result.forUser.slice(0, 200)}`));
          }
        }

        messages.push({ role: 'assistant', content: result.content });
      } catch (err) {
        console.error(boldRed(`\nError: ${(err as Error).message}`));
      }

      prompt();
    });
  };

  prompt();
}

function expandMcpEnv(env?: Record<string, string>): Record<string, string> | undefined {
  if (!env) return undefined;
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    result[k] = v.replace(/\$\{(\w+)\}/g, (_match, varName) => process.env[varName] ?? '');
  }
  return result;
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
