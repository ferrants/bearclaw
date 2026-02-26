import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Tool, ToolContext } from '../types.js';
import { toolResult, errorResult } from '../types.js';
import { READ_FILE_MAX_SIZE } from '../../config/defaults.js';

const SKIP_DIRS = new Set(['.git', 'node_modules', '.next', 'dist', 'build', '__pycache__']);
const MAX_RESULTS_CAP = 500;

export const searchTool: Tool = {
  name: 'search',
  description: 'Search for text patterns in files recursively. Grep-like functionality.',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Search pattern (regex or literal)' },
      path: { type: 'string', description: 'Directory to search (default: current directory)' },
      literal: { type: 'boolean', description: 'Treat pattern as literal string (default: false)' },
      glob: { type: 'string', description: 'File pattern to match (e.g., "*.ts")' },
      caseSensitive: { type: 'boolean', description: 'Case-sensitive search (default: true)' },
      maxResults: { type: 'integer', description: 'Maximum results (default: 100, max: 500)', minimum: 1, maximum: 500 },
      contextLines: { type: 'integer', description: 'Lines of context around matches (default: 0)', minimum: 0, maximum: 5 },
    },
    required: ['pattern'],
  },

  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ReturnType<typeof toolResult>> {
    const pattern = args.pattern as string;
    const searchPath = (args.path as string) ?? '.';
    const literal = (args.literal as boolean) ?? false;
    const glob = args.glob as string | undefined;
    const caseSensitive = (args.caseSensitive as boolean) ?? true;
    const maxResults = Math.min((args.maxResults as number) ?? 100, MAX_RESULTS_CAP);
    const contextLines = (args.contextLines as number) ?? 0;

    if (!ctx.policy.isPathAllowed(searchPath)) {
      return errorResult(`Path not allowed: ${searchPath}`);
    }

    const resolved = path.resolve(ctx.policy.baseDir, ctx.policy.expandPath(searchPath));
    if (!await ctx.policy.isResolvedPathAllowed(resolved)) {
      return errorResult(`Path not allowed: ${searchPath}`);
    }

    let regex: RegExp;
    try {
      const patternStr = literal ? pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : pattern;
      regex = new RegExp(patternStr, caseSensitive ? 'g' : 'gi');
    } catch {
      return errorResult(`Invalid regex pattern: ${pattern}`);
    }

    const results: string[] = [];
    await searchDir(resolved, resolved, regex, glob, maxResults, contextLines, results);

    if (results.length === 0) {
      return toolResult('No matches found.');
    }

    return toolResult(results.join('\n'));
  },
};

async function searchDir(
  basePath: string,
  dirPath: string,
  regex: RegExp,
  glob: string | undefined,
  maxResults: number,
  contextLines: number,
  results: string[],
): Promise<void> {
  if (results.length >= maxResults) return;

  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (results.length >= maxResults) return;

    if (SKIP_DIRS.has(entry.name)) continue;

    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      await searchDir(basePath, fullPath, regex, glob, maxResults, contextLines, results);
    } else if (entry.isFile()) {
      if (glob && !matchGlob(glob, entry.name)) continue;

      try {
        const stat = await fs.stat(fullPath);
        if (stat.size > READ_FILE_MAX_SIZE) continue;

        const content = await fs.readFile(fullPath, { encoding: null });
        // Skip binary files (null byte in first 8KB)
        if (content.subarray(0, 8192).includes(0)) continue;

        const text = content.toString('utf8');
        const lines = text.split('\n');
        const relPath = path.relative(basePath, fullPath);

        for (let i = 0; i < lines.length; i++) {
          if (results.length >= maxResults) return;

          regex.lastIndex = 0;
          if (regex.test(lines[i])) {
            if (contextLines > 0) {
              const start = Math.max(0, i - contextLines);
              const end = Math.min(lines.length - 1, i + contextLines);
              for (let j = start; j <= end; j++) {
                const marker = j === i ? '>' : ' ';
                results.push(`${relPath}:${j + 1}:${marker} ${lines[j]}`);
              }
              results.push('---');
            } else {
              results.push(`${relPath}:${i + 1}: ${lines[i]}`);
            }
          }
        }
      } catch {
        // Skip unreadable files
      }
    }
  }
}

function matchGlob(pattern: string, filename: string): boolean {
  const regex = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${regex}$`).test(filename);
}
