# Skills

BearClaw supports a filesystem-based skill system that follows the [Agent Skills spec](https://agentskills.io/specification.md). A `SKILL.md` that works in Claude Code or any other spec-compliant tool works in BearClaw with no modifications.

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
        └── references/
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

Run tmux commands in the shell to control sessions, send keystrokes, and read output.

## Sending input safely

- Prefer literal sends: `tmux send-keys -t {target} -l -- "$cmd"`
- To send control keys: `tmux send-keys -t {target} C-c`, `C-d`, etc.

## Watching output

- Capture recent output: `tmux capture-pane -p -J -t {target} -S -200`
```

### Frontmatter Fields

Only standard fields from the [Agent Skills spec](https://agentskills.io/specification.md) are supported. No BearClaw-specific extensions.

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Skill identifier. Lowercase, hyphens, max 64 chars. Must match directory name. |
| `description` | string | yes | What the skill does and when to use it. Max 1024 chars. |
| `license` | string | no | License name or reference to bundled license file |
| `compatibility` | string | no | Environment requirements (intended product, system packages, etc.) |
| `metadata` | object | no | Arbitrary key-value mapping for additional metadata |
| `allowed-tools` | string | no | Space-delimited list of pre-approved tools (experimental) |

The rest of the file is markdown instructions that the agent reads when the skill is activated.

## Multi-Source Loading

Skills are loaded from multiple directories with precedence. Earlier directories take priority — if the same skill name appears in multiple locations, the first one wins.

### Default precedence (no `skillsDirs` configured)

1. **Workspace skills** (`{workspace}/skills/`) — highest precedence
2. **User-level skills** (`~/.bearclaw/skills/`) — lower precedence

### Agent directory mode

When using an agent directory (`bearclaw.jsonc`), the default search order is:

1. **Agent workspace** (`{workspace}/skills/`)
2. **Agent directory** (`{agentDir}/skills/`)
3. **Instance config** (`~/.bearclaw/skills/`)

### Custom skills directories

You can add extra directories via the `skillsDirs` field in `bearclaw.jsonc`. These are searched **before** the default locations, giving them highest precedence:

```jsonc
{
  "name": "my-agent",
  "provider": "openai",
  // ...
  "skillsDirs": [
    ".agents/skills",            // relative to agent dir
    "/home/user/shared-skills"   // absolute path
  ]
}
```

Each entry should point to a directory that directly contains skill subdirectories (each with a `SKILL.md`). Relative paths are resolved from the agent directory.

With `skillsDirs` configured, the full precedence becomes:

1. **`skillsDirs` entries** (in order) — highest precedence
2. **Agent workspace** (`{workspace}/skills/`)
3. **Agent directory** (`{agentDir}/skills/`)
4. **Instance config** (`~/.bearclaw/skills/`)

This lets you override shared skills with workspace-specific versions, or share a single skills directory across multiple agents.

## Slash Commands

All loaded skills are available as `/skill-name` slash commands in the CLI REPL:

```
> /help
Commands:
  /new     — Clear conversation and start fresh
  /exit    — Save session and exit
  /help    — Show this help

Skills:
  /tmux  — Remote control tmux sessions for interactive CLIs

> /tmux
Skill "tmux" activated.

> check the output of map:0
```

- **`/skill-name`** — Activates the skill: injects its instructions into the conversation context and confirms activation. The user's next message runs with the skill context.
- **`/skill-name some task`** — Activates the skill AND immediately runs the task.

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

When the LLM decides a skill is relevant, it reads the full `SKILL.md` via `read_file` to get detailed instructions. When activated via slash command, the full instructions are injected directly into the conversation.

## Loading Pipeline

1. **Discovery**: Scans `{workspace}/skills/*/SKILL.md` then `{configDir}/skills/*/SKILL.md`
2. **Deduplication**: First occurrence of each skill name wins (workspace takes precedence)
3. **Parsing**: Splits on `---` to extract YAML frontmatter, captures markdown body
4. **Validation**: Checks name and description are present
5. **Registration**: Skill metadata passed to `buildSystemPrompt()`

Invalid skills are logged as warnings and skipped — they don't prevent other skills from loading.

## MCP Servers

MCP servers are configured separately in `config.json`, not in skills. See [Configuration](configuration.md#mcp-servers) for details.
