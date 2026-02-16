import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Tool, ToolContext } from '../types.js';
import { toolResult, errorResult } from '../types.js';
import { READ_FILE_MAX_SIZE } from '../../config/defaults.js';

export const readFileTool: Tool = {
  name: 'read_file',
  description: 'Read the contents of a file. Returns the file content as text.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file to read' },
    },
    required: ['path'],
  },

  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ReturnType<typeof toolResult>> {
    const filePath = args.path as string;

    // Raw path validation
    if (!ctx.policy.isPathAllowed(filePath)) {
      return errorResult(`Path not allowed: ${filePath}`);
    }

    const resolved = path.resolve(ctx.policy.workspaceDir, filePath);

    // Symlink/resolved path validation
    if (!(await ctx.policy.isResolvedPathAllowed(resolved))) {
      return errorResult(`Resolved path not allowed: ${filePath}`);
    }

    // Size check before reading
    try {
      const stat = await fs.stat(resolved);
      if (stat.size > READ_FILE_MAX_SIZE) {
        return errorResult(`File too large: ${stat.size} bytes (max ${READ_FILE_MAX_SIZE})`);
      }
    } catch (err) {
      return errorResult(`Cannot stat file: ${(err as Error).message}`);
    }

    try {
      const content = await fs.readFile(resolved, 'utf8');
      return toolResult(content);
    } catch (err) {
      return errorResult(`Failed to read file: ${(err as Error).message}`);
    }
  },
};
