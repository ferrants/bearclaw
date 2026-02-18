import * as readline from 'node:readline';
import type { Channel } from './types.js';
import type { MessageBus } from '../bus/bus.js';
import type { OutboundMessage } from '../bus/types.js';
import { createLogger } from '../logging.js';
import { bold, boldCyan, boldGreen } from '../cli/colors.js';

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

    process.stdout.write(boldCyan('\nBearClaw CLI') + '\nType /help for commands.\n\n' + boldGreen('> '));

    this.rl.on('line', (line: string) => {
      const input = line.trim();
      if (!input) {
        process.stdout.write(boldGreen('> '));
        return;
      }

      if (input === '/exit' || input === 'quit' || input === 'exit') {
        process.stdout.write('Goodbye.\n');
        process.exit(0);
      }

      if (input === '/new') {
        this.onClearSession?.('cli');
        process.stdout.write('Conversation cleared.\n\n' + boldGreen('> '));
        return;
      }

      if (input === '/help' || input === 'help' || input === '?') {
        process.stdout.write(
          bold('Commands:') + '\n' +
          `  ${bold('/new')}     — Clear conversation and start fresh\n` +
          `  ${bold('/exit')}    — Exit BearClaw\n` +
          `  ${bold('/help')}    — Show this help\n` +
          '  (anything else is sent as a message)\n\n' + boldGreen('> ')
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
    process.stdout.write(`\n${prefix}${msg.content}\n\n${boldGreen('> ')}`);
  }
}
