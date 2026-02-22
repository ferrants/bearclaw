import { type InlineAllowScope } from '../config/schema.js';

interface InlineAllow {
  toolName: string;
  pattern?: string;
  scope: InlineAllowScope;
  expiresAt: number;
}

const ALLOW_REGEX = /\[allow:\s*(once|day|session)\s+(\S+)(?:\s+(.*?))?\]/g;

export class InlineAllowStore {
  private allows: InlineAllow[] = [];

  constructor(
    private enabled: boolean,
    private dayScopeHours: number,
  ) {}

  parseAndStore(message: string): string {
    if (!this.enabled) return message;

    let cleaned = message;
    let match: RegExpExecArray | null;

    // Reset regex state
    ALLOW_REGEX.lastIndex = 0;

    while ((match = ALLOW_REGEX.exec(message)) !== null) {
      const scope = match[1] as InlineAllowScope;
      const toolName = match[2];
      const pattern = match[3] || undefined;

      const expiresAt = scope === 'day'
        ? Date.now() + this.dayScopeHours * 60 * 60 * 1000
        : Infinity; // once + session = never auto-expires (once consumed on use, session lives forever)

      this.allows.push({
        toolName,
        pattern,
        scope,
        expiresAt,
      });

      cleaned = cleaned.replace(match[0], '');
    }

    return cleaned.trim();
  }

  addAllow(toolName: string, scope: InlineAllowScope, pattern?: string): void {
    const expiresAt = scope === 'day'
      ? Date.now() + this.dayScopeHours * 60 * 60 * 1000
      : Infinity; // once consumed on use, session lives for process lifetime

    this.allows.push({ toolName, pattern, scope, expiresAt });
  }

  isAllowed(toolName: string, arg?: string): boolean {
    if (!this.enabled) return false;

    this.prune();

    const idx = this.allows.findIndex(a => {
      if (a.toolName !== toolName) return false;
      if (a.pattern && arg && !this.matchWildcard(a.pattern, arg)) return false;
      return true;
    });

    if (idx === -1) return false;

    // Consume "once" allows
    if (this.allows[idx].scope === 'once') {
      this.allows.splice(idx, 1);
    }

    return true;
  }

  getActive(): InlineAllow[] {
    this.prune();
    return [...this.allows];
  }

  private prune(): void {
    const now = Date.now();
    this.allows = this.allows.filter(a => a.expiresAt > now);
  }

  private matchWildcard(pattern: string, value: string): boolean {
    const regex = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '.');
    return new RegExp(`^${regex}$`).test(value);
  }
}
