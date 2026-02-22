import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Scheduler } from '../../src/scheduler/scheduler.js';
import { MessageBus } from '../../src/bus/bus.js';
import { EventBus } from '../../src/events.js';
import type { ScheduleRule } from '../../src/config/schema.js';
import type { InboundMessage } from '../../src/bus/types.js';

describe('Scheduler', () => {
  let bus: MessageBus;
  let eventBus: EventBus;
  let abortController: AbortController;

  beforeEach(() => {
    bus = new MessageBus();
    eventBus = new EventBus();
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

    const scheduler = new Scheduler(rules, bus, eventBus, abortController.signal);
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

    const scheduler = new Scheduler(rules, bus, eventBus, abortController.signal);
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

    const scheduler = new Scheduler(rules, bus, eventBus, abortController.signal);
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

    const scheduler = new Scheduler(rules, bus, eventBus, abortController.signal);
    scheduler.start();

    // Abort before the interval fires
    abortController.abort();
    await vi.advanceTimersByTimeAsync(2000);

    // Bus should be empty
    expect(bus.inboundSize).toBe(0);
  });

  it('emits schedule:triggered event on the EventBus', async () => {
    const rules: ScheduleRule[] = [
      { interval: 'every 1s', agent: 'research', message: 'Do research' },
    ];

    const handler = vi.fn();
    eventBus.on('schedule:triggered', handler);

    const scheduler = new Scheduler(rules, bus, eventBus, abortController.signal);
    scheduler.start();

    await vi.advanceTimersByTimeAsync(1100);

    expect(handler).toHaveBeenCalledWith({
      chatId: 'schedule_0',
      agentId: 'research',
      message: 'Do research',
      schedule: 'every 1s',
    });
  });

  it('emits schedule:triggered with default agentId when no agent specified', async () => {
    const rules: ScheduleRule[] = [
      { interval: 'every 1s', message: 'Check status' },
    ];

    const handler = vi.fn();
    eventBus.on('schedule:triggered', handler);

    const scheduler = new Scheduler(rules, bus, eventBus, abortController.signal);
    scheduler.start();

    await vi.advanceTimersByTimeAsync(1100);

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'default', message: 'Check status' }),
    );
  });

  it('rejects rule with both cron and interval', () => {
    const rules: ScheduleRule[] = [
      { cron: '* * * * *', interval: 'every 1s', message: 'Bad' },
    ];

    expect(() => new Scheduler(rules, bus, eventBus, abortController.signal)).toThrow(
      'cannot have both',
    );
  });

  it('rejects rule with neither cron nor interval', () => {
    const rules: ScheduleRule[] = [
      { message: 'Bad' },
    ];

    expect(() => new Scheduler(rules, bus, eventBus, abortController.signal)).toThrow(
      'must have either',
    );
  });

  it('rejects rule with empty message', () => {
    const rules: ScheduleRule[] = [
      { interval: 'every 1s', message: '' },
    ];

    expect(() => new Scheduler(rules, bus, eventBus, abortController.signal)).toThrow(
      'must not be empty',
    );
  });

  it('generates unique chatIds when newThread is true', async () => {
    const rules: ScheduleRule[] = [
      { interval: 'every 1s', message: 'Fresh run', newThread: true },
    ];

    const scheduler = new Scheduler(rules, bus, eventBus, abortController.signal);
    scheduler.start();

    // Fire twice
    await vi.advanceTimersByTimeAsync(1100);
    const msg1 = await bus.consumeInbound();

    await vi.advanceTimersByTimeAsync(1100);
    const msg2 = await bus.consumeInbound();

    // Both should start with schedule_0_ but differ (timestamp suffix)
    expect(msg1.chatId).toMatch(/^schedule_0_\d+$/);
    expect(msg2.chatId).toMatch(/^schedule_0_\d+$/);
    expect(msg1.chatId).not.toBe(msg2.chatId);
  });

  it('uses static chatId when newThread is false', async () => {
    const rules: ScheduleRule[] = [
      { interval: 'every 1s', message: 'Same thread' },
    ];

    const scheduler = new Scheduler(rules, bus, eventBus, abortController.signal);
    scheduler.start();

    await vi.advanceTimersByTimeAsync(1100);
    const msg1 = await bus.consumeInbound();

    await vi.advanceTimersByTimeAsync(1100);
    const msg2 = await bus.consumeInbound();

    expect(msg1.chatId).toBe('schedule_0');
    expect(msg2.chatId).toBe('schedule_0');
  });

  it('calls onFire callback with rule and chatId before publishing', async () => {
    const rules: ScheduleRule[] = [
      { interval: 'every 1s', message: 'Fire test', allow: ['exec', 'read_file'] },
    ];

    const onFire = vi.fn();
    const scheduler = new Scheduler(rules, bus, eventBus, abortController.signal, onFire);
    scheduler.start();

    await vi.advanceTimersByTimeAsync(1100);

    expect(onFire).toHaveBeenCalledTimes(1);
    expect(onFire).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Fire test', allow: ['exec', 'read_file'] }),
      'schedule_0',
    );

    // Verify it was called before publish (message should be on bus after onFire)
    const msg = await bus.consumeInbound();
    expect(msg.message).toBe('Fire test');
  });

  it('calls onFire with newThread chatId', async () => {
    const rules: ScheduleRule[] = [
      { interval: 'every 1s', message: 'New thread fire', newThread: true },
    ];

    const onFire = vi.fn();
    const scheduler = new Scheduler(rules, bus, eventBus, abortController.signal, onFire);
    scheduler.start();

    await vi.advanceTimersByTimeAsync(1100);

    expect(onFire).toHaveBeenCalledTimes(1);
    const calledChatId = onFire.mock.calls[0][1] as string;
    expect(calledChatId).toMatch(/^schedule_0_\d+$/);
  });
});
