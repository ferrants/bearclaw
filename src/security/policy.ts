import * as path from 'node:path';
import * as os from 'node:os';
import { AutonomyLevel } from '../config/schema.js';
import { type ScopedRateLimiter } from './rate-limiter.js';

export class SecurityPolicy {
  public readonly baseDir: string;

  constructor(
    public readonly autonomy: AutonomyLevel,
    public readonly workspaceDir: string,
    public readonly workspaceOnly: boolean,
    public readonly allowedCommands: string[],
    public readonly restrictedCommands: Record<string, string[]>,
    public readonly forbiddenPaths: string[],
    public readonly allowedPaths: string[],
    private readonly rateLimiter: ScopedRateLimiter,
    public readonly allowSubshells: boolean = false,
    agentDir?: string,
  ) {
    // Resolve relative paths against the agent directory (parent of workspace)
    // so that sibling dirs like memory/ are reachable with relative paths.
    this.baseDir = agentDir ?? workspaceDir;
  }

  /** Expand leading ~ to home directory. */
  expandPath(rawPath: string): string {
    if (rawPath === '~') return os.homedir();
    if (rawPath.startsWith('~/')) return path.join(os.homedir(), rawPath.slice(2));
    return rawPath;
  }

  isPathAllowed(rawPath: string): boolean {
    if (rawPath.includes('\0')) return false;

    const expanded = this.expandPath(rawPath);
    const normalized = path.normalize(expanded);
    if (normalized.startsWith('..')) return false;

    if (this.workspaceOnly && path.isAbsolute(expanded)) {
      const underAllowed = this.allowedPaths.some(
        ap => normalized === ap || normalized.startsWith(ap + path.sep)
      );
      if (!underAllowed) return false;
    }

    const resolved = path.resolve(this.baseDir, expanded);
    const expandedForbidden = this.forbiddenPaths.map(p =>
      p.startsWith('~') ? p.replace('~', os.homedir()) : p
    );
    for (const forbidden of expandedForbidden) {
      if (resolved === forbidden || resolved.startsWith(forbidden + path.sep)) return false;
    }

    return true;
  }

  async isResolvedPathAllowed(resolvedPath: string): Promise<boolean> {
    try {
      const fsPromises = await import('node:fs/promises');

      // If file doesn't exist yet (new file), resolve the parent directory instead
      let realPath: string;
      try {
        realPath = await fsPromises.realpath(resolvedPath);
      } catch {
        const parentDir = path.dirname(resolvedPath);
        try {
          const realParent = await fsPromises.realpath(parentDir);
          realPath = path.join(realParent, path.basename(resolvedPath));
        } catch {
          return false;
        }
      }

      const realWorkspace = await fsPromises.realpath(this.workspaceDir);
      if (realPath === realWorkspace || realPath.startsWith(realWorkspace + path.sep)) {
        return true;
      }

      for (const allowed of this.allowedPaths) {
        try {
          const realAllowed = await fsPromises.realpath(allowed);
          if (realPath === realAllowed || realPath.startsWith(realAllowed + path.sep)) {
            return true;
          }
        } catch {
          // allowed path doesn't exist on disk, skip
        }
      }

      return false;
    } catch {
      return false;
    }
  }

  isCommandAllowed(command: string): boolean {
    if (this.autonomy === AutonomyLevel.ReadOnly) return false;
    if (this.autonomy === AutonomyLevel.Full) return true;

    if (!this.allowSubshells) {
      // Block subshell operators
      if (command.includes('`')) return false;
      if (command.includes('$(')) return false;
      if (command.includes('${')) return false;

      // Block process substitution
      if (command.includes('<(')) return false;
      if (command.includes('>(')) return false;

      // Block here-strings and here-docs
      if (command.includes('<<<')) return false;
      if (command.includes('<<')) return false;
    }

    // Block output redirection
    if (command.includes('>') && !this.allowSubshells) return false;

    // Split on command separators
    let normalized = command;
    for (const sep of ['&&', '||']) {
      normalized = normalized.replaceAll(sep, '\x00');
    }
    for (const sep of ['\n', ';', '|']) {
      normalized = normalized.replaceAll(sep, '\x00');
    }

    let hasCommand = false;
    for (const segment of normalized.split('\x00')) {
      const trimmed = segment.trim();
      if (!trimmed) continue;

      const cmdPart = this.skipEnvAssignments(trimmed);
      if (!cmdPart) continue;

      const parts = cmdPart.split(/\s+/);
      const baseCmd = parts[0]?.split('/').pop() || '';
      if (!baseCmd) continue;

      hasCommand = true;

      // Check restricted commands first (allowed but with arg restrictions)
      const blockedArgs = this.restrictedCommands[baseCmd];
      if (blockedArgs) {
        if (blockedArgs[0] === '*') return false;
        for (const arg of parts.slice(1)) {
          if (blockedArgs.some(blocked => arg.startsWith(blocked))) return false;
        }
        continue;
      }

      // Check standard allowlist
      if (!this.allowedCommands.includes(baseCmd)) return false;
    }

    return hasCommand;
  }

  private skipEnvAssignments(s: string): string {
    let rest = s;
    while (true) {
      const word = rest.split(/\s+/)[0];
      if (!word) return rest;
      if (word.includes('=') && /^[a-zA-Z_]/.test(word)) {
        rest = rest.slice(word.length).trimStart();
      } else {
        return rest;
      }
    }
  }

  canAct(): boolean {
    return this.autonomy !== AutonomyLevel.ReadOnly;
  }

  recordAction(scope?: string, agentId?: string): boolean {
    return this.rateLimiter.record(scope, agentId);
  }

  isRateLimited(scope?: string, agentId?: string): boolean {
    return this.rateLimiter.isLimited(scope, agentId);
  }
}
