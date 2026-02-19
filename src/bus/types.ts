export interface InboundMessage {
  channel: string;
  sender: string;
  chatId: string;
  messageId: string;
  message: string;
  conversationId?: string;
  agentId?: string;
  files?: string[];
  timestamp: number;
}

export interface OutboundMessage {
  channel: string;
  chatId: string;
  content: string;
  replyToMessageId?: string;
  files?: string[];
  agentId?: string;
  conversationId?: string;
}
