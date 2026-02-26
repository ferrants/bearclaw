export const ALLOWED_COMMANDS = [
  "git",
  "ls", "cat", "grep", "find", "echo", "pwd", "wc", "head", "tail",
  "sort", "uniq", "diff", "date", "which", "mkdir", "cp", "mv",
  "touch", "chmod",
];

export const RESTRICTED_COMMANDS: Record<string, string[]> = {
  curl: ["-o", "--output", "-O", "-T", "--upload-file"],
  wget: ["-O", "--output-document"],
  tee: ["*"],
  find: ["-exec", "-ok", "-execdir", "-okdir"],
  git: [
    "commit", "push", "pull", "merge", "rebase", "reset", "checkout",
    "switch", "branch", "tag", "stash", "remote", "config", "init",
    "clone", "fetch", "gc", "clean", "am", "apply", "cherry-pick",
    "revert", "bisect", "worktree", "submodule",
  ],
};

export const FORBIDDEN_PATHS = [
  "/etc", "/root", "/boot", "/dev", "/proc", "/sys", "/var",
  "/bin", "/sbin", "/lib", "/usr", "/opt", "/tmp",
  "~/.ssh", "~/.gnupg", "~/.aws", "~/.config/gcloud",
];

export const POLICY_DEFAULTS = {
  defaultAction: "approve" as const,
  denyPrecedence: true,
  approvalScope: "user+channel" as const,
  learningMode: "suggest_rules" as const,
  approvals: { cache: false, defaultTTLSeconds: 300 },
  inlineAllow: { enabled: true, dayScopeHours: 24 },
  web: {
    mode: "allow_with_blocklist" as const,
    blockedDomains: [] as string[],
    blockedCidrs: [] as string[],
    blockedHosts: [] as string[],
  },
};

export const MAX_CONVERSATION_MESSAGES = 50;
export const MAX_CONVERSATION_DURATION_MS = 600_000;
export const MAX_SESSION_MESSAGES = 100;
export const LONG_RESPONSE_THRESHOLD = 4000;
export const SHELL_TIMEOUT_MS = 60_000;
export const SHELL_OUTPUT_LIMIT = 1_048_576;
export const WEB_FETCH_MAX_CHARS = 50_000;
export const WEB_FETCH_TIMEOUT_MS = 30_000;
export const READ_FILE_MAX_SIZE = 10_485_760;
export const WRITE_FILE_MAX_SIZE = 10_485_760;
export const BOOTSTRAP_FILE_MAX_CHARS = 20_000;
export const BOOTSTRAP_TOTAL_MAX_CHARS = 24_000;
