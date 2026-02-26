import { createLogger } from '../logging.js';
import { MAX_CONVERSATION_DURATION_MS } from '../config/defaults.js';

const log = createLogger('conversation');

export interface ConversationState {
  id: string;
  channel: string;
  chatId: string;
  pending: number;
  responses: Map<string, string>; // agentId → response
  createdAt: number;
  onComplete?: (aggregated: string) => void;
}

export class ConversationTracker {
  private conversations = new Map<string, ConversationState>();
  private reapInterval: ReturnType<typeof setInterval> | null = null;

  start(): void {
    this.reapInterval = setInterval(() => this.reap(), 60_000);
  }

  stop(): void {
    if (this.reapInterval) {
      clearInterval(this.reapInterval);
      this.reapInterval = null;
    }
  }

  create(
    id: string,
    channel: string,
    chatId: string,
    onComplete?: (aggregated: string) => void,
  ): ConversationState {
    const state: ConversationState = {
      id,
      channel,
      chatId,
      pending: 0,
      responses: new Map(),
      createdAt: Date.now(),
      onComplete,
    };
    this.conversations.set(id, state);
    log.debug('Conversation created', { id, channel });
    return state;
  }

  get(id: string): ConversationState | undefined {
    return this.conversations.get(id);
  }

  fanOut(id: string, count: number): void {
    const conv = this.conversations.get(id);
    if (!conv) return;
    conv.pending += count;
    log.debug('Fan out', { id, count, pending: conv.pending });
  }

  branchComplete(id: string, agentId: string, response: string): void {
    const conv = this.conversations.get(id);
    if (!conv) return;

    conv.responses.set(agentId, response);
    conv.pending = Math.max(0, conv.pending - 1);

    log.debug('Branch complete', { id, agentId, pending: conv.pending });

    if (conv.pending === 0) {
      this.complete(id);
    }
  }

  private complete(id: string): void {
    const conv = this.conversations.get(id);
    if (!conv) return;

    const aggregated = this.aggregate(conv);
    log.info('Conversation complete', { id, responseCount: conv.responses.size });

    conv.onComplete?.(aggregated);
    this.conversations.delete(id);
  }

  private aggregate(conv: ConversationState): string {
    const parts: string[] = [];
    for (const [agentId, response] of conv.responses) {
      parts.push(`**${agentId}:**\n${response}`);
    }
    return parts.join('\n\n');
  }

  private reap(): void {
    const now = Date.now();
    for (const [id, conv] of this.conversations) {
      if (now - conv.createdAt > MAX_CONVERSATION_DURATION_MS) {
        log.warn('Conversation timed out', {
          id,
          elapsed: now - conv.createdAt,
          pending: conv.pending,
        });

        // Partial aggregation
        const timedOut = conv.pending;
        const aggregated = this.aggregate(conv) +
          (timedOut > 0 ? `\n\n*${timedOut} agent(s) timed out.*` : '');

        conv.onComplete?.(aggregated);
        this.conversations.delete(id);
      }
    }
  }
}
