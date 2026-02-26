import { describe, it, expect, vi } from 'vitest';
import { ConversationTracker } from '../../src/orchestrator/conversation.js';

describe('ConversationTracker', () => {
  it('creates and retrieves conversations', () => {
    const tracker = new ConversationTracker();
    const conv = tracker.create('conv1', 'cli', 'chat1');
    expect(conv.id).toBe('conv1');
    expect(tracker.get('conv1')).toBeDefined();
  });

  it('fan out increments pending counter', () => {
    const tracker = new ConversationTracker();
    tracker.create('conv1', 'cli', 'chat1');
    tracker.fanOut('conv1', 3);
    expect(tracker.get('conv1')!.pending).toBe(3);
  });

  it('branchComplete decrements and aggregates', () => {
    const tracker = new ConversationTracker();
    let aggregated = '';
    tracker.create('conv1', 'cli', 'chat1', (result) => { aggregated = result; });
    tracker.fanOut('conv1', 2);

    tracker.branchComplete('conv1', 'agent1', 'Response from agent1');
    expect(tracker.get('conv1')!.pending).toBe(1);

    tracker.branchComplete('conv1', 'agent2', 'Response from agent2');
    // Conversation should be complete and cleaned up
    expect(tracker.get('conv1')).toBeUndefined();
    expect(aggregated).toContain('agent1');
    expect(aggregated).toContain('agent2');
  });

  it('stores responses per agent', () => {
    const tracker = new ConversationTracker();
    tracker.create('conv1', 'cli', 'chat1');
    tracker.fanOut('conv1', 2);

    tracker.branchComplete('conv1', 'agent1', 'First');
    const conv = tracker.get('conv1');
    expect(conv?.responses.get('agent1')).toBe('First');
  });
});
