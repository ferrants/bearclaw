import type { SkillDef } from '../skills/types.js';

export type SlashCommand =
  | { type: 'config'; args: string }
  | { type: 'new' }
  | { type: 'skill'; name: string; args: string; skill: SkillDef }
  | null;

/**
 * Parse a user message into a structured slash command, or return null
 * if it's not a recognized slash command (pass through to agent as-is).
 */
export function parseSlashCommand(message: string, skills: SkillDef[]): SlashCommand {
  const trimmed = message.trim();
  if (!trimmed || !trimmed.startsWith('/')) return null;

  // /new
  if (trimmed === '/new') {
    return { type: 'new' };
  }

  // /config or /config <args>
  if (trimmed === '/config' || trimmed.startsWith('/config ')) {
    const args = trimmed.slice('/config'.length).trim();
    return { type: 'config', args };
  }

  // Skill slash commands (e.g. /tmux or /tmux list sessions)
  const spaceIdx = trimmed.indexOf(' ');
  const cmdName = spaceIdx === -1 ? trimmed.slice(1) : trimmed.slice(1, spaceIdx);
  const cmdArgs = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1).trim();
  const skill = skills.find(s => s.name === cmdName);

  if (skill) {
    return { type: 'skill', name: skill.name, args: cmdArgs, skill };
  }

  // Unknown slash command — pass through
  return null;
}
