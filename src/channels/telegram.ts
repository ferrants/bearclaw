import type { Channel } from './types.js';
import type { MessageBus } from '../bus/bus.js';
import type { OutboundMessage } from '../bus/types.js';
import { createLogger } from '../logging.js';

const log = createLogger('telegram-channel');

export class TelegramChannel implements Channel {
  name = 'telegram';
  private bus: MessageBus | null = null;
  private bot: any = null; // node-telegram-bot-api instance
  private allowFrom: string[];

  constructor(
    private botToken: string,
    allowFrom?: string[],
  ) {
    this.allowFrom = allowFrom ?? [];
  }

  async start(bus: MessageBus): Promise<void> {
    this.bus = bus;

    // Dynamic import to avoid hard dependency
    const TelegramBot = (await import('node-telegram-bot-api')).default;
    this.bot = new TelegramBot(this.botToken, { polling: true });

    this.bot.on('message', (msg: any) => {
      const senderId = String(msg.from?.id ?? '');
      const chatId = String(msg.chat.id);

      // Sender allowlist check
      if (this.allowFrom.length > 0 && !this.allowFrom.includes(senderId)) {
        log.warn('Unauthorized sender', { senderId, chatId });
        return;
      }

      const text = msg.text ?? '';
      if (!text) return;

      log.info('Message received', { chatId, senderId, text: text.slice(0, 100) });

      this.bus!.publishInbound({
        channel: 'telegram',
        sender: senderId,
        chatId,
        messageId: String(msg.message_id),
        message: text,
        timestamp: msg.date * 1000,
      });
    });

    log.info('Telegram channel started');
  }

  async stop(): Promise<void> {
    if (this.bot) {
      await this.bot.stopPolling();
      this.bot = null;
    }
    log.info('Telegram channel stopped');
  }

  async send(msg: OutboundMessage): Promise<void> {
    if (!this.bot) return;

    const options: any = {};
    if (msg.replyToMessageId) {
      options.reply_to_message_id = parseInt(msg.replyToMessageId);
    }

    await this.bot.sendMessage(msg.chatId, msg.content, options);
    log.info('Message sent', { chatId: msg.chatId, length: msg.content.length });
  }
}
