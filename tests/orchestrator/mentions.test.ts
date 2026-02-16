import { describe, it, expect } from 'vitest';
import { parseMentions, validateMentions } from '../../src/orchestrator/mentions.js';

describe('parseMentions', () => {
  it('parses single mention', () => {
    const { mentions } = parseMentions('[@coder: fix the bug]');
    expect(mentions).toHaveLength(1);
    expect(mentions[0].agents).toEqual(['coder']);
    expect(mentions[0].message).toBe('fix the bug');
  });

  it('parses multiple mentions', () => {
    const { mentions } = parseMentions('[@coder: fix it] [@reviewer: check it]');
    expect(mentions).toHaveLength(2);
    expect(mentions[0].agents).toEqual(['coder']);
    expect(mentions[1].agents).toEqual(['reviewer']);
  });

  it('parses comma-separated agents', () => {
    const { mentions } = parseMentions('[@agent1,agent2: shared task]');
    expect(mentions).toHaveLength(1);
    expect(mentions[0].agents).toEqual(['agent1', 'agent2']);
  });

  it('extracts shared context', () => {
    const { mentions, sharedContext } = parseMentions('Review this code: [@coder: optimize it]');
    expect(sharedContext).toBe('Review this code:');
    expect(mentions[0].message).toContain('Review this code:');
    expect(mentions[0].message).toContain('optimize it');
  });

  it('returns empty mentions for no tags', () => {
    const { mentions, sharedContext } = parseMentions('just a normal message');
    expect(mentions).toHaveLength(0);
    expect(sharedContext).toBe('just a normal message');
  });
});

describe('validateMentions', () => {
  it('validates known agents', () => {
    const mentions = [{ agents: ['coder'], message: 'test' }];
    const { valid, invalid } = validateMentions(mentions, ['coder', 'reviewer']);
    expect(valid).toHaveLength(1);
    expect(invalid).toHaveLength(0);
  });

  it('flags unknown agents', () => {
    const mentions = [{ agents: ['unknown'], message: 'test' }];
    const { valid, invalid } = validateMentions(mentions, ['coder']);
    expect(valid).toHaveLength(0);
    expect(invalid).toEqual(['unknown']);
  });

  it('validates team membership', () => {
    const mentions = [{ agents: ['outsider'], message: 'test' }];
    const { valid, invalid } = validateMentions(mentions, ['outsider', 'coder'], ['coder']);
    expect(valid).toHaveLength(0);
    expect(invalid).toEqual(['outsider']);
  });
});
