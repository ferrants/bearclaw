import {
  type LLMProvider,
  type Message,
  type ToolDefinition,
  type LLMResponse,
  type ChatOptions,
  type ToolCall,
} from './types.js';
import { fetchWithRetry } from './retry.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

export class AnthropicProvider implements LLMProvider {
  constructor(
    private apiKey: string,
    public defaultModel: string = 'claude-sonnet-4-5-20250929',
  ) {}

  async chat(
    messages: Message[],
    tools: ToolDefinition[],
    model: string,
    options?: ChatOptions,
  ): Promise<LLMResponse> {
    // Separate system messages
    const systemMessages = messages.filter(m => m.role === 'system');
    const chatMessages = messages.filter(m => m.role !== 'system');

    const system = systemMessages.map(m => m.content).join('\n\n') || undefined;

    const body: Record<string, unknown> = {
      model,
      max_tokens: options?.maxTokens ?? 4096,
      messages: this.translateMessages(chatMessages),
    };

    if (system) body.system = system;
    if (tools.length > 0) body.tools = this.translateTools(tools);
    if (options?.temperature !== undefined) body.temperature = options.temperature;

    if (options?.onToken) {
      return this.chatStream(body, options);
    }

    const resp = await fetchWithRetry(API_URL, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: options?.signal,
    });

    const data = await resp.json() as Record<string, unknown>;
    return this.parseResponse(data);
  }

  private async chatStream(body: Record<string, unknown>, options: ChatOptions): Promise<LLMResponse> {
    body.stream = true;

    const resp = await fetchWithRetry(API_URL, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: options.signal,
    });

    const reader = resp.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    const toolCalls: ToolCall[] = [];
    let currentToolUse: { id: string; name: string; jsonStr: string } | null = null;
    let usage: LLMResponse['usage'] | undefined;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') continue;

        let event: Record<string, unknown>;
        try {
          event = JSON.parse(data);
        } catch {
          continue;
        }

        const type = event.type as string;

        if (type === 'content_block_start') {
          const block = event.content_block as Record<string, unknown>;
          if (block.type === 'tool_use') {
            currentToolUse = {
              id: block.id as string,
              name: block.name as string,
              jsonStr: '',
            };
          }
        } else if (type === 'content_block_delta') {
          const delta = event.delta as Record<string, unknown>;
          if (delta.type === 'text_delta') {
            const text = delta.text as string;
            content += text;
            options.onToken?.(text);
          } else if (delta.type === 'input_json_delta' && currentToolUse) {
            currentToolUse.jsonStr += delta.partial_json as string;
          }
        } else if (type === 'content_block_stop') {
          if (currentToolUse) {
            try {
              toolCalls.push({
                id: currentToolUse.id,
                name: currentToolUse.name,
                arguments: JSON.parse(currentToolUse.jsonStr || '{}'),
              });
            } catch {
              toolCalls.push({
                id: currentToolUse.id,
                name: currentToolUse.name,
                arguments: {},
              });
            }
            currentToolUse = null;
          }
        } else if (type === 'message_delta') {
          const msgUsage = event.usage as Record<string, number> | undefined;
          if (msgUsage) {
            usage = {
              promptTokens: usage?.promptTokens ?? 0,
              completionTokens: msgUsage.output_tokens ?? 0,
              totalTokens: (usage?.promptTokens ?? 0) + (msgUsage.output_tokens ?? 0),
            };
          }
        } else if (type === 'message_start') {
          const message = event.message as Record<string, unknown>;
          const msgUsage = message.usage as Record<string, number> | undefined;
          if (msgUsage) {
            usage = {
              promptTokens: msgUsage.input_tokens ?? 0,
              completionTokens: 0,
              totalTokens: msgUsage.input_tokens ?? 0,
            };
          }
        }
      }
    }

    return {
      content,
      toolCalls,
      finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
      usage,
    };
  }

  private translateMessages(messages: Message[]): unknown[] {
    return messages.map(m => {
      if (m.role === 'assistant' && m.toolCalls?.length) {
        const content: unknown[] = [];
        if (m.content) content.push({ type: 'text', text: m.content });
        for (const tc of m.toolCalls) {
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            input: tc.arguments,
          });
        }
        return { role: 'assistant', content };
      }

      if (m.role === 'tool') {
        return {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: m.toolCallId,
            content: m.content,
          }],
        };
      }

      return { role: m.role, content: m.content };
    });
  }

  private translateTools(tools: ToolDefinition[]): unknown[] {
    return tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));
  }

  private parseResponse(data: Record<string, unknown>): LLMResponse {
    const content: unknown[] = (data.content as unknown[]) ?? [];
    let text = '';
    const toolCalls: ToolCall[] = [];

    for (const block of content) {
      const b = block as Record<string, unknown>;
      if (b.type === 'text') {
        text += b.text as string;
      } else if (b.type === 'tool_use') {
        toolCalls.push({
          id: b.id as string,
          name: b.name as string,
          arguments: (b.input as Record<string, unknown>) ?? {},
        });
      }
    }

    const stopReason = data.stop_reason as string;
    const usage = data.usage as Record<string, number> | undefined;

    return {
      content: text,
      toolCalls,
      finishReason: stopReason === 'tool_use' ? 'tool_calls'
        : stopReason === 'max_tokens' ? 'length'
        : 'stop',
      usage: usage ? {
        promptTokens: usage.input_tokens ?? 0,
        completionTokens: usage.output_tokens ?? 0,
        totalTokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
      } : undefined,
    };
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey,
      'anthropic-version': API_VERSION,
    };
  }
}
