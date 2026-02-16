export interface MentionTag {
  agents: string[];
  message: string;
}

const MENTION_REGEX = /\[@([\w,]+):\s*(.*?)\]/g;

export function parseMentions(text: string): {
  mentions: MentionTag[];
  sharedContext: string;
} {
  const mentions: MentionTag[] = [];
  let sharedContext = text;

  let match: RegExpExecArray | null;
  MENTION_REGEX.lastIndex = 0;

  while ((match = MENTION_REGEX.exec(text)) !== null) {
    const agentStr = match[1];
    const message = match[2].trim();
    const agents = agentStr.split(',').map(a => a.trim()).filter(Boolean);

    mentions.push({ agents, message });
    sharedContext = sharedContext.replace(match[0], '');
  }

  sharedContext = sharedContext.trim();

  // Prepend shared context to each mention's message
  if (sharedContext && mentions.length > 0) {
    for (const m of mentions) {
      m.message = `${sharedContext}\n\n${m.message}`;
    }
  }

  return { mentions, sharedContext };
}

export function validateMentions(
  mentions: MentionTag[],
  validAgents: string[],
  teamAgents?: string[],
): { valid: MentionTag[]; invalid: string[] } {
  const valid: MentionTag[] = [];
  const invalid: string[] = [];

  for (const m of mentions) {
    const invalidAgents = m.agents.filter(a => {
      if (!validAgents.includes(a)) return true;
      if (teamAgents && !teamAgents.includes(a)) return true;
      return false;
    });

    if (invalidAgents.length > 0) {
      invalid.push(...invalidAgents);
    } else {
      valid.push(m);
    }
  }

  return { valid, invalid };
}
