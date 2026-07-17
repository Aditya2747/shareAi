/**
 * Lightweight calendar field extraction for the heuristic intent fallback
 * (used when Gemini is unavailable). Prefer local wall time + IANA timeZone
 * so Google Calendar does not shift events incorrectly.
 */

export function defaultCalendarTimeZone(): string {
  return (
    process.env.CALENDAR_DEFAULT_TIMEZONE ||
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    'UTC'
  );
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function formatWallDateTime(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
}

function parseClockTime(raw: string): { hours: number; minutes: number } | null {
  const m = raw.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!m) return null;
  let hours = Number(m[1]);
  const minutes = m[2] ? Number(m[2]) : 0;
  const meridiem = m[3]?.toLowerCase();
  if (Number.isNaN(hours) || Number.isNaN(minutes) || minutes > 59) return null;
  if (meridiem === 'pm' && hours < 12) hours += 12;
  if (meridiem === 'am' && hours === 12) hours = 0;
  if (!meridiem && hours > 23) return null;
  if (hours > 23) return null;
  return { hours, minutes };
}

function dayOffsetFromPrompt(lower: string): number {
  if (/\btoday\b/.test(lower)) return 0;
  if (/\btomorrow\b/.test(lower)) return 1;
  return 1; // default: tomorrow for calendar-ish prompts
}

function durationMinutesFromPrompt(lower: string): number {
  const mins = lower.match(/\bfor\s+(\d+)\s*(minutes|mins|min)\b/);
  if (mins) return Math.max(1, Number(mins[1]));
  const hours = lower.match(/\bfor\s+(\d+(?:\.\d+)?)\s*(hours|hour|hrs|hr)\b/);
  if (hours) return Math.max(1, Math.round(Number(hours[1]) * 60));
  return 60;
}

export function extractEventTitle(prompt: string): string {
  const patterns = [
    /\btitled\s+["“]?([^"”\n,]+?)["”]?(?=\s+for\b|\s*$|,|\.|and\b)/i,
    /\bcalled\s+["“]?([^"”\n,]+?)["”]?(?=\s+for\b|\s*$|,|\.|and\b)/i,
    /\bnamed\s+["“]?([^"”\n,]+?)["”]?(?=\s+for\b|\s*$|,|\.|and\b)/i,
    /\bevent\s+["“]([^"”\n]+)["”]/i,
  ];
  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    if (match?.[1]) {
      const title = match[1].trim();
      if (title) return title;
    }
  }
  return 'Calendar Event';
}

export function extractEventSchedule(prompt: string): {
  title: string;
  start_time: string;
  end_time: string;
  timeZone: string;
} {
  const lower = prompt.toLowerCase();
  const timeZone = defaultCalendarTimeZone();
  const title = extractEventTitle(prompt);

  const timeMatch = prompt.match(
    /\bat\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?|\d{1,2}:\d{2})\b/i
  );
  const clock = timeMatch ? parseClockTime(timeMatch[1]) : null;

  const base = new Date();
  base.setSeconds(0, 0);
  base.setDate(base.getDate() + dayOffsetFromPrompt(lower));

  if (clock) {
    base.setHours(clock.hours, clock.minutes, 0, 0);
  } else {
    // No explicit clock → keep prior behavior of "same local time next day"
    // but still use wall-clock formatting for Google.
  }

  const durationMins = durationMinutesFromPrompt(lower);
  const end = new Date(base.getTime() + durationMins * 60_000);

  return {
    title,
    start_time: formatWallDateTime(base),
    end_time: formatWallDateTime(end),
    timeZone,
  };
}
