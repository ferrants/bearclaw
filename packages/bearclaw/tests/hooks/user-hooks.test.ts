import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import { createUserHookRunner } from '../../src/hooks/user-hooks.js';

// Use a temp dir for hook scripts
function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bearclaw-hooks-'));
}

function writeScript(dir: string, name: string, content: string): string {
  const p = path.join(dir, name);
  fs.writeFileSync(p, content, { mode: 0o755 });
  return p;
}

describe('createUserHookRunner', () => {
  it('hook subprocess receives correct JSON on stdin', async () => {
    const dir = makeTempDir();
    const outFile = path.join(dir, 'stdin.json');
    writeScript(dir, 'capture.sh', `#!/bin/sh\ncat > "${outFile}"\n`);

    const runner = createUserHookRunner({
      'tool:before': [{ command: `sh ${path.join(dir, 'capture.sh')}` }],
    }, dir);

    await runner.runToolBefore('exec', { command: 'ls' }, 'agent1', 'chat1');

    const captured = JSON.parse(fs.readFileSync(outFile, 'utf-8'));
    expect(captured.event).toBe('tool:before');
    expect(captured.toolName).toBe('exec');
    expect(captured.args).toEqual({ command: 'ls' });
    expect(captured.agentId).toBe('agent1');
    expect(captured.chatId).toBe('chat1');

    fs.rmSync(dir, { recursive: true });
  });

  it('exit code 0 allows in tool:before', async () => {
    const dir = makeTempDir();
    const runner = createUserHookRunner({
      'tool:before': [{ command: 'exit 0' }],
    }, dir);

    const result = await runner.runToolBefore('exec', { command: 'ls' }, 'agent1');
    expect(result.proceed).toBe(true);

    fs.rmSync(dir, { recursive: true });
  });

  it('exit code 2 blocks in tool:before', async () => {
    const dir = makeTempDir();
    const runner = createUserHookRunner({
      'tool:before': [{ command: 'exit 2' }],
    }, dir);

    const result = await runner.runToolBefore('exec', { command: 'rm -rf /' }, 'agent1');
    expect(result.proceed).toBe(false);

    fs.rmSync(dir, { recursive: true });
  });

  it('stdout JSON replaces args in tool:before', async () => {
    const dir = makeTempDir();
    const runner = createUserHookRunner({
      'tool:before': [{ command: 'echo \'{"command":"ls -la"}\'' }],
    }, dir);

    const result = await runner.runToolBefore('exec', { command: 'ls' }, 'agent1');
    expect(result.proceed).toBe(true);
    expect(result.args).toEqual({ command: 'ls -la' });

    fs.rmSync(dir, { recursive: true });
  });

  it('non-JSON stdout is ignored gracefully', async () => {
    const dir = makeTempDir();
    const runner = createUserHookRunner({
      'tool:before': [{ command: 'echo "not json"' }],
    }, dir);

    const result = await runner.runToolBefore('exec', { command: 'ls' }, 'agent1');
    expect(result.proceed).toBe(true);
    expect(result.args).toEqual({ command: 'ls' });

    fs.rmSync(dir, { recursive: true });
  });

  it('toolNames filtering skips non-matching hooks', async () => {
    const dir = makeTempDir();
    const runner = createUserHookRunner({
      'tool:before': [{ command: 'exit 2', toolNames: ['write_file'] }],
    }, dir);

    // exec is not in toolNames, so the blocking hook should be skipped
    const result = await runner.runToolBefore('exec', { command: 'ls' }, 'agent1');
    expect(result.proceed).toBe(true);

    fs.rmSync(dir, { recursive: true });
  });

  it('toolNames filtering runs matching hooks', async () => {
    const dir = makeTempDir();
    const runner = createUserHookRunner({
      'tool:before': [{ command: 'exit 2', toolNames: ['exec'] }],
    }, dir);

    const result = await runner.runToolBefore('exec', { command: 'ls' }, 'agent1');
    expect(result.proceed).toBe(false);

    fs.rmSync(dir, { recursive: true });
  });

  it('timeout kills subprocess and does not block', async () => {
    const dir = makeTempDir();
    const runner = createUserHookRunner({
      'tool:before': [{ command: 'sleep 30', timeout: 200 }],
    }, dir);

    const start = Date.now();
    const result = await runner.runToolBefore('exec', { command: 'ls' }, 'agent1');
    const elapsed = Date.now() - start;

    // Should not take 30 seconds, should resolve quickly after timeout
    expect(elapsed).toBeLessThan(5000);
    // Non-zero exit from timeout means proceed (not exit code 2)
    expect(result.proceed).toBe(true);

    fs.rmSync(dir, { recursive: true });
  });

  it('sequential execution order', async () => {
    const dir = makeTempDir();
    const outFile = path.join(dir, 'order.txt');
    writeScript(dir, 'first.sh', `#!/bin/sh\necho -n 1 >> "${outFile}"\n`);
    writeScript(dir, 'second.sh', `#!/bin/sh\necho -n 2 >> "${outFile}"\n`);

    const runner = createUserHookRunner({
      'agent:start': [
        { command: `sh ${path.join(dir, 'first.sh')}` },
        { command: `sh ${path.join(dir, 'second.sh')}` },
      ],
    }, dir);

    await runner.runAgentStart('agent1', 'claude-3', 'chat1');

    const order = fs.readFileSync(outFile, 'utf-8');
    expect(order).toBe('12');

    fs.rmSync(dir, { recursive: true });
  });

  it('agent:end receives correct data', async () => {
    const dir = makeTempDir();
    const outFile = path.join(dir, 'end.json');
    writeScript(dir, 'capture.sh', `#!/bin/sh\ncat > "${outFile}"\n`);

    const runner = createUserHookRunner({
      'agent:end': [{ command: `sh ${path.join(dir, 'capture.sh')}` }],
    }, dir);

    await runner.runAgentEnd('agent1', 'Final answer', 3, ['exec', 'read_file'], 'chat1');

    const captured = JSON.parse(fs.readFileSync(outFile, 'utf-8'));
    expect(captured.event).toBe('agent:end');
    expect(captured.agentId).toBe('agent1');
    expect(captured.content).toBe('Final answer');
    expect(captured.iterations).toBe(3);
    expect(captured.toolsUsed).toEqual(['exec', 'read_file']);

    fs.rmSync(dir, { recursive: true });
  });

  it('tool:after runs for matching tool', async () => {
    const dir = makeTempDir();
    const outFile = path.join(dir, 'after.json');
    writeScript(dir, 'capture.sh', `#!/bin/sh\ncat > "${outFile}"\n`);

    const runner = createUserHookRunner({
      'tool:after': [{ command: `sh ${path.join(dir, 'capture.sh')}`, toolNames: ['exec'] }],
    }, dir);

    await runner.runToolAfter('exec', { command: 'ls' }, 'output here', 'agent1', 'chat1');

    const captured = JSON.parse(fs.readFileSync(outFile, 'utf-8'));
    expect(captured.event).toBe('tool:after');
    expect(captured.toolName).toBe('exec');
    expect(captured.resultSummary).toBe('output here');

    fs.rmSync(dir, { recursive: true });
  });

  it('tool:before chains modified args through multiple hooks', async () => {
    const dir = makeTempDir();
    const runner = createUserHookRunner({
      'tool:before': [
        { command: 'echo \'{"command":"step1"}\'' },
        { command: 'echo \'{"command":"step2"}\'' },
      ],
    }, dir);

    const result = await runner.runToolBefore('exec', { command: 'original' }, 'agent1');
    expect(result.proceed).toBe(true);
    // Second hook replaces the args from the first
    expect(result.args).toEqual({ command: 'step2' });

    fs.rmSync(dir, { recursive: true });
  });
});
