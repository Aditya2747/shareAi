import { describe, expect, it } from 'vitest';
import { extractEventSchedule, extractEventTitle } from './calendar-intent';

describe('extractEventTitle', () => {
  it('reads titled / called names', () => {
    expect(
      extractEventTitle('Schedule an event tomorrow at 3pm titled "ShareAi test"')
    ).toBe('ShareAi test');
    expect(
      extractEventTitle('Create a calendar event tomorrow at 4pm called ShareAi demo')
    ).toBe('ShareAi demo');
  });
});

describe('extractEventSchedule', () => {
  it('parses tomorrow + clock + duration', () => {
    const schedule = extractEventSchedule(
      'Schedule a Google Calendar event tomorrow at 3:00 PM titled "ShareAi test" for 30 minutes'
    );
    expect(schedule.title).toBe('ShareAi test');
    expect(schedule.start_time).toMatch(/T15:00:00$/);
    expect(schedule.end_time).toMatch(/T15:30:00$/);
    expect(schedule.timeZone).toBeTruthy();
  });

  it('defaults duration to 60 minutes', () => {
    const schedule = extractEventSchedule(
      'Create a Google Calendar event tomorrow at 4pm called "ShareAi demo"'
    );
    expect(schedule.title).toBe('ShareAi demo');
    expect(schedule.start_time).toMatch(/T16:00:00$/);
    expect(schedule.end_time).toMatch(/T17:00:00$/);
  });
});
