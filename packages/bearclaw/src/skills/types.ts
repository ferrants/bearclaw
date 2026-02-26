export interface SkillDef {
  name: string;
  description: string;
  dir: string;              // absolute path to skill directory
  instructions: string;     // markdown body of SKILL.md
  allowedTools?: string[];  // pre-approved tools (from allowed-tools frontmatter)
  disableModelInvocation?: boolean;  // exclude from system prompt (model can't see it)
  source?: string;                   // which directory this skill was loaded from
}
