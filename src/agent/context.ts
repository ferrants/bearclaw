import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AgentConfig, TeamConfig, BearClawConfig } from '../config/schema.js';
import type { ToolRegistryImpl } from '../tools/registry.js';

export function buildSystemPrompt(
  agentConfig: AgentConfig,
  config: BearClawConfig,
  toolRegistry: ToolRegistryImpl,
  teamContext?: { team: TeamConfig; teammates: string[] },
): string {
  const parts: string[] = [];

  // 1. Load system prompt files
  if (agentConfig.systemPromptFiles) {
    for (const file of agentConfig.systemPromptFiles) {
      const filePath = path.resolve(config.workspace.path, file);
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        parts.push(content.trim());
      } catch {
        // Skip missing prompt files
      }
    }
  }

  // 2. Tool descriptions summary
  const toolNames = toolRegistry.list();
  if (toolNames.length > 0) {
    const defs = toolRegistry.toProviderDefs();
    const toolSummary = defs.map(d => `- ${d.name}: ${d.description}`).join('\n');
    parts.push(`Available tools:\n${toolSummary}`);
  }

  // 3. Memory files
  if (config.memory.enabled) {
    const memDir = path.resolve(config.workspace.path, config.memory.dir);
    for (const file of config.memory.alwaysLoad) {
      const filePath = path.join(memDir, file);
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        parts.push(`## Memory: ${file}\n${content.trim()}`);
      } catch {
        // Skip missing memory files
      }
    }
  }

  // 4. Team context
  if (teamContext) {
    parts.push(
      `## Team: ${teamContext.team.name}\n` +
      `Teammates: ${teamContext.teammates.join(', ')}\n` +
      `To communicate with teammates, use mention syntax: [@agent_id: message]`
    );
  }

  return parts.join('\n\n');
}
