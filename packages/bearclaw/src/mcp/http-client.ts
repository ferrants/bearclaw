import { createLogger } from '../logging.js';
import type { McpTransport, McpToolDef } from './client.js';

const log = createLogger('mcp-http');

interface JsonRpcResponse {
  id?: number;
  result?: unknown;
  error?: { code: number; message: string };
}

export class McpHttpClient implements McpTransport {
  private nextId = 1;
  private sessionId: string | null = null;
  private initialized = false;

  constructor(
    private url: string,
    private headers: Record<string, string> = {},
    private timeout = 30_000,
  ) {}

  async start(): Promise<void> {
    await this.initialize();
  }

  async listTools(): Promise<McpToolDef[]> {
    const result = await this.request('tools/list', {}) as { tools: McpToolDef[] };
    return result.tools ?? [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const result = await this.request('tools/call', { name, arguments: args }) as {
      content: Array<{ type: string; text?: string }>;
    };

    if (!result.content || !Array.isArray(result.content)) {
      return '';
    }

    return result.content
      .filter((c) => c.type === 'text' && c.text)
      .map((c) => c.text)
      .join('\n');
  }

  async stop(): Promise<void> {
    this.sessionId = null;
    this.initialized = false;
  }

  private async initialize(): Promise<void> {
    const result = await this.rawRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'bearclaw', version: '1.0.0' },
    }) as Record<string, unknown>;

    log.info('MCP HTTP server initialized', { serverInfo: result.serverInfo });
    this.initialized = true;

    // Send initialized notification
    await this.notify('notifications/initialized', {});
  }

  private async request(method: string, params: unknown): Promise<unknown> {
    try {
      return await this.rawRequest(method, params);
    } catch (err) {
      // Re-initialize on 404 (session expired) and retry once
      if (err instanceof McpHttpError && err.status === 404 && this.initialized) {
        log.info('Session expired, re-initializing');
        this.sessionId = null;
        await this.initialize();
        return await this.rawRequest(method, params);
      }
      throw err;
    }
  }

  private async rawRequest(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const reqHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        ...this.headers,
      };
      if (this.sessionId) {
        reqHeaders['Mcp-Session-Id'] = this.sessionId;
      }

      const response = await fetch(this.url, {
        method: 'POST',
        headers: reqHeaders,
        body,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new McpHttpError(
          `MCP HTTP error: ${response.status} ${response.statusText}`,
          response.status,
        );
      }

      // Capture session ID from response
      const newSessionId = response.headers.get('Mcp-Session-Id');
      if (newSessionId) {
        this.sessionId = newSessionId;
      }

      const contentType = response.headers.get('Content-Type') ?? '';

      if (contentType.includes('text/event-stream')) {
        return await this.parseSSE(response, id);
      }

      // Standard JSON response
      const json = await response.json() as JsonRpcResponse;
      if (json.error) {
        throw new Error(`MCP JSON-RPC error: ${json.error.message} (code ${json.error.code})`);
      }
      return json.result;
    } finally {
      clearTimeout(timer);
    }
  }

  private async parseSSE(response: Response, expectedId: number): Promise<unknown> {
    const text = await response.text();
    const lines = text.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;

      const data = trimmed.slice(5).trim();
      if (!data) continue;

      try {
        const msg = JSON.parse(data) as JsonRpcResponse;
        if (msg.id === expectedId) {
          if (msg.error) {
            throw new Error(`MCP JSON-RPC error: ${msg.error.message} (code ${msg.error.code})`);
          }
          return msg.result;
        }
      } catch (err) {
        if (err instanceof SyntaxError) {
          log.debug('SSE unparseable data line', { data: data.slice(0, 100) });
          continue;
        }
        throw err;
      }
    }

    throw new Error(`No JSON-RPC response found in SSE stream for request ${expectedId}`);
  }

  private async notify(method: string, params: unknown): Promise<void> {
    const body = JSON.stringify({ jsonrpc: '2.0', method, params });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const reqHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        ...this.headers,
      };
      if (this.sessionId) {
        reqHeaders['Mcp-Session-Id'] = this.sessionId;
      }

      const response = await fetch(this.url, {
        method: 'POST',
        headers: reqHeaders,
        body,
        signal: controller.signal,
      });

      // Notifications expect 202 or 2xx — we don't need the response body
      if (!response.ok) {
        log.debug('MCP notification non-OK response', { status: response.status, method });
      }
    } finally {
      clearTimeout(timer);
    }
  }
}

export class McpHttpError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'McpHttpError';
  }
}
