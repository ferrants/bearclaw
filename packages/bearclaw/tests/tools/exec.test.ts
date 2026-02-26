import { describe, it, expect } from 'vitest';
import { execTool } from '../../src/tools/builtin/exec.js';
import { SecurityPolicy } from '../../src/security/policy.js';
import { AutonomyLevel } from '../../src/config/schema.js';
import { ScopedRateLimiter } from '../../src/security/rate-limiter.js';
import { ALLOWED_COMMANDS, RESTRICTED_COMMANDS, FORBIDDEN_PATHS } from '../../src/config/defaults.js';
import type { ToolContext } from '../../src/tools/types.js';

function makeCtx(overrides?: Partial<{ autonomy: AutonomyLevel }>): ToolContext {
  const policy = new SecurityPolicy(
    overrides?.autonomy ?? AutonomyLevel.Supervised,
    process.cwd(),
    true,
    ALLOWED_COMMANDS,
    RESTRICTED_COMMANDS,
    FORBIDDEN_PATHS,
    [],
    new ScopedRateLimiter({ global: 100 }),
  );

  return {
    signal: AbortSignal.timeout(10000),
    policy,
    currentAgentConfig: { name: 'test', provider: 'anthropic' },
  } as ToolContext;
}

describe('exec tool', () => {
  it('executes allowed commands', async () => {
    const ctx = makeCtx();
    const result = await execTool.execute(ctx, { command: 'echo hello' });
    expect(result.isError).toBe(false);
    expect(result.forLLM).toContain('hello');
  });

  it('blocks disallowed commands', async () => {
    const ctx = makeCtx();
    const result = await execTool.execute(ctx, { command: 'rm -rf /' });
    expect(result.isError).toBe(true);
    expect(result.forLLM).toContain('not allowed');
  });

  it('blocks commands in readonly mode', async () => {
    const ctx = makeCtx({ autonomy: AutonomyLevel.ReadOnly });
    const result = await execTool.execute(ctx, { command: 'echo test' });
    expect(result.isError).toBe(true);
  });

  it('handles piped commands', async () => {
    const ctx = makeCtx();
    const result = await execTool.execute(ctx, { command: 'echo hello | grep hello' });
    expect(result.isError).toBe(false);
    expect(result.forLLM).toContain('hello');
  });

  it('blocks absolute paths outside workspace', async () => {
    const ctx = makeCtx();
    const result = await execTool.execute(ctx, { command: 'cat /etc/passwd' });
    expect(result.isError).toBe(true);
  });

  it('blocks find -exec usage', async () => {
    const ctx = makeCtx();
    const result = await execTool.execute(ctx, { command: 'find . -exec echo hi \\;' });
    expect(result.isError).toBe(true);
  });

  it('returns user-visible results', async () => {
    const ctx = makeCtx();
    const result = await execTool.execute(ctx, { command: 'echo visible' });
    expect(result.forUser).toBeDefined();
  });
});
