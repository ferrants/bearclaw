import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

const WS_MAGIC_GUID = '258EAFA5-E914-47DA-95CA-5AB9FFAB11B3';
const OPCODE_TEXT = 0x1;
const OPCODE_CLOSE = 0x8;
const OPCODE_PING = 0x9;
const OPCODE_PONG = 0xA;

const PING_INTERVAL_MS = 30_000;

export interface WebSocketConnection {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onMessage(handler: (data: string) => void): void;
  onClose(handler: () => void): void;
  onError(handler: (err: Error) => void): void;
  readonly isOpen: boolean;
}

export function upgradeToWebSocket(
  req: IncomingMessage,
  socket: Duplex,
  _head: Buffer,
): WebSocketConnection | null {
  const key = req.headers['sec-websocket-key'];
  if (!key) return null;

  const accept = createHash('sha1')
    .update(key + WS_MAGIC_GUID)
    .digest('base64');

  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n` +
    '\r\n',
  );

  let open = true;
  let messageHandler: ((data: string) => void) | null = null;
  let closeHandler: (() => void) | null = null;
  let errorHandler: ((err: Error) => void) | null = null;
  let buffer = Buffer.alloc(0);

  const pingTimer = setInterval(() => {
    if (open) sendFrame(OPCODE_PING, Buffer.alloc(0));
  }, PING_INTERVAL_MS);

  function sendFrame(opcode: number, payload: Buffer): void {
    const len = payload.length;
    let header: Buffer;

    if (len < 126) {
      header = Buffer.alloc(2);
      header[0] = 0x80 | opcode; // FIN + opcode
      header[1] = len;
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }

    socket.write(Buffer.concat([header, payload]));
  }

  function cleanup(): void {
    if (!open) return;
    open = false;
    clearInterval(pingTimer);
    closeHandler?.();
  }

  function processFrame(data: Buffer): number {
    if (data.length < 2) return 0;

    const opcode = data[0] & 0x0F;
    const masked = (data[1] & 0x80) !== 0;
    let payloadLen = data[1] & 0x7F;
    let offset = 2;

    if (payloadLen === 126) {
      if (data.length < 4) return 0;
      payloadLen = data.readUInt16BE(2);
      offset = 4;
    } else if (payloadLen === 127) {
      if (data.length < 10) return 0;
      payloadLen = Number(data.readBigUInt64BE(2));
      offset = 10;
    }

    const maskLen = masked ? 4 : 0;
    const totalLen = offset + maskLen + payloadLen;
    if (data.length < totalLen) return 0;

    let payload: Buffer;
    if (masked) {
      const mask = data.subarray(offset, offset + 4);
      payload = Buffer.alloc(payloadLen);
      for (let i = 0; i < payloadLen; i++) {
        payload[i] = data[offset + 4 + i] ^ mask[i & 3];
      }
    } else {
      payload = data.subarray(offset + maskLen, offset + maskLen + payloadLen);
    }

    switch (opcode) {
      case OPCODE_TEXT:
        messageHandler?.(payload.toString('utf8'));
        break;
      case OPCODE_CLOSE:
        sendFrame(OPCODE_CLOSE, payload.subarray(0, Math.min(payload.length, 2)));
        cleanup();
        socket.end();
        break;
      case OPCODE_PING:
        sendFrame(OPCODE_PONG, payload);
        break;
      case OPCODE_PONG:
        // keepalive acknowledged
        break;
    }

    return totalLen;
  }

  socket.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    let consumed: number;
    while ((consumed = processFrame(buffer)) > 0) {
      buffer = buffer.subarray(consumed);
    }
  });

  socket.on('close', cleanup);
  socket.on('error', (err: Error) => {
    errorHandler?.(err);
    cleanup();
  });

  const conn: WebSocketConnection = {
    send(data: string): void {
      if (!open) return;
      sendFrame(OPCODE_TEXT, Buffer.from(data, 'utf8'));
    },
    close(code = 1000, reason = ''): void {
      if (!open) return;
      const reasonBuf = Buffer.from(reason, 'utf8');
      const payload = Buffer.alloc(2 + reasonBuf.length);
      payload.writeUInt16BE(code, 0);
      reasonBuf.copy(payload, 2);
      sendFrame(OPCODE_CLOSE, payload);
      cleanup();
      socket.end();
    },
    onMessage(handler: (data: string) => void): void {
      messageHandler = handler;
    },
    onClose(handler: () => void): void {
      closeHandler = handler;
    },
    onError(handler: (err: Error) => void): void {
      errorHandler = handler;
    },
    get isOpen(): boolean {
      return open;
    },
  };

  return conn;
}
