'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle, ArrowLeft, Loader2, Mail } from 'lucide-react';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnUrl = searchParams.get('returnUrl') || '/';

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [step, setStep] = useState<'request' | 'verify'>('request');
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const codeRefs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    setMounted(true);
  }, []);

  async function handleRequestOtp() {
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      const res = await fetch('/api/otp/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to send code');

      if (data.devOtp) {
        setInfo(`Dev code (email not configured): ${data.devOtp}`);
        setCode(String(data.devOtp));
      } else {
        setInfo(data.message || `Code sent to ${email}`);
      }
      setExpiresAt(data.expiresAt || null);
      setStep('verify');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOtp(fullCode?: string) {
    const otp = (fullCode ?? code).replace(/\D/g, '').slice(0, 6);
    if (otp.length !== 6) {
      setError('Enter the 6-digit code');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code: otp }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Verification failed');
      router.replace(returnUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
      setCode('');
    } finally {
      setLoading(false);
    }
  }

  function onDigitChange(index: number, value: string) {
    const digit = value.replace(/\D/g, '').slice(-1);
    const chars = code.padEnd(6, ' ').split('').slice(0, 6);
    chars[index] = digit || ' ';
    const next = chars.join('').replace(/ /g, '');
    setCode(next);
    if (digit && index < 5) codeRefs.current[index + 1]?.focus();
    if (digit && index === 5 && next.length === 6) {
      void handleVerifyOtp(next);
    }
  }

  if (!mounted) {
    return (
      <div className="min-h-screen bg-[var(--chat-bg)] flex items-center justify-center">
        <Loader2 className="w-7 h-7 text-[var(--chat-accent)] animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--chat-bg)] flex items-center justify-center px-4 py-10 font-sans">
      <div className="w-full max-w-[400px] space-y-8">
        <div className="text-center space-y-2">
          <div className="mx-auto w-10 h-10 rounded-full bg-[var(--chat-accent)]/20 flex items-center justify-center">
            <Mail className="w-5 h-5 text-[var(--chat-accent)]" />
          </div>
          <h1 className="text-2xl font-semibold text-[var(--chat-text)] tracking-tight">
            Sign in to shareAi
          </h1>
          <p className="text-sm text-[var(--chat-muted)]">
            We&apos;ll email you a one-time code. No password needed.
          </p>
        </div>

        <div className="rounded-2xl border border-[var(--chat-border)] bg-[var(--chat-surface)] p-6 space-y-4 shadow-xl shadow-black/20">
          {info && (
            <div className="rounded-xl bg-[var(--chat-accent)]/10 border border-[var(--chat-accent)]/30 px-3 py-2 text-sm text-[var(--chat-text)]">
              {info}
            </div>
          )}
          {error && (
            <div className="rounded-xl bg-red-500/10 border border-red-500/30 px-3 py-2 text-sm text-red-300 flex gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--chat-muted)]">Email</label>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              disabled={loading || step === 'verify'}
              className="w-full rounded-xl bg-[var(--chat-bg)] border border-[var(--chat-border)] px-3.5 py-2.5 text-sm text-[var(--chat-text)] focus:outline-none focus:ring-2 focus:ring-[var(--chat-accent)]/50"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && step === 'request') void handleRequestOtp();
              }}
            />
          </div>

          {step === 'request' && (
            <button
              type="button"
              onClick={handleRequestOtp}
              disabled={loading || !email.trim()}
              className="w-full rounded-xl bg-[var(--chat-accent)] hover:brightness-110 disabled:opacity-40 text-[var(--chat-bg)] font-medium py-2.5 text-sm transition flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Continue
            </button>
          )}

          {step === 'verify' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-medium text-[var(--chat-muted)]">
                  6-digit code
                  {expiresAt
                    ? ` · expires ${new Date(expiresAt).toLocaleTimeString()}`
                    : ''}
                </label>
                <div className="flex gap-2 justify-between">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <input
                      key={i}
                      ref={(el) => {
                        codeRefs.current[i] = el;
                      }}
                      inputMode="numeric"
                      maxLength={1}
                      value={code[i] || ''}
                      onChange={(e) => onDigitChange(i, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Backspace' && !code[i] && i > 0) {
                          codeRefs.current[i - 1]?.focus();
                        }
                      }}
                      className="w-11 h-12 text-center text-lg font-semibold rounded-xl bg-[var(--chat-bg)] border border-[var(--chat-border)] text-[var(--chat-text)] focus:outline-none focus:ring-2 focus:ring-[var(--chat-accent)]/50"
                      disabled={loading}
                    />
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={() => handleVerifyOtp()}
                disabled={loading || code.replace(/\D/g, '').length !== 6}
                className="w-full rounded-xl bg-[var(--chat-accent)] hover:brightness-110 disabled:opacity-40 text-[var(--chat-bg)] font-medium py-2.5 text-sm transition flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Verify & sign in
              </button>

              <button
                type="button"
                onClick={() => {
                  setStep('request');
                  setCode('');
                  setError(null);
                  setInfo(null);
                }}
                className="w-full text-sm text-[var(--chat-muted)] hover:text-[var(--chat-text)] flex items-center justify-center gap-1"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Use a different email
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[var(--chat-bg)] flex items-center justify-center">
          <Loader2 className="w-7 h-7 text-[var(--chat-accent)] animate-spin" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
