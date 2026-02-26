import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Message } from '../providers/types.js';
import { MAX_SESSION_MESSAGES } from '../config/defaults.js';

export const KNOWN_CHANNELS = ['cli', 'websocket', 'scheduler', 'gateway'] as const;

export interface ChatInfo {
  agentId: string;
  channel: string;
  chatId: string;
  lastModified: number;
  messageCount: number;
}

function sanitizePathSegment(segment: string): string {
  return segment.replace(/[/\\.\0]/g, '_');
}

export function sessionPath(sessionsDir: string, agentId: string, channel: string, chatId: string): string {
  const safeAgent = sanitizePathSegment(agentId);
  const safeChannel = sanitizePathSegment(channel);
  const safeChatId = sanitizePathSegment(chatId);
  return path.join(sessionsDir, `${safeAgent}_${safeChannel}_${safeChatId}.json`);
}

export function loadSession(sessionsDir: string, agentId: string, channel: string, chatId: string): Message[] {
  try {
    const data = fs.readFileSync(sessionPath(sessionsDir, agentId, channel, chatId), 'utf8');
    const messages: Message[] = JSON.parse(data);
    return messages.slice(-MAX_SESSION_MESSAGES);
  } catch {
    return [];
  }
}

export function saveSession(sessionsDir: string, agentId: string, channel: string, chatId: string, messages: Message[]): void {
  fs.mkdirSync(sessionsDir, { recursive: true });
  const trimmed = messages.slice(-MAX_SESSION_MESSAGES);
  fs.writeFileSync(sessionPath(sessionsDir, agentId, channel, chatId), JSON.stringify(trimmed, null, 2));
}

export function listChats(sessionsDir: string, filter?: { channel?: string; agentId?: string }): ChatInfo[] {
  let files: string[];
  try {
    files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json'));
  } catch {
    return [];
  }

  const results: ChatInfo[] = [];
  for (const file of files) {
    const base = file.slice(0, -5); // strip .json
    const parts = base.split('_');

    // Find the channel token among known channels
    let channelIdx = -1;
    for (let i = 0; i < parts.length; i++) {
      if ((KNOWN_CHANNELS as readonly string[]).includes(parts[i])) {
        channelIdx = i;
        break;
      }
    }
    if (channelIdx < 1 || channelIdx >= parts.length - 1) continue;

    const agentId = parts.slice(0, channelIdx).join('_');
    const channel = parts[channelIdx];
    const chatId = parts.slice(channelIdx + 1).join('_');

    if (filter?.channel && filter.channel !== channel) continue;
    if (filter?.agentId && filter.agentId !== agentId) continue;

    const filePath = path.join(sessionsDir, file);
    let lastModified = 0;
    let messageCount = 0;
    try {
      const stat = fs.statSync(filePath);
      lastModified = stat.mtimeMs;
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Message[];
      messageCount = data.length;
    } catch {
      continue;
    }

    results.push({ agentId, channel, chatId, lastModified, messageCount });
  }

  return results.sort((a, b) => b.lastModified - a.lastModified);
}

export function clearSession(sessionsDir: string, agentId: string, channel: string, chatId: string): boolean {
  const p = sessionPath(sessionsDir, agentId, channel, chatId);
  try {
    fs.unlinkSync(p);
    return true;
  } catch {
    return false;
  }
}
