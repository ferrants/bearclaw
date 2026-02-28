import type { Tool } from '../tools/types.js';
import { toolResult, errorResult } from '../tools/types.js';
import type { ToolContext } from '../tools/types.js';
import type { McpTransport } from './client.js';

export async function createMcpTools(prefix: string, client: McpTransport): Promise<Tool[]> {
  const mcpTools = await client.listTools();
  const tools: Tool[] = [];

  for (const mcpTool of mcpTools) {
    const name = `${prefix}_${mcpTool.name}`;
    const capturedClient = client;
    const capturedName = mcpTool.name;

    tools.push({
      name,
      description: mcpTool.description ?? '',
      parameters: mcpTool.inputSchema ?? { type: 'object', properties: {} },

      async execute(_ctx: ToolContext, args: Record<string, unknown>): Promise<ReturnType<typeof toolResult>> {
        try {
          const result = await capturedClient.callTool(capturedName, args);
          return toolResult(result || '(no output)');
        } catch (err) {
          return errorResult(`MCP tool error: ${(err as Error).message}`);
        }
      },
    });
  }

  return tools;
}
