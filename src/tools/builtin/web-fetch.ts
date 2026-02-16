import type { Tool, ToolContext } from '../types.js';
import { toolResult, errorResult } from '../types.js';
import { validateUrl } from '../../security/ssrf.js';
import { WEB_FETCH_MAX_CHARS, WEB_FETCH_TIMEOUT_MS } from '../../config/defaults.js';

export const webFetchTool: Tool = {
  name: 'web_fetch',
  description: 'Fetch content from a URL. HTML is stripped to text. Result truncated to 50K characters.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'URL to fetch' },
    },
    required: ['url'],
  },

  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ReturnType<typeof toolResult>> {
    const url = args.url as string;

    // Rate limit check
    if (ctx.policy.isRateLimited('web', ctx.currentAgentConfig.name)) {
      return errorResult('Rate limited: too many web requests');
    }

    // SSRF validation
    const validation = await validateUrl(url);
    if (!validation.allowed) {
      return errorResult(`URL blocked: ${validation.reason}`);
    }

    ctx.policy.recordAction('web', ctx.currentAgentConfig.name);

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(WEB_FETCH_TIMEOUT_MS),
        headers: {
          'User-Agent': 'BearClaw/0.1',
          'Accept': 'text/html,application/json,text/plain',
        },
      });

      if (!response.ok) {
        return errorResult(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type') ?? '';
      let text = await response.text();

      if (contentType.includes('text/html')) {
        text = stripHtml(text);
      }

      if (text.length > WEB_FETCH_MAX_CHARS) {
        text = text.slice(0, WEB_FETCH_MAX_CHARS) + '\n[Truncated]';
      }

      return toolResult(text);
    } catch (err) {
      return errorResult(`Fetch failed: ${(err as Error).message}`);
    }
  },
};

function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
