'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle, Lock, Loader2, CheckCircle2 } from 'lucide-react';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const returnUrl = searchParams.get('returnUrl');
  const defaultRedirect = '/';

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [step, setStep] = useState<'request' | 'verify'>('request');
  const [success, setSuccess] = useState(false);
  const [mounted, setMounted] = useState(false);

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
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to request OTP');
      }
      const data = (await res.json()) as { devOtp?: string; message?: string };
      if (data.devOtp) {
        setInfo(`Dev OTP: ${data.devOtp}`);
      } else if (data.message) {
        setInfo(data.message);
      }
      setStep('verify');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOtp() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to verify OTP');
      }

      setSuccess(true);

      // Redirect to chat/workflow interface after successful login.
      // If user came here with an intended destination, respect it.
      router.replace(returnUrl || defaultRedirect);

    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }


  if (!mounted) {
    return (
      <div className="min-h-screen bg-dark flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-dark via-slate-900 to-slate-800 flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md space-y-6">
        <div className="space-y-2 text-center">
          <h1 className="text-3xl font-bold text-white">OTP Login</h1>
          <p className="text-gray-300">Request a one-time code to continue.</p>
        </div>

        <div className="bg-slate-800 border border-slate-700 rounded-lg p-6 space-y-4">
          {info && (
            <div className="bg-blue-900/20 border border-blue-700 rounded-md p-3 text-blue-200 text-sm">
              {info}
            </div>
          )}
          {error && (
            <div className="bg-red-900/20 border border-red-700 rounded-md p-3 text-red-300 text-sm">
              {error}
            </div>
          )}

          {success ? (
            <div className="space-y-3 text-center">
              <CheckCircle2 className="w-12 h-12 text-green-400 mx-auto" />
              <div className="text-white font-semibold">Logged in</div>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-300">Email</label>
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="mt-1 w-full bg-slate-700 border border-slate-600 rounded-md px-3 py-2 text-sm text-white"
                  disabled={loading}
                />
              </div>

              {step === 'request' && (
                <button
                  onClick={handleRequestOtp}
                  disabled={loading || !email.trim()}
                  className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:opacity-50 text-white font-semibold py-3 px-4 rounded-md transition flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    <>
                      <Lock className="w-5 h-5" />
                      Request OTP
                    </>
                  )}
                </button>
              )}

              {step === 'verify' && (
                <>
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-300">OTP code</label>
                    <input
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      placeholder="123456"
                      className="mt-1 w-full bg-slate-700 border border-slate-600 rounded-md px-3 py-2 text-sm text-white"
                      disabled={loading}
                    />
                  </div>

                  <button
                    onClick={handleVerifyOtp}
                    disabled={loading || !email.trim() || !code.trim()}
                    className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:opacity-50 text-white font-semibold py-3 px-4 rounded-md transition flex items-center justify-center gap-2"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Verifying...
                      </>
                    ) : (
                      <>
                        <Lock className="w-5 h-5" />
                        Verify
                      </>
                    )}
                  </button>

                  <p className="text-xs text-gray-400">
                    In local dev without email configured, the API returns a dev OTP.
                  </p>
                </>
              )}

              <div className="pt-2 text-center">
                <div className="text-xs text-gray-400">
                  <AlertCircle className="inline w-4 h-4 mr-1" />
                  MVP login only (cookie-based). Replace with real OTP delivery when ready.
                </div>
              </div>
            </>
          )}
        </div>

        <div className="text-center text-xs text-gray-400">
          After login, open a workflow execute URL again.
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-dark flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}

