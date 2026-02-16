import * as readline from 'node:readline';
import type { Channel } from './types.js';
import type { MessageBus } from '../bus/bus.js';
import type { OutboundMessage } from '../bus/types.js';
import { createLogger } from '../logging.js';

const log = createLogger('cli-channel');

export class CliChannel implements Channel {
  name = 'cli';
  private bus: MessageBus | null = null;
  private rl: readline.Interface | null = null;

  async start(bus: MessageBus): Promise<void> {
    this.bus = bus;

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    process.stdout.write('\nBearClaw CLI\nType "help" for commands, "quit" to exit.\n\n> ');

    this.rl.on('line', (line: string) => {
      const input = line.trim();
      if (!input) {
        process.stdout.write('> ');
        return;
      }

      if (input === 'quit' || input === 'exit') {
        process.stdout.write('Goodbye.\n');
        process.exit(0);
      }

      if (input === 'help' || input === '?') {
        process.stdout.write(
          'Commands:\n' +
          '  help, ?    — Show this help\n' +
          '  quit, exit — Exit BearClaw\n' +
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
