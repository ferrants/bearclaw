import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createLogger } from '../logging.js';

const log = createLogger('mcp-client');

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export class McpClient {
  private process: ChildProcess | null = null;
  private buffer = '';
  private nextId = 1;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (err: Error) => void }>();

  constructor(
    private command: string,
    private args: string[],
    private env?: Record<string, string>,
  ) {}

  async start(): Promise<void> {
    const childEnv = { ...process.env, ...this.env };
    this.process = spawn(this.command, this.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: childEnv,
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      log.debug('MCP stderr', { data: data.toString().slice(0, 200) });
    });

    this.process.stdout?.on('data', (data: Buffer) => {
      this.buffer += data.toString();
      this.processBuffer();
    });

    this.process.on('error', (err) => {
      log.error('MCP process error', { error: err.message });
      for (const p of this.pending.values()) {
        p.reject(err);
      }
      this.pending.clear();
    });

    this.process.on('close', (code) => {
      log.debug('MCP process closed', { code });
      const err = new Error(`MCP process exited with code ${code}`);
      for (const p of this.pending.values()) {
        p.reject(err);
      }
      this.pending.clear();
    });

    // Send initialize
    const result = await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'bearclaw', version: '1.0.0' },
    }) as Record<string, unknown>;

    log.info('MCP server initialized', { serverInfo: result.serverInfo });

    // Send initialized notification
    this.notify('notifications/initialized', {});
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
    if (!this.process) return;

    try {
      // Try graceful shutdown
      this.notify('notifications/cancelled', {});
    } catch {
      // Ignore
    }

    this.process.kill('SIGTERM');

    // Force kill after 5s
    const forceKill = setTimeout(() => {
      if (this.process && !this.process.killed) {
        this.process.kill('SIGKILL');
      }
    }, 5000);

    await new Promise<void>((resolve) => {
      if (!this.process) { resolve(); return; }
      this.process.on('close', () => {
        clearTimeout(forceKill);
        resolve();
      });
    });

    this.process = null;
  }

  private request(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });

      const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params });
      this.process?.stdin?.write(msg + '\n');

      // Timeout after 30s
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`MCP request timed out: ${method}`));
        }
      }, 30_000);
    });
  }

  private notify(method: string, params: unknown): void {
    const msg = JSON.stringify({ jsonrpc: '2.0', method, params });
    this.process?.stdin?.write(msg + '\n');
  }

  private processBuffer(): void {
    const lines = this.buffer.split('\n');
    // Keep the last (possibly incomplete) line in the buffer
    this.buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const msg = JSON.parse(trimmed) as { id?: number; result?: unknown; error?: { message: string } };
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id)!;
          this.pending.delete(msg.id);
          if (msg.error) {
            p.reject(new Error(msg.error.message));
          } else {
            p.resolve(msg.result);
          }
        }
      } catch {
        log.debug('MCP unparseable line', { line: trimmed.slice(0, 100) });
      }
    }
  }
}
