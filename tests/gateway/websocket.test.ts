import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { upgradeToWebSocket } from '../../src/gateway/websocket.js';
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
