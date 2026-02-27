import { describe, it, expect, vi } from 'vitest';
import { configExplainTool } from '../../src/tools/builtin/config-explain.js';
import { createConfigGetTool } from '../../src/tools/builtin/config-get.js';
import { createConfigSetTool } from '../../src/tools/builtin/config-set.js';
import { ConfigManager } from '../../src/config/manager.js';
import { defaultInstanceConfig } from '../../src/config/config.js';
import type { ToolContext } from '../../src/tools/types.js';

vi.mock('../../src/config/config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/config/config.js')>();
  return {
    ...actual,
    saveConfig: vi.fn(),
  };
});

const dummyCtx = {} as ToolContext;

describe('config_explain', () => {
  it('returns all docs when no section specified', async () => {
    const result = await configExplainTool.execute(dummyCtx, {});
    expect(result.isError).toBe(false);
    expect(result.forLLM).toContain('security.encrypt');
    expect(result.forLLM).toContain('monitoring.logLevel');
  });

  it('filters by section prefix', async () => {
    const result = await configExplainTool.execute(dummyCtx, { section: 'security' });
    expect(result.isError).toBe(false);
    expect(result.forLLM).toContain('security.encrypt');
    expect(result.forLLM).not.toContain('monitoring.logLevel');
  });

  it('returns helpful message for unknown section', async () => {
    const result = await configExplainTool.execute(dummyCtx, { section: 'nonexistent' });
    expect(result.isError).toBe(false);
    expect(result.forLLM).toContain('No configuration fields found');
    expect(result.forLLM).toContain('Available sections');
  });
});

describe('config_get', () => {
  it('returns a specific value', async () => {
    const config = defaultInstanceConfig();
    const manager = new ConfigManager(config);
    const tool = createConfigGetTool(manager);

    const result = await tool.execute(dummyCtx, { path: 'security.encrypt' });
    expect(result.isError).toBe(false);
    expect(result.forLLM).toContain('true');
  });

  it('returns error for missing path', async () => {
    const config = defaultInstanceConfig();
    const manager = new ConfigManager(config);
    const tool = createConfigGetTool(manager);

    const result = await tool.execute(dummyCtx, { path: 'nonexistent.field' });
    expect(result.isError).toBe(true);
    expect(result.forLLM).toContain('not found');
  });

  it('returns full config when no path specified', async () => {
    const config = defaultInstanceConfig();
    const manager = new ConfigManager(config);
    const tool = createConfigGetTool(manager);

    const result = await tool.execute(dummyCtx, {});
    expect(result.isError).toBe(false);
    const parsed = JSON.parse(result.forLLM);
    expect(parsed.security).toBeDefined();
    expect(parsed.monitoring).toBeDefined();
  });

  it('redacts API keys', async () => {
    const config = defaultInstanceConfig();
    config.providers.anthropic = { apiKey: 'sk-secret-key', defaultModel: 'claude-3' };
    const manager = new ConfigManager(config);
    const tool = createConfigGetTool(manager);

    const result = await tool.execute(dummyCtx, { path: 'providers.anthropic' });
    expect(result.isError).toBe(false);
    expect(result.forLLM).toContain('REDACTED');
    expect(result.forLLM).not.toContain('sk-secret-key');
    // Model should still be visible
    expect(result.forLLM).toContain('claude-3');
  });
});

describe('config_set', () => {
  it('updates a non-security field without approval', async () => {
    const config = defaultInstanceConfig();
    const manager = new ConfigManager(config);
    const requestApproval = vi.fn();
    const tool = createConfigSetTool(manager, requestApproval);

    const result = await tool.execute(dummyCtx, { path: 'monitoring.logLevel', value: 'debug' });
    expect(result.isError).toBe(false);
    expect(result.forLLM).toContain('debug');
    expect(requestApproval).not.toHaveBeenCalled();
    expect(manager.get('monitoring.logLevel')).toBe('debug');
  });

  it('requires approval for security fields', async () => {
    const config = defaultInstanceConfig();
    const manager = new ConfigManager(config);
    const requestApproval = vi.fn().mockResolvedValue(true);
    const tool = createConfigSetTool(manager, requestApproval);

    const result = await tool.execute(dummyCtx, { path: 'security.encrypt', value: 'false' });
    expect(result.isError).toBe(false);
    expect(requestApproval).toHaveBeenCalledTimes(1);
    expect(manager.get('security.encrypt')).toBe(false);
  });

  it('denies when approval is rejected', async () => {
    const config = defaultInstanceConfig();
    const manager = new ConfigManager(config);
    const requestApproval = vi.fn().mockResolvedValue(false);
    const tool = createConfigSetTool(manager, requestApproval);

    const result = await tool.execute(dummyCtx, { path: 'security.encrypt', value: 'false' });
    expect(result.isError).toBe(true);
    expect(result.forLLM).toContain('denied');
    // Value should not change
    expect(manager.get('security.encrypt')).toBe(true);
  });

  it('rejects unknown paths', async () => {
    const config = defaultInstanceConfig();
    const manager = new ConfigManager(config);
    const tool = createConfigSetTool(manager, vi.fn());

    const result = await tool.execute(dummyCtx, { path: 'nonexistent.field', value: 'test' });
    expect(result.isError).toBe(true);
    expect(result.forLLM).toContain('Unknown config path');
  });

  it('coerces string to boolean', async () => {
    const config = defaultInstanceConfig();
    const manager = new ConfigManager(config);
    const tool = createConfigSetTool(manager, vi.fn());

    await tool.execute(dummyCtx, { path: 'gateway.enabled', value: 'true' });
    expect(manager.get('gateway.enabled')).toBe(true);
  });

  it('coerces string to number', async () => {
    const config = defaultInstanceConfig();
    const manager = new ConfigManager(config);
    const tool = createConfigSetTool(manager, vi.fn());

    await tool.execute(dummyCtx, { path: 'gateway.port', value: '8080' });
    expect(manager.get('gateway.port')).toBe(8080);
  });
});
