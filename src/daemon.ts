#!/usr/bin/env node

import * as path from 'node:path';
import { loadConfig, getConfigDir, encryptConfigSecrets, loadInstanceConfig } from './config/config.js';
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
import type { LLMProvider, Message } from './providers/types.js';
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
import { configExplainTool } from './tools/builtin/config-explain.js';
import { createConfigGetTool } from './tools/builtin/config-get.js';
import { createConfigSetTool } from './tools/builtin/config-set.js';
import { ConfigManager } from './config/manager.js';
import { runAgentLoop } from './agent/loop.js';
import { buildSystemPrompt } from './agent/context.js';
import { loadSession, saveSession, clearSession, listChats } from './agent/session.js';
import type { SessionProvider } from './gateway/ws-handler.js';
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
import { WsHandler } from './gateway/ws-handler.js';
import { ApprovalBridge, type ApprovalDecision } from './gateway/approval-bridge.js';
import { MentionablesProvider } from './gateway/mentionables.js';
import { Scheduler } from './scheduler/index.js';
import { parseSlashCommand } from './commands/slash.js';
import { handleConfig, handleNew, handleSkill } from './commands/handlers.js';
import type { ServerMessage_CommandResult } from './gateway/ws-protocol.js';
import { UserRuleStore } from './security/user-rules.js';
import { AgentRegistry } from './config/agent-registry.js';
import { loadAgentDirConfig, buildResolvedConfig } from './config/agent-loader.js';
import { createAgentRuntime, createDefaultAgentRuntime } from './config/agent-runtime-factory.js';
import type { AgentRuntime } from './config/agent-runtime.js';

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

  // 2. Build AgentRegistry from CLI args or legacy config
  const agentRegistry = new AgentRegistry();
  const instanceConfig = loadInstanceConfig();

  // Parse agent dirs from CLI args (e.g., bearclaw daemon ~/agents/a1 ~/agents/a2)
  const agentDirArgs = process.argv.slice(2).filter(a => !a.startsWith('-'));

  if (agentDirArgs.length > 0) {
    // Multi-agent mode: each arg is an agent directory
    for (const dirArg of agentDirArgs) {
      const agentDirInfo = loadAgentDirConfig(path.resolve(dirArg));
      const runtime = await createAgentRuntime({
        agentDir: agentDirInfo,
        instanceConfig,
        configDir,
      });
      agentRegistry.register(runtime);
      log.info('Loaded agent', { name: runtime.name, dir: runtime.dir });
    }
  } else {
    // Legacy mode: create _default runtime from config
    const defaultRuntime = await createDefaultAgentRuntime(config, configDir);
    agentRegistry.register(defaultRuntime);
    // Also register any additional agents from legacy config
    for (const [id, agentConfig] of Object.entries(config.agents)) {
      if (id === 'default' || id === '_default') continue;
      // These are sub-agents within the default runtime, not separate runtimes
    }
    log.info('Using legacy config mode');
  }

  // 3. Shared security (for legacy mode / fallback)
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
  const userRuleStore = new UserRuleStore(configDir);

  // Sync user rules into all PolicyEngine instances
  const syncUserRules = () => {
    const rules = userRuleStore.toPolicyRules();
    policyEngine.setUserRules(rules);
    for (const runtime of agentRegistry.all()) {
      runtime.policyEngine.setUserRules(rules);
    }
  };
  syncUserRules();

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

  // Load static API keys into pairing guard
  if (config.gateway.apiKeys) {
    for (const entry of config.gateway.apiKeys) {
      if (entry.key) {
        pairing.addStaticKey(entry.label, secrets.decrypt(entry.key));
      }
    }
    if (config.gateway.apiKeys.length > 0) {
      log.info('Loaded static API keys', { count: config.gateway.apiKeys.length });
    }
  }

  // 4. Event bus
  const eventBus = new EventBus();

  // 5. Providers
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

  // 6. Tools
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

  // Config tools (hidden until explicitly activated)
  const defaultRuntime = agentRegistry.getDefault();
  const configManager = new ConfigManager(config, defaultRuntime?.dir);
  toolRegistry.registerHidden(configExplainTool);
  toolRegistry.registerHidden(createConfigGetTool(configManager));
  toolRegistry.registerHidden(createConfigSetTool(configManager, async () => {
    // Daemon mode: deny security config changes by default (no interactive approval)
    log.warn('Config set denied: security field change requires interactive approval');
    return false;
  }));

  // 6b. Load skills (aggregate from all runtimes for legacy mode, or per-runtime)
  const skills = defaultRuntime?.skills ?? loadSkills(path.resolve(config.workspace.path), configDir);

  // 6c. Start instance-level MCP servers
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
  // Collect all MCP clients from agent runtimes
  for (const runtime of agentRegistry.all()) {
    mcpClients.push(...runtime.mcpClients);
  }

  // Schedule rules map — populated in section 12, referenced by before-hook closure
  const scheduleRulesByIndex = new Map<number, import('./config/schema.js').ScheduleRule>();

  // 7. Hooks
  const hooks = new ToolHookRegistryImpl();
  // PolicyEngine as first before-hook (uses per-agent policy when available)
  hooks.registerBefore(async (toolName, args, ctx) => {
    const scope = toolName === 'exec' ? 'exec' as const
      : toolName === 'web_fetch' ? 'web' as const
      : toolName === 'message' ? 'message' as const
      : 'tool' as const;

    // Use the per-agent policy engine if available
    const agentName = ctx.currentAgentConfig.name;
    const runtime = agentRegistry.get(agentName);
    const effectivePolicyEngine = runtime?.policyEngine ?? policyEngine;
    const effectiveInlineAllowStore = runtime?.inlineAllowStore ?? inlineAllowStore;

    const decision = effectivePolicyEngine.evaluate({
      toolName,
      scope,
      command: args.command as string | undefined,
      agentId: agentName,
      channel: ctx.channel,
    });

    if (decision.action === 'deny') {
      return { proceed: false, args };
    }

    if (decision.action === 'approve') {
      // Check inline allows first
      if (effectiveInlineAllowStore.isAllowed(toolName)) {
        return { proceed: true, args };
      }

      // Per-schedule approval mode override
      if (ctx.channel === 'scheduler' && ctx.chatId) {
        const idxMatch = ctx.chatId.match(/^schedule_(\d+)/);
        if (idxMatch) {
          const schedRule = scheduleRulesByIndex.get(Number(idxMatch[1]));
          if (schedRule?.approvalMode === 'auto-approve') {
            return { proceed: true, args };
          }
          if (schedRule?.approvalMode === 'auto-deny') {
            return { proceed: false, args };
          }
          // 'user-rules': fall through to WS approval flow
          // (user rules already checked via PolicyEngine above)
        }
      }

      // WebSocket approval flow
      if (wsHandler) {
        const approvalMode = config.gateway.approvalMode ?? 'auto-approve';

        if (wsHandler.hasClients() || approvalMode === 'wait') {
          const { requestId, decision: approvalDecision } = approvalBridge.requestApproval({
            toolName,
            args,
            agentId: agentName,
            chatId: ctx.chatId ?? '',
            hasClients: wsHandler.hasClients(),
          });

          wsHandler.broadcast({
            type: 'approval_needed',
            requestId,
            toolName,
            args,
            agentId: agentName,
            chatId: ctx.chatId ?? '',
          });

          const decision: ApprovalDecision = await approvalDecision;
          if (decision.rejected) {
            return { proceed: false, args, rejected: true, feedback: decision.feedback };
          }
          return { proceed: decision.approved, args };
        }

        // No clients connected — fallback based on mode
        if (approvalMode === 'auto-deny') {
          return { proceed: false, args };
        }
        // auto-approve: fall through
      }

      effectivePolicyEngine.suggestRule({
        toolName,
        scope,
        command: args.command as string | undefined,
        agentId: agentName,
      }, 'allow');
    }

    return { proceed: true, args };
  });

  // 8. Message bus
  const bus = new MessageBus();
  setPublishOutbound((msg) => bus.publishOutbound(msg));

  // 9. Channels
  const channels: Channel[] = [];

  // Clear all agent sessions for a given channel + chatId
  const clearAllAgentSessions = (channelName: string, chatId: string) => {
    // Clear sessions from all runtimes
    for (const runtime of agentRegistry.all()) {
      for (const id of Object.keys(runtime.agentConfigs)) {
        clearSession(runtime.sessionsDir, id, channelName, chatId);
      }
    }
    // Also clear legacy sessions
    for (const id of Object.keys(config.agents)) {
      clearSession(path.join(configDir, 'sessions'), id, channelName, chatId);
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

  // 10. Conversation tracker
  const conversationTracker = new ConversationTracker();
  conversationTracker.start();

  // 11. Gateway + WebSocket
  const approvalBridge = new ApprovalBridge();

  // Build aggregate agents/teams from all runtimes for mentionables
  const allAgents: Record<string, import('./config/schema.js').AgentConfig> = {};
  const allTeams: Record<string, import('./config/schema.js').TeamConfig> = {};
  for (const runtime of agentRegistry.all()) {
    // Only expose primary agents (not sub-agents) as mentionables
    allAgents[runtime.name] = runtime.primaryAgentConfig;
    Object.assign(allTeams, runtime.teams);
  }

  const mentionablesProvider = new MentionablesProvider(
    allAgents, allTeams, skills, toolRegistry,
  );

  const sessionProvider: SessionProvider = {
    listChats(filter) {
      const all: import('./agent/session.js').ChatInfo[] = [];
      for (const runtime of agentRegistry.all()) {
        all.push(...listChats(runtime.sessionsDir, filter));
      }
      all.push(...listChats(path.join(configDir, 'sessions'), filter));
      return all.sort((a, b) => b.lastModified - a.lastModified);
    },
    getChatHistory(agentId, channel, chatId) {
      const runtime = agentRegistry.get(agentId);
      const sessDir = runtime?.sessionsDir ?? path.join(configDir, 'sessions');
      return loadSession(sessDir, agentId, channel, chatId);
    },
  };

  let wsHandler: WsHandler | null = null;
  if (config.gateway.enabled) {
    wsHandler = new WsHandler(
      bus, pairing, config.gateway.requirePairing,
      eventBus, approvalBridge, mentionablesProvider,
      (agentId, toolName, scope) => {
        if (scope === 'always') {
          // 'always' is handled via UserRuleStore callbacks below
          return;
        }
        const runtime = agentRegistry.get(agentId);
        const store = runtime?.inlineAllowStore ?? inlineAllowStore;
        store.addAllow(toolName, scope);
        log.info('Allow registered from approval', { agentId, toolName, scope });
      },
      {
        onAlwaysAllow: (agentId, toolName) => {
          userRuleStore.addRule({ action: 'allow', toolName, agentId, createdBy: 'ws-approval' });
          syncUserRules();
          log.info('Persistent allow rule created', { agentId, toolName });
        },
        onAlwaysDeny: (agentId, toolName) => {
          userRuleStore.addRule({ action: 'deny', toolName, agentId, createdBy: 'ws-approval' });
          syncUserRules();
          log.info('Persistent deny rule created', { agentId, toolName });
        },
        listRules: () => userRuleStore.listRules(),
        removeRule: (ruleId) => {
          const success = userRuleStore.removeRule(ruleId);
          if (success) syncUserRules();
          return success;
        },
      },
    );
    wsHandler.setSessionProvider(sessionProvider);

    const gateway = new GatewayServer(config.gateway, bus, pairing);
    gateway.setWsHandler(wsHandler);
    gateway.setMentionables(mentionablesProvider);
    gateway.setSessionProvider(sessionProvider);
    await gateway.start();
  }

  // 12. Scheduler (aggregate schedules from all runtimes)
  const abortController = new AbortController();
  const allSchedules = agentRegistry.all().flatMap(rt =>
    rt.schedules.map(s => ({ ...s, agent: s.agent ?? rt.name }))
  );
  allSchedules.forEach((rule, i) => scheduleRulesByIndex.set(i, rule));

  if (allSchedules.length > 0) {
    const scheduler = new Scheduler(allSchedules, bus, eventBus, abortController.signal, (rule, _chatId) => {
      if (rule.allow && rule.allow.length > 0) {
        const runtime = agentRegistry.get(rule.agent ?? agentRegistry.getDefault()?.name ?? '');
        const store = runtime?.inlineAllowStore ?? inlineAllowStore;
        for (const toolName of rule.allow) {
          store.addAllow(toolName, 'session');
        }
      }
    });
    scheduler.start();
    log.info('Scheduler started', { rules: allSchedules.length });
  }

  // Resolve runtime for an agent name
  function resolveRuntime(agentName: string): { runtime: AgentRuntime; agentConfig: import('./config/schema.js').AgentConfig } | undefined {
    // Try primary agent lookup via registry
    const runtime = agentRegistry.get(agentName);
    if (runtime) {
      return { runtime, agentConfig: runtime.primaryAgentConfig };
    }

    // Try sub-agent lookup across runtimes
    for (const rt of agentRegistry.all()) {
      const agentConfig = rt.agentConfigs[agentName];
      if (agentConfig) {
        return { runtime: rt, agentConfig };
      }
    }

    return undefined;
  }

  // Inbound processing
  const inboundLoop = async () => {
    while (!abortController.signal.aborted) {
      let inbound;
      try {
        inbound = await bus.consumeInbound(abortController.signal);
      } catch {
        break;
      }

      const { channel, sender, chatId, message, agentId: requestedAgent } = inbound;
      log.info('Inbound message', { channel, sender, chatId, length: message.length });

      // Parse inline allows (per-agent if available)
      const targetRuntime = requestedAgent ? agentRegistry.get(requestedAgent) : agentRegistry.getDefault();
      const effectiveInlineAllowStore = targetRuntime?.inlineAllowStore ?? inlineAllowStore;
      const cleaned = effectiveInlineAllowStore.parseAndStore(message);

      // Aggregate skills from target runtime for slash command parsing
      const effectiveSkills = targetRuntime?.skills ?? skills;

      // Intercept slash commands
      const slashCmd = parseSlashCommand(cleaned, effectiveSkills);
      if (slashCmd) {
        if (slashCmd.type === 'new') {
          const result = handleNew();
          // Re-hide config tools
          toolRegistry.setHidden('config_explain', true);
          toolRegistry.setHidden('config_get', true);
          toolRegistry.setHidden('config_set', true);
          const response = result.action === 'immediate' ? result.response : '';

          if (channel === 'websocket') {
            // WebSocket: keep old session, create a new chatId
            const newChatId = `ws_${Date.now()}`;
            bus.publishOutbound({ channel, chatId, content: response });
            if (wsHandler) {
              const cmdResult: ServerMessage_CommandResult = {
                type: 'command_result', chatId, command: 'new', message: response, newChatId,
              };
              wsHandler.broadcast(cmdResult);
            }
          } else {
            // CLI/Telegram: clear old session (single-session UIs)
            clearAllAgentSessions(channel, chatId);
            bus.publishOutbound({ channel, chatId, content: response });
          }
          continue;
        }

        if (slashCmd.type === 'config') {
          // Unhide config tools globally
          toolRegistry.setHidden('config_explain', false);
          toolRegistry.setHidden('config_get', false);
          toolRegistry.setHidden('config_set', false);

          const result = handleConfig(slashCmd.args);
          if (result.action === 'inject') {
            if (wsHandler) {
              const cmdResult: ServerMessage_CommandResult = {
                type: 'command_result', chatId, command: 'config',
                message: 'Configuration mode activated.',
              };
              wsHandler.broadcast(cmdResult);
            }

            if (slashCmd.args) {
              const resolved = requestedAgent ? resolveRuntime(requestedAgent) : undefined;
              const targetAgent = resolved?.agentConfig.name
                ?? routeMessage(slashCmd.args, allAgents, allTeams, agentRegistry.getDefault()?.name ?? 'default').agentId!;
              processAgentMessage(targetAgent, slashCmd.args, channel, chatId, sender, undefined, result.messages);
            } else {
              const defRuntime = agentRegistry.getDefault();
              const agentId = requestedAgent ?? defRuntime?.name ?? '_default';
              const resolved = resolveRuntime(agentId);
              const sessDir = resolved?.runtime.sessionsDir ?? path.join(configDir, 'sessions');
              const messages = loadSession(sessDir, agentId, channel, chatId);
              const effectiveConfig = resolved?.runtime.resolvedConfig ?? config;
              const systemPrompt = buildSystemPrompt(
                resolved?.agentConfig ?? config.agents[agentId] ?? config.agents['default'],
                effectiveConfig, toolRegistry, undefined, effectiveSkills,
                resolved?.runtime.dir,
              );
              if (systemPrompt) {
                if (messages.length > 0 && messages[0].role === 'system') {
                  messages[0].content = systemPrompt;
                } else {
                  messages.unshift({ role: 'system', content: systemPrompt });
                }
              }
              messages.push(...result.messages);
              saveSession(sessDir, agentId, channel, chatId, messages);
              bus.publishOutbound({ channel, chatId, content: result.agentMessage ?? 'Configuration mode activated.' });
            }
          }
          continue;
        }

        if (slashCmd.type === 'skill') {
          const result = handleSkill(slashCmd.skill, slashCmd.args);
          if (result.action === 'inject') {
            if (wsHandler) {
              const cmdResult: ServerMessage_CommandResult = {
                type: 'command_result', chatId, command: slashCmd.name,
                message: `Skill "${slashCmd.name}" activated.`,
              };
              wsHandler.broadcast(cmdResult);
            }

            if (slashCmd.args) {
              const resolved = requestedAgent ? resolveRuntime(requestedAgent) : undefined;
              const targetAgent = resolved?.agentConfig.name
                ?? routeMessage(slashCmd.args, allAgents, allTeams, agentRegistry.getDefault()?.name ?? 'default').agentId!;
              processAgentMessage(targetAgent, slashCmd.args, channel, chatId, sender, undefined, result.messages);
            } else {
              const defRuntime = agentRegistry.getDefault();
              const agentId = requestedAgent ?? defRuntime?.name ?? '_default';
              const resolved = resolveRuntime(agentId);
              const sessDir = resolved?.runtime.sessionsDir ?? path.join(configDir, 'sessions');
              const messages = loadSession(sessDir, agentId, channel, chatId);
              const effectiveConfig = resolved?.runtime.resolvedConfig ?? config;
              const systemPrompt = buildSystemPrompt(
                resolved?.agentConfig ?? config.agents[agentId] ?? config.agents['default'],
                effectiveConfig, toolRegistry, undefined, effectiveSkills,
                resolved?.runtime.dir,
              );
              if (systemPrompt) {
                if (messages.length > 0 && messages[0].role === 'system') {
                  messages[0].content = systemPrompt;
                } else {
                  messages.unshift({ role: 'system', content: systemPrompt });
                }
              }
              messages.push(...result.messages);
              saveSession(sessDir, agentId, channel, chatId, messages);
              bus.publishOutbound({ channel, chatId, content: result.agentMessage ?? `Skill "${slashCmd.name}" activated.` });
            }
          }
          continue;
        }
      }

      // If a specific agent was requested (e.g. from WebSocket), route directly
      if (requestedAgent) {
        const resolved = resolveRuntime(requestedAgent);
        if (resolved && agentRegistry.isPrimary(requestedAgent)) {
          processAgentMessage(requestedAgent, cleaned, channel, chatId, sender);
          continue;
        }
        // Sub-agents are not externally addressable — fall through to default routing
      }

      // Route message using flat agent names from registry
      const defaultAgentName = agentRegistry.getDefault()?.name ?? 'default';
      const route = routeMessage(cleaned, allAgents, allTeams, defaultAgentName);

      if (route.type === 'team') {
        // Team routing — look across all runtimes for the team
        const resolved = resolveRuntime(route.agentId ?? '');
        const effectiveTeams = resolved?.runtime.teams ?? allTeams;
        const effectiveAgents = resolved?.runtime.agentConfigs ?? allAgents;
        const teamInfo = resolveTeam(route.teamId!, effectiveTeams, effectiveAgents);
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
    prefixMessages?: Message[],
  ) {
    // Resolve agent from registry (supports both primary and sub-agents)
    const resolved = resolveRuntime(agentId);
    if (!resolved) {
      bus.publishOutbound({ channel, chatId, content: `Unknown agent: ${agentId}` });
      return;
    }

    const { runtime, agentConfig } = resolved;
    const provider = createProvider(agentConfig.provider);
    const model = agentConfig.model ?? provider.defaultModel;
    log.info('Processing message', { agentId, provider: agentConfig.provider, model, channel });

    const ctx = {
      signal: abortController.signal,
      channel,
      chatId,
      policy: runtime.policy,
      policyEngine: runtime.policyEngine,
      approvalManager,
      inlineAllowStore: runtime.inlineAllowStore,
      toolRegistry,
      hooks,
      agentConfigs: runtime.agentConfigs,
      currentAgentConfig: agentConfig,
      providerFactory: createProvider,
    };

    // Load session and build context (always refresh system prompt)
    const sessionsDir = runtime.sessionsDir;
    const messages = loadSession(sessionsDir, agentId, channel, chatId);
    const effectiveSkills = runtime.skills;
    const systemPrompt = buildSystemPrompt(
      agentConfig, runtime.resolvedConfig, toolRegistry, undefined, effectiveSkills,
      runtime.dir,
    );
    if (systemPrompt) {
      if (messages.length > 0 && messages[0].role === 'system') {
        messages[0].content = systemPrompt;
      } else {
        messages.unshift({ role: 'system', content: systemPrompt });
      }
    }

    // Inject prefix messages (e.g. from slash commands) before user message
    if (prefixMessages) {
      messages.push(...prefixMessages);
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
          eventBus,
          agentId,
          chatId,
        },
        messages,
        ctx,
      );

      messages.push({ role: 'assistant', content: result.content });
      saveSession(sessionsDir, agentId, channel, chatId, messages);
      log.info('Agent responded', { agentId, channel, iterations: result.iterations, toolCalls: result.toolsUsed.length });

      eventBus.emit('agent:response', {
        agentId,
        chatId,
        content: result.content,
        iterations: result.iterations,
        toolsUsed: result.toolsUsed.map(t => t.name),
      });
      eventBus.emit('agent:stopped', { agentId, reason: 'completed' });

      // Parse mentions for multi-agent handoff
      const { mentions } = parseMentions(result.content);
      if (mentions.length > 0 && conversationId) {
        const conv = conversationTracker.get(conversationId);
        if (conv) {
          const validAgents = agentRegistry.names();
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
    wsHandler?.close();
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
    agents: agentRegistry.names(),
    channels: config.channels.enabled,
    schedules: allSchedules.length,
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
