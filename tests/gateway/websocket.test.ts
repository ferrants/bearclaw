import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { upgradeToWebSocket } from '../../src/gateway/websocket.js';
import { WsHandler } from '../../src/gateway/ws-handler.js';
import type { SessionProvider } from '../../src/gateway/ws-handler.js';
import type { IncomingMessage } from 'node:http';

function createMockSocket() {
  const emitter = new EventEmitter();
  const written: Buffer[] = [];
  return {
    emitter,
    written,
    socket: {
      write: (data: Buffer | string) => {
        written.push(Buffer.isBuffer(data) ? data : Buffer.from(data));
        return true;
      },
      end: vi.fn(),
      on: (event: string, handler: (...args: unknown[]) => void) => {
        emitter.on(event, handler);
        return emitter;
      },
      destroy: vi.fn(),
    } as unknown as import('node:stream').Duplex,
  };
}

function makeClientFrame(text: string): Buffer {
  const payload = Buffer.from(text, 'utf8');
  const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
  const masked = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i++) {
    masked[i] = payload[i] ^ mask[i & 3];
  }

  const len = payload.length;
  let header: Buffer;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81; // FIN + text
    header[1] = 0x80 | len; // masked
  } else {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(len, 2);
  }

  return Buffer.concat([header, mask, masked]);
}

describe('WebSocket', () => {
  it('should perform upgrade handshake', () => {
    const { socket, written } = createMockSocket();
    const req = {
      headers: { 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==' },
    } as unknown as IncomingMessage;

    const conn = upgradeToWebSocket(req, socket, Buffer.alloc(0));
    expect(conn).not.toBeNull();
    expect(conn!.isOpen).toBe(true);

    const response = written[0].toString();
    expect(response).toContain('101 Switching Protocols');
    expect(response).toContain('Sec-WebSocket-Accept:');
  });

  it('should return null without sec-websocket-key', () => {
    const { socket } = createMockSocket();
    const req = { headers: {} } as unknown as IncomingMessage;
    const conn = upgradeToWebSocket(req, socket, Buffer.alloc(0));
    expect(conn).toBeNull();
  });

  it('should receive text messages', () => {
    const { socket, emitter } = createMockSocket();
    const req = {
      headers: { 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==' },
    } as unknown as IncomingMessage;

    const conn = upgradeToWebSocket(req, socket, Buffer.alloc(0))!;
    const received: string[] = [];
    conn.onMessage((data) => received.push(data));

    emitter.emit('data', makeClientFrame('hello'));
    expect(received).toEqual(['hello']);
  });

  it('should send text frames', () => {
    const { socket, written } = createMockSocket();
    const req = {
      headers: { 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==' },
    } as unknown as IncomingMessage;

    const conn = upgradeToWebSocket(req, socket, Buffer.alloc(0))!;
    conn.send('world');

    // written[0] is the handshake, written[1] is the frame
    const frame = written[1];
    expect(frame[0]).toBe(0x81); // FIN + text
    expect(frame[1]).toBe(5); // length (unmasked from server)
    expect(frame.subarray(2).toString()).toBe('world');
  });

  it('should handle close frame', () => {
    const { socket, emitter } = createMockSocket();
    const req = {
      headers: { 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==' },
    } as unknown as IncomingMessage;

    const conn = upgradeToWebSocket(req, socket, Buffer.alloc(0))!;
    let closed = false;
    conn.onClose(() => { closed = true; });

    // Send close frame (opcode 0x8, masked, 2-byte payload with code 1000)
    const mask = Buffer.from([0x00, 0x00, 0x00, 0x00]);
    const payload = Buffer.alloc(2);
    payload.writeUInt16BE(1000, 0);
    const frame = Buffer.concat([Buffer.from([0x88, 0x82]), mask, payload]);
    emitter.emit('data', frame);

    expect(closed).toBe(true);
    expect(conn.isOpen).toBe(false);
  });

  it('should handle multiple messages in one chunk', () => {
    const { socket, emitter } = createMockSocket();
    const req = {
      headers: { 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==' },
    } as unknown as IncomingMessage;

    const conn = upgradeToWebSocket(req, socket, Buffer.alloc(0))!;
    const received: string[] = [];
    conn.onMessage((data) => received.push(data));

    const combined = Buffer.concat([makeClientFrame('one'), makeClientFrame('two')]);
    emitter.emit('data', combined);
    expect(received).toEqual(['one', 'two']);
  });
});

describe('WsHandler chat list/history', () => {
  function createWsHandlerWithSession(sessionProvider: SessionProvider) {
    const bus = { publishInbound: vi.fn(), publishOutbound: vi.fn(), consumeInbound: vi.fn(), consumeOutbound: vi.fn() };
    const pairing = { verifyToken: () => true, generateCode: vi.fn(), verifyCode: vi.fn(), addStaticKey: vi.fn() };
    const eventBus = { on: vi.fn(), emit: vi.fn() };
    const approvalBridge = { listPending: () => [], requestApproval: vi.fn(), resolveApproval: vi.fn(), clear: vi.fn() };
    const mentionables = { query: () => [] };

    const handler = new WsHandler(
      bus as any,
      pairing as any,
      false,
      eventBus as any,
      approvalBridge as any,
      mentionables as any,
    );
    handler.setSessionProvider(sessionProvider);
    return handler;
  }

  function connectClient(handler: WsHandler) {
    const { socket, emitter, written } = createMockSocket();
    const req = {
      url: '/ws',
      headers: { host: 'localhost', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==' },
    } as unknown as IncomingMessage;
    handler.handleUpgrade(req, socket, Buffer.alloc(0));
    return { emitter, written };
  }

  function parseServerMessages(written: Buffer[]): unknown[] {
    // Skip the first buffer (handshake response), parse subsequent WebSocket frames
    const messages: unknown[] = [];
    for (let i = 1; i < written.length; i++) {
      const frame = written[i];
      const len = frame[1] & 0x7f;
      let offset = 2;
      if (len === 126) offset = 4;
      if (len === 127) offset = 10;
      const payload = frame.subarray(offset).toString('utf8');
      try {
        messages.push(JSON.parse(payload));
      } catch { /* ignore */ }
    }
    return messages;
  }

  it('list_chats returns chat_list response', () => {
    const sessionProvider: SessionProvider = {
      listChats: () => [
        { agentId: 'agent1', channel: 'websocket', chatId: 'chat1', lastModified: 1000, messageCount: 5 },
      ],
      getChatHistory: () => [],
    };
    const handler = createWsHandlerWithSession(sessionProvider);
    const { emitter, written } = connectClient(handler);

    emitter.emit('data', makeClientFrame(JSON.stringify({ type: 'list_chats', id: 'q1' })));

    const msgs = parseServerMessages(written);
    const response = msgs.find((m: any) => m.type === 'chat_list') as any;
    expect(response).toBeDefined();
    expect(response.id).toBe('q1');
    expect(response.chats).toHaveLength(1);
    expect(response.chats[0].agentId).toBe('agent1');
    expect(response.chats[0].chatId).toBe('chat1');
  });

  it('get_chat_history returns chat_history with messages', () => {
    const sessionProvider: SessionProvider = {
      listChats: () => [],
      getChatHistory: () => [
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi there' },
      ],
    };
    const handler = createWsHandlerWithSession(sessionProvider);
    const { emitter, written } = connectClient(handler);

    emitter.emit('data', makeClientFrame(JSON.stringify({
      type: 'get_chat_history', id: 'q2', chatId: 'chat1', agentId: 'agent1',
    })));

    const msgs = parseServerMessages(written);
    const response = msgs.find((m: any) => m.type === 'chat_history') as any;
    expect(response).toBeDefined();
    expect(response.id).toBe('q2');
    expect(response.chatId).toBe('chat1');
    expect(response.agentId).toBe('agent1');
    // System messages should be excluded
    expect(response.messages).toHaveLength(2);
    expect(response.messages[0].role).toBe('user');
    expect(response.messages[1].role).toBe('assistant');
  });

  it('get_chat_history excludes system messages', () => {
    const sessionProvider: SessionProvider = {
      listChats: () => [],
      getChatHistory: () => [
        { role: 'system', content: 'system prompt' },
        { role: 'user', content: 'question' },
        { role: 'assistant', content: 'answer' },
        { role: 'tool', content: 'tool result' },
      ],
    };
    const handler = createWsHandlerWithSession(sessionProvider);
    const { emitter, written } = connectClient(handler);

    emitter.emit('data', makeClientFrame(JSON.stringify({
      type: 'get_chat_history', id: 'q3', chatId: 'c1',
    })));

    const msgs = parseServerMessages(written);
    const response = msgs.find((m: any) => m.type === 'chat_history') as any;
    expect(response.messages).toHaveLength(3);
    expect(response.messages.every((m: any) => m.role !== 'system')).toBe(true);
  });
});
