import { describe, it, expect } from 'vitest';
import { routeMessage } from '../../src/orchestrator/router.js';
import type { AgentConfig, TeamConfig } from '../../src/config/schema.js';

const agents: Record<string, AgentConfig> = {
  default: { name: 'default', provider: 'anthropic' },
  coder: { name: 'coder', provider: 'anthropic' },
  reviewer: { name: 'reviewer', provider: 'openai' },
};

const teams: Record<string, TeamConfig> = {
  dev: { name: 'dev', agents: ['coder', 'reviewer'], leaderAgent: 'coder' },
};

describe('routeMessage', () => {
  it('routes to default agent when no prefix', () => {
    const result = routeMessage('hello world', agents, teams);
    expect(result.type).toBe('agent');
    expect(result.agentId).toBe('default');
    expect(result.message).toBe('hello world');
  });

  it('routes to specific agent', () => {
    const result = routeMessage('@coder fix the bug', agents, teams);
    expect(result.type).toBe('agent');
    expect(result.agentId).toBe('coder');
    expect(result.message).toBe('fix the bug');
  });

  it('routes to team', () => {
    const result = routeMessage('@dev review this', agents, teams);
    expect(result.type).toBe('team');
    expect(result.teamId).toBe('dev');
    expect(result.message).toBe('review this');
  });

  it('routes unknown @ target to default', () => {
    const result = routeMessage('@unknown do something', agents, teams);
    expect(result.type).toBe('agent');
    expect(result.agentId).toBe('default');
    expect(result.message).toBe('@unknown do something');
  });

  it('handles @ with no message', () => {
    const result = routeMessage('@coder', agents, teams);
    expect(result.agentId).toBe('default');
  });
});
