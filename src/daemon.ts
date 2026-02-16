#!/usr/bin/env node

import * as path from 'node:path';
import { loadConfig, getConfigDir, encryptConfigSecrets } from './config/config.js';
import { setLogLevel, createLogger } from './logging.js';
import { EventBus } from './events.js';
import { SecretStore } from './security/secrets.js';
import { SecurityPolicy } from './security/policy.js';
import { ScopedRateLimiter } from './security/rate-limiter.js';
import { PolicyEngine } from './security/policy-engine.js';
import { ApprovalManager } from './security/approvals.js';
import { InlineAllowStore } from './security/inline-allow.js';
import { PairingGuard } from './security/pairing.js';
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
import { messageTool, setPublishOutbound } from './tools/builtin/message.js';
import { runAgentLoop } from './agent/loop.js';
import { buildSystemPrompt } from './agent/context.js';
import { loadSession, saveSession, clearSession } from './agent/session.js';
import { loadSkills } from './skills/index.js';
import { McpClient, createMcpTools } from './mcp/index.js';
import { MessageBus } from './bus/bus.js';
import { CliChannel } from './channels/cli.js';
import { TelegramChannel } from './channels/telegram.js';
import type { Channel } from './channels/types.js';
import { ConversationTracker } from './orchestrator/conversation.js';
import { routeMessage } from './orchestrator/router.js';
import { parseMentions, validateMentions } from './orchestrator/mentions.js';
import { resolveTeam } from './orchestrator/team.js';
import { GatewayServer } from './gateway/server.js';
import { Scheduler } from './scheduler/index.js';

const log = createLogger('daemon');

async function main() {
  const config = loadConfig();
  const configDir = getConfigDir();
  setLogLevel(config.monitoring.logLevel);

  log.info('BearClaw daemon starting');

  // 1. Initialize secrets and encrypt any plaintext keys
  const secrets = new SecretStore(configDir, config.security.encrypt);
  if (config.security.encrypt) {
    encryptConfigSecrets(config, (v) => secrets.encrypt(v), SecretStore.isEncrypted);
  }

  // 2. Initialize security
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
  const pairing = new PairingGuard(configDir, secrets);

  // 3. Event bus
  const eventBus = new EventBus();

  // 4. Providers
  function createProvider(name: string): LLMProvider {
    switch (name) {
      case 'anthropic': {
        const cfg = config.providers.anthropic;
        if (!cfg) throw new Error('Anthropic provider not configured');
        return new AnthropicProvider(secrets.decrypt(cfg.apiKey), cfg.defaultModel);
      }
      case 'openai': {
        const cfg = config.providers.openai;
        if (!cfg) throw new Error('OpenAI provider not configured');
        return new OpenAIProvider(secrets.decrypt(cfg.apiKey), cfg.defaultModel);
      }
      case 'ollama': {
        const cfg = config.providers.ollama;
        if (!cfg) throw new Error('Ollama provider not configured');
        return new OllamaProvider(cfg.baseUrl, cfg.defaultModel);
      }
      case 'cli-delegation': {
        const cfg = config.providers.cliDelegation;
        if (!cfg) throw new Error('CLI delegation provider not configured');
        log.warn('CLI delegation bypasses BearClaw security model');
        return new CliDelegationProvider(cfg);
      }
      default:
        throw new Error(`Unknown provider: ${name}`);
    }
  }

  // 5. Tools
  const toolRegistry = new ToolRegistryImpl();
  toolRegistry.register(readFileTool);
  toolRegistry.register(writeFileTool);
  toolRegistry.register(editFileTool);
  toolRegistry.register(listDirTool);
  toolRegistry.register(searchTool);
  toolRegistry.register(execTool);
  toolRegistry.register(webFetchTool);
  toolRegistry.register(spawnTool);
  toolRegistry.register(messageTool);

  // Wire spawn and message
  setAgentLoopFn(runAgentLoop);

  // 5b. Load skills (workspace takes precedence over user-level)
  const skills = loadSkills(path.resolve(config.workspace.path), configDir);

  // 5c. Start MCP servers
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

  // 6. Hooks
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
      channel: ctx.channel,
    });

    if (decision.action === 'deny') {
      return { proceed: false, args };
    }

    if (decision.action === 'approve') {
      // Check inline allows first
      if (inlineAllowStore.isAllowed(toolName)) {
        return { proceed: true, args };
      }
      // Otherwise need manual approval (for now, auto-approve in daemon mode)
      policyEngine.suggestRule({
        toolName,
        scope,
        command: args.command as string | undefined,
        agentId: ctx.currentAgentConfig.name,
      }, 'allow');
    }

    return { proceed: true, args };
  });

  // 7. Message bus
  const bus = new MessageBus();
  setPublishOutbound((msg) => bus.publishOutbound(msg));

  // 8. Channels
  const channels: Channel[] = [];

  // Clear all agent sessions for a given channel + chatId
  const clearAllAgentSessions = (channelName: string, chatId: string) => {
    for (const id of Object.keys(config.agents)) {
      clearSession(sessionsDir, id, channelName, chatId);
    }
    log.info('Sessions cleared', { channel: channelName, chatId });
  };

  if (config.channels.enabled.includes('cli')) {
    channels.push(new CliChannel({
      onClearSession: (chatId) => clearAllAgentSessions('cli', chatId),
    }));
  }
  if (config.channels.enabled.includes('telegram') && config.channels.telegram) {
    const tg = config.channels.telegram;
    channels.push(new TelegramChannel(secrets.decrypt(tg.botToken), tg.allowFrom, {
      onClearSession: (chatId) => clearAllAgentSessions('telegram', chatId),
    }));
  }

  for (const channel of channels) {
    await channel.start(bus);
  }

  // 9. Conversation tracker
  const conversationTracker = new ConversationTracker();
  conversationTracker.start();

  // 10. Gateway
  if (config.gateway.enabled) {
    const gateway = new GatewayServer(config.gateway, bus, pairing);
    await gateway.start();
  }

  // 11. Scheduler
  const abortController = new AbortController();
  if (config.schedules.length > 0) {
    const scheduler = new Scheduler(config.schedules, bus, abortController.signal);
    scheduler.start();
    log.info('Scheduler started', { rules: config.schedules.length });
  }

  // Main loop
  const sessionsDir = path.join(configDir, 'sessions');

  // Inbound processing
  const inboundLoop = async () => {
    while (!abortController.signal.aborted) {
      let inbound;
      try {
        inbound = await bus.consumeInbound(abortController.signal);
      } catch {
        break;
      }

      const { channel, sender, chatId, message } = inbound;
      log.info('Inbound message', { channel, sender, chatId, length: message.length });

      // Parse inline allows
      const cleaned = inlineAllowStore.parseAndStore(message);

      // Route message
      const route = routeMessage(cleaned, config.agents, config.teams);

      if (route.type === 'team') {
        // Team routing
        const teamInfo = resolveTeam(route.teamId!, config.teams, config.agents);
        if (!teamInfo) {
          bus.publishOutbound({ channel, chatId, content: `Unknown team: ${route.teamId}` });
          continue;
        }

        const convId = `conv_${Date.now()}`;
        conversationTracker.create(convId, channel, chatId, (aggregated) => {
          bus.publishOutbound({ channel, chatId, content: aggregated, conversationId: convId });
        });

        // Route to leader
        processAgentMessage(
          teamInfo.leaderAgent.name,
          route.message,
          channel,
          chatId,
          sender,
          convId,
        );
      } else {
        // Direct agent routing
        processAgentMessage(
          route.agentId!,
          route.message,
          channel,
          chatId,
          sender,
        );
      }
    }
  };

  async function processAgentMessage(
    agentId: string,
    message: string,
    channel: string,
    chatId: string,
    sender: string,
    conversationId?: string,
  ) {
    const agentConfig = config.agents[agentId];
    if (!agentConfig) {
      bus.publishOutbound({ channel, chatId, content: `Unknown agent: ${agentId}` });
      return;
    }

    const provider = createProvider(agentConfig.provider);
    const model = agentConfig.model ?? provider.defaultModel;
    log.info('Processing message', { agentId, provider: agentConfig.provider, model, channel });

    const ctx = {
      signal: abortController.signal,
      channel,
      chatId,
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

    // Load session and build context (always refresh system prompt)
    const messages = loadSession(sessionsDir, agentId, channel, chatId);
    const systemPrompt = buildSystemPrompt(agentConfig, config, toolRegistry, undefined, skills);
    if (systemPrompt) {
      if (messages.length > 0 && messages[0].role === 'system') {
        messages[0].content = systemPrompt;
      } else {
        messages.unshift({ role: 'system', content: systemPrompt });
      }
    }

    messages.push({ role: 'user', content: message });

    try {
      const result = await runAgentLoop(
        {
          provider,
          model,
          tools: toolRegistry,
          hooks,
          maxIterations: agentConfig.maxIterations ?? 25,
          maxTotalTokens: agentConfig.maxTotalTokens,
        },
        messages,
        ctx,
      );

      messages.push({ role: 'assistant', content: result.content });
      saveSession(sessionsDir, agentId, channel, chatId, messages);
      log.info('Agent responded', { agentId, channel, iterations: result.iterations, toolCalls: result.toolsUsed.length });

      eventBus.emit('agent:stopped', { agentId, reason: 'completed' });

      // Parse mentions for multi-agent handoff
      const { mentions } = parseMentions(result.content);
      if (mentions.length > 0 && conversationId) {
        const conv = conversationTracker.get(conversationId);
        if (conv) {
          const validAgents = Object.keys(config.agents);
          const { valid } = validateMentions(mentions, validAgents);

          if (valid.length > 0) {
            conversationTracker.fanOut(conversationId, valid.length);
            for (const m of valid) {
              for (const targetAgent of m.agents) {
                processAgentMessage(targetAgent, m.message, channel, chatId, agentId, conversationId);
              }
            }
          }
        }
      }

      if (conversationId) {
        conversationTracker.branchComplete(conversationId, agentId, result.content);
      } else {
        bus.publishOutbound({
          channel,
          chatId,
          content: result.content,
          agentId,
        });
      }
    } catch (err) {
      log.error('Agent error', { agentId, error: String(err) });
      bus.publishOutbound({
        channel,
        chatId,
        content: `Error from ${agentId}: ${(err as Error).message}`,
        agentId,
      });
    }
  }

  // Outbound processing
  const outboundLoop = async () => {
    while (!abortController.signal.aborted) {
      let outbound;
      try {
        outbound = await bus.consumeOutbound(abortController.signal);
      } catch {
        break;
      }

      const channel = channels.find(c => c.name === outbound.channel);
      if (channel) {
        try {
          await channel.send(outbound);
        } catch (err) {
          log.error('Send error', { channel: outbound.channel, error: String(err) });
        }
      }
    }
  };

  // Graceful shutdown
  const shutdown = async () => {
    log.info('Shutting down...');
    abortController.abort();
    conversationTracker.stop();
    await hooks.flush();
    for (const client of mcpClients) {
      await client.stop();
    }
    for (const channel of channels) {
      await channel.stop();
    }
    log.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  log.info('BearClaw daemon started', {
    agents: Object.keys(config.agents),
    channels: config.channels.enabled,
    schedules: config.schedules.length,
  });

  // Start loops
  await Promise.all([inboundLoop(), outboundLoop()]);
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
