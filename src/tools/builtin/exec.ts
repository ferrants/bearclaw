import { spawn } from 'node:child_process';
import type { Tool, ToolContext } from '../types.js';
import { userResult, errorResult } from '../types.js';
import { SHELL_TIMEOUT_MS, SHELL_OUTPUT_LIMIT } from '../../config/defaults.js';

export const execTool: Tool = {
  name: 'exec',
  description: 'Execute a shell command. Commands must be on the allowed list.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The shell command to execute' },
    },
    required: ['command'],
  },

  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ReturnType<typeof userResult>> {
    const command = args.command as string;

    // Rate limit check
    if (ctx.policy.isRateLimited('exec', ctx.currentAgentConfig.name)) {
      return errorResult('Rate limited: too many exec calls');
    }

    // Command validation
    if (!ctx.policy.isCommandAllowed(command)) {
      return errorResult(`Command not allowed: ${command}`);
    }

    // Record the action
    ctx.policy.recordAction('exec', ctx.currentAgentConfig.name);

    try {
      const output = await runCommand(command, ctx.policy.workspaceDir, ctx.signal);
      return userResult(output);
    } catch (err) {
      return errorResult(`Command failed: ${(err as Error).message}`);
    }
  },
};

function isSimpleCommand(command: string): boolean {
  return !command.includes('|') &&
    !command.includes('&&') &&
    !command.includes('||') &&
    !command.includes(';') &&
    !command.includes('\n');
}

function runCommand(command: string, cwd: string, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    let child;

    if (isSimpleCommand(command)) {
      const parts = command.trim().split(/\s+/);
      const cmd = parts[0];
      const args = parts.slice(1);
      child = spawn(cmd, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    } else {
      child = spawn('sh', ['-c', command], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    }

    let stdout = '';
    let stderr = '';
    let outputSize = 0;

    child.stdout.on('data', (data: Buffer) => {
      outputSize += data.length;
      if (outputSize <= SHELL_OUTPUT_LIMIT) {
        stdout += data.toString();
      }
    });

    child.stderr.on('data', (data: Buffer) => {
      outputSize += data.length;
      if (outputSize <= SHELL_OUTPUT_LIMIT) {
        stderr += data.toString();
      }
    });

    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Command timed out after ${SHELL_TIMEOUT_MS}ms`));
    }, SHELL_TIMEOUT_MS);

    child.on('close', (code) => {
      clearTimeout(timeout);
      if (outputSize > SHELL_OUTPUT_LIMIT) {
        const truncNote = `\n[Output truncated at ${SHELL_OUTPUT_LIMIT} bytes]`;
        stdout += truncNote;
      }
      if (code === 0) {
        resolve(stdout || stderr);
      } else {
        const output = stderr || stdout;
        reject(new Error(`Exit code ${code}: ${output.slice(0, 500)}`));
      }
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    signal.addEventListener('abort', () => {
      child.kill('SIGTERM');
    }, { once: true });
  });
}
