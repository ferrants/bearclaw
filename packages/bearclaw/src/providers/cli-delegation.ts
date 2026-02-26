import { spawn } from 'node:child_process';
import {
  type LLMProvider,
  type Message,
  type ToolDefinition,
  type LLMResponse,
  type ChatOptions,
} from './types.js';

export interface CliDelegationConfig {
  command: string;
  flags?: string[];
  outputParser?: "text" | "jsonl";
  jsonlMessageType?: string;
}

export class CliDelegationProvider implements LLMProvider {
  constructor(
    private config: CliDelegationConfig,
    public defaultModel: string = '',
  ) {}

  async chat(
    messages: Message[],
    _tools: ToolDefinition[],
    _model: string,
    options?: ChatOptions,
  ): Promise<LLMResponse> {
    const lastUserMsg = messages.filter(m => m.role === 'user').pop();
    const prompt = lastUserMsg?.content ?? '';

    const args = this.buildArgs(prompt);
    const output = await this.spawnCommand(this.config.command, args, options?.signal);

    const content = this.config.outputParser === 'jsonl'
      ? this.parseJsonl(output)
      : output;

    return { content, toolCalls: [], finishReason: 'stop' };
  }

  private buildArgs(prompt: string): string[] {
    const cmd = this.config.command;
    const flags = this.config.flags ?? [];

    if (cmd === 'claude') {
      return ['--dangerously-skip-permissions', ...flags, '-p', prompt];
    }
    if (cmd === 'codex') {
      return ['exec', '--dangerously-bypass-approvals-and-sandbox', '--json', ...flags, prompt];
    }
    return [...flags, prompt];
  }

  private parseJsonl(output: string): string {
    const targetType = this.config.jsonlMessageType ?? 'agent_message';
    const lines = output.trim().split('\n');
    for (const line of lines) {
      try {
        const json = JSON.parse(line);
        if (json.type === 'item.completed' && json.item?.type === targetType) {
          return json.item.text;
        }
      } catch { /* ignore non-JSON lines */ }
    }
    return output;
  }

  private spawnCommand(command: string, args: string[], signal?: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
      child.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

      child.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`CLI delegation failed (exit ${code}): ${stderr.slice(0, 500)}`));
        }
      });

      child.on('error', reject);

      if (signal) {
        signal.addEventListener('abort', () => {
          child.kill('SIGTERM');
        }, { once: true });
      }
    });
  }
}
