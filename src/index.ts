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

const log = createLogger('cli');

function cliApproval(toolName: string, args: Record<string, unknown>): Promise<boolean> {
  return new Promise((resolve) => {
    const argSummary = args.command ? ` "${args.command}"` : args.path ? ` "${args.path}"` : '';
    process.stdout.write(`\n[approval] Allow ${toolName}${argSummary}? (y/N) `);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.once('line', (answer: string) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}

async function main() {
  const config = loadConfig();
  const configDir = getConfigDir();
  setLogLevel(config.monitoring.logLevel);

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
    console.error('No default agent configured');
    process.exit(1);
  }

  const provider = createProvider(agentConfig.provider);
  const model = agentConfig.model ?? provider.defaultModel;

  // Build context
  const ctx = {
    signal: AbortSignal.timeout(600_000),
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

  // Build system prompt
  const systemPrompt = buildSystemPrompt(agentConfig, config, toolRegistry, undefined, skills);

  // Load session
  const sessionsDir = path.join(configDir, 'sessions');
  const messages = loadSession(sessionsDir, agentId, 'cli', 'repl');

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

  console.log('\nBearClaw CLI');
  console.log(`Agent: ${agentConfig.name} (${agentConfig.provider}/${model})`);
  console.log(`Workspace: ${path.resolve(config.workspace.path)}`);
  console.log('Type /help for commands.\n');

  const prompt = () => {
    rl.question('> ', async (input: string) => {
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
          'Commands:',
          '  /new     — Clear conversation and start fresh',
          '  /exit    — Save session and exit',
          '  /help    — Show this help',
        ];
        if (skills.length > 0) {
          lines.push('');
          lines.push('Skills:');
          for (const s of skills) {
            lines.push(`  /${s.name}  — ${s.description}`);
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
          console.log(`Skill "${skill.name}" activated.\n`);

          if (cmdArgs) {
            // If args provided, run them immediately as the next user message
            messages.push({ role: 'user', content: cmdArgs });

            try {
              const result = await runAgentLoop(
                { provider, model, tools: toolRegistry, hooks, maxIterations: agentConfig.maxIterations ?? 25, maxTotalTokens: agentConfig.maxTotalTokens, options: { onToken: (t) => process.stdout.write(t) } },
                messages,
                ctx,
              );

              process.stdout.write('\n\n');
              for (const tu of result.toolsUsed) {
                if (tu.result.forUser) {
                  console.log(`[${tu.name}] ${tu.result.forUser.slice(0, 200)}`);
                }
              }
              messages.push({ role: 'assistant', content: result.content });
            } catch (err) {
              console.error(`\nError: ${(err as Error).message}`);
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
          { provider, model, tools: toolRegistry, hooks, maxIterations: agentConfig.maxIterations ?? 25, maxTotalTokens: agentConfig.maxTotalTokens, options: { onToken: (t) => process.stdout.write(t) } },
          messages,
          ctx,
        );

        process.stdout.write('\n\n');

        // Show tool results to user
        for (const tu of result.toolsUsed) {
          if (tu.result.forUser) {
            console.log(`[${tu.name}] ${tu.result.forUser.slice(0, 200)}`);
          }
        }

        messages.push({ role: 'assistant', content: result.content });
      } catch (err) {
        console.error(`\nError: ${(err as Error).message}`);
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
