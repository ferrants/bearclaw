import * as readline from 'node:readline';
import type { Channel } from './types.js';
import type { MessageBus } from '../bus/bus.js';
import type { OutboundMessage } from '../bus/types.js';
import { createLogger } from '../logging.js';

const log = createLogger('cli-channel');

export interface CliChannelOptions {
  onClearSession?: (chatId: string) => void;
}

export class CliChannel implements Channel {
  name = 'cli';
  private bus: MessageBus | null = null;
  private rl: readline.Interface | null = null;
  private onClearSession?: (chatId: string) => void;

  constructor(options?: CliChannelOptions) {
    this.onClearSession = options?.onClearSession;
  }

  async start(bus: MessageBus): Promise<void> {
    this.bus = bus;

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    process.stdout.write('\nBearClaw CLI\nType /help for commands.\n\n> ');

    this.rl.on('line', (line: string) => {
      const input = line.trim();
      if (!input) {
        process.stdout.write('> ');
        return;
      }

      if (input === '/exit' || input === 'quit' || input === 'exit') {
        process.stdout.write('Goodbye.\n');
        process.exit(0);
      }

      if (input === '/new') {
        this.onClearSession?.('cli');
        process.stdout.write('Conversation cleared.\n\n> ');
        return;
      }

      if (input === '/help' || input === 'help' || input === '?') {
        process.stdout.write(
          'Commands:\n' +
          '  /new     — Clear conversation and start fresh\n' +
          '  /exit    — Exit BearClaw\n' +
          '  /help    — Show this help\n' +
          '  (anything else is sent as a message)\n\n> '
        );
        return;
      }

      this.bus!.publishInbound({
        channel: 'cli',
        sender: 'user',
        chatId: 'cli',
        messageId: `cli_${Date.now()}`,
        message: input,
        timestamp: Date.now(),
      });
    });

    log.info('CLI channel started');
  }

  async stop(): Promise<void> {
    this.rl?.close();
    this.rl = null;
    log.info('CLI channel stopped');
  }

  async send(msg: OutboundMessage): Promise<void> {
    const prefix = msg.agentId ? `[${msg.agentId}] ` : '';
    process.stdout.write(`\n${prefix}${msg.content}\n\n> `);
  }
}
