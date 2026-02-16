export interface CronFields {
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
}

function parseField(field: string, min: number, max: number): Set<number> {
  const values = new Set<number>();

  for (const part of field.split(',')) {
    const trimmed = part.trim();

    // Handle step: */2, 1-5/2, or just *
    const [range, stepStr] = trimmed.split('/');
    const step = stepStr !== undefined ? parseInt(stepStr, 10) : 1;

    if (isNaN(step) || step <= 0) {
      throw new Error(`Invalid step value in "${trimmed}"`);
    }

    let start: number;
    let end: number;

    if (range === '*') {
      start = min;
      end = max;
    } else if (range.includes('-')) {
      const [lo, hi] = range.split('-');
      start = parseInt(lo, 10);
      end = parseInt(hi, 10);
      if (isNaN(start) || isNaN(end)) {
        throw new Error(`Invalid range in "${trimmed}"`);
      }
    } else {
      start = parseInt(range, 10);
      end = stepStr !== undefined ? max : start;
      if (isNaN(start)) {
        throw new Error(`Invalid value in "${trimmed}"`);
      }
    }

    if (start < min || start > max || end < min || end > max) {
      throw new Error(`Value out of range [${min}-${max}] in "${trimmed}"`);
    }

    for (let i = start; i <= end; i += step) {
      values.add(i);
    }
  }

  if (values.size === 0) {
    throw new Error(`Empty field: "${field}"`);
  }

  return values;
}

export function parseCron(expr: string): CronFields {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression: expected 5 fields, got ${parts.length}`);
  }

  return {
    minutes: parseField(parts[0], 0, 59),
    hours: parseField(parts[1], 0, 23),
    daysOfMonth: parseField(parts[2], 1, 31),
    months: parseField(parts[3], 1, 12),
    daysOfWeek: parseField(parts[4], 0, 6),
  };
}

export function cronMatchesTime(fields: CronFields, date: Date): boolean {
  return (
    fields.minutes.has(date.getMinutes()) &&
    fields.hours.has(date.getHours()) &&
    fields.daysOfMonth.has(date.getDate()) &&
    fields.months.has(date.getMonth() + 1) &&
    fields.daysOfWeek.has(date.getDay())
  );
}

export function nextCronTime(fields: CronFields, after: Date): Date {
  const maxMinutes = 366 * 24 * 60; // cap at 366 days
  const candidate = new Date(after.getTime());
  // Start from the next minute
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  for (let i = 0; i < maxMinutes; i++) {
    if (cronMatchesTime(fields, candidate)) {
      return candidate;
    }
    candidate.setMinutes(candidate.getMinutes() + 1);
  }

  throw new Error('No matching cron time found within 366 days');
}
