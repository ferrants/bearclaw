import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnthropicProvider } from '../../src/providers/anthropic.js';
import type { Message, ToolDefinition } from '../../src/providers/types.js';

describe('AnthropicProvider', () => {
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
        content: [{ type: 'text', text: 'hello' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const provider = new AnthropicProvider('test-key');
    await provider.chat(
      [{ role: 'user', content: 'hi' }],
      [],
      'claude-sonnet-4-5-20250929',
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(opts.headers['x-api-key']).toBe('test-key');
    expect(opts.headers['anthropic-version']).toBe('2023-06-01');
  });

  it('separates system messages', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'response' }],
        stop_reason: 'end_turn',
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const provider = new AnthropicProvider('test-key');
    const messages: Message[] = [
      { role: 'system', content: 'You are helpful' },
      { role: 'user', content: 'hi' },
    ];

    await provider.chat(messages, [], 'claude-sonnet-4-5-20250929');

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.system).toBe('You are helpful');
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe('user');
  });

  it('translates tool definitions', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: '' }],
        stop_reason: 'end_turn',
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const provider = new AnthropicProvider('test-key');
    const tools: ToolDefinition[] = [{
      name: 'read_file',
      description: 'Read a file',
      parameters: { type: 'object', properties: { path: { type: 'string' } } },
    }];

    await provider.chat([{ role: 'user', content: 'hi' }], tools, 'claude-sonnet-4-5-20250929');

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.tools[0].name).toBe('read_file');
    expect(body.tools[0].input_schema).toBeDefined();
  });

  it('parses tool_use response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [
          { type: 'text', text: 'Let me read that file.' },
          { type: 'tool_use', id: 'tc_1', name: 'read_file', input: { path: 'test.txt' } },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 50, output_tokens: 20 },
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const provider = new AnthropicProvider('test-key');
    const result = await provider.chat(
      [{ role: 'user', content: 'read test.txt' }],
      [],
      'claude-sonnet-4-5-20250929',
    );

    expect(result.content).toBe('Let me read that file.');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('read_file');
    expect(result.toolCalls[0].arguments).toEqual({ path: 'test.txt' });
    expect(result.finishReason).toBe('tool_calls');
    expect(result.usage?.totalTokens).toBe(70);
  });

  it('translates tool results as user messages', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'done' }],
        stop_reason: 'end_turn',
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const provider = new AnthropicProvider('test-key');
    const messages: Message[] = [
      { role: 'user', content: 'read test.txt' },
      { role: 'assistant', content: 'Reading...', toolCalls: [{ id: 'tc_1', name: 'read_file', arguments: { path: 'test.txt' } }] },
      { role: 'tool', content: 'file contents', toolCallId: 'tc_1' },
    ];

    await provider.chat(messages, [], 'claude-sonnet-4-5-20250929');

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    // Tool result should be translated to user message with tool_result content
    const toolResultMsg = body.messages[2];
    expect(toolResultMsg.role).toBe('user');
    expect(toolResultMsg.content[0].type).toBe('tool_result');
    expect(toolResultMsg.content[0].tool_use_id).toBe('tc_1');
  });
});
