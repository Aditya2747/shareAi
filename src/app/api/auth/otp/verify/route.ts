import { NextRequest, NextResponse } from 'next/server';
import {
  isValidEmail,
  normalizeEmail,
  setSessionCookie,
  userIdFromEmail,
  verifyOtp,
} from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { clientIpFromRequest } from '@/lib/chat-attachments';

type VerifyBody = {
  email: string;
  code: string;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as VerifyBody;

    if (!body?.email || !body?.code) {
      return NextResponse.json(
        { error: 'Missing email or code' },
        { status: 400 }
      );
    }

    if (!isValidEmail(body.email)) {
      return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 });
    }

    const email = normalizeEmail(body.email);
    const code = String(body.code).trim().replace(/\s+/g, '');

    if (!/^\d{6}$/.test(code)) {
      return NextResponse.json(
        { error: 'Enter the 6-digit code from your email' },
        { status: 400 }
      );
    }

    const ip = clientIpFromRequest(request);
    const verifyLimit = checkRateLimit({
      key: `otp:verify:${email}:${ip}`,
      limit: 15,
      windowMs: 15 * 60 * 1000,
    });
    if (!verifyLimit.ok) {
      return NextResponse.json(
        {
          error: `Too many verification attempts. Try again in ${verifyLimit.retryAfterSec}s.`,
        },
        { status: 429, headers: { 'Retry-After': String(verifyLimit.retryAfterSec) } }
      );
    }

    const isValid = await verifyOtp(email, code);
    if (!isValid) {
      return NextResponse.json(
        { error: 'Invalid or expired code. Request a new one if needed.' },
        { status: 401 }
      );
    }

    const userId = userIdFromEmail(email);
    const response = NextResponse.json(
      { userId, email, ok: true },
      { status: 200 }
    );
    setSessionCookie(response, userId);
    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
