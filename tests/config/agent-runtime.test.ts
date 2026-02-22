import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createAgentRuntime } from '../../src/config/agent-runtime-factory.js';
import { loadAgentDirConfig } from '../../src/config/agent-loader.js';
import type { InstanceConfig } from '../../src/config/instance-schema.js';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bearclaw-rt-'));
}

describe('createAgentRuntime', () => {
  let dir: string;
  let configDir: string;

  const instanceConfig: InstanceConfig = {
    providers: { anthropic: { apiKey: 'test-key', defaultModel: 'claude-3' } },
    gateway: { enabled: false, host: '127.0.0.1', port: 3000, bodyLimit: 65536, timeout: 30000, requirePairing: true, allowPublicBind: false },
    channels: { enabled: ['cli'] },
    security: { encrypt: false, forbiddenPaths: ['/etc'], rateLimits: { global: 20 } },
    monitoring: { logLevel: 'info', heartbeatInterval: 3600 },
  };

  beforeEach(() => {
    dir = tmpDir();
    configDir = tmpDir();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  it('creates a runtime with correct name and paths', async () => {
    fs.writeFileSync(path.join(dir, 'bearclaw.jsonc'), JSON.stringify({
      name: 'test-agent',
      provider: 'anthropic',
      maxIterations: 10,
    }));

    const agentDir = loadAgentDirConfig(dir);
    const runtime = await createAgentRuntime({
      agentDir,
      instanceConfig,
      configDir,
    });

    expect(runtime.name).toBe('test-agent');
    expect(runtime.dir).toBe(path.resolve(dir));
    expect(runtime.workspacePath).toBe(path.resolve(dir, 'workspace'));
    expect(runtime.sessionsDir).toBe(path.join(dir, '.bearclaw', 'sessions'));
  });

  it('has per-agent security policy', async () => {
    fs.writeFileSync(path.join(dir, 'bearclaw.jsonc'), JSON.stringify({
      name: 'secure-agent',
      provider: 'anthropic',
    }));

    const agentDir = loadAgentDirConfig(dir);
    const runtime = await createAgentRuntime({
      agentDir,
      instanceConfig,
      configDir,
    });

    expect(runtime.policy).toBeDefined();
    expect(runtime.policyEngine).toBeDefined();
    expect(runtime.inlineAllowStore).toBeDefined();
  });

  it('loads skills from agent dir', async () => {
    // Create a skill in the agent dir
    const skillDir = path.join(dir, 'skills', 'greet');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---
name: greet
description: Say hello
---
Hello!
`);

    fs.writeFileSync(path.join(dir, 'bearclaw.jsonc'), JSON.stringify({
      name: 'skilled-agent',
      provider: 'anthropic',
    }));

    const agentDir = loadAgentDirConfig(dir);
    const runtime = await createAgentRuntime({
      agentDir,
      instanceConfig,
      configDir,
    });

    expect(runtime.skills.some(s => s.name === 'greet')).toBe(true);
  });

  it('includes subagents in agentConfigs', async () => {
    fs.writeFileSync(path.join(dir, 'bearclaw.jsonc'), JSON.stringify({
      name: 'parent',
      provider: 'anthropic',
      subagents: {
        helper: { name: 'helper', provider: 'anthropic' },
      },
    }));

    const agentDir = loadAgentDirConfig(dir);
    const runtime = await createAgentRuntime({
      agentDir,
      instanceConfig,
      configDir,
    });

    expect(runtime.agentConfigs['parent']).toBeDefined();
    expect(runtime.agentConfigs['helper']).toBeDefined();
    expect(runtime.primaryAgentConfig.name).toBe('parent');
  });
});
