import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { loadSkills } from '../../src/skills/loader.js';

describe('loadSkills', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bearclaw-skills-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty array when no skills directory', () => {
    const skills = loadSkills(tmpDir);
    expect(skills).toEqual([]);
  });

  it('returns empty array when skills directory is empty', () => {
    fs.mkdirSync(path.join(tmpDir, 'skills'));
    const skills = loadSkills(tmpDir);
    expect(skills).toEqual([]);
  });

  it('loads a simple skill', () => {
    const skillDir = path.join(tmpDir, 'skills', 'deploy');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---
name: deploy
description: Deploy the application
---

# Deploy

Steps to deploy...
`);

    const skills = loadSkills(tmpDir);
    expect(skills.length).toBe(1);
    expect(skills[0].name).toBe('deploy');
    expect(skills[0].description).toBe('Deploy the application');
    expect(skills[0].instructions).toContain('Steps to deploy');
  });

  it('skips skills missing name or description', () => {
    const skillDir = path.join(tmpDir, 'skills', 'bad');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---
name: bad
---

No description
`);

    const skills = loadSkills(tmpDir);
    expect(skills).toEqual([]);
  });

  it('ignores unknown frontmatter fields gracefully', () => {
    const skillDir = path.join(tmpDir, 'skills', 'extra');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---
name: extra
description: Has extra fields
tools:
  - name: something
    script: something.sh
custom_field: hello
---

Instructions
`);

    const skills = loadSkills(tmpDir);
    expect(skills.length).toBe(1);
    expect(skills[0].name).toBe('extra');
    expect(skills[0].description).toBe('Has extra fields');
  });

  it('loads multiple skills', () => {
    for (const name of ['alpha', 'beta']) {
      const skillDir = path.join(tmpDir, 'skills', name);
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---
name: ${name}
description: Skill ${name}
---

Instructions for ${name}
`);
    }

    const skills = loadSkills(tmpDir);
    expect(skills.length).toBe(2);
    const names = skills.map(s => s.name);
    expect(names).toContain('alpha');
    expect(names).toContain('beta');
  });

  it('skips non-directory entries in skills/', () => {
    const skillsDir = path.join(tmpDir, 'skills');
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.writeFileSync(path.join(skillsDir, 'README.md'), 'not a skill');

    const skills = loadSkills(tmpDir);
    expect(skills).toEqual([]);
  });

  it('captures the skill directory path', () => {
    const skillDir = path.join(tmpDir, 'skills', 'tmux');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---
name: tmux
description: Tmux control
---

Use tmux
`);

    const skills = loadSkills(tmpDir);
    expect(skills[0].dir).toBe(skillDir);
  });

  // --- Multi-source loading ---

  it('loads skills from multiple source directories', () => {
    const dir1 = fs.mkdtempSync(path.join(os.tmpdir(), 'bearclaw-src1-'));
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'bearclaw-src2-'));

    try {
      // Skill in dir1
      const s1 = path.join(dir1, 'skills', 'alpha');
      fs.mkdirSync(s1, { recursive: true });
      fs.writeFileSync(path.join(s1, 'SKILL.md'), `---
name: alpha
description: Alpha skill
---
Alpha instructions
`);

      // Skill in dir2
      const s2 = path.join(dir2, 'skills', 'beta');
      fs.mkdirSync(s2, { recursive: true });
      fs.writeFileSync(path.join(s2, 'SKILL.md'), `---
name: beta
description: Beta skill
---
Beta instructions
`);

      const skills = loadSkills(dir1, dir2);
      expect(skills.length).toBe(2);
      expect(skills.map(s => s.name)).toContain('alpha');
      expect(skills.map(s => s.name)).toContain('beta');
    } finally {
      fs.rmSync(dir1, { recursive: true, force: true });
      fs.rmSync(dir2, { recursive: true, force: true });
    }
  });

  it('first source directory takes precedence on name conflict', () => {
    const dir1 = fs.mkdtempSync(path.join(os.tmpdir(), 'bearclaw-hi-'));
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'bearclaw-lo-'));

    try {
      // Same skill name in both
      for (const [dir, desc] of [[dir1, 'Workspace version'], [dir2, 'User version']] as const) {
        const sd = path.join(dir, 'skills', 'deploy');
        fs.mkdirSync(sd, { recursive: true });
        fs.writeFileSync(path.join(sd, 'SKILL.md'), `---
name: deploy
description: ${desc}
---
Instructions
`);
      }

      const skills = loadSkills(dir1, dir2);
      expect(skills.length).toBe(1);
      expect(skills[0].description).toBe('Workspace version');
    } finally {
      fs.rmSync(dir1, { recursive: true, force: true });
      fs.rmSync(dir2, { recursive: true, force: true });
    }
  });

  // --- Frontmatter flags ---

  it('parses disable-model-invocation flag', () => {
    const skillDir = path.join(tmpDir, 'skills', 'secret');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---
name: secret
description: Secret skill
disable-model-invocation: true
---

Secret instructions
`);

    const skills = loadSkills(tmpDir);
    expect(skills.length).toBe(1);
    expect(skills[0].disableModelInvocation).toBe(true);
  });

  it('defaults disableModelInvocation to undefined when not specified', () => {
    const skillDir = path.join(tmpDir, 'skills', 'plain');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---
name: plain
description: Plain skill
---

Plain instructions
`);

    const skills = loadSkills(tmpDir);
    expect(skills[0].disableModelInvocation).toBeUndefined();
  });

  it('records source directory', () => {
    const skillDir = path.join(tmpDir, 'skills', 'tracked');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---
name: tracked
description: Tracked skill
---

Tracked
`);

    const skills = loadSkills(tmpDir);
    expect(skills[0].source).toBe(path.join(tmpDir, 'skills'));
  });
});
