import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { buildSystemPrompt, truncateFile, truncateTotal } from '../../src/agent/context.js';
import { ToolRegistryImpl } from '../../src/tools/registry.js';
import type { BearClawConfig, AgentConfig } from '../../src/config/schema.js';
import { AutonomyLevel } from '../../src/config/schema.js';

function makeConfig(workspacePath: string): BearClawConfig {
  return {
    workspace: { path: workspacePath },
    security: {
      autonomy: AutonomyLevel.Supervised,
      workspaceOnly: true,
      allowedCommands: [],
      restrictedCommands: {},
      forbiddenPaths: [],
      allowedPaths: [],
      rateLimits: { global: 20 },
      encrypt: false,
    },
    gateway: { enabled: false, host: '127.0.0.1', port: 3000, bodyLimit: 65536, timeout: 30000, requirePairing: true, allowPublicBind: false },
    providers: {},
    channels: { enabled: ['cli'] },
    agents: {},
    teams: {},
    memory: { enabled: true, dir: 'memory', alwaysLoad: ['tasks.md'] },
    policy: {
      defaultAction: 'approve',
      denyPrecedence: true,
      approvalScope: 'user+channel',
      learningMode: 'suggest_rules',
      rules: [],
      approvals: { cache: false, defaultTTLSeconds: 300 },
      inlineAllow: { enabled: true, dayScopeHours: 24 },
      web: { mode: 'allow_with_blocklist', blockedDomains: [], blockedCidrs: [], blockedHosts: [] },
    },
    schedules: [],
    monitoring: { logLevel: 'info', heartbeatInterval: 3600 },
  } as BearClawConfig;
}

function makeAgent(overrides?: Partial<AgentConfig>): AgentConfig {
  return {
    name: 'test',
    provider: 'anthropic',
    systemPromptFiles: [],
    ...overrides,
  };
}

describe('buildSystemPrompt', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bearclaw-context-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('wraps system prompt files with ## heading', () => {
    fs.writeFileSync(path.join(tmpDir, 'SOUL.md'), 'You are a helpful assistant.');
    const config = makeConfig(tmpDir);
    const agent = makeAgent({ systemPromptFiles: ['SOUL.md'] });
    const registry = new ToolRegistryImpl();

    const prompt = buildSystemPrompt(agent, config, registry);
    expect(prompt).toContain('## SOUL.md');
    expect(prompt).toContain('You are a helpful assistant.');
  });

  it('wraps nested-path prompt files with basename heading', () => {
    fs.mkdirSync(path.join(tmpDir, 'prompts'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'prompts', 'IDENTITY.md'), 'I am BearClaw.');
    const config = makeConfig(tmpDir);
    const agent = makeAgent({ systemPromptFiles: ['prompts/IDENTITY.md'] });
    const registry = new ToolRegistryImpl();

    const prompt = buildSystemPrompt(agent, config, registry);
    expect(prompt).toContain('## IDENTITY.md');
    expect(prompt).toContain('I am BearClaw.');
  });

  it('skips missing prompt files gracefully', () => {
    const config = makeConfig(tmpDir);
    const agent = makeAgent({ systemPromptFiles: ['nonexistent.md'] });
    const registry = new ToolRegistryImpl();

    const prompt = buildSystemPrompt(agent, config, registry);
    expect(prompt).not.toContain('nonexistent');
  });

  it('wraps memory files with ## Memory: heading', () => {
    const memDir = path.join(tmpDir, 'memory');
    fs.mkdirSync(memDir, { recursive: true });
    fs.writeFileSync(path.join(memDir, 'tasks.md'), '- Fix the bug');
    const config = makeConfig(tmpDir);
    const agent = makeAgent();
    const registry = new ToolRegistryImpl();

    const prompt = buildSystemPrompt(agent, config, registry);
    expect(prompt).toContain('## Memory');
    expect(prompt).toContain('### tasks.md');
    expect(prompt).toContain('- Fix the bug');
    expect(prompt).toContain('Memory directory:');
    expect(prompt).toContain('Use absolute paths when reading/writing memory files.');
  });

  it('wraps tools section with ## Tools heading', () => {
    const config = makeConfig(tmpDir);
    const agent = makeAgent();
    const registry = new ToolRegistryImpl();
    registry.register({
      name: 'read_file',
      description: 'Read a file',
      parameters: { type: 'object', properties: {} },
      execute: async () => ({ forLLM: '', isError: false, async: false }),
    });

    const prompt = buildSystemPrompt(agent, config, registry);
    expect(prompt).toContain('## Tools');
    expect(prompt).toContain('- read_file: Read a file');
  });

  it('includes skills section', () => {
    const config = makeConfig(tmpDir);
    const agent = makeAgent();
    const registry = new ToolRegistryImpl();
    const skills = [
      { name: 'deploy', description: 'Deploy the app', dir: '', instructions: '' },
    ];

    const prompt = buildSystemPrompt(agent, config, registry, undefined, skills);
    expect(prompt).toContain('## Available Skills');
    expect(prompt).toContain('- deploy: Deploy the app');
  });

  it('excludes skills with disableModelInvocation from system prompt', () => {
    const config = makeConfig(tmpDir);
    const agent = makeAgent();
    const registry = new ToolRegistryImpl();
    const skills = [
      { name: 'deploy', description: 'Deploy the app', dir: '', instructions: '' },
      { name: 'secret', description: 'Secret skill', dir: '', instructions: '', disableModelInvocation: true },
    ];

    const prompt = buildSystemPrompt(agent, config, registry, undefined, skills);
    expect(prompt).toContain('- deploy: Deploy the app');
    expect(prompt).not.toContain('secret');
  });

  it('omits skills section when all skills have disableModelInvocation', () => {
    const config = makeConfig(tmpDir);
    const agent = makeAgent();
    const registry = new ToolRegistryImpl();
    const skills = [
      { name: 'hidden', description: 'Hidden', dir: '', instructions: '', disableModelInvocation: true },
    ];

    const prompt = buildSystemPrompt(agent, config, registry, undefined, skills);
    expect(prompt).not.toContain('Available Skills');
  });

  it('includes team context', () => {
    const config = makeConfig(tmpDir);
    const agent = makeAgent();
    const registry = new ToolRegistryImpl();
    const teamContext = {
      team: { name: 'alpha', agents: ['a', 'b'], leaderAgent: 'a' },
      teammates: ['agent-a', 'agent-b'],
    };

    const prompt = buildSystemPrompt(agent, config, registry, teamContext);
    expect(prompt).toContain('## Team: alpha');
    expect(prompt).toContain('agent-a, agent-b');
  });

  it('truncates large prompt files', () => {
    const bigContent = 'x'.repeat(25_000);
    fs.writeFileSync(path.join(tmpDir, 'BIG.md'), bigContent);
    const config = makeConfig(tmpDir);
    const agent = makeAgent({ systemPromptFiles: ['BIG.md'] });
    const registry = new ToolRegistryImpl();

    const prompt = buildSystemPrompt(agent, config, registry);
    expect(prompt).toContain('[...truncated...]');
    expect(prompt.length).toBeLessThan(bigContent.length);
  });

  it('truncates total prompt when it exceeds budget', () => {
    // Create multiple files that together exceed the total budget
    for (let i = 0; i < 3; i++) {
      fs.writeFileSync(path.join(tmpDir, `file${i}.md`), 'y'.repeat(10_000));
    }
    const config = makeConfig(tmpDir);
    const agent = makeAgent({ systemPromptFiles: ['file0.md', 'file1.md', 'file2.md'] });
    const registry = new ToolRegistryImpl();

    const prompt = buildSystemPrompt(agent, config, registry);
    expect(prompt).toContain('[...system prompt truncated...]');
    // Total should be within budget (24k + marker overhead)
    expect(prompt.length).toBeLessThanOrEqual(24_000 + 50);
  });
});

describe('truncateFile', () => {
  it('returns content unchanged when under limit', () => {
    const content = 'short content';
    expect(truncateFile(content, 1000)).toBe(content);
  });

  it('truncates with head/tail split and marker', () => {
    const content = 'A'.repeat(500) + 'B'.repeat(500);
    const result = truncateFile(content, 200);

    expect(result).toContain('[...truncated...]');
    expect(result.length).toBeLessThan(content.length);
    // Head should be 70% of 200 = 140 chars of 'A'
    expect(result.startsWith('A'.repeat(140))).toBe(true);
    // Tail should be 20% of 200 = 40 chars of 'B'
    expect(result.endsWith('B'.repeat(40))).toBe(true);
  });

  it('preserves exact boundary content', () => {
    const content = 'x'.repeat(100);
    expect(truncateFile(content, 100)).toBe(content);
    expect(truncateFile(content, 101)).toBe(content);
  });
});

describe('truncateTotal', () => {
  it('returns content unchanged when under limit', () => {
    expect(truncateTotal('hello', 1000)).toBe('hello');
  });

  it('uses different marker than file truncation', () => {
    const content = 'z'.repeat(500);
    const result = truncateTotal(content, 100);
    expect(result).toContain('[...system prompt truncated...]');
    expect(result).not.toContain('[...truncated...]');
  });
});
