import { describe, it, expect } from 'vitest';
import { parseSlashCommand } from '../../src/commands/slash.js';
import { handleConfig, handleNew, handleSkill } from '../../src/commands/handlers.js';
import type { SkillDef } from '../../src/skills/types.js';

const mockSkill: SkillDef = {
  name: 'tmux',
  description: 'Remote control tmux sessions',
  dir: '/skills/tmux',
  instructions: 'Use tmux to manage sessions.',
};

const skills: SkillDef[] = [mockSkill];

describe('parseSlashCommand', () => {
  it('parses /config with no args', () => {
    const result = parseSlashCommand('/config', skills);
    expect(result).toEqual({ type: 'config', args: '' });
  });

  it('parses /config with args', () => {
    const result = parseSlashCommand('/config show gateway', skills);
    expect(result).toEqual({ type: 'config', args: 'show gateway' });
  });

  it('parses /new', () => {
    const result = parseSlashCommand('/new', skills);
    expect(result).toEqual({ type: 'new' });
  });

  it('parses skill command with args', () => {
    const result = parseSlashCommand('/tmux list sessions', skills);
    expect(result).toEqual({ type: 'skill', name: 'tmux', args: 'list sessions', skill: mockSkill });
  });

  it('parses skill command with no args', () => {
    const result = parseSlashCommand('/tmux', skills);
    expect(result).toEqual({ type: 'skill', name: 'tmux', args: '', skill: mockSkill });
  });

  it('returns null for unknown slash commands', () => {
    const result = parseSlashCommand('/unknown', skills);
    expect(result).toBeNull();
  });

  it('returns null for regular messages', () => {
    const result = parseSlashCommand('hello world', skills);
    expect(result).toBeNull();
  });

  it('returns null for empty string', () => {
    const result = parseSlashCommand('', skills);
    expect(result).toBeNull();
  });

  it('returns null for whitespace-only string', () => {
    const result = parseSlashCommand('   ', skills);
    expect(result).toBeNull();
  });

  it('trims input before parsing', () => {
    const result = parseSlashCommand('  /new  ', skills);
    expect(result).toEqual({ type: 'new' });
  });
});

describe('handleConfig', () => {
  it('returns inject with 2 messages when no args', () => {
    const result = handleConfig('');
    expect(result.action).toBe('inject');
    if (result.action === 'inject') {
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].role).toBe('user');
      expect(result.messages[1].role).toBe('assistant');
      expect(result.agentMessage).toBe('Configuration mode activated.');
    }
  });

  it('returns inject with 3 messages when args provided', () => {
    const result = handleConfig('show gateway');
    expect(result.action).toBe('inject');
    if (result.action === 'inject') {
      expect(result.messages).toHaveLength(3);
      expect(result.messages[0].role).toBe('user');
      expect(result.messages[1].role).toBe('assistant');
      expect(result.messages[2].role).toBe('user');
      expect(result.messages[2].content).toBe('show gateway');
      expect(result.agentMessage).toBeUndefined();
    }
  });
});

describe('handleNew', () => {
  it('returns immediate response', () => {
    const result = handleNew();
    expect(result).toEqual({ action: 'immediate', response: 'Session cleared.' });
  });
});

describe('handleSkill', () => {
  it('returns inject with 2 messages when no args', () => {
    const result = handleSkill(mockSkill, '');
    expect(result.action).toBe('inject');
    if (result.action === 'inject') {
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].role).toBe('user');
      expect(result.messages[0].content).toContain('tmux');
      expect(result.messages[1].role).toBe('assistant');
      expect(result.agentMessage).toBe('Skill "tmux" activated.');
    }
  });

  it('returns inject with 3 messages when args provided', () => {
    const result = handleSkill(mockSkill, 'list sessions');
    expect(result.action).toBe('inject');
    if (result.action === 'inject') {
      expect(result.messages).toHaveLength(3);
      expect(result.messages[2].role).toBe('user');
      expect(result.messages[2].content).toBe('list sessions');
      expect(result.agentMessage).toBeUndefined();
    }
  });
});
