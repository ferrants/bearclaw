import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { EventBus } from '../events.js';
import type { PairingGuard } from '../security/pairing.js';
import type { MessageBus } from '../bus/bus.js';
import { upgradeToWebSocket, type WebSocketConnection } from './websocket.js';
import { ApprovalBridge } from './approval-bridge.js';
import type { MentionablesProvider } from './mentionables.js';
import type { ClientMessage, ServerMessage } from './ws-protocol.js';
import { createLogger } from '../logging.js';

const log = createLogger('ws-handler');

export class WsHandler {
  private clients = new Set<WebSocketConnection>();

  constructor(
    private bus: MessageBus,
    private pairing: PairingGuard,
    private requirePairing: boolean,
    private eventBus: EventBus,
    private approvalBridge: ApprovalBridge,
    private mentionables: MentionablesProvider,
  ) {
    this.subscribeEvents();
  }

  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

    if (url.pathname !== '/ws') {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    // Auth
    if (this.requirePairing) {
      const token = url.searchParams.get('token');
      if (!token || !this.pairing.verifyToken(token)) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
    }

    const conn = upgradeToWebSocket(req, socket, head);
    if (!conn) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }

    this.clients.add(conn);
    log.info('WebSocket client connected', { clients: this.clients.size });

    // Send pending approvals
    const pending = this.approvalBridge.listPending();
    for (const req of pending) {
      this.sendTo(conn, {
        type: 'approval_needed',
        requestId: req.requestId,
        toolName: req.toolName,
        args: req.args,
        agentId: req.agentId,
        chatId: req.chatId,
      });
    }

    conn.onMessage((data) => {
      try {
        const msg = JSON.parse(data) as ClientMessage;
        this.handleClientMessage(conn, msg);
      } catch {
        this.sendTo(conn, { type: 'error', code: 'INVALID_JSON', message: 'Invalid JSON' });
      }
    });

    conn.onClose(() => {
      this.clients.delete(conn);
      log.info('WebSocket client disconnected', { clients: this.clients.size });
    });

    conn.onError((err) => {
      log.error('WebSocket error', { error: String(err) });
      this.clients.delete(conn);
    });
  }

  broadcast(msg: ServerMessage): void {
    const json = JSON.stringify(msg);
    for (const client of this.clients) {
      if (client.isOpen) {
        client.send(json);
      }
    }
  }

  hasClients(): boolean {
    return this.clients.size > 0;
  }

  close(): void {
    for (const client of this.clients) {
      client.close(1001, 'Server shutting down');
    }
    this.clients.clear();
    this.approvalBridge.clear();
  }

  private sendTo(conn: WebSocketConnection, msg: ServerMessage): void {
    if (conn.isOpen) {
      conn.send(JSON.stringify(msg));
    }
  }

  private handleClientMessage(conn: WebSocketConnection, msg: ClientMessage): void {
    switch (msg.type) {
      case 'message':
        this.handleIncomingMessage(conn, msg);
        break;
      case 'approval_response':
        this.handleApprovalResponse(conn, msg);
        break;
      case 'query_mentionables':
        this.handleQueryMentionables(conn, msg);
        break;
      default:
        this.sendTo(conn, {
          type: 'error',
          code: 'UNKNOWN_TYPE',
          message: `Unknown message type: ${(msg as { type: string }).type}`,
        });
    }
  }

  private handleIncomingMessage(
    conn: WebSocketConnection,
    msg: { id: string; message: string; chatId?: string; agentId?: string },
  ): void {
    if (!msg.message) {
      this.sendTo(conn, { type: 'error', id: msg.id, code: 'MISSING_FIELD', message: 'message required' });
      return;
    }

    this.bus.publishInbound({
      channel: 'websocket',
      sender: 'websocket',
      chatId: msg.chatId ?? 'ws_default',
      messageId: msg.id ?? `ws_${Date.now()}`,
      message: msg.message,
      timestamp: Date.now(),
      agentId: msg.agentId,
    });
  }

  private handleApprovalResponse(
    conn: WebSocketConnection,
    msg: { requestId: string; approved: boolean },
  ): void {
    const resolved = this.approvalBridge.resolveApproval(msg.requestId, msg.approved);
    if (!resolved) {
      this.sendTo(conn, {
        type: 'error',
        code: 'APPROVAL_NOT_FOUND',
        message: `No pending approval: ${msg.requestId}`,
      });
    }
  }

  private handleQueryMentionables(
    conn: WebSocketConnection,
    msg: { id: string; filter?: string },
  ): void {
    const items = this.mentionables.query(msg.filter);
    this.sendTo(conn, { type: 'mentionables', id: msg.id, items });
  }

  private subscribeEvents(): void {
    this.eventBus.on('tool:pending', (data) => {
      this.broadcast({
        type: 'tool_pending',
        toolCallId: data.toolCallId,
        toolName: data.toolName,
        args: data.args,
        agentId: data.agentId,
        chatId: data.chatId,
      });
    });

    this.eventBus.on('tool:started', (data) => {
      this.broadcast({
        type: 'tool_started',
        toolCallId: data.toolCallId,
        toolName: data.toolName,
        args: data.args,
        agentId: data.agentId,
        chatId: data.chatId,
      });
    });

    this.eventBus.on('tool:completed', (data) => {
      this.broadcast({
        type: 'tool_completed',
        toolCallId: data.toolCallId,
        toolName: data.toolName,
        args: data.args,
        isError: data.isError,
        durationMs: data.durationMs,
        agentId: data.agentId,
        chatId: data.chatId,
      });
    });

    this.eventBus.on('token:received', (data) => {
      this.broadcast({
        type: 'token',
        chatId: data.chatId,
        agentId: data.agentId,
        token: data.token,
      });
    });

    this.eventBus.on('agent:response', (data) => {
      this.broadcast({
        type: 'agent_response',
        chatId: data.chatId,
        agentId: data.agentId,
        content: data.content,
        iterations: data.iterations,
        toolsUsed: data.toolsUsed,
      });
    });
  }
}
