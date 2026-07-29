import { describe, expect, it } from 'vitest';
import { normalizeDomain } from './browser-sessions';

describe('normalizeDomain', () => {
  it('strips www and lowercases host', () => {
    expect(normalizeDomain('WWW.Example.COM')).toBe('example.com');
  });

  it('parses full URLs', () => {
    expect(normalizeDomain('https://www.example.com/path')).toBe('example.com');
  });
});
