import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AgentConfig, TeamConfig, BearClawConfig } from '../config/schema.js';
import type { ToolRegistryImpl } from '../tools/registry.js';
import type { SkillDef } from '../skills/types.js';
import { BOOTSTRAP_FILE_MAX_CHARS, BOOTSTRAP_TOTAL_MAX_CHARS } from '../config/defaults.js';

export function buildSystemPrompt(
  agentConfig: AgentConfig,
  config: BearClawConfig,
  toolRegistry: ToolRegistryImpl,
  teamContext?: { team: TeamConfig; teammates: string[] },
  skills?: SkillDef[],
  agentDir?: string,
): string {
  const parts: string[] = [];

  // Base directory for resolving relative paths: agent dir if available, otherwise workspace
  const baseDir = agentDir ?? config.workspace.path;

  // 1. Load system prompt files (with headings and truncation)
  if (agentConfig.systemPromptFiles) {
    for (const file of agentConfig.systemPromptFiles) {
      const filePath = path.resolve(baseDir, file);
      try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const content = truncateFile(raw.trim(), BOOTSTRAP_FILE_MAX_CHARS);
        const basename = path.basename(file);
        parts.push(`## ${basename}\n${content}`);
      } catch {
        // Skip missing prompt files
      }
    }
  }

  // 2. Current date/time
  const now = new Date();
  const timestamp = now.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  parts.push(`## Current Date\n${timestamp}`);

  // 3. Tool descriptions summary
  const toolNames = toolRegistry.list();
  if (toolNames.length > 0) {
    const defs = toolRegistry.toProviderDefs();
    const toolSummary = defs.map(d => `- ${d.name}: ${d.description}`).join('\n');
    parts.push(`## Tools\nYou have access to the following tools. Use them to accomplish tasks — do not ask the user to run commands manually when you can use a tool directly.\n${toolSummary}`);
  }

  // 4. Memory files (with truncation)
  if (config.memory.enabled) {
    const memDir = path.resolve(baseDir, config.memory.dir);
    const memoryParts: string[] = [];
    memoryParts.push(`Memory directory: ${memDir}`);
    memoryParts.push('Use absolute paths when reading/writing memory files.');
    for (const file of config.memory.alwaysLoad) {
      const filePath = path.join(memDir, file);
      try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const content = truncateFile(raw.trim(), BOOTSTRAP_FILE_MAX_CHARS);
        memoryParts.push(`### ${file}\n${content}`);
      } catch {
        // Skip missing memory files
      }
    }
    parts.push(`## Memory\n${memoryParts.join('\n\n')}`);
  }

  // 5. Skills (exclude those with disableModelInvocation)
  if (skills && skills.length > 0) {
    const visibleSkills = skills.filter(s => !s.disableModelInvocation);
    if (visibleSkills.length > 0) {
      const skillLines = visibleSkills.map(s => `- ${s.name}: ${s.description}`);
      parts.push(
        `## Available Skills\n${skillLines.join('\n')}\n\n` +
        `To use a skill's detailed instructions, read its SKILL.md from the skills/ directory.`
      );
    }
  }

  // 6. Team context
  if (teamContext) {
    parts.push(
      `## Team: ${teamContext.team.name}\n` +
      `Teammates: ${teamContext.teammates.join(', ')}\n` +
      `To communicate with teammates, use mention syntax: [@agent_id: message]`
    );
  }

  // 7. Enforce total budget
  return truncateTotal(parts.join('\n\n'), BOOTSTRAP_TOTAL_MAX_CHARS);
}

/**
 * Truncate a single file's content: keep 70% from head + 20% from tail,
 * insert a [...truncated...] marker in between.
 */
export function truncateFile(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;

  const headSize = Math.floor(maxChars * 0.7);
  const tailSize = Math.floor(maxChars * 0.2);
  const marker = '\n\n[...truncated...]\n\n';

  return content.slice(0, headSize) + marker + content.slice(content.length - tailSize);
}

/**
 * Truncate the total assembled prompt to stay within budget.
 * Uses the same head/tail strategy.
 */
export function truncateTotal(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;

  const headSize = Math.floor(maxChars * 0.7);
  const tailSize = Math.floor(maxChars * 0.2);
  const marker = '\n\n[...system prompt truncated...]\n\n';

  return content.slice(0, headSize) + marker + content.slice(content.length - tailSize);
}
