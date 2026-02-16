import { describe, it, expect } from 'vitest';
import { parseFrontmatter } from '../../src/skills/frontmatter.js';

describe('parseFrontmatter', () => {
  it('parses simple scalars', () => {
    const input = `---
name: deploy
description: Deploy the app
---

# Instructions`;

    const { data, body } = parseFrontmatter(input);
    expect(data.name).toBe('deploy');
    expect(data.description).toBe('Deploy the app');
    expect(body.trim()).toBe('# Instructions');
  });

  it('parses quoted strings', () => {
    const input = `---
name: "my-skill"
description: 'A skill with colons: inside'
---

Body`;

    const { data } = parseFrontmatter(input);
    expect(data.name).toBe('my-skill');
    expect(data.description).toBe('A skill with colons: inside');
  });

  it('parses array of objects (tools)', () => {
    const input = `---
name: deploy
description: Deploy
tools:
  - name: run_deploy
    description: Run deployment
    script: scripts/deploy.sh
    parameters:
      type: object
      properties:
        environment: { type: string, description: "Target env" }
      required:
        - environment
---

Body`;

    const { data } = parseFrontmatter(input);
    expect(Array.isArray(data.tools)).toBe(true);
    const tools = data.tools as Array<Record<string, unknown>>;
    expect(tools.length).toBe(1);
    expect(tools[0].name).toBe('run_deploy');
    expect(tools[0].description).toBe('Run deployment');
    expect(tools[0].script).toBe('scripts/deploy.sh');
    const params = tools[0].parameters as Record<string, unknown>;
    expect(params.type).toBe('object');
  });

  it('parses MCP server definitions', () => {
    const input = `---
name: jira-skill
description: Jira integration
mcp:
  - name: jira
    command: npx
    args:
      - -y
      - @modelcontextprotocol/server-jira
    env:
      JIRA_URL: "https://mycompany.atlassian.net"
      JIRA_TOKEN: "\${JIRA_TOKEN}"
---

Instructions`;

    const { data } = parseFrontmatter(input);
    expect(Array.isArray(data.mcp)).toBe(true);
    const mcp = data.mcp as Array<Record<string, unknown>>;
    expect(mcp.length).toBe(1);
    expect(mcp[0].name).toBe('jira');
    expect(mcp[0].command).toBe('npx');
    const args = mcp[0].args as string[];
    expect(args).toContain('-y');
    expect(args).toContain('@modelcontextprotocol/server-jira');
    const env = mcp[0].env as Record<string, string>;
    expect(env.JIRA_URL).toBe('https://mycompany.atlassian.net');
  });

  it('returns empty data when no frontmatter', () => {
    const input = '# Just markdown\n\nNo frontmatter here.';
    const { data, body } = parseFrontmatter(input);
    expect(data).toEqual({});
    expect(body).toBe(input);
  });

  it('handles multiple tools', () => {
    const input = `---
name: multi
description: Multiple tools
tools:
  - name: tool_a
    description: First tool
    script: a.sh
  - name: tool_b
    description: Second tool
    script: b.sh
---

Body`;

    const { data } = parseFrontmatter(input);
    const tools = data.tools as Array<Record<string, unknown>>;
    expect(tools.length).toBe(2);
    expect(tools[0].name).toBe('tool_a');
    expect(tools[1].name).toBe('tool_b');
  });

  it('parses inline arrays', () => {
    const input = `---
name: test
description: Test
tags: [deploy, production, ci]
---

Body`;

    const { data } = parseFrontmatter(input);
    expect(data.tags).toEqual(['deploy', 'production', 'ci']);
  });

  it('parses boolean and number values', () => {
    const input = `---
name: test
description: Test
enabled: true
count: 42
---

Body`;

    const { data } = parseFrontmatter(input);
    expect(data.enabled).toBe(true);
    expect(data.count).toBe(42);
  });
});
