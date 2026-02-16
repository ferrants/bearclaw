import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { AutonomyLevel } from '../../config/schema.js';
import type { Tool, ToolContext } from '../types.js';
import { toolResult, errorResult } from '../types.js';
import { WRITE_FILE_MAX_SIZE } from '../../config/defaults.js';

export const writeFileTool: Tool = {
  name: 'write_file',
  description: 'Write content to a file. Creates parent directories if needed.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file to write' },
      content: { type: 'string', description: 'Content to write' },
    },
    required: ['path', 'content'],
  },

  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ReturnType<typeof toolResult>> {
    const filePath = args.path as string;
    const content = args.content as string;

    // Autonomy check
    if (ctx.policy.autonomy === AutonomyLevel.ReadOnly) {
      return errorResult('Write operations not allowed in read-only mode');
    }

    // Path validation
    if (!ctx.policy.isPathAllowed(filePath)) {
      return errorResult(`Path not allowed: ${filePath}`);
    }

    // Size check
    const byteLength = Buffer.byteLength(content, 'utf8');
    if (byteLength > WRITE_FILE_MAX_SIZE) {
      return errorResult(`Content too large: ${byteLength} bytes (max ${WRITE_FILE_MAX_SIZE})`);
    }

    const resolved = path.resolve(ctx.policy.workspaceDir, filePath);

    try {
      // Auto-create parent directories
      await fs.mkdir(path.dirname(resolved), { recursive: true });
      await fs.writeFile(resolved, content, 'utf8');
      return toolResult(`Wrote ${byteLength} bytes to ${filePath}`);
    } catch (err) {
      return errorResult(`Failed to write file: ${(err as Error).message}`);
    }
  },
};
