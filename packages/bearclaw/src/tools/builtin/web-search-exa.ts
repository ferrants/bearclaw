import type { Tool, ToolContext } from '../types.js';
import { toolResult, errorResult } from '../types.js';
import { WEB_FETCH_TIMEOUT_MS, WEB_FETCH_MAX_CHARS } from '../../config/defaults.js';

const EXA_ENDPOINT = 'https://mcp.exa.ai/mcp';

export const webSearchExaTool: Tool = {
  name: 'web_search_exa',
  description: 'Search the web via Exa MCP. Returns a text summary of results.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      numResults: { type: 'number', description: 'Number of results (default 8)' },
      type: { type: 'string', enum: ['auto', 'fast', 'deep'], description: 'Search depth (default auto)' },
      livecrawl: { type: 'string', enum: ['fallback', 'preferred'], description: 'Live crawl preference (default fallback)' },
      contextMaxCharacters: { type: 'number', description: 'Max characters for context per result' },
    },
    required: ['query'],
  },

  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ReturnType<typeof toolResult>> {
    const query = String(args.query ?? '').trim();
    if (!query) return errorResult('query is required');

    // Rate limit check (web scope)
    if (ctx.policy.isRateLimited('web', ctx.currentAgentConfig.name)) {
      return errorResult('Rate limited: too many web requests');
    }

    const payload = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'web_search_exa',
        arguments: {
          query,
          numResults: typeof args.numResults === 'number' ? args.numResults : 8,
          type: typeof args.type === 'string' ? args.type : 'auto',
          livecrawl: typeof args.livecrawl === 'string' ? args.livecrawl : 'fallback',
          contextMaxCharacters: typeof args.contextMaxCharacters === 'number' ? args.contextMaxCharacters : 10000,
        },
      },
    };

    ctx.policy.recordAction('web', ctx.currentAgentConfig.name);

    try {
      const response = await fetch(EXA_ENDPOINT, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'accept': 'application/json, text/event-stream',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(WEB_FETCH_TIMEOUT_MS),
      });

      if (!response.ok) {
        const text = await response.text();
        return errorResult(`Search failed (${response.status}): ${text.slice(0, 500)}`);
      }

      const bodyText = await response.text();
      const resultText = extractSseText(bodyText);
      if (!resultText) return toolResult('No results found.');

      const trimmed = resultText.length > WEB_FETCH_MAX_CHARS
        ? resultText.slice(0, WEB_FETCH_MAX_CHARS) + '\n[Truncated]'
        : resultText;

      return toolResult(trimmed);
    } catch (err) {
      return errorResult(`Search failed: ${(err as Error).message}`);
    }
  },
};

function extractSseText(body: string): string {
  for (const line of body.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    const jsonStr = line.slice(6).trim();
    if (!jsonStr) continue;
    try {
      const data = JSON.parse(jsonStr) as { result?: { content?: Array<{ type?: string; text?: string }> } };
      const text = data.result?.content?.find(c => c.type === 'text')?.text;
      if (text) return text;
    } catch {
      // ignore malformed lines
    }
  }
  return '';
}
