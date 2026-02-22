import * as fs from 'node:fs';
import * as path from 'node:path';

const BEARCLAW_CONFIG = 'bearclaw.jsonc';

export function runInitCommand(targetDir?: string): void {
  const dir = path.resolve(targetDir ?? '.');
  const configPath = path.join(dir, BEARCLAW_CONFIG);

  if (fs.existsSync(configPath)) {
    console.error(`Error: ${BEARCLAW_CONFIG} already exists in ${dir}`);
    process.exit(1);
  }

  // Derive agent name from directory name
  const agentName = path.basename(dir);

  // Create directory if needed
  fs.mkdirSync(dir, { recursive: true });

  // Scaffold bearclaw.jsonc
  const config = `{
  // Agent configuration — see https://github.com/ferrants/bearclaw
  "name": "${agentName}",
  "provider": "anthropic",
  "workspace": "./workspace",
  "systemPromptFiles": ["prompts/system.md"],
  "maxIterations": 25,
  "memory": {
    "enabled": true,
    "dir": "memory",
    "alwaysLoad": ["active-tasks.md"]
  },
  "security": {
    "autonomy": "supervised",
    "workspaceOnly": true,
    "allowMemoryWrite": true
  }
}
`;
  fs.writeFileSync(configPath, config, 'utf8');

  // Create directories with .gitkeep
  const dirs = ['workspace', 'prompts', 'skills', 'memory'];
  for (const d of dirs) {
    const full = path.join(dir, d);
    fs.mkdirSync(full, { recursive: true });
    const gitkeep = path.join(full, '.gitkeep');
    if (!fs.existsSync(gitkeep)) {
      fs.writeFileSync(gitkeep, '', 'utf8');
    }
  }

  // Starter system prompt
  const systemPromptPath = path.join(dir, 'prompts', 'system.md');
  if (!fs.existsSync(systemPromptPath)) {
    fs.writeFileSync(systemPromptPath, `# ${agentName}\n\nYou are ${agentName}, a helpful AI agent.\n`, 'utf8');
  }

  // .gitignore for runtime state
  const gitignorePath = path.join(dir, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, '# BearClaw runtime state\n.bearclaw/\n', 'utf8');
  }

  console.log(`Initialized agent "${agentName}" in ${dir}`);
  console.log('');
  console.log('Created:');
  console.log(`  ${BEARCLAW_CONFIG}     — agent config`);
  console.log('  prompts/system.md  — system prompt');
  console.log('  workspace/         — agent workspace');
  console.log('  skills/            — agent-specific skills');
  console.log('  memory/            — agent memory files');
  console.log('  .gitignore         — excludes .bearclaw/ runtime state');
}
