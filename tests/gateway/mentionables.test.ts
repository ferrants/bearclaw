import { describe, it, expect } from 'vitest';
import { MentionablesProvider } from '../../src/gateway/mentionables.js';
import type { AgentConfig, TeamConfig } from '../../src/config/schema.js';
import type { SkillDef } from '../../src/skills/types.js';
import type { ToolRegistry } from '../../src/tools/types.js';

function makeToolRegistry(names: string[]): ToolRegistry {
  return {
    list: () => names,
    get: (name: string) => ({ name, description: `${name} tool`, parameters: {}, execute: async () => ({ forLLM: '', isError: false, async: false }) }),
    register: () => {},
    registerHidden: () => {},
    setHidden: () => {},
    execute: async () => ({ forLLM: '', isError: false, async: false }),
    toProviderDefs: () => [],
  } as ToolRegistry;
}

describe('MentionablesProvider', () => {
  const agents: Record<string, AgentConfig> = {
    coder: { name: 'coder', provider: 'anthropic' },
    reviewer: { name: 'reviewer', provider: 'openai' },
  };

  const teams: Record<string, TeamConfig> = {
    devteam: { name: 'devteam', agents: ['coder', 'reviewer'], leaderAgent: 'coder' },
  };

  const skills: SkillDef[] = [
    { name: 'commit', description: 'Create a git commit', dir: '/skills/commit', instructions: '' },
    { name: 'deploy', description: 'Deploy to prod', dir: '/skills/deploy', instructions: '' },
  ];

  it('should return all mentionables without filter', () => {
    const provider = new MentionablesProvider(agents, teams, skills, makeToolRegistry(['exec', 'read_file']));
    const items = provider.query();

    expect(items).toHaveLength(7); // 2 agents + 1 team + 2 skills + 2 tools
    expect(items.filter(i => i.type === 'agent')).toHaveLength(2);
    expect(items.filter(i => i.type === 'team')).toHaveLength(1);
    expect(items.filter(i => i.type === 'skill')).toHaveLength(2);
    expect(items.filter(i => i.type === 'tool')).toHaveLength(2);
  });

  it('should filter by name', () => {
    const provider = new MentionablesProvider(agents, teams, skills, makeToolRegistry(['exec']));
    const items = provider.query('cod');
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe('coder');
  });

  it('should filter by description', () => {
    const provider = new MentionablesProvider(agents, teams, skills, makeToolRegistry([]));
    const items = provider.query('git');
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe('commit');
  });

  it('should set triggers correctly', () => {
    const provider = new MentionablesProvider(agents, teams, skills, makeToolRegistry([]));
    const items = provider.query();

    const agent = items.find(i => i.name === 'coder');
    expect(agent?.trigger).toBe('@coder');

    const team = items.find(i => i.name === 'devteam');
    expect(team?.trigger).toBe('@devteam');

    const skill = items.find(i => i.name === 'commit');
    expect(skill?.trigger).toBe('/commit');
  });
});
