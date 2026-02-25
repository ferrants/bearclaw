import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { UserRuleStore } from '../../src/security/user-rules.js';
import { PolicyEngine } from '../../src/security/policy-engine.js';

describe('UserRuleStore', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bearclaw-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should add and list rules', () => {
    const store = new UserRuleStore(tmpDir);
    const id = store.addRule({ action: 'allow', toolName: 'exec', createdBy: 'cli' });

    expect(id).toMatch(/^ur_/);
    const rules = store.listRules();
    expect(rules).toHaveLength(1);
    expect(rules[0].action).toBe('allow');
    expect(rules[0].toolName).toBe('exec');
    expect(rules[0].createdBy).toBe('cli');
    expect(rules[0].createdAt).toBeTruthy();
  });

  it('should remove rules by id', () => {
    const store = new UserRuleStore(tmpDir);
    const id1 = store.addRule({ action: 'allow', toolName: 'exec', createdBy: 'cli' });
    store.addRule({ action: 'deny', toolName: 'web_fetch', createdBy: 'ws-approval' });

    expect(store.listRules()).toHaveLength(2);

    const removed = store.removeRule(id1);
    expect(removed).toBe(true);
    expect(store.listRules()).toHaveLength(1);
    expect(store.listRules()[0].toolName).toBe('web_fetch');
  });

  it('should return false for removing non-existent rule', () => {
    const store = new UserRuleStore(tmpDir);
    expect(store.removeRule('nonexistent')).toBe(false);
  });

  it('should persist rules to disk and reload', () => {
    const store1 = new UserRuleStore(tmpDir);
    store1.addRule({ action: 'allow', toolName: 'exec', agentId: 'agent1', createdBy: 'cli' });
    store1.addRule({ action: 'deny', toolName: 'web_fetch', createdBy: 'ws-approval' });

    // Create a new store from the same dir — should load persisted rules
    const store2 = new UserRuleStore(tmpDir);
    const rules = store2.listRules();
    expect(rules).toHaveLength(2);
    expect(rules[0].toolName).toBe('exec');
    expect(rules[0].agentId).toBe('agent1');
    expect(rules[1].toolName).toBe('web_fetch');
    expect(rules[1].agentId).toBeUndefined();
  });

  it('should start empty when no file exists', () => {
    const store = new UserRuleStore(tmpDir);
    expect(store.listRules()).toHaveLength(0);
  });

  it('should convert to PolicyRule[]', () => {
    const store = new UserRuleStore(tmpDir);
    store.addRule({ action: 'allow', toolName: 'exec', agentId: 'a1', createdBy: 'cli' });
    store.addRule({ action: 'deny', toolName: 'web_fetch', createdBy: 'ws-approval' });

    const policyRules = store.toPolicyRules();
    expect(policyRules).toHaveLength(2);

    expect(policyRules[0].action).toBe('allow');
    expect(policyRules[0].scope).toBe('exec');
    expect(policyRules[0].match.toolName).toBe('exec');
    expect(policyRules[0].match.agentId).toBe('a1');

    expect(policyRules[1].action).toBe('deny');
    expect(policyRules[1].scope).toBe('web');
    expect(policyRules[1].match.toolName).toBe('web_fetch');
    expect(policyRules[1].match.agentId).toBeUndefined();
  });

  it('should map tool scope correctly', () => {
    const store = new UserRuleStore(tmpDir);
    store.addRule({ action: 'allow', toolName: 'read_file', createdBy: 'cli' });
    store.addRule({ action: 'allow', toolName: 'message', createdBy: 'cli' });

    const policyRules = store.toPolicyRules();
    expect(policyRules[0].scope).toBe('tool');
    expect(policyRules[1].scope).toBe('message');
  });

  describe('integration with PolicyEngine', () => {
    it('user rules should take priority over config rules', () => {
      const store = new UserRuleStore(tmpDir);
      store.addRule({ action: 'allow', toolName: 'exec', agentId: 'a1', createdBy: 'cli' });

      const engine = new PolicyEngine({
        defaultAction: 'approve',
        denyPrecedence: false,
        approvalScope: 'global',
        learningMode: 'suggest_rules',
        rules: [
          { id: 'r1', action: 'deny', scope: 'exec', match: { toolName: 'exec' } },
        ],
        approvals: { cache: false, defaultTTLSeconds: 300 },
        inlineAllow: { enabled: true, dayScopeHours: 24 },
        web: { mode: 'allow_with_blocklist', blockedDomains: [], blockedCidrs: [], blockedHosts: [] },
      }, tmpDir);

      engine.setUserRules(store.toPolicyRules());

      // User rule (allow) should win over config rule (deny) because it's checked first
      const decision = engine.evaluate({ toolName: 'exec', scope: 'exec', agentId: 'a1' });
      expect(decision.action).toBe('allow');
    });

    it('user rules with deny should block even if config allows', () => {
      const store = new UserRuleStore(tmpDir);
      store.addRule({ action: 'deny', toolName: 'exec', agentId: 'a1', createdBy: 'ws-approval' });

      const engine = new PolicyEngine({
        defaultAction: 'allow',
        denyPrecedence: false,
        approvalScope: 'global',
        learningMode: 'suggest_rules',
        rules: [
          { id: 'r1', action: 'allow', scope: 'exec', match: { toolName: 'exec' } },
        ],
        approvals: { cache: false, defaultTTLSeconds: 300 },
        inlineAllow: { enabled: true, dayScopeHours: 24 },
        web: { mode: 'allow_with_blocklist', blockedDomains: [], blockedCidrs: [], blockedHosts: [] },
      }, tmpDir);

      engine.setUserRules(store.toPolicyRules());

      const decision = engine.evaluate({ toolName: 'exec', scope: 'exec', agentId: 'a1' });
      expect(decision.action).toBe('deny');
    });

    it('user rule scoped to agentId should not match other agents', () => {
      const store = new UserRuleStore(tmpDir);
      store.addRule({ action: 'allow', toolName: 'exec', agentId: 'a1', createdBy: 'cli' });

      const engine = new PolicyEngine({
        defaultAction: 'approve',
        denyPrecedence: false,
        approvalScope: 'global',
        learningMode: 'suggest_rules',
        rules: [],
        approvals: { cache: false, defaultTTLSeconds: 300 },
        inlineAllow: { enabled: true, dayScopeHours: 24 },
        web: { mode: 'allow_with_blocklist', blockedDomains: [], blockedCidrs: [], blockedHosts: [] },
      }, tmpDir);

      engine.setUserRules(store.toPolicyRules());

      // Should not match agent 'a2'
      const decision = engine.evaluate({ toolName: 'exec', scope: 'exec', agentId: 'a2' });
      expect(decision.action).toBe('approve'); // falls through to default
    });
  });
});
