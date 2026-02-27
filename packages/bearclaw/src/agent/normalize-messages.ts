import type { Message } from '../providers/types.js';

export interface NormalizeMessagesResult {
  messages: Message[];
  droppedToolMessages: number;
  droppedToolCalls: number;
}

export function normalizeMessages(messages: Message[]): NormalizeMessagesResult {
  const normalized: Message[] = [];
  let pending: { assistant: Message; remaining: Set<string>; tools: Message[] } | null = null;
  let droppedToolMessages = 0;
  let droppedToolCalls = 0;

  for (const message of messages) {
    if (pending) {
      if (message.role === 'tool') {
        const toolCallId = message.toolCallId;
        if (!toolCallId || !pending.remaining.has(toolCallId)) {
          droppedToolMessages += 1;
          continue;
        }
        pending.tools.push(message);
        pending.remaining.delete(toolCallId);
        if (pending.remaining.size === 0) {
          normalized.push(pending.assistant, ...pending.tools);
          pending = null;
        }
        continue;
      }

      // Pending tool calls were not fully satisfied. Keep assistant content, drop tool_calls.
      droppedToolCalls += pending.remaining.size;
      normalized.push({ ...pending.assistant, toolCalls: undefined });
      pending = null;
    }

    if (message.role === 'assistant' && message.toolCalls && message.toolCalls.length > 0) {
      const ids = message.toolCalls.map(tc => tc.id).filter(Boolean);
      if (ids.length === 0) {
        normalized.push({ ...message, toolCalls: undefined });
      } else {
        pending = { assistant: message, remaining: new Set(ids), tools: [] };
      }
      continue;
    }

    if (message.role === 'tool') {
      droppedToolMessages += 1;
      continue;
    }

    normalized.push(message);
  }

  if (pending) {
    droppedToolCalls += pending.remaining.size;
    normalized.push({ ...pending.assistant, toolCalls: undefined });
  }

  return { messages: normalized, droppedToolMessages, droppedToolCalls };
}
