import * as path from 'node:path';
import type { AgentRuntime } from './agent-runtime.js';
import type { ResolvedAgentDir } from './agent-schema.js';
import type { InstanceConfig } from './instance-schema.js';
import { buildResolvedConfig } from './agent-loader.js';
import { SecurityPolicy } from '../security/policy.js';
import { ScopedRateLimiter } from '../security/rate-limiter.js';
import { PolicyEngine } from '../security/policy-engine.js';
import { InlineAllowStore } from '../security/inline-allow.js';
import { loadSkillsMulti } from '../skills/index.js';
import { McpClient, McpHttpClient, createMcpTools } from '../mcp/index.js';
import type { McpTransport } from '../mcp/index.js';
import type { ToolRegistryImpl } from '../tools/registry.js';
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

function expandEnvVars(values?: Record<string, string>): Record<string, string> | undefined {
  if (!values) return undefined;
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) {
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
  const mcpClients: McpTransport[] = [];
  const agentMcpServers = agentDir.config.mcp?.servers ?? {};
  for (const [name, serverConfig] of Object.entries(agentMcpServers)) {
    let client: McpTransport;
    if (serverConfig.url) {
      const headers = expandEnvVars(serverConfig.headers) ?? {};
      client = new McpHttpClient(serverConfig.url, headers, serverConfig.timeout);
    } else if (serverConfig.command) {
      const env = expandEnvVars(serverConfig.env);
      client = new McpClient(serverConfig.command, serverConfig.args ?? [], env);
    } else {
      log.warn('MCP server config missing both url and command, skipping', { name });
      continue;
    }
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
