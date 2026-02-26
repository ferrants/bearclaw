import { describe, it, expect } from 'vitest';
import { AgentRegistry } from '../../src/config/agent-registry.js';
import type { AgentRuntime } from '../../src/config/agent-runtime.js';

function mockRuntime(name: string): AgentRuntime {
  return {
    name,
    dir: `/agents/${name}`,
    workspacePath: `/agents/${name}/workspace`,
    sessionsDir: `/agents/${name}/.bearclaw/sessions`,
    policy: {} as AgentRuntime['policy'],
    policyEngine: {} as AgentRuntime['policyEngine'],
    inlineAllowStore: {} as AgentRuntime['inlineAllowStore'],
    skills: [],
    mcpClients: [],
    agentConfigs: { [name]: { name, provider: 'anthropic' } },
    primaryAgentConfig: { name, provider: 'anthropic' },
    teams: {},
    resolvedConfig: {} as AgentRuntime['resolvedConfig'],
    schedules: [],
  };
}

describe('AgentRegistry', () => {
  it('registers and retrieves agents by name', () => {
    const registry = new AgentRegistry();
    const rt = mockRuntime('agent1');
    registry.register(rt);
    expect(registry.get('agent1')).toBe(rt);
  });

  it('throws on duplicate agent names', () => {
    const registry = new AgentRegistry();
    registry.register(mockRuntime('agent1'));
    expect(() => registry.register(mockRuntime('agent1'))).toThrow('Duplicate agent name');
  });

  it('returns undefined for unknown agents', () => {
    const registry = new AgentRegistry();
    expect(registry.get('unknown')).toBeUndefined();
  });

  it('uses first registered as default', () => {
    const registry = new AgentRegistry();
    const first = mockRuntime('first');
    const second = mockRuntime('second');
    registry.register(first);
    registry.register(second);
    expect(registry.getDefault()).toBe(first);
  });

  it('prefers _default as default', () => {
    const registry = new AgentRegistry();
    const first = mockRuntime('first');
    const def = mockRuntime('_default');
    registry.register(first);
    registry.register(def);
    expect(registry.getDefault()).toBe(def);
  });

  it('resolve falls back to default', () => {
    const registry = new AgentRegistry();
    const rt = mockRuntime('agent1');
    registry.register(rt);
    expect(registry.resolve('agent1')).toBe(rt);
    expect(registry.resolve('unknown')).toBe(rt); // falls back to default
    expect(registry.resolve()).toBe(rt); // no name → default
  });

  it('lists all agent names', () => {
    const registry = new AgentRegistry();
    registry.register(mockRuntime('a'));
    registry.register(mockRuntime('b'));
    expect(registry.names()).toEqual(['a', 'b']);
  });

  it('isPrimary checks registered names', () => {
    const registry = new AgentRegistry();
    registry.register(mockRuntime('agent1'));
    expect(registry.isPrimary('agent1')).toBe(true);
    expect(registry.isPrimary('subagent')).toBe(false);
  });

  it('reports correct size', () => {
    const registry = new AgentRegistry();
    expect(registry.size).toBe(0);
    registry.register(mockRuntime('a'));
    registry.register(mockRuntime('b'));
    expect(registry.size).toBe(2);
  });

  it('all returns all runtimes', () => {
    const registry = new AgentRegistry();
    const a = mockRuntime('a');
    const b = mockRuntime('b');
    registry.register(a);
    registry.register(b);
    expect(registry.all()).toEqual([a, b]);
  });
});
