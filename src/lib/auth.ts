import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

const SESSION_COOKIE = 'shareai_session';
const LEGACY_USER_COOKIE = 'shareai_user_id';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14; // 14 days
const OTP_TTL_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;

const SESSION_SECRET =
  process.env.AUTH_SESSION_SECRET || process.env.ENCRYPTION_KEY || '';
const OTP_SECRET = process.env.OTP_SECRET || SESSION_SECRET;

function normalizeBase64Url(input: string): string {
  return input.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlEncode(input: string | Buffer): string {
  const raw = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf-8');
  return normalizeBase64Url(raw.toString('base64'));
}

function base64UrlDecode(input: string): string {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(normalized + padding, 'base64').toString('utf-8');
}

function sign(value: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

type SessionPayload = {
  uid: string;
  exp: number;
};

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function userIdFromEmail(email: string): string {
  const normalized = normalizeEmail(email);
  return `user_${crypto
    .createHash('sha256')
    .update(normalized)
    .digest('hex')
    .slice(0, 24)}`;
}

export function createSessionToken(userId: string): string {
  if (!SESSION_SECRET) {
    throw new Error(
      'Missing AUTH_SESSION_SECRET (or ENCRYPTION_KEY fallback) for signing sessions'
    );
  }
  const payload: SessionPayload = {
    uid: userId,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const payloadPart = base64UrlEncode(JSON.stringify(payload));
  const signaturePart = sign(payloadPart, SESSION_SECRET);
  return `${payloadPart}.${signaturePart}`;
}

export function getUserIdFromRequest(request: NextRequest): string | null {
  const sessionToken = request.cookies.get(SESSION_COOKIE)?.value;
  if (sessionToken) {
    const [payloadPart, signaturePart] = sessionToken.split('.');
    if (!payloadPart || !signaturePart) return null;

    const expectedSig = sign(payloadPart, SESSION_SECRET);
    const expectedBuf = Buffer.from(expectedSig, 'utf-8');
    const actualBuf = Buffer.from(signaturePart, 'utf-8');
    if (
      expectedBuf.length !== actualBuf.length ||
      !crypto.timingSafeEqual(expectedBuf, actualBuf)
    ) {
      return null;
    }

    const payloadRaw = base64UrlDecode(payloadPart);
    const payload = JSON.parse(payloadRaw) as SessionPayload;
    if (!payload?.uid || !payload?.exp) return null;
    if (payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload.uid;
  }

  // Backward compatibility for old local cookies.
  return request.cookies.get(LEGACY_USER_COOKIE)?.value || null;
}

export function setSessionCookie(response: NextResponse, userId: string): void {
  const token = createSessionToken(userId);
  response.cookies.set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_TTL_SECONDS,
  });

  // Clear legacy cookie.
  response.cookies.set({
    name: LEGACY_USER_COOKIE,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set({
    name: SESSION_COOKIE,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  response.cookies.set({
    name: LEGACY_USER_COOKIE,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

function generateOtpCode(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

function hashOtp(email: string, otpCode: string): string {
  if (!OTP_SECRET) {
    throw new Error(
      'Missing OTP secret. Set OTP_SECRET or AUTH_SESSION_SECRET/ENCRYPTION_KEY.'
    );
  }
  const normalizedEmail = normalizeEmail(email);
  return crypto
    .createHmac('sha256', OTP_SECRET)
    .update(`${normalizedEmail}:${otpCode}`)
    .digest('hex');
}

export async function issueOtp(emailInput: string): Promise<{ otpCode: string; expiresAtIso: string }> {
  const email = normalizeEmail(emailInput);
  const otpCode = generateOtpCode();
  const expiresAtIso = new Date(
    Date.now() + OTP_TTL_MINUTES * 60 * 1000
  ).toISOString();
  const hashed = hashOtp(email, otpCode);
  const otpId = `otp_${crypto.randomUUID()}`;

  // Invalidate previous active OTPs for this email.
  await supabaseAdmin
    .from('otp_codes')
    .update({ consumed_at: new Date().toISOString() })
    .eq('email', email)
    .is('consumed_at', null);

  const { error } = await supabaseAdmin.from('otp_codes').insert([
    {
      id: otpId,
      email,
      code_hash: hashed,
      expires_at: expiresAtIso,
      attempts_left: OTP_MAX_ATTEMPTS,
      consumed_at: null,
    },
  ]);

  if (error) {
    throw new Error(`Failed to store OTP: ${error.message}`);
  }

  return { otpCode, expiresAtIso };
}

export async function verifyOtp(emailInput: string, otpCode: string): Promise<boolean> {
  const email = normalizeEmail(emailInput);
  const normalizedCode = String(otpCode).trim();
  const nowIso = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from('otp_codes')
    .select('id, code_hash, attempts_left, expires_at')
    .eq('email', email)
    .is('consumed_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to lookup OTP: ${error.message}`);
  }

  if (!data) return false;
  if (!data.expires_at || new Date(data.expires_at).getTime() <= Date.now()) {
    await supabaseAdmin
      .from('otp_codes')
      .update({ consumed_at: nowIso })
      .eq('id', data.id);
    return false;
  }
  if ((data.attempts_left ?? 0) <= 0) {
    await supabaseAdmin
      .from('otp_codes')
      .update({ consumed_at: nowIso })
      .eq('id', data.id);
    return false;
  }

  const submittedHash = hashOtp(email, normalizedCode);
  const stored = Buffer.from(data.code_hash, 'utf-8');
  const candidate = Buffer.from(submittedHash, 'utf-8');
  const isValid =
    stored.length === candidate.length &&
    crypto.timingSafeEqual(stored, candidate);

  if (!isValid) {
    const nextAttempts = Math.max((data.attempts_left ?? 1) - 1, 0);
    await supabaseAdmin
      .from('otp_codes')
      .update({
        attempts_left: nextAttempts,
        consumed_at: nextAttempts === 0 ? nowIso : null,
      })
      .eq('id', data.id);
    return false;
  }

  await supabaseAdmin
    .from('otp_codes')
    .update({ consumed_at: nowIso, attempts_left: 0 })
    .eq('id', data.id);
  return true;
}
