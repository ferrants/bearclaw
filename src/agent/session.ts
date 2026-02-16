import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Message } from '../providers/types.js';
import { MAX_SESSION_MESSAGES } from '../config/defaults.js';

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

export function clearSession(sessionsDir: string, agentId: string, channel: string, chatId: string): boolean {
  const p = sessionPath(sessionsDir, agentId, channel, chatId);
  try {
    fs.unlinkSync(p);
    return true;
  } catch {
    return false;
  }
}
