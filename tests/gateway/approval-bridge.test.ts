import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApprovalBridge } from '../../src/gateway/approval-bridge.js';

describe('ApprovalBridge', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('should create and resolve an approval', async () => {
    const bridge = new ApprovalBridge();
    const { requestId, decision } = bridge.requestApproval({
      toolName: 'exec',
      args: { command: 'ls' },
      agentId: 'agent1',
      chatId: 'chat1',
      hasClients: true,
    });

    expect(requestId).toMatch(/^apr_/);
    expect(bridge.listPending()).toHaveLength(1);

    bridge.resolveApproval(requestId, true);
    const result = await decision;
    expect(result).toBe(true);
    expect(bridge.listPending()).toHaveLength(0);
  });

  it('should deny on timeout', async () => {
    const bridge = new ApprovalBridge(100, 200);
    const { decision } = bridge.requestApproval({
      toolName: 'exec',
      args: {},
      agentId: 'a',
      chatId: 'c',
      hasClients: true,
    });

    vi.advanceTimersByTime(150);
    const result = await decision;
    expect(result).toBe(false);
  });

  it('should use longer timeout when no clients', async () => {
    const bridge = new ApprovalBridge(100, 500);
    const { requestId, decision } = bridge.requestApproval({
      toolName: 'exec',
      args: {},
      agentId: 'a',
      chatId: 'c',
      hasClients: false,
    });

    // After 100ms, should still be pending
    vi.advanceTimersByTime(150);
    expect(bridge.listPending()).toHaveLength(1);

    // Resolve before wait timeout
    bridge.resolveApproval(requestId, true);
    const result = await decision;
    expect(result).toBe(true);
  });

  it('should return false for unknown requestId', () => {
    const bridge = new ApprovalBridge();
    expect(bridge.resolveApproval('nonexistent', true)).toBe(false);
  });

  it('should deny all on clear', async () => {
    const bridge = new ApprovalBridge();
    const { decision: d1 } = bridge.requestApproval({
      toolName: 'a', args: {}, agentId: 'a', chatId: 'c', hasClients: true,
    });
    const { decision: d2 } = bridge.requestApproval({
      toolName: 'b', args: {}, agentId: 'a', chatId: 'c', hasClients: true,
    });

    bridge.clear();
    expect(await d1).toBe(false);
    expect(await d2).toBe(false);
    expect(bridge.listPending()).toHaveLength(0);
  });

  it('should list pending approvals', () => {
    const bridge = new ApprovalBridge();
    bridge.requestApproval({
      toolName: 'exec', args: { command: 'rm' }, agentId: 'a1', chatId: 'c1', hasClients: true,
    });
    bridge.requestApproval({
      toolName: 'write', args: { path: '/tmp' }, agentId: 'a2', chatId: 'c2', hasClients: true,
    });

    const pending = bridge.listPending();
    expect(pending).toHaveLength(2);
    expect(pending[0].toolName).toBe('exec');
    expect(pending[1].toolName).toBe('write');
  });
});
