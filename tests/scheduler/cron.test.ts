import { describe, it, expect } from 'vitest';
import { parseCron, cronMatchesTime, nextCronTime } from '../../src/scheduler/cron.js';

describe('parseCron', () => {
  it('parses wildcard fields', () => {
    const fields = parseCron('* * * * *');
    expect(fields.minutes.size).toBe(60);
    expect(fields.hours.size).toBe(24);
    expect(fields.daysOfMonth.size).toBe(31);
    expect(fields.months.size).toBe(12);
    expect(fields.daysOfWeek.size).toBe(7);
  });

  it('parses specific values', () => {
    const fields = parseCron('30 6 15 1 3');
    expect(fields.minutes).toEqual(new Set([30]));
    expect(fields.hours).toEqual(new Set([6]));
    expect(fields.daysOfMonth).toEqual(new Set([15]));
    expect(fields.months).toEqual(new Set([1]));
    expect(fields.daysOfWeek).toEqual(new Set([3]));
  });

  it('parses ranges', () => {
    const fields = parseCron('1-5 9-17 * * 1-5');
    expect(fields.minutes).toEqual(new Set([1, 2, 3, 4, 5]));
    expect(fields.hours).toEqual(new Set([9, 10, 11, 12, 13, 14, 15, 16, 17]));
    expect(fields.daysOfWeek).toEqual(new Set([1, 2, 3, 4, 5]));
  });

  it('parses steps with wildcard', () => {
    const fields = parseCron('*/15 */6 * * *');
    expect(fields.minutes).toEqual(new Set([0, 15, 30, 45]));
    expect(fields.hours).toEqual(new Set([0, 6, 12, 18]));
  });

  it('parses steps with range', () => {
    const fields = parseCron('1-10/3 * * * *');
    expect(fields.minutes).toEqual(new Set([1, 4, 7, 10]));
  });

  it('parses lists', () => {
    const fields = parseCron('0,15,30,45 * * * *');
    expect(fields.minutes).toEqual(new Set([0, 15, 30, 45]));
  });

  it('parses combo: list with ranges', () => {
    const fields = parseCron('0,10-12,30 * * * *');
    expect(fields.minutes).toEqual(new Set([0, 10, 11, 12, 30]));
  });

  it('throws on wrong number of fields', () => {
    expect(() => parseCron('* * *')).toThrow('expected 5 fields');
  });

  it('throws on out-of-range value', () => {
    expect(() => parseCron('60 * * * *')).toThrow('out of range');
  });

  it('throws on invalid step', () => {
    expect(() => parseCron('*/0 * * * *')).toThrow('Invalid step');
  });

  it('throws on non-numeric value', () => {
    expect(() => parseCron('abc * * * *')).toThrow('Invalid value');
  });
});

describe('cronMatchesTime', () => {
  it('matches a specific time', () => {
    const fields = parseCron('30 6 * * *');
    // 2026-02-15 06:30:00 (Sunday = 0)
    const date = new Date(2026, 1, 15, 6, 30, 0);
    expect(cronMatchesTime(fields, date)).toBe(true);
  });

  it('does not match wrong minute', () => {
    const fields = parseCron('30 6 * * *');
    const date = new Date(2026, 1, 15, 6, 31, 0);
    expect(cronMatchesTime(fields, date)).toBe(false);
  });

  it('matches day of week', () => {
    const fields = parseCron('0 9 * * 1'); // Monday
    // 2026-02-16 is a Monday
    const date = new Date(2026, 1, 16, 9, 0, 0);
    expect(cronMatchesTime(fields, date)).toBe(true);
  });

  it('does not match wrong day of week', () => {
    const fields = parseCron('0 9 * * 1'); // Monday
    // 2026-02-15 is a Sunday
    const date = new Date(2026, 1, 15, 9, 0, 0);
    expect(cronMatchesTime(fields, date)).toBe(false);
  });
});

describe('nextCronTime', () => {
  it('finds next occurrence from a given time', () => {
    const fields = parseCron('0 6 * * *'); // daily at 6:00
    const after = new Date(2026, 1, 15, 7, 0, 0); // 7:00 AM
    const next = nextCronTime(fields, after);
    expect(next.getHours()).toBe(6);
    expect(next.getMinutes()).toBe(0);
    expect(next.getDate()).toBe(16); // next day
  });

  it('finds next occurrence within the same day', () => {
    const fields = parseCron('30 14 * * *'); // daily at 14:30
    const after = new Date(2026, 1, 15, 6, 0, 0);
    const next = nextCronTime(fields, after);
    expect(next.getDate()).toBe(15);
    expect(next.getHours()).toBe(14);
    expect(next.getMinutes()).toBe(30);
  });

  it('finds every-15-minutes occurrence', () => {
    const fields = parseCron('*/15 * * * *');
    const after = new Date(2026, 1, 15, 10, 16, 0);
    const next = nextCronTime(fields, after);
    expect(next.getMinutes()).toBe(30);
    expect(next.getHours()).toBe(10);
  });

  it('advances past current minute', () => {
    const fields = parseCron('0 * * * *');
    const after = new Date(2026, 1, 15, 10, 0, 30); // 10:00:30
    const next = nextCronTime(fields, after);
    // Should be 11:00, not 10:00
    expect(next.getHours()).toBe(11);
    expect(next.getMinutes()).toBe(0);
  });
});
