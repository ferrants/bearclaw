import type { AgentConfig, TeamConfig } from '../config/schema.js';
import type { SkillDef } from '../skills/types.js';
import type { ToolRegistry } from '../tools/types.js';
import type { Mentionable } from '@bearclaw/shared/ws-protocol';

export class MentionablesProvider {
  constructor(
    private agents: Record<string, AgentConfig>,
    private teams: Record<string, TeamConfig>,
    private skills: SkillDef[],
    private toolRegistry: ToolRegistry,
  ) {}

  query(filter?: string): Mentionable[] {
    const items: Mentionable[] = [];

    for (const agent of Object.values(this.agents)) {
      items.push({
        type: 'agent',
        name: agent.name,
        trigger: `@${agent.name}`,
      });
    }

    for (const team of Object.values(this.teams)) {
      items.push({
        type: 'team',
        name: team.name,
        trigger: `@${team.name}`,
      });
    }

    for (const skill of this.skills) {
      items.push({
        type: 'skill',
        name: skill.name,
        description: skill.description,
        trigger: `/${skill.name}`,
      });
    }

    for (const toolName of this.toolRegistry.list()) {
      const tool = this.toolRegistry.get(toolName);
      items.push({
        type: 'tool',
        name: toolName,
        description: tool?.description,
      });
    }

    if (!filter) return items;

    const lower = filter.toLowerCase();
    return items.filter(
      item => item.name.toLowerCase().includes(lower) ||
              item.description?.toLowerCase().includes(lower),
    );
  }
}
