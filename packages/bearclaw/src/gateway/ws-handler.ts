import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { EventBus } from '../events.js';
import type { PairingGuard } from '../security/pairing.js';
import type { MessageBus } from '../bus/bus.js';
import { upgradeToWebSocket, type WebSocketConnection } from './websocket.js';
import { ApprovalBridge } from './approval-bridge.js';
import type { MentionablesProvider } from './mentionables.js';
import type {
  ClientMessage,
  ClientMessage_ApprovalResponse,
  ClientMessage_ListChats,
  ClientMessage_GetChatHistory,
  ClientMessage_ListPendingApprovals,
  ClientMessage_ListUserRules,
  ClientMessage_RemoveUserRule,
  ClientMessage_GetStats,
  ServerMessage,
} from './ws-protocol.js';
import type { StatsCollector } from './stats-collector.js';
import type { InlineAllowScope } from '../config/schema.js';
import type { ChatInfo } from '../agent/session.js';
import type { Message } from '../providers/types.js';
import { createLogger } from '../logging.js';

export interface SessionProvider {
  listChats(filter?: { channel?: string; agentId?: string }): ChatInfo[];
  getChatHistory(agentId: string, channel: string, chatId: string): Message[];
}

export interface UserRuleCallbacks {
  onAlwaysAllow?: (agentId: string, toolName: string) => void;
  onAlwaysDeny?: (agentId: string, toolName: string) => void;
  listRules?: () => Array<{
    id: string;
    action: 'allow' | 'deny';
    toolName: string;
    agentId?: string;
    createdAt: string;
    createdBy: 'ws-approval' | 'cli';
  }>;
  removeRule?: (ruleId: string) => boolean;
}

const log = createLogger('ws-handler');

export type OnAllowCallback = (agentId: string, toolName: string, scope: InlineAllowScope) => void;

export class WsHandler {
  private clients = new Set<WebSocketConnection>();

  private sessions: SessionProvider | null = null;

  constructor(
    private bus: MessageBus,
    private pairing: PairingGuard,
    private requirePairing: boolean,
    private eventBus: EventBus,
    private approvalBridge: ApprovalBridge,
    private mentionables: MentionablesProvider,
    private onAllow?: OnAllowCallback,
    private userRuleCallbacks?: UserRuleCallbacks,
    private statsCollector?: StatsCollector,
  ) {
    this.subscribeEvents();
  }

  setSessionProvider(provider: SessionProvider): void {
    this.sessions = provider;
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
      case 'list_chats':
        this.handleListChats(conn, msg);
        break;
      case 'get_chat_history':
        this.handleGetChatHistory(conn, msg);
        break;
      case 'list_pending_approvals':
        this.handleListPendingApprovals(conn, msg);
        break;
      case 'list_user_rules':
        this.handleListUserRules(conn, msg);
        break;
      case 'remove_user_rule':
        this.handleRemoveUserRule(conn, msg);
        break;
      case 'get_stats':
        this.handleGetStats(conn, msg);
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
    msg: ClientMessage_ApprovalResponse,
  ): void {
    // Handle reject: resolve with rejected flag
    if (msg.reject) {
      const request = this.approvalBridge.resolveApproval(msg.requestId, {
        approved: false,
        rejected: true,
        feedback: msg.feedback,
      });
      if (!request) {
        this.sendTo(conn, {
          type: 'error',
          code: 'APPROVAL_NOT_FOUND',
          message: `No pending approval: ${msg.requestId}`,
        });
      }
      return;
    }

    const request = this.approvalBridge.resolveApproval(msg.requestId, {
      approved: msg.approved,
    });
    if (!request) {
      this.sendTo(conn, {
        type: 'error',
        code: 'APPROVAL_NOT_FOUND',
        message: `No pending approval: ${msg.requestId}`,
      });
      return;
    }

    // Register durable allow if requested and approved
    if (msg.approved && msg.allow) {
      if (msg.allow === 'always') {
        // Persistent allow via UserRuleStore
        this.userRuleCallbacks?.onAlwaysAllow?.(request.agentId, request.toolName);
      } else if (msg.allow !== 'once' && this.onAllow) {
        this.onAllow(request.agentId, request.toolName, msg.allow);
      }
    }

    // Register persistent deny
    if (!msg.approved && msg.deny === 'always') {
      this.userRuleCallbacks?.onAlwaysDeny?.(request.agentId, request.toolName);
    }
  }

  private handleListPendingApprovals(
    conn: WebSocketConnection,
    msg: ClientMessage_ListPendingApprovals,
  ): void {
    let approvals = this.approvalBridge.listPending();

    // Optional filtering
    if (msg.chatId) {
      approvals = approvals.filter(a => a.chatId === msg.chatId);
    }
    if (msg.agentId) {
      approvals = approvals.filter(a => a.agentId === msg.agentId);
    }

    this.sendTo(conn, {
      type: 'pending_approvals',
      id: msg.id,
      approvals,
    });
  }

  private handleListUserRules(
    conn: WebSocketConnection,
    msg: ClientMessage_ListUserRules,
  ): void {
    const rules = this.userRuleCallbacks?.listRules?.() ?? [];
    this.sendTo(conn, {
      type: 'user_rules',
      id: msg.id,
      rules,
    });
  }

  private handleRemoveUserRule(
    conn: WebSocketConnection,
    msg: ClientMessage_RemoveUserRule,
  ): void {
    const success = this.userRuleCallbacks?.removeRule?.(msg.ruleId) ?? false;
    this.sendTo(conn, {
      type: 'user_rule_removed',
      id: msg.id,
      ruleId: msg.ruleId,
      success,
    });
  }

  private handleQueryMentionables(
    conn: WebSocketConnection,
    msg: { id: string; filter?: string },
  ): void {
    const items = this.mentionables.query(msg.filter);
    this.sendTo(conn, { type: 'mentionables', id: msg.id, items });
  }

  private handleListChats(conn: WebSocketConnection, msg: ClientMessage_ListChats): void {
    if (!this.sessions) {
      this.sendTo(conn, { type: 'error', id: msg.id, code: 'NOT_AVAILABLE', message: 'Session provider not configured' });
      return;
    }
    const filter: { channel?: string; agentId?: string } = {};
    if (msg.channel) filter.channel = msg.channel;
    if (msg.agentId) filter.agentId = msg.agentId;
    const chats = this.sessions.listChats(Object.keys(filter).length > 0 ? filter : undefined);
    this.sendTo(conn, { type: 'chat_list', id: msg.id, chats });
  }

  private handleGetChatHistory(conn: WebSocketConnection, msg: ClientMessage_GetChatHistory): void {
    if (!this.sessions) {
      this.sendTo(conn, { type: 'error', id: msg.id, code: 'NOT_AVAILABLE', message: 'Session provider not configured' });
      return;
    }
    if (!msg.chatId) {
      this.sendTo(conn, { type: 'error', id: msg.id, code: 'MISSING_FIELD', message: 'chatId required' });
      return;
    }
    const agentId = msg.agentId ?? 'default';
    const channel = msg.channel ?? 'websocket';
    const messages = this.sessions.getChatHistory(agentId, channel, msg.chatId);
    const filtered = messages
      .filter(m => m.role !== 'system')
      .map(m => ({ role: m.role, content: m.content }));
    this.sendTo(conn, { type: 'chat_history', id: msg.id, chatId: msg.chatId, agentId, messages: filtered });
  }

  private handleGetStats(conn: WebSocketConnection, msg: ClientMessage_GetStats): void {
    if (!this.statsCollector) {
      this.sendTo(conn, { type: 'error', id: msg.id, code: 'NOT_AVAILABLE', message: 'Stats collector not configured' });
      return;
    }
    this.sendTo(conn, this.statsCollector.getStats(msg.id));
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

    this.eventBus.on('schedule:triggered', (data) => {
      this.broadcast({
        type: 'schedule_triggered',
        chatId: data.chatId,
        agentId: data.agentId,
        message: data.message,
        schedule: data.schedule,
      });
    });

    this.eventBus.on('agent:status', (data) => {
      this.broadcast({
        type: 'agent_status',
        agentId: data.agentId,
        chatId: data.chatId,
        status: data.status,
        contextTokens: data.contextTokens,
        maxContextTokens: data.maxContextTokens,
      });
    });

    this.eventBus.on('usage', (data) => {
      this.broadcast({
        type: 'usage',
        agentId: data.agentId,
        chatId: data.chatId,
        inputTokens: data.inputTokens,
        outputTokens: data.outputTokens,
        cacheReadTokens: data.cacheReadTokens,
        cacheWriteTokens: data.cacheWriteTokens,
        model: data.model,
      });
    });

    this.eventBus.on('notice', (data) => {
      this.broadcast({
        type: 'notice',
        level: data.level,
        code: data.code,
        message: data.message,
        agentId: data.agentId,
        chatId: data.chatId,
        droppedToolMessages: data.droppedToolMessages,
        droppedToolCalls: data.droppedToolCalls,
      });
    });

    this.eventBus.on('agent:error', (data) => {
      this.broadcast({
        type: 'error',
        code: 'AGENT_ERROR',
        message: `Agent ${data.agentId} error: ${data.message}`,
      });
    });
  }
}
