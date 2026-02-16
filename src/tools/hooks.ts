import type { ToolResult, ToolContext } from './types.js';
import { createLogger } from '../logging.js';

const log = createLogger('tool-hooks');

export type BeforeToolCallHook = (
  toolName: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
) => Promise<{ proceed: boolean; args: Record<string, unknown> }>;

export type AfterToolCallHook = (
  toolName: string,
  args: Record<string, unknown>,
  result: ToolResult,
  ctx: ToolContext,
) => Promise<void>;

export class ToolHookRegistryImpl {
  private beforeHooks: BeforeToolCallHook[] = [];
  private afterHooks: AfterToolCallHook[] = [];
  private pendingAfterHooks: Promise<void>[] = [];

  registerBefore(hook: BeforeToolCallHook): void {
    this.beforeHooks.push(hook);
  }

  registerAfter(hook: AfterToolCallHook): void {
    this.afterHooks.push(hook);
  }

  async runBefore(
    toolName: string,
    args: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<{ proceed: boolean; args: Record<string, unknown> }> {
    let currentArgs = { ...args };

    for (const hook of this.beforeHooks) {
      try {
        const result = await hook(toolName, currentArgs, ctx);
        if (!result.proceed) {
          return { proceed: false, args: currentArgs };
        }
        currentArgs = result.args;
      } catch (err) {
        log.error('Before hook error', { tool: toolName, error: String(err) });
        return { proceed: false, args: currentArgs };
      }
    }

    return { proceed: true, args: currentArgs };
  }

  async runAfter(
    toolName: string,
    args: Record<string, unknown>,
    result: ToolResult,
    ctx: ToolContext,
  ): Promise<void> {
    const promises = this.afterHooks.map(async hook => {
      try {
        await hook(toolName, args, result, ctx);
      } catch (err) {
        log.error('After hook error', { tool: toolName, error: String(err) });
      }
    });

    const pending = Promise.all(promises).then(() => {});
    this.pendingAfterHooks.push(pending);
  }

  async flush(timeoutMs = 5000): Promise<void> {
    const pending = [...this.pendingAfterHooks];
    this.pendingAfterHooks = [];

    await Promise.race([
      Promise.allSettled(pending),
      new Promise<void>(resolve => setTimeout(resolve, timeoutMs)),
    ]);
  }
}
