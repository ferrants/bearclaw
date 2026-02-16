import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAIProvider } from '../../src/providers/openai.js';
import type { Message, ToolDefinition } from '../../src/providers/types.js';

describe('OpenAIProvider', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends correct headers', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }],
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const provider = new OpenAIProvider('test-key');
    await provider.chat([{ role: 'user', content: 'hi' }], [], 'gpt-4o');

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(opts.headers['Authorization']).toBe('Bearer test-key');
  });

  it('translates tool definitions to function format', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '' }, finish_reason: 'stop' }],
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const provider = new OpenAIProvider('test-key');
    const tools: ToolDefinition[] = [{
      name: 'exec',
      description: 'Execute a command',
      parameters: { type: 'object', properties: { command: { type: 'string' } } },
    }];

    await provider.chat([{ role: 'user', content: 'hi' }], tools, 'gpt-4o');

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.tools[0].type).toBe('function');
    expect(body.tools[0].function.name).toBe('exec');
  });

  it('parses tool_calls response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: 'Running command...',
            tool_calls: [{
              id: 'call_1',
              type: 'function',
              function: { name: 'exec', arguments: '{"command":"ls"}' },
            }],
          },
          finish_reason: 'tool_calls',
        }],
        usage: { prompt_tokens: 30, completion_tokens: 15, total_tokens: 45 },
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const provider = new OpenAIProvider('test-key');
    const result = await provider.chat(
      [{ role: 'user', content: 'list files' }],
      [],
      'gpt-4o',
    );

    expect(result.content).toBe('Running command...');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('exec');
    expect(result.toolCalls[0].arguments).toEqual({ command: 'ls' });
    expect(result.finishReason).toBe('tool_calls');
    expect(result.usage?.totalTokens).toBe(45);
  });

  it('translates assistant messages with tool calls', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'done' }, finish_reason: 'stop' }],
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const provider = new OpenAIProvider('test-key');
    const messages: Message[] = [
      { role: 'user', content: 'run ls' },
      { role: 'assistant', content: 'Running...', toolCalls: [{ id: 'c1', name: 'exec', arguments: { command: 'ls' } }] },
      { role: 'tool', content: 'file1 file2', toolCallId: 'c1' },
    ];

    await provider.chat(messages, [], 'gpt-4o');

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const assistantMsg = body.messages[1];
    expect(assistantMsg.tool_calls[0].function.arguments).toBe('{"command":"ls"}');

    const toolMsg = body.messages[2];
    expect(toolMsg.role).toBe('tool');
    expect(toolMsg.tool_call_id).toBe('c1');
  });
});
