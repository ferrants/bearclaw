import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Tool, ToolContext } from '../types.js';
import { toolResult, errorResult } from '../types.js';

export const listDirTool: Tool = {
  name: 'list_dir',
  description: 'List files and directories in a path. Non-recursive by default.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Directory path to list (default: current directory)' },
      depth: { type: 'integer', description: 'Recursion depth (default: 1, max: 5)', minimum: 1, maximum: 5 },
    },
  },

  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ReturnType<typeof toolResult>> {
    const dirPath = (args.path as string) ?? '.';
    const depth = (args.depth as number) ?? 1;

    if (!ctx.policy.isPathAllowed(dirPath)) {
      return errorResult(`Path not allowed: ${dirPath}`);
    }

    const resolved = path.resolve(ctx.policy.workspaceDir, ctx.policy.expandPath(dirPath));

    try {
      const lines = await listRecursive(resolved, '', depth);
      return toolResult(lines.join('\n'));
    } catch (err) {
      return errorResult(`Failed to list directory: ${(err as Error).message}`);
    }
  },
};

async function listRecursive(basePath: string, prefix: string, depth: number): Promise<string[]> {
  if (depth <= 0) return [];

  const entries = await fs.readdir(basePath, { withFileTypes: true });
  const lines: string[] = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;

    const fullPath = path.join(basePath, entry.name);
    const displayPath = prefix ? `${prefix}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      lines.push(`${displayPath}/`);
      if (depth > 1) {
        const subLines = await listRecursive(fullPath, displayPath, depth - 1);
        lines.push(...subLines);
      }
    } else {
      try {
        const stat = await fs.stat(fullPath);
        lines.push(`${displayPath} (${formatSize(stat.size)})`);
      } catch {
        lines.push(displayPath);
      }
    }
  }

  return lines;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
