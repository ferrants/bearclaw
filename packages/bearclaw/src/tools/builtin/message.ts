import type { Tool, ToolContext } from '../types.js';
import { toolResult, errorResult } from '../types.js';

// Forward reference to bus - set during daemon init
export type PublishOutboundFn = (msg: {
  channel: string;
  chatId: string;
  content: string;
  agentId?: string;
  conversationId?: string;
}) => void;

let publishOutbound: PublishOutboundFn | null = null;

export function setPublishOutbound(fn: PublishOutboundFn): void {
  publishOutbound = fn;
}

export const messageTool: Tool = {
  name: 'message',
  description: 'Send a message to a specific channel and chat. Used for cross-channel communication.',
  parameters: {
    type: 'object',
    properties: {
      channel: { type: 'string', description: 'Target channel (e.g., "gateway", "cli")' },
      chatId: { type: 'string', description: 'Target chat ID' },
      content: { type: 'string', description: 'Message content to send' },
    },
    required: ['channel', 'chatId', 'content'],
  },

  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ReturnType<typeof toolResult>> {
    if (!publishOutbound) {
      return errorResult('Message bus not initialized');
    }

    const channel = args.channel as string;
    const chatId = args.chatId as string;
    const content = args.content as string;

    publishOutbound({
      channel,
      chatId,
      content,
      agentId: ctx.currentAgentConfig.name,
    });

    return toolResult(`Message sent to ${channel}:${chatId}`);
  },
};
