const UNIT_MS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

export function parseInterval(expr: string): number {
  const match = expr.trim().match(/^every\s+(\d+)\s*([smhd])$/i);
  if (!match) {
    throw new Error(`Invalid interval expression: "${expr}". Expected format: "every <N><s|m|h|d>"`);
  }

  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();

  if (value <= 0) {
    throw new Error(`Interval value must be positive, got ${value}`);
  }

  const multiplier = UNIT_MS[unit];
  if (!multiplier) {
    throw new Error(`Unknown unit "${unit}"`);
  }

  return value * multiplier;
}
