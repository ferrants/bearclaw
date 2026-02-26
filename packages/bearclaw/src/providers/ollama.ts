import {
  type LLMProvider,
  type Message,
  type ToolDefinition,
  type LLMResponse,
  type ChatOptions,
  type ToolCall,
} from './types.js';
import { fetchWithRetry } from './retry.js';

export class OllamaProvider implements LLMProvider {
  private apiUrl: string;

  constructor(
    baseUrl: string = 'http://127.0.0.1:11434',
    public defaultModel: string = 'llama3',
  ) {
    this.apiUrl = `${baseUrl}/api/chat`;
  }

  async chat(
    messages: Message[],
    tools: ToolDefinition[],
    model: string,
    options?: ChatOptions,
  ): Promise<LLMResponse> {
    const body: Record<string, unknown> = {
      model,
      messages: this.translateMessages(messages),
      stream: !!options?.onToken,
    };

    if (tools.length > 0) body.tools = this.translateTools(tools);

    const bodyOptions: Record<string, unknown> = {};
    if (options?.temperature !== undefined) bodyOptions.temperature = options.temperature;
    if (Object.keys(bodyOptions).length > 0) body.options = bodyOptions;

    if (options?.onToken) {
      return this.chatStream(body, options);
    }

    const resp = await fetchWithRetry(this.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: options?.signal,
    });

    const data = await resp.json() as Record<string, unknown>;
    return this.parseResponse(data);
  }

  private async chatStream(body: Record<string, unknown>, options: ChatOptions): Promise<LLMResponse> {
    const resp = await fetchWithRetry(this.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: options.signal,
    });

    const reader = resp.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    const toolCalls: ToolCall[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;

        let event: Record<string, unknown>;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }

        const message = event.message as Record<string, unknown> | undefined;
        if (message?.content) {
          const text = message.content as string;
          content += text;
          options.onToken?.(text);
        }

        if (message?.tool_calls) {
          for (const tc of message.tool_calls as Array<Record<string, unknown>>) {
            const fn = tc.function as Record<string, unknown>;
            toolCalls.push({
              id: `ollama_${Date.now()}_${toolCalls.length}`,
              name: fn.name as string,
              arguments: (fn.arguments as Record<string, unknown>) ?? {},
            });
          }
        }
      }
    }

    return {
      content,
      toolCalls,
      finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
    };
  }

  private translateMessages(messages: Message[]): unknown[] {
    return messages.map(m => {
      if (m.role === 'assistant' && m.toolCalls?.length) {
        return {
          role: 'assistant',
          content: m.content || '',
          tool_calls: m.toolCalls.map(tc => ({
            function: {
              name: tc.name,
              arguments: tc.arguments,
            },
          })),
        };
      }

      if (m.role === 'tool') {
        return {
          role: 'tool',
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
    const message = data.message as Record<string, unknown>;
    const content = (message?.content as string) ?? '';
    const toolCalls: ToolCall[] = [];

    const rawToolCalls = message?.tool_calls as Array<Record<string, unknown>> | undefined;
    if (rawToolCalls) {
      for (const tc of rawToolCalls) {
        const fn = tc.function as Record<string, unknown>;
        toolCalls.push({
          id: `ollama_${Date.now()}_${toolCalls.length}`,
          name: fn.name as string,
          arguments: (fn.arguments as Record<string, unknown>) ?? {},
        });
      }
    }

    return {
      content,
      toolCalls,
      finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
    };
  }
}
