import type { EventBus } from '../events.js';
import type { SessionProvider } from './ws-handler.js';
import type { ApprovalBridge } from './approval-bridge.js';
import type { ServerMessage_Stats } from '@bearclaw/shared/ws-protocol';

interface AgentState {
  status: 'idle' | 'thinking' | 'tool_use';
  activeChatId: string;
  contextTokens: number;
  maxContextTokens: number;
  lastActivity: number;
}

const IDLE_CLEANUP_MS = 5 * 60 * 1000; // Remove idle agents after 5 minutes

export class StatsCollector {
  private agents = new Map<string, AgentState>();
  private startTime = Date.now();
  private totalChatCount = 0;
  private totalMessages = 0;
  private initialized = false;

  constructor(
    private eventBus: EventBus,
    private sessions: SessionProvider,
    private approvalBridge: ApprovalBridge,
  ) {
    this.subscribe();
  }

  getStats(id: string): ServerMessage_Stats {
    this.ensureInitialized();
    this.cleanupIdleAgents();

    const agents: ServerMessage_Stats['agents'] = [];
    for (const [agentId, state] of this.agents) {
      agents.push({
        agentId,
        status: state.status,
        activeChatId: state.activeChatId,
        contextTokens: state.contextTokens,
        maxContextTokens: state.maxContextTokens,
      });
    }

    const pendingApprovals = this.approvalBridge.listPending().length;

    return {
      type: 'stats',
      id,
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
      agents,
      totalChatCount: this.totalChatCount,
      totalMessages: this.totalMessages,
      pendingApprovals,
    };
  }

  private ensureInitialized(): void {
    if (this.initialized) return;
    this.initialized = true;
    // Load initial counts from filesystem once
    const chats = this.sessions.listChats();
    this.totalChatCount = chats.length;
    this.totalMessages = chats.reduce((sum, c) => sum + c.messageCount, 0);
  }

  private cleanupIdleAgents(): void {
    const now = Date.now();
    for (const [agentId, state] of this.agents) {
      if (state.status === 'idle' && now - state.lastActivity > IDLE_CLEANUP_MS) {
        this.agents.delete(agentId);
      }
    }
  }

  private subscribe(): void {
    this.eventBus.on('agent:status', (data) => {
      this.agents.set(data.agentId, {
        status: data.status,
        activeChatId: data.chatId,
        contextTokens: data.contextTokens,
        maxContextTokens: data.maxContextTokens,
        lastActivity: Date.now(),
      });
    });

    this.eventBus.on('agent:stopped', (data) => {
      const existing = this.agents.get(data.agentId);
      if (existing) {
        existing.status = 'idle';
        existing.contextTokens = 0;
        existing.lastActivity = Date.now();
      }
    });

    // Track message counts incrementally from agent:response events
    this.eventBus.on('agent:response', () => {
      // Each response means at least a user message + assistant message were added
      this.totalMessages += 2;
    });

    // Track new conversations
    this.eventBus.on('conversation:created', () => {
      this.totalChatCount++;
    });
  }
}
