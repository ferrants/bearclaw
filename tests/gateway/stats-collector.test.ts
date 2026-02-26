import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventBus } from '../../src/events.js';
import { StatsCollector } from '../../src/gateway/stats-collector.js';
import type { SessionProvider } from '../../src/gateway/ws-handler.js';
import type { ApprovalBridge } from '../../src/gateway/approval-bridge.js';

function makeSessionProvider(chats: Array<{ messageCount: number }> = []): SessionProvider {
  return {
    listChats: () => chats.map((c, i) => ({
      agentId: 'agent1',
      channel: 'websocket',
      chatId: `chat_${i}`,
      lastModified: Date.now(),
      messageCount: c.messageCount,
    })),
    getChatHistory: () => [],
  };
}

function makeApprovalBridge(pendingCount = 0): ApprovalBridge {
  return {
    listPending: () => Array.from({ length: pendingCount }, (_, i) => ({
      requestId: `req_${i}`,
      toolName: 'exec',
      args: {},
      agentId: 'agent1',
      chatId: 'chat1',
      createdAt: Date.now(),
    })),
    requestApproval: vi.fn(),
    resolveApproval: vi.fn(),
    clear: vi.fn(),
  } as unknown as ApprovalBridge;
}

describe('StatsCollector', () => {
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus();
  });

  it('returns initial stats with uptime and empty agents', () => {
    const collector = new StatsCollector(eventBus, makeSessionProvider(), makeApprovalBridge());
    const stats = collector.getStats('req1');

    expect(stats.type).toBe('stats');
    expect(stats.id).toBe('req1');
    expect(stats.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(stats.agents).toEqual([]);
    expect(stats.totalChatCount).toBe(0);
    expect(stats.totalMessages).toBe(0);
    expect(stats.pendingApprovals).toBe(0);
  });

  it('loads initial counts from session provider on first getStats', () => {
    const sessions = makeSessionProvider([{ messageCount: 5 }, { messageCount: 3 }]);
    const collector = new StatsCollector(eventBus, sessions, makeApprovalBridge());
    const stats = collector.getStats('req1');

    expect(stats.totalChatCount).toBe(2);
    expect(stats.totalMessages).toBe(8);
  });

  it('only loads from filesystem once', () => {
    const sessions = makeSessionProvider([{ messageCount: 5 }]);
    const listChatsSpy = vi.spyOn(sessions, 'listChats');
    const collector = new StatsCollector(eventBus, sessions, makeApprovalBridge());

    collector.getStats('req1');
    collector.getStats('req2');

    expect(listChatsSpy).toHaveBeenCalledTimes(1);
  });

  it('tracks agent:status events', () => {
    const collector = new StatsCollector(eventBus, makeSessionProvider(), makeApprovalBridge());

    eventBus.emit('agent:status', {
      agentId: 'agent1',
      chatId: 'chat1',
      status: 'thinking',
      contextTokens: 5000,
      maxContextTokens: 200000,
    });

    const stats = collector.getStats('req1');
    expect(stats.agents).toHaveLength(1);
    expect(stats.agents[0]).toEqual({
      agentId: 'agent1',
      status: 'thinking',
      activeChatId: 'chat1',
      contextTokens: 5000,
      maxContextTokens: 200000,
    });
  });

  it('transitions through thinking → tool_use → thinking', () => {
    const collector = new StatsCollector(eventBus, makeSessionProvider(), makeApprovalBridge());

    eventBus.emit('agent:status', {
      agentId: 'agent1', chatId: 'chat1', status: 'thinking',
      contextTokens: 1000, maxContextTokens: 200000,
    });
    let stats = collector.getStats('req1');
    expect(stats.agents[0].status).toBe('thinking');

    eventBus.emit('agent:status', {
      agentId: 'agent1', chatId: 'chat1', status: 'tool_use',
      contextTokens: 1000, maxContextTokens: 200000,
    });
    stats = collector.getStats('req2');
    expect(stats.agents[0].status).toBe('tool_use');

    eventBus.emit('agent:status', {
      agentId: 'agent1', chatId: 'chat1', status: 'thinking',
      contextTokens: 2000, maxContextTokens: 200000,
    });
    stats = collector.getStats('req3');
    expect(stats.agents[0].status).toBe('thinking');
    expect(stats.agents[0].contextTokens).toBe(2000);
  });

  it('resets to idle on agent:stopped', () => {
    const collector = new StatsCollector(eventBus, makeSessionProvider(), makeApprovalBridge());

    eventBus.emit('agent:status', {
      agentId: 'agent1', chatId: 'chat1', status: 'thinking',
      contextTokens: 5000, maxContextTokens: 200000,
    });
    eventBus.emit('agent:stopped', { agentId: 'agent1', reason: 'completed' });

    const stats = collector.getStats('req1');
    expect(stats.agents[0].status).toBe('idle');
    expect(stats.agents[0].contextTokens).toBe(0);
  });

  it('tracks multiple agents independently', () => {
    const collector = new StatsCollector(eventBus, makeSessionProvider(), makeApprovalBridge());

    eventBus.emit('agent:status', {
      agentId: 'agent1', chatId: 'chat1', status: 'thinking',
      contextTokens: 1000, maxContextTokens: 200000,
    });
    eventBus.emit('agent:status', {
      agentId: 'agent2', chatId: 'chat2', status: 'tool_use',
      contextTokens: 3000, maxContextTokens: 128000,
    });

    const stats = collector.getStats('req1');
    expect(stats.agents).toHaveLength(2);
    const a1 = stats.agents.find(a => a.agentId === 'agent1');
    const a2 = stats.agents.find(a => a.agentId === 'agent2');
    expect(a1?.status).toBe('thinking');
    expect(a2?.status).toBe('tool_use');
    expect(a2?.maxContextTokens).toBe(128000);
  });

  it('reports pending approvals count', () => {
    const collector = new StatsCollector(eventBus, makeSessionProvider(), makeApprovalBridge(3));
    const stats = collector.getStats('req1');
    expect(stats.pendingApprovals).toBe(3);
  });

  it('increments message count on agent:response events', () => {
    const collector = new StatsCollector(eventBus, makeSessionProvider([{ messageCount: 10 }]), makeApprovalBridge());

    // Trigger initialization
    collector.getStats('req1');

    eventBus.emit('agent:response', {
      agentId: 'agent1', chatId: 'chat1', content: 'hi',
      iterations: 1, toolsUsed: [],
    });

    const stats = collector.getStats('req2');
    expect(stats.totalMessages).toBe(12); // 10 initial + 2 from response
  });

  it('increments chat count on conversation:created events', () => {
    const collector = new StatsCollector(eventBus, makeSessionProvider(), makeApprovalBridge());

    // Trigger initialization
    collector.getStats('req1');

    eventBus.emit('conversation:created', { id: 'conv1', channel: 'websocket' });

    const stats = collector.getStats('req2');
    expect(stats.totalChatCount).toBe(1);
  });

  it('cleans up idle agents after timeout', () => {
    const collector = new StatsCollector(eventBus, makeSessionProvider(), makeApprovalBridge());

    eventBus.emit('agent:status', {
      agentId: 'agent1', chatId: 'chat1', status: 'thinking',
      contextTokens: 1000, maxContextTokens: 200000,
    });
    eventBus.emit('agent:stopped', { agentId: 'agent1', reason: 'completed' });

    // Manually set lastActivity to the past to simulate timeout
    const agents = (collector as any).agents as Map<string, any>;
    const state = agents.get('agent1');
    state.lastActivity = Date.now() - 6 * 60 * 1000; // 6 minutes ago

    const stats = collector.getStats('req1');
    expect(stats.agents).toHaveLength(0);
  });

  it('does not clean up active agents', () => {
    const collector = new StatsCollector(eventBus, makeSessionProvider(), makeApprovalBridge());

    eventBus.emit('agent:status', {
      agentId: 'agent1', chatId: 'chat1', status: 'thinking',
      contextTokens: 1000, maxContextTokens: 200000,
    });

    // Even with old lastActivity, thinking agents should not be cleaned up
    const agents = (collector as any).agents as Map<string, any>;
    const state = agents.get('agent1');
    state.lastActivity = Date.now() - 10 * 60 * 1000;

    const stats = collector.getStats('req1');
    expect(stats.agents).toHaveLength(1);
    expect(stats.agents[0].status).toBe('thinking');
  });
});
