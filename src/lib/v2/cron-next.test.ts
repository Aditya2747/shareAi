import { describe, expect, it } from 'vitest';
import { computeNextRunAt, parseCronExpression } from './cron-next';

describe('cron-next', () => {
  it('parses daily 9am', () => {
    const f = parseCronExpression('0 9 * * *');
    expect(f.minute).toEqual([0]);
    expect(f.hour).toEqual([9]);
  });

  it('computes a next run after from in UTC', () => {
    const from = new Date('2026-07-23T08:00:00.000Z');
    const next = computeNextRunAt('0 9 * * *', 'UTC', from);
    expect(next.toISOString()).toBe('2026-07-23T09:00:00.000Z');
  });

  it('rolls to next day when past the hour', () => {
    const from = new Date('2026-07-23T10:00:00.000Z');
    const next = computeNextRunAt('0 9 * * *', 'UTC', from);
    expect(next.toISOString()).toBe('2026-07-24T09:00:00.000Z');
  });
});
