import type { Channel } from './types.js';
import type { MessageBus } from '../bus/bus.js';
import type { OutboundMessage } from '../bus/types.js';
import { createLogger } from '../logging.js';

const log = createLogger('telegram-channel');

export interface TelegramChannelOptions {
  onClearSession?: (chatId: string) => void;
}

export class TelegramChannel implements Channel {
  name = 'telegram';
  private bus: MessageBus | null = null;
  private bot: any = null; // node-telegram-bot-api instance
  private allowFrom: string[];
  private onClearSession?: (chatId: string) => void;

  constructor(
    private botToken: string,
    allowFrom?: string[],
    options?: TelegramChannelOptions,
  ) {
    this.allowFrom = allowFrom ?? [];
    this.onClearSession = options?.onClearSession;
  }

  async start(bus: MessageBus): Promise<void> {
    this.bus = bus;

    // Dynamic import to avoid hard dependency
    const TelegramBot = (await import('node-telegram-bot-api')).default;
    this.bot = new TelegramBot(this.botToken, { polling: true });

    this.bot.on('message', (msg: any) => {
      const senderId = String(msg.from?.id ?? '');
      const senderUsername = msg.from?.username ?? '';
      const chatId = String(msg.chat.id);

      // Sender allowlist check (matches numeric user ID or username)
      if (this.allowFrom.length > 0) {
        const allowed = this.allowFrom.some(
          entry => entry === senderId || entry === senderUsername
        );
        if (!allowed) {
          log.warn('Unauthorized sender', { senderId, senderUsername, chatId });
          return;
        }
      }

      const text = msg.text ?? '';
      if (!text) return;

      // Handle /new command
      if (text === '/new') {
        this.onClearSession?.(chatId);
        this.bot.sendMessage(chatId, 'Conversation cleared.');
        log.info('/new command', { chatId, senderId });
        return;
      }

      // Handle /help command
      if (text === '/help') {
        this.bot.sendMessage(chatId, 'Commands:\n/new — Clear conversation and start fresh\n/help — Show this help');
        return;
      }

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

    const chunks = splitMessage(msg.content);
    for (let i = 0; i < chunks.length; i++) {
      await this.bot.sendMessage(msg.chatId, chunks[i], i === 0 ? options : {});
    }
    log.info('Message sent', { chatId: msg.chatId, length: msg.content.length, chunks: chunks.length });
  }
}

const TELEGRAM_MAX_LENGTH = 4096;

/**
 * Split a message into chunks that fit within Telegram's 4096 character limit.
 * Splits at paragraph boundaries first, then line boundaries, then hard-cuts.
 */
function splitMessage(text: string): string[] {
  if (text.length <= TELEGRAM_MAX_LENGTH) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= TELEGRAM_MAX_LENGTH) {
      chunks.push(remaining);
      break;
    }

    let splitAt = -1;

    // Try to split at a paragraph boundary (double newline)
    const paragraphSearch = remaining.lastIndexOf('\n\n', TELEGRAM_MAX_LENGTH);
    if (paragraphSearch > 0) {
      splitAt = paragraphSearch;
    }

    // Fall back to line boundary
    if (splitAt < 0) {
      const lineSearch = remaining.lastIndexOf('\n', TELEGRAM_MAX_LENGTH);
      if (lineSearch > 0) {
        splitAt = lineSearch;
      }
    }

    // Hard cut as last resort
    if (splitAt < 0) {
      splitAt = TELEGRAM_MAX_LENGTH;
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^\n+/, '');
  }

  return chunks;
}
