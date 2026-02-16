import * as http from 'node:http';
import type { MessageBus } from '../bus/bus.js';
import type { PairingGuard } from '../security/pairing.js';
import { createLogger } from '../logging.js';

const log = createLogger('gateway');

export interface GatewayConfig {
  host: string;
  port: number;
  bodyLimit: number;
  timeout: number;
  requirePairing: boolean;
  allowPublicBind: boolean;
}

export class GatewayServer {
  private server: http.Server | null = null;

  constructor(
    private config: GatewayConfig,
    private bus: MessageBus,
    private pairing: PairingGuard,
  ) {}

  async start(): Promise<void> {
    if (!this.config.allowPublicBind && this.config.host !== '127.0.0.1' && this.config.host !== 'localhost') {
      log.warn('Refusing to bind to non-loopback address without allowPublicBind', { host: this.config.host });
      return;
    }

    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res);
    });

    this.server.setTimeout(this.config.timeout);

    return new Promise((resolve, reject) => {
      this.server!.listen(this.config.port, this.config.host, () => {
        log.info('Gateway started', { host: this.config.host, port: this.config.port });
        resolve();
      });
      this.server!.on('error', reject);
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          log.info('Gateway stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const method = req.method ?? 'GET';

    try {
      if (method === 'GET' && url.pathname === '/health') {
        return this.sendJson(res, 200, { status: 'ok' });
      }

      if (method === 'POST' && url.pathname === '/pair') {
        return await this.handlePair(req, res);
      }

      if (method === 'POST' && url.pathname === '/pair/verify') {
        return await this.handlePairVerify(req, res);
      }

      if (method === 'POST' && url.pathname === '/message') {
        return await this.handleMessage(req, res);
      }

      this.sendJson(res, 404, { error: 'Not found' });
    } catch (err) {
      log.error('Request error', { path: url.pathname, error: String(err) });
      this.sendJson(res, 500, { error: 'Internal server error' });
    }
  }

  private parseJson(body: string, res: http.ServerResponse): Record<string, unknown> | null {
    try {
      return JSON.parse(body) as Record<string, unknown>;
    } catch {
      this.sendJson(res, 400, { error: 'Invalid JSON' });
      return null;
    }
  }

  private async handlePair(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = await this.readBody(req);
    const parsed = this.parseJson(body, res);
    if (!parsed) return;
    const { sessionId } = parsed;
    if (!sessionId) {
      return this.sendJson(res, 400, { error: 'sessionId required' });
    }

    const code = this.pairing.generateCode(sessionId as string);
    log.info('Pairing code generated', { sessionId });
    // Code displayed to user via separate channel (e.g., CLI)
    this.sendJson(res, 200, { message: 'Pairing code generated. Check the BearClaw console.' });
  }

  private async handlePairVerify(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = await this.readBody(req);
    const parsed = this.parseJson(body, res);
    if (!parsed) return;
    const { sessionId, code } = parsed;
    if (!sessionId || !code) {
      return this.sendJson(res, 400, { error: 'sessionId and code required' });
    }

    const result = this.pairing.verifyCode(sessionId as string, code as string);
    if (result.success) {
      this.sendJson(res, 200, { token: result.token });
    } else {
      this.sendJson(res, 401, { error: result.reason });
    }
  }

  private async handleMessage(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // Auth check
    if (this.config.requirePairing) {
      const auth = req.headers.authorization;
      if (!auth?.startsWith('Bearer ')) {
        return this.sendJson(res, 401, { error: 'Bearer token required' });
      }
      const token = auth.slice(7);
      if (!this.pairing.verifyToken(token)) {
        return this.sendJson(res, 401, { error: 'Invalid token' });
      }
    }

    const body = await this.readBody(req);
    const parsed = this.parseJson(body, res);
    if (!parsed) return;
    const { chatId, message } = parsed;
    if (!message) {
      return this.sendJson(res, 400, { error: 'message required' });
    }

    this.bus.publishInbound({
      channel: 'gateway',
      sender: 'gateway',
      chatId: (chatId as string) ?? 'gateway',
      messageId: `gw_${Date.now()}`,
      message: message as string,
      timestamp: Date.now(),
    });

    this.sendJson(res, 200, { status: 'queued' });
  }

  private readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = '';
      let size = 0;

      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > this.config.bodyLimit) {
          reject(new Error('Body too large'));
          req.destroy();
          return;
        }
        body += chunk.toString();
      });

      req.on('end', () => resolve(body));
      req.on('error', reject);
    });
  }

  private sendJson(res: http.ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }
}
