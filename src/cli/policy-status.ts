import { type PolicyConfig } from '../config/schema.js';
import { type InlineAllowStore } from '../security/inline-allow.js';

export function formatPolicyStatus(
  config: PolicyConfig,
  inlineAllowStore?: InlineAllowStore,
): string {
  const lines: string[] = [];

  lines.push('=== BearClaw Policy Status ===');
  lines.push('');
  lines.push(`Default action: ${config.defaultAction}`);
  lines.push(`Deny precedence: ${config.denyPrecedence}`);
  lines.push(`Approval scope: ${config.approvalScope}`);
  lines.push(`Learning mode: ${config.learningMode}`);
  lines.push('');

  lines.push(`Rules: ${config.rules.length}`);
  for (const rule of config.rules) {
    const matchParts: string[] = [];
    if (rule.match.toolName) matchParts.push(`tool=${rule.match.toolName}`);
    if (rule.match.command) matchParts.push(`cmd=${rule.match.command}`);
    if (rule.match.urlDomain) matchParts.push(`domain=${rule.match.urlDomain}`);
    if (rule.match.channel) matchParts.push(`channel=${rule.match.channel}`);
    if (rule.match.agentId) matchParts.push(`agent=${rule.match.agentId}`);
    lines.push(`  [${rule.id}] ${rule.action} ${rule.scope} ${matchParts.join(', ')}`);
  }
  lines.push('');

  lines.push(`Web mode: ${config.web.mode}`);
  if (config.web.blockedDomains.length > 0) {
    lines.push(`  Blocked domains: ${config.web.blockedDomains.join(', ')}`);
  }
  if (config.web.blockedCidrs.length > 0) {
    lines.push(`  Blocked CIDRs: ${config.web.blockedCidrs.join(', ')}`);
  }
  lines.push('');

  if (inlineAllowStore) {
    const active = inlineAllowStore.getActive();
    lines.push(`Inline allows: ${active.length}`);
    for (const allow of active) {
      const pattern = allow.pattern ? ` ${allow.pattern}` : '';
      const expires = allow.expiresAt === Infinity ? 'once' : new Date(allow.expiresAt).toISOString();
      lines.push(`  ${allow.toolName}${pattern} (${allow.scope}, expires: ${expires})`);
    }
  }

  return lines.join('\n');
}
