# Skills

BearClaw supports a filesystem-based skill system — compatible with Claude Code's Agent Skills format — that lets users add capabilities without modifying source code. Drop a `SKILL.md` into your workspace and BearClaw picks it up automatically.

Skills are purely instruction-based: they provide context and guidance that gets loaded into the agent's system prompt. The agent uses its existing tools (like `exec`) to act on the instructions.

## Directory Structure

Skills live in `{workspace}/skills/{skill-name}/SKILL.md`:

```
workspace/
└── skills/
    ├── tmux/
    │   └── SKILL.md
    └── code-review/
        ├── SKILL.md
        └── checklist.md
```

Each skill is a directory containing a `SKILL.md` file with YAML frontmatter and markdown instructions.

## SKILL.md Format

```yaml
---
name: tmux
description: "Remote control tmux sessions for interactive CLIs (python, gdb, etc.)"
---

# tmux Skill

Use tmux as a programmable terminal multiplexer for interactive work.

## Sending input safely

- Prefer literal sends: `tmux send-keys -t {target} -l -- "$cmd"`
- To send control keys: `tmux send-keys -t {target} C-c`, `C-d`, etc.

## Watching output

- Capture recent output: `tmux capture-pane -p -J -t {target} -S -200`
```

### Frontmatter Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Skill identifier, kebab-case |
| `description` | string | yes | When to use this skill, shown to LLM |

The rest of the file is markdown instructions that the agent reads when the skill is relevant.

## Compatibility

BearClaw skills use the same format as Claude Code Agent Skills. A `SKILL.md` that works in Claude Code works in BearClaw with no modifications — just copy the skill directory into `{workspace}/skills/`.

## Context Integration

Skills are integrated into the agent's system prompt at two levels:

### Level 1: Metadata (automatic)

Skill names and descriptions are injected into every system prompt:

```
## Available Skills
- tmux: Remote control tmux sessions for interactive CLIs
- code-review: Review code for best practices

To use a skill's detailed instructions, read its SKILL.md from the skills/ directory.
```

This costs ~100 tokens per skill and helps the LLM know what's available.

### Level 2: Full Instructions (on demand)

When the LLM decides a skill is relevant, it reads the full `SKILL.md` via `read_file` to get detailed instructions from the markdown body.

## Loading Pipeline

1. **Discovery**: Scans `{workspace}/skills/*/SKILL.md` using `fs.readdirSync`
2. **Parsing**: Splits on `---` to extract YAML frontmatter, captures markdown body
3. **Validation**: Checks name and description are present
4. **Registration**: Skill metadata passed to `buildSystemPrompt()`

Invalid skills are logged as warnings and skipped — they don't prevent other skills from loading.

## MCP Servers

MCP servers are configured separately in `config.json`, not in skills. See [Configuration](configuration.md#mcp-servers) for details.
