/**
 * Minimal 5-field cron next-occurrence helper (no external deps).
 * Supports: minute, hour, day-of-month, month, day-of-week.
 * Fields: * , N , *\/N , A-B , comma lists.
 * Timezone: IANA name; evaluation uses Intl local parts in that zone.
 */

export type CronFields = {
  minute: number[];
  hour: number[];
  dayOfMonth: number[];
  month: number[];
  dayOfWeek: number[]; // 0–6 Sunday–Saturday
};

function parseField(field: string, min: number, max: number): number[] {
  const values = new Set<number>();
  for (const part of field.split(',')) {
    if (part === '*') {
      for (let i = min; i <= max; i++) values.add(i);
      continue;
    }
    const stepMatch = part.match(/^(?:\*|(\d+)-(\d+))\/(\d+)$/);
    if (stepMatch) {
      const start = stepMatch[1] ? Number(stepMatch[1]) : min;
      const end = stepMatch[2] ? Number(stepMatch[2]) : max;
      const step = Number(stepMatch[3]);
      for (let i = start; i <= end; i += step) values.add(i);
      continue;
    }
    const rangeMatch = part.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const a = Number(rangeMatch[1]);
      const b = Number(rangeMatch[2]);
      for (let i = a; i <= b; i++) values.add(i);
      continue;
    }
    const n = Number(part);
    if (!Number.isInteger(n) || n < min || n > max) {
      throw new Error(`Invalid cron field value: ${part}`);
    }
    values.add(n);
  }
  return Array.from(values).sort((a, b) => a - b);
}

export function parseCronExpression(expr: string): CronFields {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error('cron_expression must have 5 fields (m h dom mon dow)');
  }
  return {
    minute: parseField(parts[0], 0, 59),
    hour: parseField(parts[1], 0, 23),
    dayOfMonth: parseField(parts[2], 1, 31),
    month: parseField(parts[3], 1, 12),
    dayOfWeek: parseField(parts[4], 0, 6),
  };
}

function zonedParts(
  date: Date,
  timeZone: string
): { year: number; month: number; day: number; hour: number; minute: number; weekday: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  });
  const map: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    weekday: weekdayMap[map.weekday] ?? 0,
  };
}

/** Rough UTC instant for a zoned wall clock (good enough for scheduling). */
function zonedWallToUtc(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number
): Date {
  // Guess UTC, then nudge by observed offset.
  let utc = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (let i = 0; i < 3; i++) {
    const parts = zonedParts(new Date(utc), timeZone);
    const asIfUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      0
    );
    const target = Date.UTC(year, month - 1, day, hour, minute, 0);
    utc += target - asIfUtc;
  }
  return new Date(utc);
}

function matches(fields: CronFields, parts: ReturnType<typeof zonedParts>): boolean {
  if (!fields.minute.includes(parts.minute)) return false;
  if (!fields.hour.includes(parts.hour)) return false;
  if (!fields.month.includes(parts.month)) return false;
  const domOk = fields.dayOfMonth.includes(parts.day);
  const dowOk = fields.dayOfWeek.includes(parts.weekday);
  // Cron: if both DOM and DOW are restricted, match either (standard cron OR).
  const domStar = fields.dayOfMonth.length === 31;
  const dowStar = fields.dayOfWeek.length === 7;
  if (!domStar && !dowStar) return domOk || dowOk;
  if (!domStar) return domOk;
  if (!dowStar) return dowOk;
  return true;
}

/** Next run strictly after `from` (default: now). Searches up to ~400 days. */
export function computeNextRunAt(
  cronExpression: string,
  timeZone: string = 'UTC',
  from: Date = new Date()
): Date {
  const fields = parseCronExpression(cronExpression);
  const start = new Date(from.getTime() + 60_000); // next minute
  start.setUTCSeconds(0, 0);

  // Iterate minute by minute in the target zone via UTC stepping.
  let cursor = start;
  const maxIterations = 400 * 24 * 60;
  for (let i = 0; i < maxIterations; i++) {
    const parts = zonedParts(cursor, timeZone);
    if (matches(fields, parts)) {
      // Snap to exact wall time in zone
      return zonedWallToUtc(
        timeZone,
        parts.year,
        parts.month,
        parts.day,
        parts.hour,
        parts.minute
      );
    }
    cursor = new Date(cursor.getTime() + 60_000);
  }
  throw new Error('Could not compute next_run_at within search window');
}

export const SCHEDULE_PRESETS = [
  {
    id: 'daily_9am',
    label: 'Daily at 9:00 AM',
    cronExpression: '0 9 * * *',
  },
  {
    id: 'weekdays_9am',
    label: 'Weekdays at 9:00 AM',
    cronExpression: '0 9 * * 1-5',
  },
  {
    id: 'hourly',
    label: 'Every hour',
    cronExpression: '0 * * * *',
  },
] as const;
