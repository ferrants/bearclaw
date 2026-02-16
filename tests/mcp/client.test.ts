import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { McpClient } from '../../src/mcp/client.js';

describe('McpClient', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bearclaw-mcp-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('starts and communicates with a mock MCP server', async () => {
    // Create a mock MCP server script that responds to JSON-RPC
    const serverScript = path.join(tmpDir, 'server.js');
    fs.writeFileSync(serverScript, `
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });

rl.on('line', (line) => {
  const msg = JSON.parse(line);

  if (msg.method === 'initialize') {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: '2024-11-05',
        serverInfo: { name: 'mock-server', version: '1.0.0' },
        capabilities: {},
      },
    }) + '\\n');
  } else if (msg.method === 'tools/list') {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        tools: [
          {
            name: 'greet',
            description: 'Say hello',
            inputSchema: {
              type: 'object',
              properties: {
                name: { type: 'string' },
              },
            },
          },
        ],
      },
    }) + '\\n');
  } else if (msg.method === 'tools/call') {
    const name = msg.params.arguments.name || 'world';
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        content: [
          { type: 'text', text: 'Hello, ' + name + '!' },
        ],
      },
    }) + '\\n');
  }
});
`);

    const client = new McpClient('node', [serverScript]);
    await client.start();

    // List tools
    const tools = await client.listTools();
    expect(tools.length).toBe(1);
    expect(tools[0].name).toBe('greet');
    expect(tools[0].description).toBe('Say hello');

    // Call a tool
    const result = await client.callTool('greet', { name: 'BearClaw' });
    expect(result).toBe('Hello, BearClaw!');

    await client.stop();
  });

  it('handles server errors gracefully', async () => {
    const serverScript = path.join(tmpDir, 'error-server.js');
    fs.writeFileSync(serverScript, `
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });

rl.on('line', (line) => {
  const msg = JSON.parse(line);

  if (msg.method === 'initialize') {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: '2024-11-05',
        serverInfo: { name: 'error-server' },
        capabilities: {},
      },
    }) + '\\n');
  } else if (msg.method === 'tools/list') {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: msg.id,
      result: { tools: [] },
    }) + '\\n');
  } else {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: msg.id,
      error: { code: -32600, message: 'Something went wrong' },
    }) + '\\n');
  }
});
`);

    const client = new McpClient('node', [serverScript]);
    await client.start();

    const tools = await client.listTools();
    expect(tools).toEqual([]);

    await expect(client.callTool('anything', {})).rejects.toThrow('Something went wrong');

    await client.stop();
  });
});
