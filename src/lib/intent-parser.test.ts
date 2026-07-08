import { describe, expect, it, vi } from 'vitest';

vi.mock('ai', () => ({
  generateObject: vi.fn(async () => {
    throw new Error('forced fallback');
  }),
}));

import { parseIntentFromPrompt } from '@/lib/intent-parser';

describe('parseIntentFromPrompt fallback', () => {
  it('detects Slack + Calendar + Gmail from prompt text', async () => {
    const intent = await parseIntentFromPrompt(
      'Schedule a calendar event and send an email to bob@example.com, then post in Slack #general'
    );

    expect(intent.targetAPIs).toEqual(
      expect.arrayContaining(['google-calendar', 'google-gmail', 'slack'])
    );
    expect(intent.requiredScopes['google-calendar']).toEqual([
      'https://www.googleapis.com/auth/calendar.events',
    ]);
    expect(intent.requiredScopes['google-gmail']).toEqual([
      'https://www.googleapis.com/auth/gmail.send',
    ]);
    expect(intent.requiredScopes.slack).toEqual(['chat:write', 'users:read']);
    expect(intent.parameters.to).toBe('bob@example.com');
    expect(intent.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it('defaults to slack when no provider keywords are present', async () => {
    const intent = await parseIntentFromPrompt('Do the thing quickly');
    expect(intent.targetAPIs).toEqual(['slack']);
  });
});
