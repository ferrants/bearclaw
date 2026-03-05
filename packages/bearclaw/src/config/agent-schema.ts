import type { AutonomyLevel, AgentConfig, TeamConfig, PolicyConfig, PolicyRule, McpServerConfig, ScheduleRule } from './schema.js';

/**
 * Agent directory configuration (bearclaw.jsonc in agent dir).
 * Self-contained, cloneable agent definition.
 */
export interface AgentDirConfig {
  /** Agent's public name. Defaults to directory name. */
  name?: string;
  /** Workspace directory, relative to agent dir. Defaults to "./workspace". */
  workspace?: string;
  /** Provider name (references instance config providers). */
  provider: string;
  /** Model override. */
  model?: string;
  /** Max agent loop iterations. */
  maxIterations?: number;
  /** Max total tokens before stopping. */
  maxTotalTokens?: number;
  /** System prompt files, resolved relative to agent dir. */
  systemPromptFiles?: string[];
  /** Glob patterns of tool names this agent may use. If set, only matching tools are available. */
  allowedTools?: string[];
  /** Glob patterns of tool names to exclude from this agent. Applied after allowedTools. */
  excludeTools?: string[];

  /** Internal sub-agent definitions (callable via spawn only). */
  subagents?: Record<string, AgentConfig>;
  /** Team definitions for sub-agent coordination. */
  teams?: Record<string, TeamConfig>;

  /** Agent-level security (merged with instance security). */
  security?: {
    autonomy?: AutonomyLevel;
    workspaceOnly?: boolean;
    allowedCommands?: string[];
    restrictedCommands?: Record<string, string[]>;
    allowedPaths?: string[];
    allowMemoryWrite?: boolean;
    allowSubshells?: boolean;
    rateLimits?: {
      perAgent?: number;
      perToolClass?: Record<string, number>;
    };
  };

  /** Agent-level policy rules. */
  policy?: {
    defaultAction?: PolicyConfig['defaultAction'];
    rules?: PolicyRule[];
  };

  /** Agent-specific MCP servers. */
  mcp?: {
    servers: Record<string, McpServerConfig>;
  };

  /** Memory configuration. */
  memory?: {
    enabled?: boolean;
    dir?: string;
    alwaysLoad?: string[];
  };

  /** Additional directories to load skills from (resolved relative to agent dir).
   *  These are searched *before* the default locations (workspace/skills, agentDir/skills, configDir/skills).
   *  Each entry should point to a directory that contains skill subdirectories (each with a SKILL.md). */
  skillsDirs?: string[];

  /** User-configurable hooks that run shell commands at lifecycle points. */
  hooks?: Partial<Record<'agent:start' | 'tool:before' | 'tool:after' | 'agent:end', Array<{
    /** Shell command to run via `sh -c`. Receives JSON on stdin. */
    command: string;
    /** Timeout in ms (default 10000). */
    timeout?: number;
    /** Only run for these tool names (tool:before / tool:after only). */
    toolNames?: string[];
  }>>>;

  /** Schedule rules tagged to this agent. */
  schedules?: ScheduleRule[];
}

/**
 * Resolved agent directory info after loading.
 * Contains the parsed config plus resolved paths.
 */
export interface ResolvedAgentDir {
  /** Absolute path to the agent directory. */
  dir: string;
  /** The parsed bearclaw.jsonc config. */
  config: AgentDirConfig;
  /** Resolved agent name (from config or directory name). */
  name: string;
  /** Absolute path to workspace. */
  workspacePath: string;
  /** Absolute path to sessions directory. */
  sessionsDir: string;
}
