import { describe, it, expect } from 'vitest';
import { validateArgs } from '../../src/tools/validate.js';

describe('validateArgs', () => {
  it('validates required fields', () => {
    const schema = {
      type: 'object',
      properties: { name: { type: 'string' }, age: { type: 'number' } },
      required: ['name'],
    };

    expect(validateArgs(schema, { name: 'test' }).valid).toBe(true);
    expect(validateArgs(schema, {}).valid).toBe(false);
    expect(validateArgs(schema, {}).errors[0]).toContain('name');
  });

  it('validates string type', () => {
    const schema = {
      type: 'object',
      properties: { name: { type: 'string' } },
    };

    expect(validateArgs(schema, { name: 'test' }).valid).toBe(true);
    expect(validateArgs(schema, { name: 123 }).valid).toBe(false);
  });

  it('validates number type', () => {
    const schema = {
      type: 'object',
      properties: { count: { type: 'number' } },
    };

    expect(validateArgs(schema, { count: 5 }).valid).toBe(true);
    expect(validateArgs(schema, { count: 'five' }).valid).toBe(false);
  });

  it('validates integer type', () => {
    const schema = {
      type: 'object',
      properties: { count: { type: 'integer' } },
    };

    expect(validateArgs(schema, { count: 5 }).valid).toBe(true);
    expect(validateArgs(schema, { count: 5.5 }).valid).toBe(false);
  });

  it('validates boolean type', () => {
    const schema = {
      type: 'object',
      properties: { flag: { type: 'boolean' } },
    };

    expect(validateArgs(schema, { flag: true }).valid).toBe(true);
    expect(validateArgs(schema, { flag: 'yes' }).valid).toBe(false);
  });

  it('validates enum', () => {
    const schema = {
      type: 'object',
      properties: { mode: { type: 'string', enum: ['a', 'b'] } },
    };

    expect(validateArgs(schema, { mode: 'a' }).valid).toBe(true);
    expect(validateArgs(schema, { mode: 'c' }).valid).toBe(false);
  });

  it('validates minimum/maximum', () => {
    const schema = {
      type: 'object',
      properties: { n: { type: 'number', minimum: 0, maximum: 100 } },
    };

    expect(validateArgs(schema, { n: 50 }).valid).toBe(true);
    expect(validateArgs(schema, { n: -1 }).valid).toBe(false);
    expect(validateArgs(schema, { n: 101 }).valid).toBe(false);
  });

  it('handles non-object schemas', () => {
    expect(validateArgs({ type: 'string' }, {}).valid).toBe(true);
  });
});
