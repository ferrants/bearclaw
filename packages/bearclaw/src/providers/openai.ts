import {
  type LLMProvider,
  type Message,
  type ToolDefinition,
  type LLMResponse,
  type ChatOptions,
  type ToolCall,
} from './types.js';
import { fetchWithRetry } from './retry.js';

const API_URL = 'https://api.openai.com/v1/chat/completions';

export class OpenAIProvider implements LLMProvider {
  constructor(
    private apiKey: string,
    public defaultModel: string = 'gpt-4o',
  ) {}

  async chat(
    messages: Message[],
    tools: ToolDefinition[],
    model: string,
    options?: ChatOptions,
  ): Promise<LLMResponse> {
    const body: Record<string, unknown> = {
      model,
      messages: this.translateMessages(messages),
    };

    if (options?.maxTokens) body.max_tokens = options.maxTokens;
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
    const toolCallMap = new Map<number, { id: string; name: string; argsStr: string }>();
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

        const choices = event.choices as Array<Record<string, unknown>>;
        if (!choices?.[0]) continue;

        const delta = choices[0].delta as Record<string, unknown>;
        if (!delta) continue;

        if (delta.content) {
          const text = delta.content as string;
          content += text;
          options.onToken?.(text);
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls as Array<Record<string, unknown>>) {
            const idx = tc.index as number;
            if (!toolCallMap.has(idx)) {
              toolCallMap.set(idx, {
                id: (tc.id as string) ?? '',
                name: ((tc.function as Record<string, unknown>)?.name as string) ?? '',
                argsStr: '',
              });
            }
            const entry = toolCallMap.get(idx)!;
            if (tc.id) entry.id = tc.id as string;
            const fn = tc.function as Record<string, unknown> | undefined;
            if (fn?.name) entry.name = fn.name as string;
            if (fn?.arguments) entry.argsStr += fn.arguments as string;
          }
        }

        if (event.usage) {
          const u = event.usage as Record<string, number>;
          usage = {
            promptTokens: u.prompt_tokens ?? 0,
            completionTokens: u.completion_tokens ?? 0,
            totalTokens: u.total_tokens ?? 0,
          };
        }
      }
    }

    const toolCalls: ToolCall[] = [];
    for (const [, entry] of [...toolCallMap.entries()].sort((a, b) => a[0] - b[0])) {
      try {
        toolCalls.push({
          id: entry.id,
          name: entry.name,
          arguments: JSON.parse(entry.argsStr || '{}'),
        });
      } catch {
        toolCalls.push({ id: entry.id, name: entry.name, arguments: {} });
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
        return {
          role: 'assistant',
          content: m.content || null,
          tool_calls: m.toolCalls.map(tc => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          })),
        };
      }

      if (m.role === 'tool') {
        return {
          role: 'tool',
          tool_call_id: m.toolCallId,
          content: m.content,
        };
      }

      return { role: m.role, content: m.content };
    });
  }

  private translateTools(tools: ToolDefinition[]): unknown[] {
    return tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  private parseResponse(data: Record<string, unknown>): LLMResponse {
    const choices = data.choices as Array<Record<string, unknown>>;
    if (!choices?.[0]) {
      return { content: '', toolCalls: [], finishReason: 'error' };
    }

    const choice = choices[0];
    const message = choice.message as Record<string, unknown>;
    const content = (message.content as string) ?? '';
    const toolCalls: ToolCall[] = [];

    const rawToolCalls = message.tool_calls as Array<Record<string, unknown>> | undefined;
    if (rawToolCalls) {
      for (const tc of rawToolCalls) {
        const fn = tc.function as Record<string, unknown>;
        toolCalls.push({
          id: tc.id as string,
          name: fn.name as string,
          arguments: JSON.parse((fn.arguments as string) || '{}'),
        });
      }
    }

    const finishReason = choice.finish_reason as string;
    const usage = data.usage as Record<string, number> | undefined;

    return {
      content,
      toolCalls,
      finishReason: finishReason === 'tool_calls' ? 'tool_calls'
        : finishReason === 'length' ? 'length'
        : 'stop',
      usage: usage ? {
        promptTokens: usage.prompt_tokens ?? 0,
        completionTokens: usage.completion_tokens ?? 0,
        totalTokens: usage.total_tokens ?? 0,
      } : undefined,
    };
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
    };
  }
}
