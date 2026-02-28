import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpHttpClient } from '../../src/mcp/http-client.js';

function jsonResponse(result: unknown, headers?: Record<string, string>) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({
      'Content-Type': 'application/json',
      ...headers,
    }),
    json: async () => ({ jsonrpc: '2.0', id: 1, result }),
    text: async () => JSON.stringify({ jsonrpc: '2.0', id: 1, result }),
  };
}

function sseResponse(events: string[], headers?: Record<string, string>) {
  const body = events.join('\n');
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({
      'Content-Type': 'text/event-stream',
      ...headers,
    }),
    json: async () => { throw new Error('not json'); },
    text: async () => body,
  };
}

function errorResponse(status: number, statusText = 'Error') {
  return {
    ok: false,
    status,
    statusText,
    headers: new Headers(),
    json: async () => ({}),
    text: async () => '',
  };
}

describe('McpHttpClient', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('initializes, lists tools, and calls a tool (JSON responses)', async () => {
    let callCount = 0;
    mockFetch.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // initialize
        return jsonResponse({ serverInfo: { name: 'test-server' } }, { 'Mcp-Session-Id': 'sess-123' });
      }
      if (callCount === 2) {
        // notifications/initialized (notification)
        return { ok: true, status: 202, statusText: 'Accepted', headers: new Headers(), json: async () => ({}), text: async () => '' };
      }
      if (callCount === 3) {
        // tools/list
        return jsonResponse({ tools: [{ name: 'do_thing', description: 'Does a thing', inputSchema: { type: 'object' } }] });
      }
      if (callCount === 4) {
        // tools/call
        return jsonResponse({ content: [{ type: 'text', text: 'result-value' }] });
      }
      return jsonResponse({});
    });

    const client = new McpHttpClient('https://mcp.example.com');
    await client.start();

    const tools = await client.listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('do_thing');

    const result = await client.callTool('do_thing', { foo: 'bar' });
    expect(result).toBe('result-value');

    // Verify session ID is echoed on subsequent requests
    const thirdCall = mockFetch.mock.calls[2];
    expect(thirdCall[1].headers['Mcp-Session-Id']).toBe('sess-123');
  });

  it('parses SSE responses', async () => {
    let callCount = 0;
    mockFetch.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return jsonResponse({ serverInfo: { name: 'sse-server' } });
      }
      if (callCount === 2) {
        return { ok: true, status: 202, statusText: 'Accepted', headers: new Headers(), json: async () => ({}), text: async () => '' };
      }
      // tools/list via SSE
      const id = JSON.parse(mockFetch.mock.calls[callCount - 1][1].body).id;
      return sseResponse([
        `data: ${JSON.stringify({ jsonrpc: '2.0', id, result: { tools: [{ name: 'sse_tool', description: 'SSE tool', inputSchema: {} }] } })}`,
        '',
      ]);
    });

    const client = new McpHttpClient('https://mcp.example.com');
    await client.start();

    const tools = await client.listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('sse_tool');
  });

  it('captures and echoes session ID on subsequent requests', async () => {
    let callCount = 0;
    mockFetch.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return jsonResponse({ serverInfo: {} }, { 'Mcp-Session-Id': 'my-session' });
      }
      if (callCount === 2) {
        return { ok: true, status: 202, statusText: 'Accepted', headers: new Headers(), json: async () => ({}), text: async () => '' };
      }
      return jsonResponse({ tools: [] });
    });

    const client = new McpHttpClient('https://mcp.example.com');
    await client.start();
    await client.listTools();

    // First call (initialize) should not have session ID
    expect(mockFetch.mock.calls[0][1].headers['Mcp-Session-Id']).toBeUndefined();
    // Notification should have session ID
    expect(mockFetch.mock.calls[1][1].headers['Mcp-Session-Id']).toBe('my-session');
    // tools/list should have session ID
    expect(mockFetch.mock.calls[2][1].headers['Mcp-Session-Id']).toBe('my-session');
  });

  it('re-initializes on 404 session expiry and retries', async () => {
    let callCount = 0;
    mockFetch.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // Initial initialize
        return jsonResponse({ serverInfo: {} }, { 'Mcp-Session-Id': 'old-session' });
      }
      if (callCount === 2) {
        // initialized notification
        return { ok: true, status: 202, statusText: 'Accepted', headers: new Headers(), json: async () => ({}), text: async () => '' };
      }
      if (callCount === 3) {
        // tools/list → 404 (session expired)
        return errorResponse(404, 'Not Found');
      }
      if (callCount === 4) {
        // Re-initialize
        return jsonResponse({ serverInfo: {} }, { 'Mcp-Session-Id': 'new-session' });
      }
      if (callCount === 5) {
        // initialized notification after re-init
        return { ok: true, status: 202, statusText: 'Accepted', headers: new Headers(), json: async () => ({}), text: async () => '' };
      }
      if (callCount === 6) {
        // Retry tools/list
        return jsonResponse({ tools: [{ name: 'recovered', description: 'Back', inputSchema: {} }] });
      }
      return jsonResponse({});
    });

    const client = new McpHttpClient('https://mcp.example.com');
    await client.start();

    const tools = await client.listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('recovered');
    expect(mockFetch).toHaveBeenCalledTimes(6);
  });

  it('propagates JSON-RPC errors', async () => {
    let callCount = 0;
    mockFetch.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return jsonResponse({ serverInfo: {} });
      }
      if (callCount === 2) {
        return { ok: true, status: 202, statusText: 'Accepted', headers: new Headers(), json: async () => ({}), text: async () => '' };
      }
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: async () => ({ jsonrpc: '2.0', id: 3, error: { code: -32600, message: 'Invalid request' } }),
        text: async () => '',
      };
    });

    const client = new McpHttpClient('https://mcp.example.com');
    await client.start();

    await expect(client.listTools()).rejects.toThrow('MCP JSON-RPC error: Invalid request (code -32600)');
  });

  it('propagates HTTP errors (500)', async () => {
    let callCount = 0;
    mockFetch.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return jsonResponse({ serverInfo: {} });
      }
      if (callCount === 2) {
        return { ok: true, status: 202, statusText: 'Accepted', headers: new Headers(), json: async () => ({}), text: async () => '' };
      }
      return errorResponse(500, 'Internal Server Error');
    });

    const client = new McpHttpClient('https://mcp.example.com');
    await client.start();

    await expect(client.listTools()).rejects.toThrow('MCP HTTP error: 500 Internal Server Error');
  });

  it('sends custom headers', async () => {
    mockFetch.mockImplementation(async () => {
      return jsonResponse({ serverInfo: {} });
    });

    const client = new McpHttpClient('https://mcp.example.com', {
      'Authorization': 'Bearer sk-test-key',
    });
    await client.start();

    const initCall = mockFetch.mock.calls[0];
    expect(initCall[1].headers['Authorization']).toBe('Bearer sk-test-key');
  });
});
