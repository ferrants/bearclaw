import type { Message } from '../providers/types.js';
import type { SkillDef } from '../skills/types.js';

export type SlashCommandResult =
  | { action: 'inject'; messages: Message[]; agentMessage?: string }
  | { action: 'immediate'; response: string };

/**
 * Handle /config command — unhide config tools and inject activation messages.
 * Caller is responsible for actually calling toolRegistry.setHidden().
 */
export function handleConfig(args: string): SlashCommandResult {
  const messages: Message[] = [
    {
      role: 'user',
      content: '[Configuration Mode Activated]\n\nYou now have access to config_explain, config_get, and config_set tools. Use them to help the user understand and modify BearClaw configuration. Security-sensitive fields will require explicit user approval before changes are applied.',
    },
    {
      role: 'assistant',
      content: 'Configuration mode activated. I can now explain config options, read current settings, and update configuration. How can I help?',
    },
  ];

  if (args) {
    messages.push({ role: 'user', content: args });
  }

  return {
    action: 'inject',
    messages,
    agentMessage: args ? undefined : 'Configuration mode activated.',
  };
}

/**
 * Handle /new command — clear session.
 * Caller is responsible for actually clearing session state.
 */
export function handleNew(): SlashCommandResult {
  return { action: 'immediate', response: 'Session cleared.' };
}

/**
 * Handle a skill slash command — inject skill instructions.
 */
export function handleSkill(skill: SkillDef, args: string): SlashCommandResult {
  const messages: Message[] = [
    {
      role: 'user',
      content: `[Skill: ${skill.name}]\n\n${skill.instructions}`,
    },
    {
      role: 'assistant',
      content: `Skill "${skill.name}" activated. I'll follow these instructions for the rest of this conversation.`,
    },
  ];

  if (args) {
    messages.push({ role: 'user', content: args });
  }

  return {
    action: 'inject',
    messages,
    agentMessage: args ? undefined : `Skill "${skill.name}" activated.`,
  };
}
