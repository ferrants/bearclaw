import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Message } from '../providers/types.js';
import { MAX_SESSION_MESSAGES } from '../config/defaults.js';

export function sessionPath(sessionsDir: string, agentId: string, channel: string, chatId: string): string {
  return path.join(sessionsDir, `${agentId}_${channel}_${chatId}.json`);
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
