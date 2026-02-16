import { describe, it, expect } from 'vitest';
import { SecurityPolicy } from '../../src/security/policy.js';
import { AutonomyLevel } from '../../src/config/schema.js';
import { ScopedRateLimiter } from '../../src/security/rate-limiter.js';
import { ALLOWED_COMMANDS, RESTRICTED_COMMANDS, FORBIDDEN_PATHS } from '../../src/config/defaults.js';

function makePolicy(overrides?: {
  autonomy?: AutonomyLevel;
  workspaceDir?: string;
  workspaceOnly?: boolean;
  allowedCommands?: string[];
  restrictedCommands?: Record<string, string[]>;
  forbiddenPaths?: string[];
}): SecurityPolicy {
  return new SecurityPolicy(
    overrides?.autonomy ?? AutonomyLevel.Supervised,
    overrides?.workspaceDir ?? '/workspace',
    overrides?.workspaceOnly ?? true,
    overrides?.allowedCommands ?? ALLOWED_COMMANDS,
    overrides?.restrictedCommands ?? RESTRICTED_COMMANDS,
    overrides?.forbiddenPaths ?? FORBIDDEN_PATHS,
    new ScopedRateLimiter({ global: 100 }),
  );
}

describe('SecurityPolicy', () => {
  describe('isPathAllowed', () => {
    it('blocks null bytes', () => {
      const policy = makePolicy();
      expect(policy.isPathAllowed('file\0.txt')).toBe(false);
    });

    it('blocks paths that escape upward', () => {
      const policy = makePolicy();
      expect(policy.isPathAllowed('../etc/passwd')).toBe(false);
      expect(policy.isPathAllowed('../../root')).toBe(false);
    });

    it('blocks absolute paths in workspaceOnly mode', () => {
      const policy = makePolicy();
      expect(policy.isPathAllowed('/etc/passwd')).toBe(false);
    });

    it('allows absolute paths when workspaceOnly is false', () => {
      const policy = makePolicy({ workspaceOnly: false, workspaceDir: '/workspace' });
      // /home/user is not in forbidden list (assuming not matching)
      expect(policy.isPathAllowed('/home/user/file.txt')).toBe(true);
    });

    it('blocks forbidden paths (exact match)', () => {
      const policy = makePolicy({ workspaceOnly: false });
      expect(policy.isPathAllowed('/etc')).toBe(false);
    });

    it('blocks forbidden paths (prefix + separator)', () => {
      const policy = makePolicy({ workspaceOnly: false });
      expect(policy.isPathAllowed('/etc/passwd')).toBe(false);
    });

    it('allows relative paths within workspace', () => {
      const policy = makePolicy();
      expect(policy.isPathAllowed('src/index.ts')).toBe(true);
      expect(policy.isPathAllowed('./data/file.json')).toBe(true);
    });

    it('allows nested paths', () => {
      const policy = makePolicy();
      expect(policy.isPathAllowed('a/b/c/d.txt')).toBe(true);
    });
  });

  describe('isCommandAllowed', () => {
    it('blocks all commands in ReadOnly mode', () => {
      const policy = makePolicy({ autonomy: AutonomyLevel.ReadOnly });
      expect(policy.isCommandAllowed('git status')).toBe(false);
    });

    it('allows all commands in Full mode', () => {
      const policy = makePolicy({ autonomy: AutonomyLevel.Full });
      expect(policy.isCommandAllowed('rm -rf /')).toBe(true);
    });

    it('allows whitelisted commands', () => {
      const policy = makePolicy();
      expect(policy.isCommandAllowed('git status')).toBe(true);
      expect(policy.isCommandAllowed('ls -la')).toBe(true);
      expect(policy.isCommandAllowed('npm install')).toBe(true);
    });

    it('blocks non-whitelisted commands', () => {
      const policy = makePolicy();
      expect(policy.isCommandAllowed('rm -rf /')).toBe(false);
      expect(policy.isCommandAllowed('sudo apt install')).toBe(false);
    });

    it('blocks backtick subshells', () => {
      const policy = makePolicy();
      expect(policy.isCommandAllowed('echo `whoami`')).toBe(false);
    });

    it('blocks $() subshells', () => {
      const policy = makePolicy();
      expect(policy.isCommandAllowed('echo $(whoami)')).toBe(false);
    });

    it('blocks ${} expansions', () => {
      const policy = makePolicy();
      expect(policy.isCommandAllowed('echo ${PATH}')).toBe(false);
    });

    it('blocks output redirection', () => {
      const policy = makePolicy();
      expect(policy.isCommandAllowed('ls > /tmp/out')).toBe(false);
    });

    it('handles chained commands (all must be allowed)', () => {
      const policy = makePolicy();
      expect(policy.isCommandAllowed('git add . && git commit -m "test"')).toBe(true);
      expect(policy.isCommandAllowed('git status && rm -rf /')).toBe(false);
    });

    it('handles pipe chains', () => {
      const policy = makePolicy();
      expect(policy.isCommandAllowed('ls | grep foo')).toBe(true);
      expect(policy.isCommandAllowed('ls | rm foo')).toBe(false);
    });

    it('blocks restricted command args (curl -o)', () => {
      const policy = makePolicy();
      expect(policy.isCommandAllowed('curl https://example.com')).toBe(true);
      expect(policy.isCommandAllowed('curl -o /tmp/file https://example.com')).toBe(false);
      expect(policy.isCommandAllowed('curl --output /tmp/file https://example.com')).toBe(false);
    });

    it('blocks entirely restricted commands (tee)', () => {
      const policy = makePolicy();
      expect(policy.isCommandAllowed('tee /tmp/file')).toBe(false);
    });

    it('skips env assignments', () => {
      const policy = makePolicy();
      expect(policy.isCommandAllowed('NODE_ENV=production node script.js')).toBe(true);
    });

    it('handles path-based commands', () => {
      const policy = makePolicy();
      expect(policy.isCommandAllowed('/usr/bin/git status')).toBe(true);
    });

    it('rejects empty commands', () => {
      const policy = makePolicy();
      expect(policy.isCommandAllowed('')).toBe(false);
      expect(policy.isCommandAllowed('   ')).toBe(false);
    });
  });

  describe('canAct', () => {
    it('returns false for ReadOnly', () => {
      const policy = makePolicy({ autonomy: AutonomyLevel.ReadOnly });
      expect(policy.canAct()).toBe(false);
    });

    it('returns true for Supervised', () => {
      const policy = makePolicy({ autonomy: AutonomyLevel.Supervised });
      expect(policy.canAct()).toBe(true);
    });

    it('returns true for Full', () => {
      const policy = makePolicy({ autonomy: AutonomyLevel.Full });
      expect(policy.canAct()).toBe(true);
    });
  });
});
