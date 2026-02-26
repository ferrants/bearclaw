import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { AutonomyLevel } from '../../config/schema.js';
import type { Tool, ToolContext } from '../types.js';
import { toolResult, errorResult } from '../types.js';

export const editFileTool: Tool = {
  name: 'edit_file',
  description: 'Edit a file by finding an exact string and replacing it. The old_string must appear exactly once in the file.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file to edit' },
      old_string: { type: 'string', description: 'Exact string to find (must be unique in file)' },
      new_string: { type: 'string', description: 'String to replace it with' },
    },
    required: ['path', 'old_string', 'new_string'],
  },

  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ReturnType<typeof toolResult>> {
    const filePath = args.path as string;
    const oldString = args.old_string as string;
    const newString = args.new_string as string;

    if (ctx.policy.autonomy === AutonomyLevel.ReadOnly) {
      return errorResult('Edit operations not allowed in read-only mode');
    }

    if (!ctx.policy.isPathAllowed(filePath)) {
      return errorResult(`Path not allowed: ${filePath}`);
    }

    const resolved = path.resolve(ctx.policy.baseDir, ctx.policy.expandPath(filePath));
    if (!await ctx.policy.isResolvedPathAllowed(resolved)) {
      return errorResult(`Path not allowed: ${filePath}`);
    }

    try {
      const content = await fs.readFile(resolved, 'utf8');

      // Count occurrences
      let count = 0;
      let idx = 0;
      while ((idx = content.indexOf(oldString, idx)) !== -1) {
        count++;
        idx += oldString.length;
      }

      if (count === 0) {
        return errorResult('old_string not found in file');
      }
      if (count > 1) {
        return errorResult(`old_string found ${count} times (must be unique)`);
      }

      const newContent = content.replace(oldString, newString);
      await fs.writeFile(resolved, newContent, 'utf8');

      const linesRemoved = oldString.split('\n').length;
      const linesAdded = newString.split('\n').length;
      return toolResult(`Edited ${filePath}: -${linesRemoved} lines, +${linesAdded} lines`);
    } catch (err) {
      return errorResult(`Failed to edit file: ${(err as Error).message}`);
    }
  },
};
