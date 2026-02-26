import { describe, it, expect } from 'vitest';
import { parseInterval } from '../../src/scheduler/interval.js';

describe('parseInterval', () => {
  it('parses seconds', () => {
    expect(parseInterval('every 30s')).toBe(30_000);
  });

  it('parses minutes', () => {
    expect(parseInterval('every 30m')).toBe(1_800_000);
  });

  it('parses hours', () => {
    expect(parseInterval('every 4h')).toBe(14_400_000);
  });

  it('parses days', () => {
    expect(parseInterval('every 1d')).toBe(86_400_000);
  });

  it('handles whitespace variations', () => {
    expect(parseInterval('  every 10m  ')).toBe(600_000);
    expect(parseInterval('every 10 m')).toBe(600_000);
  });

  it('throws on missing "every"', () => {
    expect(() => parseInterval('30m')).toThrow('Invalid interval');
  });

  it('throws on zero value', () => {
    expect(() => parseInterval('every 0m')).toThrow('must be positive');
  });

  it('throws on invalid unit', () => {
    expect(() => parseInterval('every 5x')).toThrow('Invalid interval');
  });

  it('throws on empty string', () => {
    expect(() => parseInterval('')).toThrow('Invalid interval');
  });
});
