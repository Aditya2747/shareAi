import { NextRequest, NextResponse } from 'next/server';
import {
  normalizeEmail,
  setSessionCookie,
  userIdFromEmail,
  verifyOtp,
} from '@/lib/auth';

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

    const email = normalizeEmail(body.email);
    const code = String(body.code).trim();

    const isValid = await verifyOtp(email, code);
    if (!isValid) {
      return NextResponse.json({ error: 'Invalid OTP code' }, { status: 401 });
    }

    const userId = userIdFromEmail(email);

    const response = NextResponse.json({ userId }, { status: 200 });
    setSessionCookie(response, userId);

    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

