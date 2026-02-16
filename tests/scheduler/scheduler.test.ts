import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Scheduler } from '../../src/scheduler/scheduler.js';
import { MessageBus } from '../../src/bus/bus.js';
import type { ScheduleRule } from '../../src/config/schema.js';
import type { InboundMessage } from '../../src/bus/types.js';

describe('Scheduler', () => {
  let bus: MessageBus;
  let abortController: AbortController;

  beforeEach(() => {
    bus = new MessageBus();
    abortController = new AbortController();
    vi.useFakeTimers();
  });

  afterEach(() => {
    abortController.abort();
    vi.useRealTimers();
  });

  it('fires interval rule and produces message on bus', async () => {
    const rules: ScheduleRule[] = [
      { interval: 'every 1s', message: 'Check status' },
    ];

    const scheduler = new Scheduler(rules, bus, abortController.signal);
    scheduler.start();

    // Advance past the interval
    await vi.advanceTimersByTimeAsync(1100);

    const msg = await bus.consumeInbound();
    expect(msg.channel).toBe('scheduler');
    expect(msg.sender).toBe('scheduler');
    expect(msg.message).toBe('Check status');
    expect(msg.chatId).toBe('schedule_0');
  });

  it('prefixes message with @agent when agent is specified', async () => {
    const rules: ScheduleRule[] = [
      { interval: 'every 1s', agent: 'research', message: 'Do research' },
    ];

    const scheduler = new Scheduler(rules, bus, abortController.signal);
    scheduler.start();

    await vi.advanceTimersByTimeAsync(1100);

    const msg = await bus.consumeInbound();
    expect(msg.message).toBe('@research Do research');
  });

  it('produces deterministic chatId per rule index', async () => {
    const rules: ScheduleRule[] = [
      { interval: 'every 1s', message: 'First' },
      { interval: 'every 1s', message: 'Second' },
    ];

    const scheduler = new Scheduler(rules, bus, abortController.signal);
    scheduler.start();

    await vi.advanceTimersByTimeAsync(1100);

    const messages: InboundMessage[] = [];
    // Both rules should have fired
    messages.push(await bus.consumeInbound());
    messages.push(await bus.consumeInbound());

    const chatIds = messages.map(m => m.chatId).sort();
    expect(chatIds).toContain('schedule_0');
    expect(chatIds).toContain('schedule_1');
  });

  it('abort signal stops the scheduler', async () => {
    const rules: ScheduleRule[] = [
      { interval: 'every 1s', message: 'Tick' },
    ];

    const scheduler = new Scheduler(rules, bus, abortController.signal);
    scheduler.start();

    // Abort before the interval fires
    abortController.abort();
    await vi.advanceTimersByTimeAsync(2000);

    // Bus should be empty
    expect(bus.inboundSize).toBe(0);
  });

  it('rejects rule with both cron and interval', () => {
    const rules: ScheduleRule[] = [
      { cron: '* * * * *', interval: 'every 1s', message: 'Bad' },
    ];

    expect(() => new Scheduler(rules, bus, abortController.signal)).toThrow(
      'cannot have both',
    );
  });

  it('rejects rule with neither cron nor interval', () => {
    const rules: ScheduleRule[] = [
      { message: 'Bad' },
    ];

    expect(() => new Scheduler(rules, bus, abortController.signal)).toThrow(
      'must have either',
    );
  });

  it('rejects rule with empty message', () => {
    const rules: ScheduleRule[] = [
      { interval: 'every 1s', message: '' },
    ];

    expect(() => new Scheduler(rules, bus, abortController.signal)).toThrow(
      'must not be empty',
    );
  });
});
