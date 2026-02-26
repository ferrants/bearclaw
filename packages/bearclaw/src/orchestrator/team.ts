import type { TeamConfig, AgentConfig } from '../config/schema.js';

export function resolveTeam(
  teamId: string,
  teams: Record<string, TeamConfig>,
  agents: Record<string, AgentConfig>,
): {
  team: TeamConfig;
  leaderAgent: AgentConfig;
  memberAgents: AgentConfig[];
} | null {
  const team = teams[teamId];
  if (!team) return null;

  const leaderAgent = agents[team.leaderAgent];
  if (!leaderAgent) return null;

  const memberAgents = team.agents
    .map(id => agents[id])
    .filter((a): a is AgentConfig => !!a);

  return { team, leaderAgent, memberAgents };
}
