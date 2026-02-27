import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { AgentDirConfig, ResolvedAgentDir } from './agent-schema.js';
import type { InstanceConfig } from './instance-schema.js';
import type { BearClawConfig, PolicyConfig, AgentConfig } from './schema.js';
import { AutonomyLevel } from './schema.js';
import {
  ALLOWED_COMMANDS,
  RESTRICTED_COMMANDS,
  FORBIDDEN_PATHS,
  POLICY_DEFAULTS,
} from './defaults.js';
import { stripJsonc } from './config.js';

const AGENT_CONFIG_FILE = 'bearclaw.jsonc';

/**
 * Walk up from startDir looking for bearclaw.jsonc (like git finds .git).
 * Returns the directory containing the config, or null if not found.
 */
export function discoverAgentDir(startDir: string): string | null {
  let dir = path.resolve(startDir);
  const root = path.parse(dir).root;

  while (dir !== root) {
    if (fs.existsSync(path.join(dir, AGENT_CONFIG_FILE))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // Check root itself
  if (fs.existsSync(path.join(dir, AGENT_CONFIG_FILE))) {
    return dir;
  }

  return null;
}

/**
 * Load and parse bearclaw.jsonc from an agent directory.
 */
export function loadAgentDirConfig(agentDir: string): ResolvedAgentDir {
  const configPath = path.join(agentDir, AGENT_CONFIG_FILE);
  const raw = fs.readFileSync(configPath, 'utf8');
  const config: AgentDirConfig = JSON.parse(stripJsonc(raw));

  const name = config.name ?? path.basename(agentDir);
  const workspacePath = path.resolve(agentDir, config.workspace ?? './workspace');
  const sessionsDir = path.join(agentDir, '.bearclaw', 'sessions');

  return {
    dir: path.resolve(agentDir),
    config,
    name,
    workspacePath,
    sessionsDir,
  };
}

/**
 * Merge security config from instance + agent directory.
 * Agent config cannot weaken instance security.
 */
export function mergeSecurityConfig(
  instanceSecurity: InstanceConfig['security'],
  agentSecurity: AgentDirConfig['security'],
  agentDir: string,
  memoryDir?: string,
): BearClawConfig['security'] {
  const base: BearClawConfig['security'] = {
    autonomy: AutonomyLevel.Supervised,
    workspaceOnly: true,
    allowedCommands: [...ALLOWED_COMMANDS],
    restrictedCommands: { ...RESTRICTED_COMMANDS },
    forbiddenPaths: [...instanceSecurity.forbiddenPaths],
    allowedPaths: [...(instanceSecurity.allowedPaths ?? [])],
    allowSubshells: false,
    rateLimits: { ...instanceSecurity.rateLimits },
    encrypt: instanceSecurity.encrypt,
  };

  if (!agentSecurity) return base;

  // Autonomy: more restrictive wins
  if (agentSecurity.autonomy) {
    const levels = [AutonomyLevel.ReadOnly, AutonomyLevel.Supervised, AutonomyLevel.Full];
    const instanceIdx = levels.indexOf(base.autonomy);
    const agentIdx = levels.indexOf(agentSecurity.autonomy);
    base.autonomy = levels[Math.min(instanceIdx, agentIdx)];
  }

  if (agentSecurity.workspaceOnly !== undefined) {
    // Can only make more restrictive (false -> true is more restrictive doesn't make sense,
    // but true always wins: if instance says workspaceOnly, agent can't override)
    base.workspaceOnly = base.workspaceOnly || agentSecurity.workspaceOnly;
  }

  if (agentSecurity.allowedCommands) {
    base.allowedCommands = [...new Set([...base.allowedCommands, ...agentSecurity.allowedCommands])];
  }

  if (agentSecurity.restrictedCommands) {
    base.restrictedCommands = { ...base.restrictedCommands, ...agentSecurity.restrictedCommands };
  }

  // forbiddenPaths: union (agent cannot remove instance forbidden paths)
  // Agent's own forbidden paths are already in instance. Agent can only add.
  // No agent-level forbiddenPaths field — it's instance-only.

  // allowedPaths: agent can add paths under its own directory OR under
  // any instance-level allowedPath (agent can't grant itself access to
  // arbitrary paths — only paths the instance admin already approved).
  if (agentSecurity.allowedPaths) {
    const resolvedAgentDir = path.resolve(agentDir);
    const instanceAllowed = (instanceSecurity.allowedPaths ?? []).map(p =>
      p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p
    );
    const validPaths = agentSecurity.allowedPaths
      .map(p => p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : path.resolve(agentDir, p))
      .filter(p =>
        p.startsWith(resolvedAgentDir + path.sep) || p === resolvedAgentDir ||
        instanceAllowed.some(ia => p === ia || p.startsWith(ia + path.sep))
      );
    base.allowedPaths = [...base.allowedPaths, ...validPaths];
  }

  // allowMemoryWrite: add memory dir to allowedPaths
  if (agentSecurity.allowMemoryWrite && memoryDir) {
    const resolvedMemoryDir = path.resolve(agentDir, memoryDir);
    const resolvedAgentDirCheck = path.resolve(agentDir);
    if (resolvedMemoryDir.startsWith(resolvedAgentDirCheck)) {
      base.allowedPaths = [...base.allowedPaths, resolvedMemoryDir];
    }
    base.allowMemoryWrite = true;
  }

  if (agentSecurity.allowSubshells !== undefined) {
    // Agent can disable subshells but not enable them if instance forbids
    base.allowSubshells = base.allowSubshells && agentSecurity.allowSubshells;
  }

  // rateLimits: agent limits capped by instance ceiling
  if (agentSecurity.rateLimits) {
    if (agentSecurity.rateLimits.perAgent !== undefined) {
      base.rateLimits.perAgent = base.rateLimits.perAgent !== undefined
        ? Math.min(base.rateLimits.perAgent, agentSecurity.rateLimits.perAgent)
        : agentSecurity.rateLimits.perAgent;
    }
    if (agentSecurity.rateLimits.perToolClass) {
      base.rateLimits.perToolClass = { ...base.rateLimits.perToolClass };
      for (const [tool, limit] of Object.entries(agentSecurity.rateLimits.perToolClass)) {
        const existing = base.rateLimits.perToolClass[tool];
        base.rateLimits.perToolClass[tool] = existing !== undefined
          ? Math.min(existing, limit)
          : limit;
      }
    }
  }

  return base;
}

/**
 * Merge policy config from instance + agent directory.
 * Agent rules evaluated first, instance defaults as fallback.
 */
export function mergePolicyConfig(
  instancePolicy: PolicyConfig,
  agentPolicy: AgentDirConfig['policy'],
): PolicyConfig {
  if (!agentPolicy) return instancePolicy;

  return {
    ...instancePolicy,
    defaultAction: agentPolicy.defaultAction ?? instancePolicy.defaultAction,
    rules: [
      ...(agentPolicy.rules ?? []),
      ...instancePolicy.rules,
    ],
  };
}

/**
 * Build a full BearClawConfig from instance + agent directory configs.
 * This is the "resolved" config that existing code expects.
 */
export function buildResolvedConfig(
  instanceConfig: InstanceConfig,
  agentDir: ResolvedAgentDir,
): BearClawConfig {
  const agentConfig = agentDir.config;
  const memoryDir = agentConfig.memory?.dir ?? 'memory';
  const security = mergeSecurityConfig(instanceConfig.security, agentConfig.security, agentDir.dir, memoryDir);

  // Build the primary agent config
  const primaryAgent: AgentConfig = {
    name: agentDir.name,
    provider: agentConfig.provider,
    model: agentConfig.model,
    workingDirectory: agentDir.workspacePath,
    autonomy: security.autonomy,
    maxIterations: agentConfig.maxIterations,
    maxTotalTokens: agentConfig.maxTotalTokens,
    systemPromptFiles: agentConfig.systemPromptFiles,
  };

  // Combine primary + subagents
  const agents: Record<string, AgentConfig> = {
    [agentDir.name]: primaryAgent,
  };
  if (agentConfig.subagents) {
    for (const [id, sub] of Object.entries(agentConfig.subagents)) {
      agents[id] = sub;
    }
  }

  // Merge MCP servers (agent-level only)
  const mcpServers = {
    ...(agentConfig.mcp?.servers ?? {}),
  };

  // Merge policy (agent-level only + defaults)
  const instancePolicy: PolicyConfig = {
    ...POLICY_DEFAULTS,
    rules: [],
  };
  const policy = mergePolicyConfig(instancePolicy, agentConfig.policy);

  // Memory config
  const memory = {
    enabled: agentConfig.memory?.enabled ?? true,
    dir: agentConfig.memory?.dir ?? 'memory',
    alwaysLoad: agentConfig.memory?.alwaysLoad ?? ['active-tasks.md'],
  };

  return {
    workspace: { path: agentDir.workspacePath },
    security,
    gateway: instanceConfig.gateway,
    providers: instanceConfig.providers,
    channels: instanceConfig.channels,
    mcp: { servers: mcpServers },
    agents,
    teams: agentConfig.teams ?? {},
    memory,
    policy,
    schedules: agentConfig.schedules ?? [],
    monitoring: instanceConfig.monitoring,
  };
}
