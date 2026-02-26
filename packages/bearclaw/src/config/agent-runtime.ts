import type { SecurityPolicy } from '../security/policy.js';
import type { PolicyEngine } from '../security/policy-engine.js';
import type { InlineAllowStore } from '../security/inline-allow.js';
import type { ToolRegistry } from '../tools/types.js';
import type { ToolHookRegistry } from '../tools/types.js';
import type { SkillDef } from '../skills/types.js';
import type { McpClient } from '../mcp/index.js';
import type { AgentConfig, TeamConfig, BearClawConfig } from './schema.js';
import type { ResolvedAgentDir } from './agent-schema.js';

/**
 * Per-agent runtime state. Each agent directory gets its own instance.
 * Bundles all the isolated state for a single externally-addressable agent.
 */
export interface AgentRuntime {
  /** Resolved agent name. */
  name: string;
  /** Absolute path to agent directory. */
  dir: string;
  /** Absolute path to workspace. */
  workspacePath: string;
  /** Absolute path to sessions directory. */
  sessionsDir: string;

  /** Per-agent security policy (merged instance + agent). */
  policy: SecurityPolicy;
  /** Per-agent policy engine (agent-level rules). */
  policyEngine: PolicyEngine;
  /** Per-agent inline allow store. */
  inlineAllowStore: InlineAllowStore;

  /** Skills loaded for this agent (agent dir + instance). */
  skills: SkillDef[];
  /** MCP clients started for this agent. */
  mcpClients: McpClient[];

  /** Agent configs visible to this runtime (primary + subagents). */
  agentConfigs: Record<string, AgentConfig>;
  /** The primary agent config. */
  primaryAgentConfig: AgentConfig;
  /** Team configs. */
  teams: Record<string, TeamConfig>;

  /** Merged BearClawConfig used for system prompt building etc. */
  resolvedConfig: BearClawConfig;

  /** Schedule rules for this agent. */
  schedules: import('./schema.js').ScheduleRule[];

  /** The resolved agent dir info (if loaded from a directory). */
  agentDir?: ResolvedAgentDir;
}
