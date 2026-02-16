import { describe, it, expect } from 'vitest';
import { MessageBus } from '../../src/bus/bus.js';
import type { InboundMessage, OutboundMessage } from '../../src/bus/types.js';

function makeInbound(msg = 'test'): InboundMessage {
  return {
    channel: 'test',
    sender: 'user',
    chatId: 'chat1',
    messageId: `msg_${Date.now()}`,
    message: msg,
    timestamp: Date.now(),
  };
}

function makeOutbound(content = 'response'): OutboundMessage {
  return {
    channel: 'test',
    chatId: 'chat1',
    content,
  };
}

describe('MessageBus', () => {
  describe('inbound', () => {
    it('publishes and consumes messages', async () => {
      const bus = new MessageBus();
      bus.publishInbound(makeInbound('hello'));

      const msg = await bus.consumeInbound();
      expect(msg.message).toBe('hello');
    });

    it('delivers directly to waiting consumer', async () => {
      const bus = new MessageBus();

      // Start waiting before publishing
      const promise = bus.consumeInbound();
      bus.publishInbound(makeInbound('direct'));

      const msg = await promise;
      expect(msg.message).toBe('direct');
    });

    it('respects capacity limit', () => {
      const bus = new MessageBus(2);
      expect(bus.publishInbound(makeInbound('1'))).toBe(true);
      expect(bus.publishInbound(makeInbound('2'))).toBe(true);
      expect(bus.publishInbound(makeInbound('3'))).toBe(false);
    });

    it('supports abort signal', async () => {
      const bus = new MessageBus();
      const controller = new AbortController();

      const promise = bus.consumeInbound(controller.signal);
      controller.abort();

      await expect(promise).rejects.toThrow();
    });

    it('maintains FIFO order', async () => {
      const bus = new MessageBus();
      bus.publishInbound(makeInbound('first'));
      bus.publishInbound(makeInbound('second'));

      const msg1 = await bus.consumeInbound();
      const msg2 = await bus.consumeInbound();
      expect(msg1.message).toBe('first');
      expect(msg2.message).toBe('second');
    });
  });

  describe('outbound', () => {
    it('publishes and consumes outbound messages', async () => {
      const bus = new MessageBus();
      bus.publishOutbound(makeOutbound('reply'));

      const msg = await bus.consumeOutbound();
      expect(msg.content).toBe('reply');
    });

    it('delivers directly to waiting consumer', async () => {
      const bus = new MessageBus();
      const promise = bus.consumeOutbound();
      bus.publishOutbound(makeOutbound('direct'));

      const msg = await promise;
      expect(msg.content).toBe('direct');
    });
  });

  describe('size tracking', () => {
    it('tracks queue sizes', () => {
      const bus = new MessageBus();
      expect(bus.inboundSize).toBe(0);
      expect(bus.outboundSize).toBe(0);

      bus.publishInbound(makeInbound());
      bus.publishOutbound(makeOutbound());

      expect(bus.inboundSize).toBe(1);
      expect(bus.outboundSize).toBe(1);
    });
  });
});
