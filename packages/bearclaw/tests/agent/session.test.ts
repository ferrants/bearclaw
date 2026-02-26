import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { listChats, saveSession } from '../../src/agent/session.js';
import type { Message } from '../../src/providers/types.js';

describe('listChats', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bearclaw-session-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should return correct entries from session files', () => {
    const messages: Message[] = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ];
    saveSession(tmpDir, 'agent1', 'websocket', 'chat1', messages);

    const chats = listChats(tmpDir);
    expect(chats).toHaveLength(1);
    expect(chats[0].agentId).toBe('agent1');
    expect(chats[0].channel).toBe('websocket');
    expect(chats[0].chatId).toBe('chat1');
    expect(chats[0].messageCount).toBe(2);
    expect(chats[0].lastModified).toBeGreaterThan(0);
  });

  it('should handle underscores in agentId and chatId', () => {
    const messages: Message[] = [{ role: 'user', content: 'test' }];
    saveSession(tmpDir, 'my_agent', 'cli', 'chat_with_underscores', messages);

    const chats = listChats(tmpDir);
    expect(chats).toHaveLength(1);
    expect(chats[0].agentId).toBe('my_agent');
    expect(chats[0].channel).toBe('cli');
    expect(chats[0].chatId).toBe('chat_with_underscores');
  });

  it('should filter by channel', () => {
    const messages: Message[] = [{ role: 'user', content: 'test' }];
    saveSession(tmpDir, 'agent1', 'websocket', 'chat1', messages);
    saveSession(tmpDir, 'agent1', 'cli', 'chat2', messages);
    saveSession(tmpDir, 'agent1', 'gateway', 'chat3', messages);

    const chats = listChats(tmpDir, { channel: 'websocket' });
    expect(chats).toHaveLength(1);
    expect(chats[0].channel).toBe('websocket');
  });

  it('should filter by agentId', () => {
    const messages: Message[] = [{ role: 'user', content: 'test' }];
    saveSession(tmpDir, 'agent1', 'websocket', 'chat1', messages);
    saveSession(tmpDir, 'agent2', 'websocket', 'chat2', messages);

    const chats = listChats(tmpDir, { agentId: 'agent2' });
    expect(chats).toHaveLength(1);
    expect(chats[0].agentId).toBe('agent2');
  });

  it('should return empty array for empty directory', () => {
    const chats = listChats(tmpDir);
    expect(chats).toEqual([]);
  });

  it('should return empty array for non-existent directory', () => {
    const chats = listChats(path.join(tmpDir, 'nonexistent'));
    expect(chats).toEqual([]);
  });

  it('should sort by lastModified descending', async () => {
    const messages: Message[] = [{ role: 'user', content: 'test' }];
    saveSession(tmpDir, 'agent1', 'websocket', 'older', messages);

    // Ensure different mtime by waiting a small amount and writing again
    await new Promise(r => setTimeout(r, 50));
    saveSession(tmpDir, 'agent1', 'websocket', 'newer', messages);

    const chats = listChats(tmpDir);
    expect(chats).toHaveLength(2);
    expect(chats[0].chatId).toBe('newer');
    expect(chats[1].chatId).toBe('older');
  });

  it('should skip files that do not match known channel pattern', () => {
    // Write a file that doesn't have a known channel
    fs.writeFileSync(path.join(tmpDir, 'badformat.json'), '[]');
    const chats = listChats(tmpDir);
    expect(chats).toEqual([]);
  });
});
