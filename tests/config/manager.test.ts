import { describe, it, expect, vi } from 'vitest';
import { ConfigManager } from '../../src/config/manager.js';
import { defaultConfig } from '../../src/config/config.js';

vi.mock('../../src/config/config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/config/config.js')>();
  return {
    ...actual,
    saveConfig: vi.fn(),
  };
});

function makeConfig() {
  return defaultConfig();
}

describe('ConfigManager', () => {
  describe('get()', () => {
    it('traverses dotted paths correctly', () => {
      const config = makeConfig();
      const manager = new ConfigManager(config);

      expect(manager.get('security.autonomy')).toBe('supervised');
      expect(manager.get('monitoring.logLevel')).toBe('info');
      expect(manager.get('gateway.port')).toBe(3000);
      expect(manager.get('memory.enabled')).toBe(true);
    });

    it('returns undefined for missing paths', () => {
      const config = makeConfig();
      const manager = new ConfigManager(config);

      expect(manager.get('nonexistent')).toBeUndefined();
      expect(manager.get('security.nonexistent')).toBeUndefined();
      expect(manager.get('deeply.nested.missing.path')).toBeUndefined();
    });

    it('returns objects for non-leaf paths', () => {
      const config = makeConfig();
      const manager = new ConfigManager(config);

      const security = manager.get('security') as Record<string, unknown>;
      expect(security).toBeDefined();
      expect(security.autonomy).toBe('supervised');
    });
  });

  describe('set()', () => {
    it('updates value and calls listeners', () => {
      const config = makeConfig();
      const manager = new ConfigManager(config);
      const listener = vi.fn();
      manager.onReload(listener);

      manager.set('monitoring.logLevel', 'debug');

      expect(manager.get('monitoring.logLevel')).toBe('debug');
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(config);
    });

    it('creates intermediate objects if needed', () => {
      const config = makeConfig();
      const manager = new ConfigManager(config);

      manager.set('providers.anthropic.apiKey', 'test-key');

      expect(manager.get('providers.anthropic.apiKey')).toBe('test-key');
    });

    it('handles multiple listeners', () => {
      const config = makeConfig();
      const manager = new ConfigManager(config);
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      manager.onReload(listener1);
      manager.onReload(listener2);

      manager.set('gateway.port', 4000);

      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);
    });
  });

  describe('getConfig()', () => {
    it('returns the config object', () => {
      const config = makeConfig();
      const manager = new ConfigManager(config);

      expect(manager.getConfig()).toBe(config);
    });
  });
});
