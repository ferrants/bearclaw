import type { Tool, ToolContext, ToolResult } from '../types.js';
import { toolResult } from '../types.js';
import { CONFIG_DOCS } from '../../config/docs.js';

export const configExplainTool: Tool = {
  name: 'config_explain',
  description: 'Explain available BearClaw configuration options. Optionally filter by section (e.g. "security", "providers", "policy").',
  parameters: {
    type: 'object',
    properties: {
      section: {
        type: 'string',
        description: 'Optional section prefix to filter by (e.g. "security", "providers", "gateway", "policy", "monitoring", "memory", "channels").',
      },
    },
  },

  async execute(_ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const section = args.section as string | undefined;

    let docs = CONFIG_DOCS;
    if (section) {
      const prefix = section.toLowerCase();
      docs = docs.filter(d => d.path.startsWith(prefix));
    }

    if (docs.length === 0) {
      return toolResult(`No configuration fields found for section "${section}". Available sections: workspace, security, gateway, providers, channels, memory, policy, monitoring.`);
    }

    const lines: string[] = [];
    for (const doc of docs) {
      lines.push(`### ${doc.path}`);
      lines.push(`Type: ${doc.type}`);
      lines.push(doc.description);
      if (doc.defaultValue !== undefined) {
        lines.push(`Default: ${typeof doc.defaultValue === 'string' ? doc.defaultValue : JSON.stringify(doc.defaultValue)}`);
      }
      if (doc.isSecurity) {
        lines.push('⚠ Security-sensitive — changes require user approval.');
      }
      lines.push('');
    }

    return toolResult(lines.join('\n'));
  },
};
