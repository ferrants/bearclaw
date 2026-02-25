import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { PolicyRule, PolicyScope } from '../config/schema.js';
import { createLogger } from '../logging.js';

const log = createLogger('user-rules');

export interface UserRule {
  id: string;
  action: 'allow' | 'deny';
  toolName: string;
  agentId?: string;
  createdAt: string;
  createdBy: 'ws-approval' | 'cli';
}

export class UserRuleStore {
  private rules: UserRule[] = [];
  private filePath: string;

  constructor(configDir: string) {
    this.filePath = path.join(configDir, 'user-rules.json');
    this.load();
  }

  addRule(rule: Omit<UserRule, 'id' | 'createdAt'>): string {
    const id = `ur_${crypto.randomUUID().slice(0, 8)}`;
    const entry: UserRule = {
      ...rule,
      id,
      createdAt: new Date().toISOString(),
    };
    this.rules.push(entry);
    this.save();
    log.info('User rule added', { id, action: rule.action, toolName: rule.toolName, agentId: rule.agentId });
    return id;
  }

  removeRule(id: string): boolean {
    const idx = this.rules.findIndex(r => r.id === id);
    if (idx === -1) return false;
    this.rules.splice(idx, 1);
    this.save();
    log.info('User rule removed', { id });
    return true;
  }

  listRules(): UserRule[] {
    return [...this.rules];
  }

  toPolicyRules(): PolicyRule[] {
    return this.rules.map(r => {
      const scope: PolicyScope = toolToScope(r.toolName);
      return {
        id: r.id,
        action: r.action,
        scope,
        match: {
          toolName: r.toolName,
          ...(r.agentId ? { agentId: r.agentId } : {}),
        },
      };
    });
  }

  private load(): void {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      this.rules = JSON.parse(raw);
      log.info('User rules loaded', { count: this.rules.length });
    } catch {
      this.rules = [];
    }
  }

  private save(): void {
    try {
      const tmpPath = this.filePath + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify(this.rules, null, 2));
      fs.renameSync(tmpPath, this.filePath);
    } catch (err) {
      log.error('Failed to save user rules', { error: String(err) });
    }
  }
}

function toolToScope(toolName: string): PolicyScope {
  if (toolName === 'exec') return 'exec';
  if (toolName === 'web_fetch') return 'web';
  if (toolName === 'message') return 'message';
  return 'tool';
}
