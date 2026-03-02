import { spawn } from 'node:child_process';
import { createLogger } from '../logging.js';

const log = createLogger('user-hooks');

export interface UserHookConfig {
  command: string;
  timeout?: number;
  toolNames?: string[];
}

export interface UserHookRunner {
  runAgentStart(agentId: string, model: string, chatId?: string): Promise<void>;
  runAgentEnd(agentId: string, content: string, iterations: number, toolsUsed: string[], chatId?: string): Promise<void>;
  runToolBefore(toolName: string, args: Record<string, unknown>, agentId: string, chatId?: string): Promise<{ proceed: boolean; args: Record<string, unknown> }>;
  runToolAfter(toolName: string, args: Record<string, unknown>, resultSummary: string, agentId: string, chatId?: string): Promise<void>;
}

interface HookResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function executeHook(config: UserHookConfig, stdinData: unknown, cwd: string, signal?: AbortSignal): Promise<HookResult> {
  const timeout = config.timeout ?? 10_000;

  return new Promise((resolve) => {
    const child = spawn('sh', ['-c', config.command], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      signal,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const settle = (exitCode: number) => {
      if (settled) return;
      settled = true;
      resolve({ exitCode, stdout, stderr });
    };

    child.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });
    child.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });

    child.on('error', (err) => {
      log.warn('Hook spawn error', { command: config.command, error: String(err) });
      settle(1);
    });

    child.on('close', (code) => {
      settle(code ?? 1);
    });

    const timer = setTimeout(() => {
      if (!settled) {
        log.warn('Hook timed out, killing', { command: config.command, timeout });
        child.kill('SIGKILL');
        settle(1);
      }
    }, timeout);

    child.on('close', () => clearTimeout(timer));

    // Suppress EPIPE errors when the child exits before stdin is consumed
    child.stdin?.on('error', () => {});

    // Write JSON to stdin
    try {
      child.stdin?.write(JSON.stringify(stdinData));
      child.stdin?.end();
    } catch {
      // stdin may already be closed
    }
  });
}

export function createUserHookRunner(
  hooks: NonNullable<import('../config/agent-schema.js').AgentDirConfig['hooks']>,
  cwd: string,
): UserHookRunner {
  return {
    async runAgentStart(agentId, model, chatId) {
      const configs = hooks['agent:start'] ?? [];
      for (const config of configs) {
        const result = await executeHook(config, { event: 'agent:start', agentId, model, chatId }, cwd);
        if (result.exitCode !== 0) {
          log.warn('agent:start hook non-zero exit', { command: config.command, exitCode: result.exitCode, stderr: result.stderr });
        }
      }
    },

    async runAgentEnd(agentId, content, iterations, toolsUsed, chatId) {
      const configs = hooks['agent:end'] ?? [];
      for (const config of configs) {
        const result = await executeHook(config, { event: 'agent:end', agentId, content, iterations, toolsUsed, chatId }, cwd);
        if (result.exitCode !== 0) {
          log.warn('agent:end hook non-zero exit', { command: config.command, exitCode: result.exitCode, stderr: result.stderr });
        }
      }
    },

    async runToolBefore(toolName, args, agentId, chatId) {
      const configs = hooks['tool:before'] ?? [];
      let currentArgs = { ...args };

      for (const config of configs) {
        // Skip if toolNames filter doesn't match
        if (config.toolNames && !config.toolNames.includes(toolName)) continue;

        const result = await executeHook(config, { event: 'tool:before', toolName, args: currentArgs, agentId, chatId }, cwd);

        if (result.exitCode === 2) {
          log.info('tool:before hook blocked call', { command: config.command, toolName });
          return { proceed: false, args: currentArgs };
        }

        if (result.exitCode !== 0) {
          log.warn('tool:before hook non-zero exit', { command: config.command, exitCode: result.exitCode, stderr: result.stderr });
          continue;
        }

        // Try to parse stdout as JSON to replace args
        if (result.stdout.trim()) {
          try {
            const parsed = JSON.parse(result.stdout.trim());
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              currentArgs = parsed as Record<string, unknown>;
            }
          } catch {
            // Non-JSON stdout is ignored
          }
        }
      }

      return { proceed: true, args: currentArgs };
    },

    async runToolAfter(toolName, args, resultSummary, agentId, chatId) {
      const configs = hooks['tool:after'] ?? [];
      for (const config of configs) {
        if (config.toolNames && !config.toolNames.includes(toolName)) continue;

        const result = await executeHook(config, { event: 'tool:after', toolName, args, resultSummary, agentId, chatId }, cwd);
        if (result.exitCode !== 0) {
          log.warn('tool:after hook non-zero exit', { command: config.command, exitCode: result.exitCode, stderr: result.stderr });
        }
      }
    },
  };
}
