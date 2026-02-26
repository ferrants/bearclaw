import type { Tool, ToolContext, ToolResult } from '../types.js';
import { toolResult, errorResult } from '../types.js';
import type { ConfigManager } from '../../config/manager.js';

const SECRET_PATHS = new Set([
  'providers.anthropic.apiKey',
  'providers.openai.apiKey',
]);

function redactSecrets(obj: unknown, currentPath: string = ''): unknown {
  if (obj === null || obj === undefined) return obj;

  if (SECRET_PATHS.has(currentPath) && typeof obj === 'string' && obj.length > 0) {
    return '***REDACTED***';
  }

  if (Array.isArray(obj)) {
    return obj.map((item, i) => redactSecrets(item, `${currentPath}[${i}]`));
  }

  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const childPath = currentPath ? `${currentPath}.${key}` : key;
      result[key] = redactSecrets(value, childPath);
    }
    return result;
  }

  return obj;
}

export function createConfigGetTool(configManager: ConfigManager): Tool {
  return {
    name: 'config_get',
    description: 'Read the current BearClaw configuration. Optionally specify a dotted path to read a specific field (e.g. "security.autonomy"). Secrets are redacted.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Dotted path to a specific config field (e.g. "security.autonomy"). Omit to get the full config.',
        },
      },
    },

    async execute(_ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
      const dottedPath = args.path as string | undefined;

      if (dottedPath) {
        const value = configManager.get(dottedPath);
        if (value === undefined) {
          return errorResult(`Config path not found: ${dottedPath}`);
        }
        const redacted = redactSecrets(value, dottedPath);
        return toolResult(JSON.stringify(redacted, null, 2));
      }

      const fullConfig = configManager.getConfig();
      const redacted = redactSecrets(fullConfig);
      return toolResult(JSON.stringify(redacted, null, 2));
    },
  };
}
