#!/usr/bin/env node

import * as path from 'node:path';
import * as readline from 'node:readline';
import { getConfigDir, encryptConfigSecrets, loadInstanceConfig } from './config/config.js';
import { setLogLevel, createLogger } from './logging.js';
import { SecretStore } from './security/secrets.js';
import { UserRuleStore } from './security/user-rules.js';
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
import { webSearchExaTool } from './tools/builtin/web-search-exa.js';
import { spawnTool, setAgentLoopFn } from './tools/builtin/spawn.js';
import { configExplainTool } from './tools/builtin/config-explain.js';
import { createConfigGetTool } from './tools/builtin/config-get.js';
import { createConfigSetTool } from './tools/builtin/config-set.js';
import { ConfigManager } from './config/manager.js';
import { runAgentLoop } from './agent/loop.js';
import { buildSystemPrompt } from './agent/context.js';
import { loadSession, saveSession, clearSession } from './agent/session.js';
import { normalizeMessages } from './agent/normalize-messages.js';
import { type McpClient, createMcpTools } from './mcp/index.js';
import type { SkillDef } from './skills/types.js';
import type { ToolContext } from './tools/types.js';
import { parseSlashCommand } from './commands/slash.js';
import { handleConfig, handleNew, handleSkill } from './commands/handlers.js';
import { setColorsEnabled, dim, bold, green, cyan, boldYellow, boldCyan, boldRed, boldGreen } from './cli/colors.js';
import { runTokenCommand } from './cli/token-cmd.js';
import { runInitCommand } from './commands/init.js';
import { discoverAgentDir, loadAgentDirConfig } from './config/agent-loader.js';
import { createAgentRuntime } from './config/agent-runtime-factory.js';
import type { AgentRuntime } from './config/agent-runtime.js';

const log = createLogger('cli');

// Shared readline instance — set by runRepl, used by cliApproval
let replRl: readline.Interface | null = null;

function parseArgs(argv: string[]): { prompt?: string; sessionId?: string; noColor?: boolean; agentDir?: string } {
  const args = argv.slice(2);
  let prompt: string | undefined;
  let sessionId: string | undefined;
  let noColor: boolean | undefined;
  let agentDir: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '-p' || args[i] === '--prompt') && i + 1 < args.length) {
      prompt = args[i + 1];
      i++;
    } else if ((args[i] === '-s' || args[i] === '--session') && i + 1 < args.length) {
      sessionId = args[i + 1];
      i++;
    } else if (args[i] === '--no-color') {
      noColor = true;
    } else if ((args[i] === '-a' || args[i] === '--agent') && i + 1 < args.length) {
      agentDir = args[i + 1];
      i++;
    }
  }

  return { prompt, sessionId, noColor, agentDir };
}

interface CliApprovalResult {
  proceed: boolean;
  scope?: 'session' | 'day' | 'always';
  denyAlways?: boolean;
  rejected?: boolean;
  feedback?: string;
}

function cliApproval(toolName: string, args: Record<string, unknown>): Promise<CliApprovalResult> {
  return new Promise((resolve) => {
    const argSummary = args.command ? ` "${args.command}"` : args.path ? ` "${args.path}"` : '';
    process.stdout.write(boldYellow(`\n[approval] ${toolName}${argSummary}\n`));
    process.stdout.write(boldYellow(`  [y]es  [s]ession  [d]ay  [p]ermanent  [n]o  [!]never  [r]eject: `));

    const handleAnswer = (answer: string) => {
      const a = answer.trim().toLowerCase();
      switch (a) {
        case 'y': case 'yes':
          resolve({ proceed: true });
          break;
        case 's': case 'session':
          resolve({ proceed: true, scope: 'session' });
          break;
        case 'd': case 'day':
          resolve({ proceed: true, scope: 'day' });
          break;
        case 'p': case 'permanent':
          resolve({ proceed: true, scope: 'always' });
          break;
        case '!': case 'never':
          resolve({ proceed: false, denyAlways: true });
          break;
        case 'r': case 'reject':
          // Ask for optional feedback
          process.stdout.write(boldYellow('  Feedback (optional, press Enter to skip): '));
          const handleFeedback = (fb: string) => {
            resolve({ proceed: false, rejected: true, feedback: fb.trim() || undefined });
          };
          if (replRl) {
            replRl.once('line', handleFeedback);
          } else {
            const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
            rl2.once('line', (fb: string) => { rl2.close(); handleFeedback(fb); });
          }
          break;
        default:
          resolve({ proceed: false });
      }
    };

    if (replRl) {
      replRl.once('line', handleAnswer);
    } else {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.once('line', (answer: string) => {
        rl.close();
        handleAnswer(answer);
      });
    }
  });
}

// Simple approval for config_set (unchanged behavior)
function cliSimpleApproval(toolName: string, args: Record<string, unknown>): Promise<boolean> {
  return cliApproval(toolName, args).then(r => r.proceed);
}

async function main() {
  // Dispatch subcommands before entering REPL
  if (process.argv[2] === 'token') {
    await runTokenCommand(process.argv.slice(3));
    return;
  }
  if (process.argv[2] === 'init') {
    runInitCommand(process.argv[3]);
    return;
  }

  const cliArgs = parseArgs(process.argv);
  const headless = cliArgs.prompt !== undefined;

  if (cliArgs.noColor || process.env.NO_COLOR !== undefined || !process.stdout.isTTY) {
    setColorsEnabled(false);
  }

  const configDir = getConfigDir();

  // Agent directory discovery: --agent flag > walk-up from cwd
  let agentRuntime: AgentRuntime | undefined;
  let agentDirPath: string | undefined;

  if (cliArgs.agentDir) {
    agentDirPath = path.resolve(cliArgs.agentDir);
  } else {
    agentDirPath = discoverAgentDir(process.cwd()) ?? undefined;
  }

  // Load instance config + resolve agent
  const instanceConfig = loadInstanceConfig();
  setLogLevel(headless ? 'error' : instanceConfig.monitoring.logLevel);
  log.info('BearClaw CLI starting');

  // Initialize secrets and encrypt any plaintext keys
  const secrets = new SecretStore(configDir, instanceConfig.security.encrypt);
  if (instanceConfig.security.encrypt) {
    encryptConfigSecrets(instanceConfig, (v) => secrets.encrypt(v), SecretStore.isEncrypted);
  }

  if (agentDirPath) {
    // Agent directory mode: load agent config + merge with instance
    const agentDirInfo = loadAgentDirConfig(agentDirPath);
    agentRuntime = await createAgentRuntime({
      agentDir: agentDirInfo,
      instanceConfig,
      configDir,
    });
    log.info('Using agent directory', { dir: agentDirPath, name: agentRuntime.name });
  } else {
    console.error(boldRed('No agent directory found. Use --agent or run within a directory containing bearclaw.jsonc.'));
    process.exit(1);
  }

  if (!agentRuntime) {
    console.error(boldRed('Agent runtime failed to initialize.'));
    process.exit(1);
  }

  // Use runtime values only
  const effectiveConfig = agentRuntime.resolvedConfig;
  const policy = agentRuntime.policy;
  const policyEngine = agentRuntime.policyEngine;
  const userRuleStore = new UserRuleStore(configDir);
  policyEngine.setUserRules(userRuleStore.toPolicyRules());

  const syncUserRules = () => {
    policyEngine.setUserRules(userRuleStore.toPolicyRules());
  };

  const approvalManager = new ApprovalManager(
    effectiveConfig.policy.approvalScope,
    effectiveConfig.policy.approvals.defaultTTLSeconds,
    effectiveConfig.policy.approvals.cache,
  );
  const inlineAllowStore = agentRuntime.inlineAllowStore;

  // Initialize providers
  function createProvider(name: string): LLMProvider {
    switch (name) {
      case 'anthropic': {
        const cfg = effectiveConfig.providers.anthropic;
        if (!cfg) throw new Error('Anthropic provider not configured');
        const key = secrets.decrypt(cfg.apiKey);
        return new AnthropicProvider(key, cfg.defaultModel);
      }
      case 'openai': {
        const cfg = effectiveConfig.providers.openai;
        if (!cfg) throw new Error('OpenAI provider not configured');
        const key = secrets.decrypt(cfg.apiKey);
        return new OpenAIProvider(key, cfg.defaultModel);
      }
      case 'ollama': {
        const cfg = effectiveConfig.providers.ollama;
        if (!cfg) throw new Error('Ollama provider not configured');
        return new OllamaProvider(cfg.baseUrl, cfg.defaultModel);
      }
      case 'cli-delegation': {
        const cfg = effectiveConfig.providers.cliDelegation;
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
  toolRegistry.register(webSearchExaTool);
  toolRegistry.register(spawnTool);

  // Wire up spawn tool
  setAgentLoopFn(runAgentLoop);

  // Config tools (hidden until /config is invoked)
  const configManager = new ConfigManager(instanceConfig, agentRuntime.dir);
  toolRegistry.registerHidden(configExplainTool);
  toolRegistry.registerHidden(createConfigGetTool(configManager));
  toolRegistry.registerHidden(createConfigSetTool(configManager, () => cliSimpleApproval('config_set', {})));

  // Load skills
  const skills = agentRuntime.skills;

  // MCP clients (agent-level only) — register tools into shared registry
  const mcpClients: McpClient[] = [...agentRuntime.mcpClients];
  {
    const agentMcpServers = agentRuntime.agentDir?.config.mcp?.servers ?? {};
    let clientIdx = 0;
    for (const [name] of Object.entries(agentMcpServers)) {
      const client = mcpClients[clientIdx++];
      if (client) {
        for (const tool of await createMcpTools(name, client)) {
          toolRegistry.register(tool);
        }
      }
    }
  }

  // Initialize hooks
  const hooks = new ToolHookRegistryImpl();

  // PolicyEngine as first before-hook
  hooks.registerBefore(async (toolName, args, ctx) => {
    const scope = toolName === 'exec' ? 'exec' as const
      : toolName === 'web_fetch' || toolName === 'web_search_exa' ? 'web' as const
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
      const result = await cliApproval(toolName, args);
      if (result.rejected) {
        return { proceed: false, args, rejected: true, feedback: result.feedback };
      }
      if (!result.proceed) {
        if (result.denyAlways) {
          userRuleStore.addRule({ action: 'deny', toolName, agentId: ctx.currentAgentConfig.name, createdBy: 'cli' });
          syncUserRules();
        }
        return { proceed: false, args };
      }
      // Register durable scope if requested
      if (result.scope === 'always') {
        userRuleStore.addRule({ action: 'allow', toolName, agentId: ctx.currentAgentConfig.name, createdBy: 'cli' });
        syncUserRules();
      } else if (result.scope) {
        inlineAllowStore.addAllow(toolName, result.scope);
      }
    }

    return { proceed: true, args };
  });

  // Resolve agent config
  const agentId = agentRuntime.name;
  const agentConfig = agentRuntime.primaryAgentConfig;

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
    agentConfigs: agentRuntime.agentConfigs,
    currentAgentConfig: agentConfig,
    providerFactory: createProvider,
  };

  function makeCtx(): ToolContext {
    return { ...baseCtx, signal: AbortSignal.timeout(600_000) };
  }

  // Build system prompt (resolve paths relative to agent dir when available)
  const systemPrompt = buildSystemPrompt(agentConfig, effectiveConfig, toolRegistry, undefined, skills, agentRuntime.dir);

  const sessionsDir = agentRuntime.sessionsDir;
  const workspacePath = agentRuntime.workspacePath;

  if (headless) {
    await runHeadless(cliArgs.prompt!, cliArgs.sessionId, systemPrompt, sessionsDir, agentId, provider, model, toolRegistry, hooks, agentConfig, makeCtx, skills, mcpClients);
  } else {
    await runRepl(systemPrompt, sessionsDir, agentId, provider, model, toolRegistry, hooks, agentConfig, makeCtx, skills, mcpClients, inlineAllowStore, workspacePath, agentRuntime);
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
  const normalizedHeadless = sessionId
    ? normalizeMessages(loadSession(sessionsDir, agentId, 'cli', chatId))
    : { messages: [], droppedToolMessages: 0, droppedToolCalls: 0 };
  const messages: Message[] = normalizedHeadless.messages;
  if (normalizedHeadless.droppedToolMessages > 0 || normalizedHeadless.droppedToolCalls > 0) {
    console.warn('[warn] Session normalization removed incomplete tool artifacts.');
  }

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
  agentRuntimeInfo?: AgentRuntime,
): Promise<void> {
  // Load session
  const normalizedRepl = normalizeMessages(loadSession(sessionsDir, agentId, 'cli', 'repl'));
  const messages: Message[] = normalizedRepl.messages;
  if (normalizedRepl.droppedToolMessages > 0 || normalizedRepl.droppedToolCalls > 0) {
    console.warn('[warn] Session normalization removed incomplete tool artifacts.');
  }

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
  if (agentRuntimeInfo) {
    console.log(cyan(`Agent dir: ${agentRuntimeInfo.dir}`));
  }
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

      // CLI-only commands
      if (trimmed === '/agent') {
        if (agentRuntimeInfo) {
          console.log(bold('Current agent:'));
          console.log(`  Name: ${agentRuntimeInfo.name}`);
          console.log(`  Dir:  ${agentRuntimeInfo.dir}`);
          console.log(`  Workspace: ${agentRuntimeInfo.workspacePath}`);
        } else {
          console.log(`Agent: ${agentConfig.name}`);
        }
        console.log('');
        return prompt();
      }

      if (trimmed === '/help') {
        const lines = [
          bold('Commands:'),
          `  ${bold('/new')}     — Clear conversation and start fresh`,
          `  ${bold('/agent')}   — Show current agent info`,
          `  ${bold('/config')}  — Enter configuration mode`,
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

      // Shared slash commands
      const slashCmd = parseSlashCommand(trimmed, skills);
      if (slashCmd) {
        if (slashCmd.type === 'new') {
          const result = handleNew();
          clearSession(sessionsDir, agentId, 'cli', 'repl');
          messages.length = 0;
          if (systemPrompt) {
            messages.push({ role: 'system', content: systemPrompt });
          }
          toolRegistry.setHidden('config_explain', true);
          toolRegistry.setHidden('config_get', true);
          toolRegistry.setHidden('config_set', true);
          console.log((result.action === 'immediate' ? result.response : 'Session cleared.') + '\n');
          return prompt();
        }

        if (slashCmd.type === 'config') {
          toolRegistry.setHidden('config_explain', false);
          toolRegistry.setHidden('config_get', false);
          toolRegistry.setHidden('config_set', false);

          const result = handleConfig(slashCmd.args);
          if (result.action === 'inject') {
            messages.push(...result.messages);
            console.log(green('Configuration mode activated.\n'));

            if (slashCmd.args) {
              try {
                const agentResult = await runAgentLoop(
                  { provider, model, tools: toolRegistry, hooks, maxIterations: agentConfig.maxIterations ?? 25, maxTotalTokens: agentConfig.maxTotalTokens, options: { onToken: (t: string) => process.stdout.write(t) } },
                  messages,
                  makeCtx(),
                );
                process.stdout.write('\n\n');
                for (const tu of agentResult.toolsUsed) {
                  if (tu.result.forUser) {
                    console.log(green(`[${tu.name}] ${tu.result.forUser.slice(0, 200)}`));
                  }
                }
                messages.push({ role: 'assistant', content: agentResult.content });
              } catch (err) {
                console.error(boldRed(`\nError: ${(err as Error).message}`));
              }
            }
          }
          return prompt();
        }

        if (slashCmd.type === 'skill') {
          const result = handleSkill(slashCmd.skill, slashCmd.args);
          if (result.action === 'inject') {
            messages.push(...result.messages);
            console.log(green(`Skill "${slashCmd.name}" activated.\n`));

            if (slashCmd.args) {
              try {
                const agentResult = await runAgentLoop(
                  { provider, model, tools: toolRegistry, hooks, maxIterations: agentConfig.maxIterations ?? 25, maxTotalTokens: agentConfig.maxTotalTokens, options: { onToken: (t: string) => process.stdout.write(t) } },
                  messages,
                  makeCtx(),
                );
                process.stdout.write('\n\n');
                for (const tu of agentResult.toolsUsed) {
                  if (tu.result.forUser) {
                    console.log(green(`[${tu.name}] ${tu.result.forUser.slice(0, 200)}`));
                  }
                }
                messages.push({ role: 'assistant', content: agentResult.content });
              } catch (err) {
                console.error(boldRed(`\nError: ${(err as Error).message}`));
              }
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

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
