import { describe, expect, it } from 'vitest';
import {
  buildExecutionPlanFromInput,
  buildHumanSummary,
  toSafeClientArgs,
} from './planner';

describe('buildHumanSummary', () => {
  it('is deterministic from action + args', () => {
    expect(buildHumanSummary('browser.open_url', { url: 'https://example.com' })).toBe(
      'Open https://example.com in the browser'
    );
    expect(buildHumanSummary('browser.click', { selector: '#login' })).toBe(
      'Click element #login'
    );
    expect(
      buildHumanSummary('google-gmail.send_email', {
        to: 'a@b.com',
        subject: 'Hi',
      })
    ).toBe('Send Gmail to a@b.com (Hi)');
  });
});

describe('toSafeClientArgs', () => {
  it('keeps allowlisted fields and drops secrets/bodies', () => {
    const safe = toSafeClientArgs({
      url: 'https://example.com',
      method: 'POST',
      body: { secret: 'nope' },
      headers: { Authorization: 'Bearer x' },
      selector: '#ok',
    });
    expect(safe).toEqual({
      url: 'https://example.com',
      method: 'POST',
      selector: '#ok',
    });
  });
});

describe('buildExecutionPlanFromInput humanSummary', () => {
  it('attaches humanSummary to planned steps', () => {
    const plan = buildExecutionPlanFromInput(
      {
        action: 'Open https://example.com and click "#go"',
        targetAPIs: [],
      },
      'Open https://example.com and click "#go"'
    );
    expect(plan.steps.length).toBeGreaterThanOrEqual(2);
    expect(plan.steps.every((s) => Boolean(s.humanSummary))).toBe(true);
    expect(plan.steps[0].humanSummary).toMatch(/Open https:\/\/example\.com/i);
  });

  it('infers windows.screenshot from screenshot prompts', () => {
    const plan = buildExecutionPlanFromInput(
      {
        action: 'Take a screenshot of my screen',
        targetAPIs: [],
      },
      'Take a screenshot of my screen'
    );
    expect(plan.steps.some((s) => s.action === 'windows.screenshot')).toBe(true);
    expect(plan.blockedReasons).toEqual([]);
  });
});
