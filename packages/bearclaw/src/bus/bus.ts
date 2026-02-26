import type { InboundMessage, OutboundMessage } from './types.js';

const DEFAULT_CAPACITY = 100;

export class MessageBus {
  private inboundQueue: InboundMessage[] = [];
  private outboundQueue: OutboundMessage[] = [];
  private inboundWaiters: Array<(msg: InboundMessage) => void> = [];
  private outboundWaiters: Array<(msg: OutboundMessage) => void> = [];
  private capacity: number;

  constructor(capacity = DEFAULT_CAPACITY) {
    this.capacity = capacity;
  }

  publishInbound(msg: InboundMessage): boolean {
    // If a consumer is waiting, deliver directly
    const waiter = this.inboundWaiters.shift();
    if (waiter) {
      waiter(msg);
      return true;
    }

    // Otherwise enqueue if capacity allows
    if (this.inboundQueue.length >= this.capacity) {
      return false;
    }
    this.inboundQueue.push(msg);
    return true;
  }

  consumeInbound(signal?: AbortSignal): Promise<InboundMessage> {
    // If queue has messages, return immediately
    const msg = this.inboundQueue.shift();
    if (msg) return Promise.resolve(msg);

    // Otherwise wait for a message
    return new Promise((resolve, reject) => {
      const waiter = (msg: InboundMessage) => {
        resolve(msg);
      };
      this.inboundWaiters.push(waiter);

      signal?.addEventListener('abort', () => {
        const idx = this.inboundWaiters.indexOf(waiter);
        if (idx !== -1) this.inboundWaiters.splice(idx, 1);
        reject(new DOMException('Aborted', 'AbortError'));
      }, { once: true });
    });
  }

  publishOutbound(msg: OutboundMessage): boolean {
    const waiter = this.outboundWaiters.shift();
    if (waiter) {
      waiter(msg);
      return true;
    }

    if (this.outboundQueue.length >= this.capacity) {
      return false;
    }
    this.outboundQueue.push(msg);
    return true;
  }

  consumeOutbound(signal?: AbortSignal): Promise<OutboundMessage> {
    const msg = this.outboundQueue.shift();
    if (msg) return Promise.resolve(msg);

    return new Promise((resolve, reject) => {
      const waiter = (msg: OutboundMessage) => {
        resolve(msg);
      };
      this.outboundWaiters.push(waiter);

      signal?.addEventListener('abort', () => {
        const idx = this.outboundWaiters.indexOf(waiter);
        if (idx !== -1) this.outboundWaiters.splice(idx, 1);
        reject(new DOMException('Aborted', 'AbortError'));
      }, { once: true });
    });
  }

  get inboundSize(): number { return this.inboundQueue.length; }
  get outboundSize(): number { return this.outboundQueue.length; }
}
