import { describe, expect, it } from 'vitest';
import {
  computeStepHash,
  stableStringify,
  verifyApprovedStepHash,
} from './step-hash';

describe('stableStringify', () => {
  it('produces the same string for objects with different key order', () => {
    const a = stableStringify({ b: 2, a: 1, nested: { z: true, y: false } });
    const b = stableStringify({ nested: { y: false, z: true }, a: 1, b: 2 });
    expect(a).toBe(b);
  });
});

describe('computeStepHash', () => {
  const base = {
    executor_type: 'api',
    action: 'slack.send_message',
    args_json: {
      channel: '#general',
      text: 'hello',
      __requiredPermissions: ['chat:write'],
    },
  };

  it('is stable across key order in args_json', () => {
    const hashA = computeStepHash(base);
    const hashB = computeStepHash({
      ...base,
      args_json: {
        __requiredPermissions: ['chat:write'],
        text: 'hello',
        channel: '#general',
      },
    });
    expect(hashA).toBe(hashB);
    expect(hashA).toMatch(/^[a-f0-9]{64}$/);
  });

  it('changes when action, executor, or args change', () => {
    const original = computeStepHash(base);
    expect(
      computeStepHash({ ...base, action: 'slack.update_message' })
    ).not.toBe(original);
    expect(
      computeStepHash({ ...base, executor_type: 'browser' })
    ).not.toBe(original);
    expect(
      computeStepHash({
        ...base,
        args_json: { ...base.args_json, text: 'tampered' },
      })
    ).not.toBe(original);
  });
});

describe('verifyApprovedStepHash (mismatch blocking)', () => {
  const step = {
    executor_type: 'os' as const,
    action: 'windows.set_theme',
    args_json: { mode: 'dark' },
  };

  it('allows execution when hash matches', () => {
    const approved = computeStepHash(step);
    const result = verifyApprovedStepHash(step, approved);
    expect(result.ok).toBe(true);
  });

  it('blocks when hash mismatches after tampering', () => {
    const approved = computeStepHash(step);
    const tampered = {
      ...step,
      args_json: { mode: 'light' },
    };
    const result = verifyApprovedStepHash(tampered, approved);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/mismatch/i);
      expect(result.currentHash).not.toBe(approved);
    }
  });

  it('blocks when approved hash is missing', () => {
    const result = verifyApprovedStepHash(step, null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/missing/i);
    }
  });
});
