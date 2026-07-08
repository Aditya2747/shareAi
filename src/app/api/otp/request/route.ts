import { NextRequest, NextResponse } from 'next/server';
import { issueOtp, normalizeEmail } from '@/lib/auth';

type RequestBody = {
  email: string;
};

async function sendOtpEmail(to: string, code: string): Promise<void> {
  const resendKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.OTP_FROM_EMAIL;

  if (!resendKey || !fromEmail) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'OTP email delivery is not configured (set RESEND_API_KEY and OTP_FROM_EMAIL)'
      );
    }
    return;
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [to],
      subject: 'Your Actionable Links login code',
      text: `Your OTP code is ${code}. It expires in 10 minutes.`,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `Failed to send OTP email (status=${response.status}): ${body}`
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RequestBody;

    if (!body?.email) {
      return NextResponse.json({ error: 'Missing email' }, { status: 400 });
    }

    const email = normalizeEmail(body.email);
    const { otpCode, expiresAtIso } = await issueOtp(email);
    await sendOtpEmail(email, otpCode);

    const responsePayload: {
      ok: boolean;
      message: string;
      expiresAt: string;
      devOtp?: string;
    } = {
      ok: true,
      message: `OTP requested for ${email}.`,
      expiresAt: expiresAtIso,
    };

    // Local/dev convenience when email delivery isn't configured.
    if (
      process.env.NODE_ENV !== 'production' &&
      (!process.env.RESEND_API_KEY || !process.env.OTP_FROM_EMAIL)
    ) {
      responsePayload.devOtp = otpCode;
      responsePayload.message = `OTP generated for ${email}. Use devOtp from response in local testing.`;
    }

    return NextResponse.json(responsePayload, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

