import { type ApprovalScope } from '../config/schema.js';

export interface ApprovalPrompt {
  requestApproval(prompt: string, channel: string, chatId: string): Promise<boolean>;
}

interface CachedApproval {
  key: string;
  expiresAt: number;
}

export class ApprovalManager {
  private cache: CachedApproval[] = [];
  private prompt: ApprovalPrompt | null = null;

  constructor(
    private scope: ApprovalScope,
    private cacheTTLSeconds: number,
    private cacheEnabled: boolean,
  ) {}

  setPrompt(prompt: ApprovalPrompt): void {
    this.prompt = prompt;
  }

  async requestApproval(
    toolName: string,
    channel: string,
    chatId: string,
    userId: string,
    promptText?: string,
  ): Promise<boolean> {
    const key = this.buildKey(toolName, channel, chatId, userId);

    // Check cache
    if (this.cacheEnabled) {
      this.pruneCache();
      if (this.cache.some(c => c.key === key)) {
        return true;
      }
    }

    // Request approval
    if (!this.prompt) {
      return false;
    }

    const text = promptText ?? `Approve tool call: ${toolName}?`;
    const approved = await this.prompt.requestApproval(text, channel, chatId);

    if (approved && this.cacheEnabled) {
      this.cache.push({
        key,
        expiresAt: Date.now() + this.cacheTTLSeconds * 1000,
      });
    }

    return approved;
  }

  isApproved(toolName: string, channel: string, chatId: string, userId: string): boolean {
    if (!this.cacheEnabled) return false;
    this.pruneCache();
    const key = this.buildKey(toolName, channel, chatId, userId);
    return this.cache.some(c => c.key === key);
  }

  private buildKey(toolName: string, channel: string, chatId: string, userId: string): string {
    switch (this.scope) {
      case 'user+channel':
        return `${userId}:${channel}:${toolName}`;
      case 'conversation':
        return `${chatId}:${toolName}`;
      case 'global':
        return toolName;
    }
  }

  private pruneCache(): void {
    const now = Date.now();
    this.cache = this.cache.filter(c => c.expiresAt > now);
  }
}
