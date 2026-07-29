import { NextRequest, NextResponse } from 'next/server';
import { issueOtp, isValidEmail, normalizeEmail } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { clientIpFromRequest } from '@/lib/chat-attachments';

type RequestBody = {
  email: string;
};

function otpDevExposeEnabled(): boolean {
  return process.env.OTP_DEV_EXPOSE === '1';
}

async function sendOtpEmail(to: string, code: string): Promise<boolean> {
  const resendKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.OTP_FROM_EMAIL;

  if (!resendKey || !fromEmail) {
    // Local: always allow. Production: only with explicit OTP_DEV_EXPOSE=1 (shows code in UI).
    if (process.env.NODE_ENV === 'production' && !otpDevExposeEnabled()) {
      throw new Error(
        'OTP email delivery is not configured (set RESEND_API_KEY and OTP_FROM_EMAIL, or OTP_DEV_EXPOSE=1 for demo bypass)'
      );
    }
    return false;
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
      subject: 'Your shareAi login code',
      text: `Your verification code is ${code}.\n\nIt expires in 10 minutes. If you did not request this, you can ignore this email.`,
      html: `<p>Your verification code is:</p><p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p><p>It expires in 10 minutes.</p>`,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `Failed to send OTP email (status=${response.status}): ${body}`
    );
  }
  return true;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RequestBody;

    if (!body?.email) {
      return NextResponse.json({ error: 'Missing email' }, { status: 400 });
    }

    if (!isValidEmail(body.email)) {
      return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 });
    }

    const email = normalizeEmail(body.email);
    const ip = clientIpFromRequest(request);

    const emailLimit = checkRateLimit({
      key: `otp:email:${email}`,
      limit: 5,
      windowMs: 15 * 60 * 1000,
    });
    if (!emailLimit.ok) {
      return NextResponse.json(
        {
          error: `Too many codes requested for this email. Try again in ${emailLimit.retryAfterSec}s.`,
        },
        { status: 429, headers: { 'Retry-After': String(emailLimit.retryAfterSec) } }
      );
    }

    const ipLimit = checkRateLimit({
      key: `otp:ip:${ip}`,
      limit: 20,
      windowMs: 15 * 60 * 1000,
    });
    if (!ipLimit.ok) {
      return NextResponse.json(
        {
          error: `Too many requests from this network. Try again in ${ipLimit.retryAfterSec}s.`,
        },
        { status: 429, headers: { 'Retry-After': String(ipLimit.retryAfterSec) } }
      );
    }

    const { otpCode, expiresAtIso } = await issueOtp(email);
    const emailed = await sendOtpEmail(email, otpCode);

    const responsePayload: {
      ok: boolean;
      message: string;
      expiresAt: string;
      emailSent: boolean;
      devOtp?: string;
    } = {
      ok: true,
      message: emailed
        ? `We sent a 6-digit code to ${email}.`
        : `OTP generated for ${email}.`,
      expiresAt: expiresAtIso,
      emailSent: emailed,
    };

    // Expose plaintext OTP when email was skipped (local, or OTP_DEV_EXPOSE=1 on Vercel).
    if (!emailed && (otpDevExposeEnabled() || process.env.NODE_ENV !== 'production')) {
      responsePayload.devOtp = otpCode;
      responsePayload.message =
        'Email not configured — use the Dev OTP shown on screen. Set Resend for real emails, or keep OTP_DEV_EXPOSE=1 for demos only.';
    }

    return NextResponse.json(responsePayload, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
