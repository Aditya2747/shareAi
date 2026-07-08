import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import {
  createSessionToken,
  getUserIdFromRequest,
  normalizeEmail,
  userIdFromEmail,
} from '@/lib/auth';

describe('auth utilities', () => {
  it('normalizes emails and produces deterministic user ids', () => {
    expect(normalizeEmail('  Alice@Example.COM ')).toBe('alice@example.com');
    expect(userIdFromEmail('Alice@Example.COM')).toBe(
      userIdFromEmail('alice@example.com')
    );
  });

  it('creates verifiable session token resolved from cookie', () => {
    const userId = 'user_test_123';
    const token = createSessionToken(userId);
    expect(token.split('.')).toHaveLength(2);

    const req = new NextRequest('http://localhost:3000', {
      headers: { cookie: `shareai_session=${token}` },
    });
    expect(getUserIdFromRequest(req)).toBe(userId);
  });

  it('rejects tampered session token signatures', () => {
    const userId = 'user_test_456';
    const token = createSessionToken(userId);
    const [payload] = token.split('.');
    const tampered = `${payload}.bad_signature`;

    const req = new NextRequest('http://localhost:3000', {
      headers: { cookie: `shareai_session=${tampered}` },
    });
    expect(getUserIdFromRequest(req)).toBeNull();
  });
});
