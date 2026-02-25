import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  type PolicyConfig,
  type PolicyRule,
  type PolicyAction,
  type PolicyScope,
} from '../config/schema.js';
import { createLogger } from '../logging.js';

const log = createLogger('policy-engine');

export interface PolicyDecision {
  action: PolicyAction;
  ruleId?: string;
  reason?: string;
}

export interface PolicyEvaluator {
  evaluate(ctx: PolicyContext): PolicyDecision;
  suggestRule(ctx: PolicyContext, decision: PolicyAction): void;
}

export interface PolicyContext {
  toolName: string;
  scope: PolicyScope;
  command?: string;
  args?: string;
  pathPattern?: string;
  urlDomain?: string;
  channel?: string;
  agentId?: string;
}

export class PolicyEngine implements PolicyEvaluator {
  private suggestionsPath: string;
  private userRules: PolicyRule[] = [];

  constructor(
    private config: PolicyConfig,
    configDir: string,
  ) {
    this.suggestionsPath = path.join(configDir, 'policy-suggestions.json');
  }

  setUserRules(rules: PolicyRule[]): void {
    this.userRules = rules;
  }

  evaluate(ctx: PolicyContext): PolicyDecision {
    const allRules = [...this.userRules, ...this.config.rules];
    const matching = allRules.filter(rule => this.ruleMatches(rule, ctx));

    // Deny precedence: if any deny rule matches, deny
    if (this.config.denyPrecedence) {
      const denyRule = matching.find(r => r.action === 'deny');
      if (denyRule) {
        log.info('Policy deny', { tool: ctx.toolName, ruleId: denyRule.id });
        return { action: 'deny', ruleId: denyRule.id, reason: `Denied by rule ${denyRule.id}` };
      }
    }

    // First matching rule decides
    if (matching.length > 0) {
      const rule = matching[0];
      log.debug('Policy match', { tool: ctx.toolName, ruleId: rule.id, action: rule.action });
      return { action: rule.action, ruleId: rule.id };
    }

    // No rule matches → default action
    log.debug('Policy default', { tool: ctx.toolName, action: this.config.defaultAction });
    return { action: this.config.defaultAction };
  }

  private ruleMatches(rule: PolicyRule, ctx: PolicyContext): boolean {
    if (rule.scope !== ctx.scope) return false;

    const m = rule.match;

    if (m.toolName && m.toolName !== ctx.toolName) return false;
    if (m.command && m.command !== ctx.command) return false;
    if (m.commandRegex && ctx.command && !new RegExp(m.commandRegex).test(ctx.command)) return false;
    if (m.argsRegex && ctx.args && !new RegExp(m.argsRegex).test(ctx.args)) return false;
    if (m.pathPattern && ctx.pathPattern && !this.matchGlob(m.pathPattern, ctx.pathPattern)) return false;
    if (m.urlDomain && ctx.urlDomain && !ctx.urlDomain.endsWith(m.urlDomain)) return false;
    if (m.channel && m.channel !== ctx.channel) return false;
    if (m.agentId && m.agentId !== ctx.agentId) return false;

    return true;
  }

  private matchGlob(pattern: string, value: string): boolean {
    const regex = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '.');
    return new RegExp(`^${regex}$`).test(value);
  }

  suggestRule(ctx: PolicyContext, decision: PolicyAction): void {
    if (this.config.learningMode !== 'suggest_rules') return;

    const suggestion = {
      timestamp: new Date().toISOString(),
      context: ctx,
      approvedAs: decision,
    };

    try {
      let suggestions: unknown[] = [];
      try {
        const raw = fs.readFileSync(this.suggestionsPath, 'utf8');
        suggestions = JSON.parse(raw);
      } catch {
        // file doesn't exist yet
      }
      suggestions.push(suggestion);
      fs.writeFileSync(this.suggestionsPath, JSON.stringify(suggestions, null, 2));
    } catch (err) {
      log.error('Failed to save policy suggestion', { error: String(err) });
    }
  }
}
