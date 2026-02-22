import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  discoverAgentDir,
  loadAgentDirConfig,
  mergeSecurityConfig,
  mergePolicyConfig,
  buildResolvedConfig,
  hasLegacyAgentFields,
} from '../../src/config/agent-loader.js';
import { AutonomyLevel } from '../../src/config/schema.js';
import type { InstanceConfig } from '../../src/config/instance-schema.js';
import { POLICY_DEFAULTS } from '../../src/config/defaults.js';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bearclaw-test-'));
}

describe('discoverAgentDir', () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('finds bearclaw.jsonc in current directory', () => {
    fs.writeFileSync(path.join(dir, 'bearclaw.jsonc'), '{}');
    expect(discoverAgentDir(dir)).toBe(dir);
  });

  it('finds bearclaw.jsonc in parent directory', () => {
    const sub = path.join(dir, 'sub', 'deep');
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(dir, 'bearclaw.jsonc'), '{}');
    expect(discoverAgentDir(sub)).toBe(dir);
  });

  it('returns null when no config found', () => {
    expect(discoverAgentDir(dir)).toBeNull();
  });
});

describe('loadAgentDirConfig', () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('loads and parses bearclaw.jsonc', () => {
    const config = {
      name: 'test-agent',
      provider: 'anthropic',
      workspace: './work',
      maxIterations: 10,
    };
    fs.writeFileSync(path.join(dir, 'bearclaw.jsonc'), JSON.stringify(config));

    const result = loadAgentDirConfig(dir);
    expect(result.name).toBe('test-agent');
    expect(result.config.provider).toBe('anthropic');
    expect(result.workspacePath).toBe(path.resolve(dir, 'work'));
    expect(result.sessionsDir).toBe(path.join(dir, '.bearclaw', 'sessions'));
  });

  it('defaults name to directory name', () => {
    const config = { provider: 'openai' };
    fs.writeFileSync(path.join(dir, 'bearclaw.jsonc'), JSON.stringify(config));

    const result = loadAgentDirConfig(dir);
    expect(result.name).toBe(path.basename(dir));
  });

  it('defaults workspace to ./workspace', () => {
    const config = { provider: 'anthropic' };
    fs.writeFileSync(path.join(dir, 'bearclaw.jsonc'), JSON.stringify(config));

    const result = loadAgentDirConfig(dir);
    expect(result.workspacePath).toBe(path.resolve(dir, 'workspace'));
  });

  it('handles JSONC comments', () => {
    const jsonc = `{
      // This is a comment
      "name": "my-agent",
      "provider": "anthropic"
    }`;
    fs.writeFileSync(path.join(dir, 'bearclaw.jsonc'), jsonc);

    const result = loadAgentDirConfig(dir);
    expect(result.name).toBe('my-agent');
  });
});

describe('mergeSecurityConfig', () => {
  const instanceSecurity: InstanceConfig['security'] = {
    encrypt: true,
    forbiddenPaths: ['/etc', '/root'],
    rateLimits: { global: 20, perAgent: 10 },
  };

  it('returns base config when no agent security', () => {
    const result = mergeSecurityConfig(instanceSecurity, undefined, '/tmp/agent');
    expect(result.forbiddenPaths).toContain('/etc');
    expect(result.forbiddenPaths).toContain('/root');
    expect(result.autonomy).toBe(AutonomyLevel.Supervised);
  });

  it('uses more restrictive autonomy', () => {
    const result = mergeSecurityConfig(instanceSecurity, {
      autonomy: AutonomyLevel.ReadOnly,
    }, '/tmp/agent');
    expect(result.autonomy).toBe(AutonomyLevel.ReadOnly);
  });

  it('does not allow agent to escalate autonomy', () => {
    const result = mergeSecurityConfig(instanceSecurity, {
      autonomy: AutonomyLevel.Full,
    }, '/tmp/agent');
    // Supervised (default) is more restrictive than Full
    expect(result.autonomy).toBe(AutonomyLevel.Supervised);
  });

  it('caps rate limits to instance ceiling', () => {
    const result = mergeSecurityConfig(instanceSecurity, {
      rateLimits: { perAgent: 50 },
    }, '/tmp/agent');
    // Instance has perAgent: 10, so agent's 50 is capped to 10
    expect(result.rateLimits.perAgent).toBe(10);
  });

  it('unions forbiddenPaths from instance', () => {
    const result = mergeSecurityConfig(instanceSecurity, {}, '/tmp/agent');
    expect(result.forbiddenPaths).toContain('/etc');
    expect(result.forbiddenPaths).toContain('/root');
  });

  it('filters allowedPaths to agent directory tree', () => {
    const agentDir = tmpDir();
    try {
      const result = mergeSecurityConfig(instanceSecurity, {
        allowedPaths: ['./workspace', '/etc/passwd'],
      }, agentDir);
      // ./workspace resolves within agent dir, so it's allowed
      expect(result.allowedPaths).toContain(path.resolve(agentDir, 'workspace'));
      // /etc/passwd is outside agent dir, so it's filtered out
      expect(result.allowedPaths).not.toContain('/etc/passwd');
    } finally {
      fs.rmSync(agentDir, { recursive: true, force: true });
    }
  });
});

describe('mergePolicyConfig', () => {
  const instancePolicy = {
    ...POLICY_DEFAULTS,
    rules: [{ id: 'instance-rule', action: 'allow' as const, scope: 'tool' as const, match: {} }],
  };

  it('returns instance policy when no agent policy', () => {
    const result = mergePolicyConfig(instancePolicy, undefined);
    expect(result).toBe(instancePolicy);
  });

  it('prepends agent rules before instance rules', () => {
    const result = mergePolicyConfig(instancePolicy, {
      rules: [{ id: 'agent-rule', action: 'deny' as const, scope: 'exec' as const, match: {} }],
    });
    expect(result.rules[0].id).toBe('agent-rule');
    expect(result.rules[1].id).toBe('instance-rule');
  });

  it('allows agent to override defaultAction', () => {
    const result = mergePolicyConfig(instancePolicy, {
      defaultAction: 'deny',
    });
    expect(result.defaultAction).toBe('deny');
  });
});

describe('hasLegacyAgentFields', () => {
  it('returns true when legacy fields present', () => {
    expect(hasLegacyAgentFields({ agents: {}, providers: {} })).toBe(true);
    expect(hasLegacyAgentFields({ workspace: { path: '.' } })).toBe(true);
  });

  it('returns false for pure instance config', () => {
    expect(hasLegacyAgentFields({ providers: {}, gateway: {} })).toBe(false);
  });
});

describe('buildResolvedConfig', () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'bearclaw.jsonc'), JSON.stringify({
      name: 'test-agent',
      provider: 'anthropic',
      maxIterations: 15,
    }));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('produces a valid BearClawConfig', () => {
    const instanceConfig: InstanceConfig = {
      providers: { anthropic: { apiKey: 'test-key', defaultModel: 'claude-3' } },
      gateway: { enabled: false, host: '127.0.0.1', port: 3000, bodyLimit: 65536, timeout: 30000, requirePairing: true, allowPublicBind: false },
      channels: { enabled: ['cli'] },
      security: { encrypt: false, forbiddenPaths: ['/etc'], rateLimits: { global: 20 } },
      monitoring: { logLevel: 'info', heartbeatInterval: 3600 },
    };

    const agentDir = loadAgentDirConfig(dir);
    const resolved = buildResolvedConfig(instanceConfig, agentDir);

    expect(resolved.workspace.path).toBe(agentDir.workspacePath);
    expect(resolved.agents['test-agent']).toBeDefined();
    expect(resolved.agents['test-agent'].provider).toBe('anthropic');
    expect(resolved.agents['test-agent'].maxIterations).toBe(15);
    expect(resolved.providers.anthropic?.apiKey).toBe('test-key');
  });
});
