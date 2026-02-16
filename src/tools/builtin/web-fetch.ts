import * as http from 'node:http';
import * as https from 'node:https';
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

    // SSRF validation (resolves DNS once, returns the IP to connect to)
    const validation = await validateUrl(url);
    if (!validation.allowed) {
      return errorResult(`URL blocked: ${validation.reason}`);
    }

    ctx.policy.recordAction('web', ctx.currentAgentConfig.name);

    try {
      // Build a URL that connects to the resolved IP, preventing DNS rebinding
      const parsed = new URL(url);
      const resolvedIP = validation.resolvedIP!;
      const originalHostname = validation.hostname!;
      const isHttps = parsed.protocol === 'https:';

      const text = await fetchByIP(parsed, resolvedIP, originalHostname, isHttps);
      let result = text;

      const contentType = result.startsWith('<!') || result.startsWith('<html') ? 'text/html' : '';
      if (contentType) {
        result = stripHtml(result);
      }

      if (result.length > WEB_FETCH_MAX_CHARS) {
        result = result.slice(0, WEB_FETCH_MAX_CHARS) + '\n[Truncated]';
      }

      return toolResult(result);
    } catch (err) {
      return errorResult(`Fetch failed: ${(err as Error).message}`);
    }
  },
};

/**
 * Fetch a URL by connecting to a specific IP address.
 * This prevents DNS rebinding by ensuring we connect to the IP we validated.
 * The Host header and TLS SNI are set to the original hostname.
 */
function fetchByIP(
  parsed: URL,
  resolvedIP: string,
  originalHostname: string,
  isHttps: boolean,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const port = parsed.port
      ? parseInt(parsed.port)
      : isHttps ? 443 : 80;

    const options: http.RequestOptions = {
      hostname: resolvedIP,
      port,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'Host': originalHostname + (parsed.port ? `:${parsed.port}` : ''),
        'User-Agent': 'BearClaw/0.1',
        'Accept': 'text/html,application/json,text/plain',
      },
      timeout: WEB_FETCH_TIMEOUT_MS,
    };

    if (isHttps) {
      // Set servername for TLS SNI so certificate validation works
      (options as https.RequestOptions).servername = originalHostname;
    }

    const transport = isHttps ? https : http;
    const req = transport.request(options, (res) => {
      if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
        reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
        res.resume();
        return;
      }

      const chunks: Buffer[] = [];
      let size = 0;

      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        // Stop accumulating if way over limit
        if (size <= WEB_FETCH_MAX_CHARS * 2) {
          chunks.push(chunk);
        }
      });

      res.on('end', () => {
        resolve(Buffer.concat(chunks).toString('utf8'));
      });

      res.on('error', reject);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timed out after ${WEB_FETCH_TIMEOUT_MS}ms`));
    });

    req.on('error', reject);
    req.end();
  });
}

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
