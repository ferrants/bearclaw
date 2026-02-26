import * as path from 'node:path';
import type { AgentRuntime } from './agent-runtime.js';
import type { ResolvedAgentDir } from './agent-schema.js';
import type { InstanceConfig } from './instance-schema.js';
import type { BearClawConfig, PolicyConfig } from './schema.js';
import { buildResolvedConfig, buildDefaultAgentDir } from './agent-loader.js';
import { SecurityPolicy } from '../security/policy.js';
import { ScopedRateLimiter } from '../security/rate-limiter.js';
import { PolicyEngine } from '../security/policy-engine.js';
import { InlineAllowStore } from '../security/inline-allow.js';
import { loadSkills, loadSkillsMulti } from '../skills/index.js';
import { McpClient, createMcpTools } from '../mcp/index.js';
import type { ToolRegistryImpl } from '../tools/registry.js';
import { POLICY_DEFAULTS } from './defaults.js';
import { createLogger } from '../logging.js';

const log = createLogger('agent-runtime');

export interface CreateAgentRuntimeOptions {
  /** The resolved agent directory info. */
  agentDir: ResolvedAgentDir;
  /** The instance-level config. */
  instanceConfig: InstanceConfig;
  /** Instance config dir (~/.bearclaw). */
  configDir: string;
  /** Shared tool registry (for MCP tool registration). */
  toolRegistry?: ToolRegistryImpl;
}

function expandMcpEnv(env?: Record<string, string>): Record<string, string> | undefined {
  if (!env) return undefined;
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    result[k] = v.replace(/\$\{(\w+)\}/g, (_match, varName) => process.env[varName] ?? '');
  }
  return result;
}

/**
 * Create an AgentRuntime from a resolved agent directory + instance config.
 * This bundles all per-agent isolated state.
 */
export async function createAgentRuntime(opts: CreateAgentRuntimeOptions): Promise<AgentRuntime> {
  const { agentDir, instanceConfig, configDir, toolRegistry } = opts;

  // Build the resolved (merged) config
  const resolvedConfig = buildResolvedConfig(instanceConfig, agentDir);

  // Create per-agent security policy
  const rateLimiter = new ScopedRateLimiter(resolvedConfig.security.rateLimits);
  const policy = new SecurityPolicy(
    resolvedConfig.security.autonomy,
    path.resolve(resolvedConfig.workspace.path),
    resolvedConfig.security.workspaceOnly,
    resolvedConfig.security.allowedCommands,
    resolvedConfig.security.restrictedCommands,
    resolvedConfig.security.forbiddenPaths,
    resolvedConfig.security.allowedPaths,
    rateLimiter,
    resolvedConfig.security.allowSubshells,
    agentDir.dir,
  );

  // Create per-agent policy engine
  const policyEngine = new PolicyEngine(resolvedConfig.policy, agentDir.dir);

  // Create per-agent inline allow store
  const inlineAllowStore = new InlineAllowStore(
    resolvedConfig.policy.inlineAllow.enabled,
    resolvedConfig.policy.inlineAllow.dayScopeHours,
  );

  // Load skills: explicit skillsDirs first, then agent workspace, agent dir, config dir
  const explicitSkillsDirs = (agentDir.config.skillsDirs ?? []).map(d =>
    path.isAbsolute(d) ? d : path.resolve(agentDir.dir, d),
  );
  const skills = loadSkillsMulti(explicitSkillsDirs, [agentDir.workspacePath, agentDir.dir, configDir]);

  // Start MCP servers (agent-specific + instance)
  const mcpClients: McpClient[] = [];
  const agentMcpServers = agentDir.config.mcp?.servers ?? {};
  for (const [name, serverConfig] of Object.entries(agentMcpServers)) {
    const env = expandMcpEnv(serverConfig.env);
    const client = new McpClient(serverConfig.command, serverConfig.args ?? [], env);
    await client.start();
    mcpClients.push(client);
    if (toolRegistry) {
      for (const tool of await createMcpTools(name, client)) {
        toolRegistry.register(tool);
      }
    }
  }

  const primaryAgentConfig = resolvedConfig.agents[agentDir.name];

  log.info('Agent runtime created', {
    name: agentDir.name,
    dir: agentDir.dir,
    workspace: agentDir.workspacePath,
    skills: skills.length,
    mcpServers: Object.keys(agentMcpServers).length,
  });

  return {
    name: agentDir.name,
    dir: agentDir.dir,
    workspacePath: agentDir.workspacePath,
    sessionsDir: agentDir.sessionsDir,
    policy,
    policyEngine,
    inlineAllowStore,
    skills,
    mcpClients,
    agentConfigs: resolvedConfig.agents,
    primaryAgentConfig,
    teams: resolvedConfig.teams,
    resolvedConfig,
    schedules: resolvedConfig.schedules,
    agentDir,
  };
}

/**
 * Create an AgentRuntime from the legacy BearClawConfig (_default agent).
 * Used for backward compatibility when no agent directory is found.
 */
export async function createDefaultAgentRuntime(
  config: BearClawConfig,
  configDir: string,
): Promise<AgentRuntime> {
  const agentDir = buildDefaultAgentDir(config, configDir);

  // Convert BearClawConfig to InstanceConfig for createAgentRuntime
  const instanceConfig: InstanceConfig = {
    providers: config.providers,
    gateway: config.gateway,
    channels: config.channels,
    security: {
      encrypt: config.security.encrypt,
      forbiddenPaths: config.security.forbiddenPaths,
      rateLimits: config.security.rateLimits,
    },
    monitoring: config.monitoring,
    // Carry legacy fields through
    agents: config.agents,
    teams: config.teams,
    memory: config.memory,
    policy: config.policy,
    schedules: config.schedules,
    mcp: config.mcp,
    workspace: config.workspace,
  };

  // For default runtime, we use the full existing config directly
  const defaultAgent = config.agents.default ?? Object.values(config.agents)[0];
  // If allowMemoryWrite, add memory dir to allowedPaths
  let allowedPaths = config.security.allowedPaths;
  if (config.security.allowMemoryWrite && config.memory?.dir) {
    const resolvedMemoryDir = path.resolve(config.workspace.path, config.memory.dir);
    allowedPaths = [...allowedPaths, resolvedMemoryDir];
  }

  const rateLimiter = new ScopedRateLimiter(config.security.rateLimits);
  const policy = new SecurityPolicy(
    config.security.autonomy,
    path.resolve(config.workspace.path),
    config.security.workspaceOnly,
    config.security.allowedCommands,
    config.security.restrictedCommands,
    config.security.forbiddenPaths,
    allowedPaths,
    rateLimiter,
    config.security.allowSubshells,
  );
  const policyEngine = new PolicyEngine(config.policy, configDir);
  const inlineAllowStore = new InlineAllowStore(
    config.policy.inlineAllow.enabled,
    config.policy.inlineAllow.dayScopeHours,
  );
  const skills = loadSkills(path.resolve(config.workspace.path), configDir);

  return {
    name: '_default',
    dir: configDir,
    workspacePath: path.resolve(config.workspace.path),
    sessionsDir: path.join(configDir, 'sessions'),
    policy,
    policyEngine,
    inlineAllowStore,
    skills,
    mcpClients: [],
    agentConfigs: config.agents,
    primaryAgentConfig: defaultAgent,
    teams: config.teams,
    resolvedConfig: config,
    schedules: config.schedules,
    agentDir,
  };
}
