import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseFrontmatter } from './frontmatter.js';
import { createLogger } from '../logging.js';
import type { SkillDef } from './types.js';

const log = createLogger('skills');

/**
 * Load skills from multiple source directories with precedence.
 * Earlier directories take precedence — if the same skill name appears in
 * multiple directories, only the first occurrence is kept.
 *
 * Typical usage:
 *   loadSkills(workspacePath, configDir)
 * loads from {workspace}/skills/ first, then {configDir}/skills/.
 */
export function loadSkills(...sourceDirs: string[]): SkillDef[] {
  const seen = new Set<string>();
  const skills: SkillDef[] = [];

  for (const baseDir of sourceDirs) {
    const skillsDir = path.join(baseDir, 'skills');
    const loaded = loadSkillsFromDir(skillsDir);

    for (const skill of loaded) {
      if (seen.has(skill.name)) {
        log.info('Skill shadowed by higher-precedence source', {
          name: skill.name,
          skippedFrom: skillsDir,
        });
        continue;
      }
      seen.add(skill.name);
      skills.push(skill);
    }
  }

  return skills;
}

function loadSkillsFromDir(skillsDir: string): SkillDef[] {
  if (!fs.existsSync(skillsDir)) {
    return [];
  }

  let entries: string[];
  try {
    entries = fs.readdirSync(skillsDir);
  } catch {
    log.warn('Could not read skills directory', { path: skillsDir });
    return [];
  }

  const skills: SkillDef[] = [];

  for (const entry of entries) {
    const skillDir = path.join(skillsDir, entry);
    const skillFile = path.join(skillDir, 'SKILL.md');

    // Must be a directory with SKILL.md
    try {
      if (!fs.statSync(skillDir).isDirectory()) continue;
    } catch {
      continue;
    }

    if (!fs.existsSync(skillFile)) continue;

    try {
      const skill = parseSkillFile(skillFile, skillDir);
      if (skill) {
        skills.push(skill);
        log.info('Loaded skill', { name: skill.name, from: skillsDir });
      }
    } catch (err) {
      log.warn('Failed to load skill', { dir: entry, error: String(err) });
    }
  }

  return skills;
}

function parseSkillFile(filePath: string, skillDir: string): SkillDef | null {
  const content = fs.readFileSync(filePath, 'utf8');
  const { data, body } = parseFrontmatter(content);

  const name = data.name as string | undefined;
  const description = data.description as string | undefined;

  if (!name || !description) {
    log.warn('Skill missing name or description', { path: filePath });
    return null;
  }

  const rawAllowed = data['allowed-tools'] as string | undefined;
  const allowedTools = rawAllowed
    ? rawAllowed.split(/\s+/).filter(Boolean)
    : undefined;

  return {
    name,
    description,
    dir: skillDir,
    instructions: body.trim(),
    allowedTools,
    disableModelInvocation: data['disable-model-invocation'] === true ? true : undefined,
    source: path.dirname(skillDir),
  };
}
