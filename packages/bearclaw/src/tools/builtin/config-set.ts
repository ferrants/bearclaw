import type { Tool, ToolContext, ToolResult } from '../types.js';
import { toolResult, errorResult } from '../types.js';
import type { ConfigManager } from '../../config/manager.js';
import { CONFIG_DOCS } from '../../config/docs.js';

function coerceValue(value: unknown, expectedType: string): unknown {
  if (typeof value === 'string') {
    // string → boolean
    if (expectedType === 'boolean') {
      if (value === 'true') return true;
      if (value === 'false') return false;
    }
    // string → number
    if (expectedType === 'number') {
      const n = Number(value);
      if (!Number.isNaN(n)) return n;
    }
    // string → string[] (JSON array)
    if (expectedType === 'string[]') {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) return parsed;
      } catch { /* not valid JSON, leave as-is */ }
    }
  }
  return value;
}

export function createConfigSetTool(
  configManager: ConfigManager,
  requestApproval: () => Promise<boolean>,
): Tool {
  return {
    name: 'config_set',
    description: 'Update an instance configuration field. Requires a dotted path and a new value. Security-sensitive fields always require user approval.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Dotted path to the config field (e.g. "providers.openai.defaultModel", "monitoring.logLevel").',
        },
        value: {
          description: 'The new value to set. Strings are coerced to the expected type when possible.',
        },
      },
      required: ['path', 'value'],
    },

    async execute(_ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
      const dottedPath = args.path as string;
      const rawValue = args.value;

      // Validate path exists in docs
      const doc = CONFIG_DOCS.find(d => d.path === dottedPath);
      if (!doc) {
        const suggestions = CONFIG_DOCS
          .filter(d => d.path.includes(dottedPath.split('.').pop() ?? ''))
          .map(d => d.path)
          .slice(0, 5);
        const hint = suggestions.length > 0 ? ` Did you mean: ${suggestions.join(', ')}?` : '';
        return errorResult(`Unknown config path: ${dottedPath}.${hint}`);
      }

      // Security fields always require approval
      if (doc.isSecurity) {
        const approved = await requestApproval();
        if (!approved) {
          return errorResult(`User denied approval for changing security field: ${dottedPath}`);
        }
      }

      // Coerce value types
      const coerced = coerceValue(rawValue, doc.type);

      // Get old value for display
      const oldValue = configManager.get(dottedPath);

      configManager.set(dottedPath, coerced);

      return toolResult(
        `Updated ${dottedPath}:\n  Old: ${JSON.stringify(oldValue)}\n  New: ${JSON.stringify(coerced)}`
      );
    },
  };
}
