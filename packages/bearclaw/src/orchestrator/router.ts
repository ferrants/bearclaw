import type { AgentConfig, TeamConfig } from '../config/schema.js';

export interface RouteResult {
  type: 'agent' | 'team';
  agentId?: string;
  teamId?: string;
  message: string;
}

export function routeMessage(
  message: string,
  agents: Record<string, AgentConfig>,
  teams: Record<string, TeamConfig>,
  defaultAgentId = 'default',
): RouteResult {
  const trimmed = message.trim();

  // @agent prefix
  if (trimmed.startsWith('@')) {
    const spaceIdx = trimmed.indexOf(' ');
    if (spaceIdx === -1) {
      return { type: 'agent', agentId: defaultAgentId, message: trimmed };
    }

    const target = trimmed.slice(1, spaceIdx);
    const rest = trimmed.slice(spaceIdx + 1).trim();

    // Check if it's a team
    if (teams[target]) {
      return { type: 'team', teamId: target, message: rest };
    }

    // Check if it's an agent
    if (agents[target]) {
      return { type: 'agent', agentId: target, message: rest };
    }

    // Unknown target, route to default
    return { type: 'agent', agentId: defaultAgentId, message: trimmed };
  }

  // No prefix → default agent
  return { type: 'agent', agentId: defaultAgentId, message: trimmed };
}
