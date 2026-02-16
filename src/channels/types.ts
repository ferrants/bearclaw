import type { MessageBus } from '../bus/bus.js';
import type { OutboundMessage } from '../bus/types.js';

export interface Channel {
  name: string;
  start(bus: MessageBus): Promise<void>;
  stop(): Promise<void>;
  send(msg: OutboundMessage): Promise<void>;
}
