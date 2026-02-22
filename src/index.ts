#!/usr/bin/env node

import * as path from 'node:path';
import * as readline from 'node:readline';
import { loadConfig, getConfigDir, encryptConfigSecrets, loadInstanceConfig } from './config/config.js';
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
import { configExplainTool } from './tools/builtin/config-explain.js';
import { createConfigGetTool } from './tools/builtin/config-get.js';
import { createConfigSetTool } from './tools/builtin/config-set.js';
import { ConfigManager } from './config/manager.js';
import { runAgentLoop } from './agent/loop.js';
import { buildSystemPrompt } from './agent/context.js';
import { loadSession, saveSession, clearSession } from './agent/session.js';
import { loadSkills } from './skills/index.js';
import { McpClient, createMcpTools } from './mcp/index.js';
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

  // Agent directory discovery: --agent flag > walk-up from cwd > fallback to legacy config
  let agentRuntime: AgentRuntime | undefined;
  let agentDirPath: string | undefined;

  if (cliArgs.agentDir) {
    agentDirPath = path.resolve(cliArgs.agentDir);
  } else {
    agentDirPath = discoverAgentDir(process.cwd()) ?? undefined;
  }

  // Load instance config + resolve agent
  const config = loadConfig();
  setLogLevel(headless ? 'error' : config.monitoring.logLevel);
  log.info('BearClaw CLI starting');

  // Initialize secrets and encrypt any plaintext keys
  const secrets = new SecretStore(configDir, config.security.encrypt);
  if (config.security.encrypt) {
    encryptConfigSecrets(config, (v) => secrets.encrypt(v), SecretStore.isEncrypted);
  }

  if (agentDirPath) {
    // Agent directory mode: load agent config + merge with instance
    const instanceConfig = loadInstanceConfig();
    const agentDirInfo = loadAgentDirConfig(agentDirPath);
    agentRuntime = await createAgentRuntime({
      agentDir: agentDirInfo,
      instanceConfig,
      configDir,
    });
    log.info('Using agent directory', { dir: agentDirPath, name: agentRuntime.name });
  }

  // Use runtime values or fall back to legacy config
  const effectiveConfig = agentRuntime?.resolvedConfig ?? config;
  const policy = agentRuntime?.policy ?? (() => {
    const rateLimiter = new ScopedRateLimiter(config.security.rateLimits);
    return new SecurityPolicy(
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
  })();
  const policyEngine = agentRuntime?.policyEngine ?? new PolicyEngine(config.policy, configDir);
  const approvalManager = new ApprovalManager(
    effectiveConfig.policy.approvalScope,
    effectiveConfig.policy.approvals.defaultTTLSeconds,
    effectiveConfig.policy.approvals.cache,
  );
  const inlineAllowStore = agentRuntime?.inlineAllowStore ?? new InlineAllowStore(
    config.policy.inlineAllow.enabled,
    config.policy.inlineAllow.dayScopeHours,
  );

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
  toolRegistry.register(spawnTool);

  // Wire up spawn tool
  setAgentLoopFn(runAgentLoop);

  // Config tools (hidden until /config is invoked)
  const configManager = new ConfigManager(config, agentRuntime?.dir);
  toolRegistry.registerHidden(configExplainTool);
  toolRegistry.registerHidden(createConfigGetTool(configManager));
  toolRegistry.registerHidden(createConfigSetTool(configManager, () => cliApproval('config_set', {})));

  // Reload security objects when config changes (legacy mode only)
  configManager.onReload((newConfig) => {
    if (!agentRuntime) {
      const newRateLimiter = new ScopedRateLimiter(newConfig.security.rateLimits);
      const newPolicy = new SecurityPolicy(
        newConfig.security.autonomy,
        path.resolve(newConfig.workspace.path),
        newConfig.security.workspaceOnly,
        newConfig.security.allowedCommands,
        newConfig.security.restrictedCommands,
        newConfig.security.forbiddenPaths,
        newConfig.security.allowedPaths,
        newRateLimiter,
        newConfig.security.allowSubshells,
      );
      const newPolicyEngine = new PolicyEngine(newConfig.policy, configDir);
      baseCtx.policy = newPolicy;
      baseCtx.policyEngine = newPolicyEngine;
    }
  });

  // Load skills
  const skills = agentRuntime?.skills ?? loadSkills(path.resolve(config.workspace.path), configDir);

  // Start MCP servers (instance-level; agent-level already started in createAgentRuntime)
  const mcpClients: McpClient[] = [...(agentRuntime?.mcpClients ?? [])];
  if (!agentRuntime) {
    for (const [name, serverConfig] of Object.entries(config.mcp.servers)) {
      const env = expandMcpEnv(serverConfig.env);
      const client = new McpClient(serverConfig.command, serverConfig.args ?? [], env);
      await client.start();
      mcpClients.push(client);
      for (const tool of await createMcpTools(name, client)) {
        toolRegistry.register(tool);
      }
    }
  }
  // Instance MCP servers (for agent-dir mode, load instance MCP not already loaded by agent)
  if (agentRuntime) {
    const instanceMcpServers = loadInstanceConfig().mcp?.servers ?? {};
    for (const [name, serverConfig] of Object.entries(instanceMcpServers)) {
      if (agentRuntime.resolvedConfig.mcp.servers[name]) continue;
      const env = expandMcpEnv(serverConfig.env);
      const client = new McpClient(serverConfig.command, serverConfig.args ?? [], env);
      await client.start();
      mcpClients.push(client);
      for (const tool of await createMcpTools(name, client)) {
        toolRegistry.register(tool);
      }
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

  // Resolve agent config
  const agentId = agentRuntime?.name ?? 'default';
  const agentConfig = agentRuntime?.primaryAgentConfig ?? config.agents['default'];
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
    agentConfigs: agentRuntime?.agentConfigs ?? config.agents,
    currentAgentConfig: agentConfig,
    providerFactory: createProvider,
  };

  function makeCtx(): ToolContext {
    return { ...baseCtx, signal: AbortSignal.timeout(600_000) };
  }

  // Build system prompt (resolve paths relative to agent dir when available)
  const systemPrompt = buildSystemPrompt(agentConfig, effectiveConfig, toolRegistry, undefined, skills, agentRuntime?.dir);

  const sessionsDir = agentRuntime?.sessionsDir ?? path.join(configDir, 'sessions');
  const workspacePath = agentRuntime?.workspacePath ?? path.resolve(config.workspace.path);

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
  agentRuntimeInfo?: AgentRuntime,
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
          console.log(`Agent: ${agentConfig.name} (legacy config mode)`);
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
