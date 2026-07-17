'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { AlertCircle, CheckCircle2, Loader2, Lock } from 'lucide-react';


interface WorkflowMetadata {
  action: string;
  targetAPIs: string[];
  requiredScopes: Record<string, string[]>;
  parameters?: Record<string, unknown>;
}

export default function ExecuteWorkflow() {
  const params = useParams();
  const id = params.id as string;
  const [mounted, setMounted] = useState(false);
  const [metadata, setMetadata] = useState<WorkflowMetadata | null>(null);
  const [loading, setLoading] = useState(true);
  const [authorizing, setAuthorizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [executionResult, setExecutionResult] = useState<Record<string, unknown> | null>(null);

  // Auth state (cookie-based OTP login)
  const [authLoading, setAuthLoading] = useState(true);
  const [recipientUserId, setRecipientUserId] = useState<string | null>(null);


  const [identityStep, setIdentityStep] = useState<'identity' | 'verify' | 'ready'>('identity');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');

  // OAuth connection state: which providers the recipient has connected.
  const [connectedProviders, setConnectedProviders] = useState<string[] | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Fetch which providers the logged-in recipient has connected.
  async function refreshConnections() {
    try {
      const res = await fetch('/api/oauth/connections');
      if (res.ok) {
        const data = (await res.json()) as { connected: string[] };
        setConnectedProviders(data.connected);
      } else {
        setConnectedProviders([]);
      }
    } catch {
      setConnectedProviders([]);
    }
  }

  // Once logged in, load connections. Surface any OAuth callback error.
  useEffect(() => {
    if (identityStep !== 'ready') return;
    refreshConnections();
    if (typeof window !== 'undefined') {
      const sp = new URLSearchParams(window.location.search);
      const oauthError = sp.get('oauth_error');
      if (oauthError) setError(oauthError);
    }
  }, [identityStep]);

  const missingProviders =
    metadata && connectedProviders
      ? metadata.targetAPIs.filter((p) => !connectedProviders.includes(p))
      : [];



  useEffect(() => {
    async function checkAuth() {
      setAuthLoading(true);
      try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
          const data = (await res.json()) as { userId: string };
          setRecipientUserId(data.userId);
          setIdentityStep('ready');
          return;
        }

        // Not authenticated: send user to login but preserve where they were headed.
        // `window.location.pathname` gives `/execute/<id>` on the client.
        if (typeof window !== 'undefined') {
          const returnUrl = window.location.pathname;
          window.location.href = `/login?returnUrl=${encodeURIComponent(returnUrl)}`;
          return;
        }

        setIdentityStep('identity');

      } catch {
        setIdentityStep('identity');
      } finally {
        setAuthLoading(false);
      }
    }

    checkAuth();
  }, []);

  useEffect(() => {
    async function fetchWorkflowMetadata() {

      try {
        const response = await fetch(`/api/workflows/${id}/metadata`);
        if (!response.ok) {
          throw new Error('Workflow not found or expired');
        }
        const data = await response.json();
        setMetadata(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load workflow');
      } finally {
        setLoading(false);
      }
    }

    fetchWorkflowMetadata();
  }, [id]);

  async function handleAuthorizeAndExecute() {
    setAuthorizing(true);
    setError(null);

    try {
      if (!recipientUserId) {
        throw new Error('Recipient identity not verified yet.');
      }

      const response = await fetch(`/api/workflows/${id}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });


      if (!response.ok) {
        const { error: apiError } = await response.json();
        throw new Error(apiError || 'Execution failed');
      }

      const data = (await response.json()) as {
        result?: Record<string, unknown> | null;
      };
      setExecutionResult(data.result ?? null);
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setAuthorizing(false);
    }
  }

  if (!mounted || loading || authLoading) {
    return (
      <div className="min-h-screen bg-dark flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }


  if (error && !metadata) {
    return (
      <div className="min-h-screen bg-dark flex items-center justify-center px-4">
        <div className="bg-red-900/20 border border-red-700 rounded-lg p-8 max-w-md text-center space-y-4">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto" />
          <h2 className="text-xl font-semibold text-white">{error}</h2>
        </div>
      </div>
    );
  }

  if (!metadata) return null;

  if (success) {
    const gmailResult = executionResult?.['google-gmail'] as
      | { to?: string; subject?: string; messageId?: string }
      | undefined;
    const calendarResult = executionResult?.['google-calendar'] as
      | { summary?: string; start?: string; end?: string; timeZone?: string }
      | undefined;
    return (
      <div className="min-h-screen bg-dark flex items-center justify-center px-4">
        <div className="bg-green-900/20 border border-green-700 rounded-lg p-8 max-w-md text-center space-y-4">
          <CheckCircle2 className="w-12 h-12 text-green-400 mx-auto" />
          <h2 className="text-xl font-semibold text-white">Workflow Executed Successfully</h2>
          <p className="text-gray-300">Your action has been completed and all required integrations have been executed.</p>
          {gmailResult?.to && (
            <p className="text-sm text-gray-400">
              Gmail sent to <span className="text-white">{gmailResult.to}</span>
              {gmailResult.subject ? ` · ${gmailResult.subject}` : ''}
            </p>
          )}
          {calendarResult?.summary && (
            <p className="text-sm text-gray-400">
              Calendar: <span className="text-white">{calendarResult.summary}</span>
              {calendarResult.start
                ? ` · ${calendarResult.start}${calendarResult.end ? ` → ${calendarResult.end}` : ''}`
                : ''}
              {calendarResult.timeZone ? ` (${calendarResult.timeZone})` : ''}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-dark via-slate-900 to-slate-800 flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md space-y-6">
        <div className="space-y-4">
          <h1 className="text-3xl font-bold text-white">Review Workflow</h1>
          <p className="text-gray-300">Please review what this workflow will do before authorizing</p>
        </div>

        <div className="bg-slate-800 border border-slate-700 rounded-lg p-6 space-y-6">
          {/* Action */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-300">Action</label>
            <p className="text-white font-semibold text-lg">{metadata.action}</p>
          </div>

          {typeof metadata.parameters?.to === 'string' && metadata.parameters.to && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-300">Email recipient</label>
              <p className="text-white">{metadata.parameters.to}</p>
            </div>
          )}

          {typeof metadata.parameters?.title === 'string' &&
            metadata.targetAPIs.includes('google-calendar') && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-300">Calendar event</label>
                <p className="text-white">{String(metadata.parameters.title)}</p>
                {typeof metadata.parameters.start_time === 'string' && (
                  <p className="text-sm text-gray-400">
                    {String(metadata.parameters.start_time)}
                    {typeof metadata.parameters.end_time === 'string'
                      ? ` → ${String(metadata.parameters.end_time)}`
                      : ''}
                    {typeof metadata.parameters.timeZone === 'string'
                      ? ` (${String(metadata.parameters.timeZone)})`
                      : ''}
                  </p>
                )}
              </div>
            )}

          {/* APIs */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-300">Required Integrations</label>
            <div className="space-y-2">
              {metadata.targetAPIs.map((api) => (
                <div key={api} className="flex items-start gap-2 bg-slate-700 rounded-md p-3">
                  <Lock className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-white font-medium capitalize">{api.replace(/-/g, ' ')}</p>
                    <p className="text-xs text-gray-400 mt-1">
                      {metadata.requiredScopes[api]?.join(', ') || 'Standard access'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Status */}
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

          {/* Identity + CTA */}
          {identityStep !== 'ready' && (
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-300">Your email</label>
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="mt-1 w-full bg-slate-700 border border-slate-600 rounded-md px-3 py-2 text-sm text-white"
                  disabled={authorizing}
                />
              </div>

              {identityStep === 'identity' && (
                <button
                  onClick={async () => {
                    setError(null);
                    setInfo(null);
                    setAuthorizing(true);
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
                      const data = (await res.json()) as {
                        devOtp?: string;
                        message?: string;
                      };
                      if (data.devOtp) {
                        setInfo(`Dev OTP: ${data.devOtp}`);
                      } else if (data.message) {
                        setInfo(data.message);
                      }
                      setIdentityStep('verify');

                    } catch (e) {
                      setError(e instanceof Error ? e.message : 'Unknown error');
                    } finally {
                      setAuthorizing(false);
                    }
                  }}
                  disabled={authorizing || !email.trim()}
                  className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:opacity-50 text-white font-semibold py-3 px-4 rounded-md transition flex items-center justify-center gap-2"
                >
                  {authorizing ? (
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

              {identityStep === 'verify' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-300">OTP code</label>
                    <input
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      placeholder="123456"
                      className="mt-1 w-full bg-slate-700 border border-slate-600 rounded-md px-3 py-2 text-sm text-white"
                      disabled={authorizing}
                    />
                  </div>

                  <button
                    onClick={async () => {
                      setError(null);
                      setAuthorizing(true);
                      try {
                        // OTP verification sets server-side session cookie.
                        const res = await fetch('/api/auth/otp/verify', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ email, code }),
                        });
                        if (!res.ok) {
                          const data = await res.json().catch(() => ({}));
                          throw new Error(data.error || 'Failed to verify OTP');
                        }
                        const data = (await res.json()) as { userId: string };
                        setRecipientUserId(data.userId);
                        setIdentityStep('ready');
                      } catch (e) {

                        setError(e instanceof Error ? e.message : 'Unknown error');
                      } finally {
                        setAuthorizing(false);
                      }
                    }}
                    disabled={authorizing || !email.trim() || !code.trim()}
                    className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:opacity-50 text-white font-semibold py-3 px-4 rounded-md transition flex items-center justify-center gap-2"
                  >
                  {authorizing ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Verifying...
                    </>
                  ) : (
                    <>
                      <Lock className="w-5 h-5" />
                      Verify & Continue
                    </>
                  )}
                </button>

                <p className="text-xs text-gray-400">
                  In local dev without email configured, request response shows a dev OTP.
                </p>
                </div>
              )}
            </div>
          )}

          {identityStep === 'ready' && (
            <div className="space-y-3">
              {/* Connection status: recipient must connect each required app. */}
              {connectedProviders === null ? (
                <div className="flex items-center gap-2 text-gray-400 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Checking your connected apps...
                </div>
              ) : (
                <div className="space-y-2">
                  {metadata.targetAPIs.map((api) => {
                    const isConnected = connectedProviders.includes(api);
                    return (
                      <div
                        key={api}
                        className="flex items-center justify-between bg-slate-700 rounded-md p-3"
                      >
                        <span className="text-white text-sm font-medium capitalize">
                          {api.replace(/-/g, ' ')}
                        </span>
                        {isConnected ? (
                          <span className="text-green-400 text-xs flex items-center gap-1">
                            <CheckCircle2 className="w-4 h-4" />
                            Connected
                          </span>
                        ) : (
                          <a
                            href={`/api/oauth/${api}/start?returnTo=${encodeURIComponent(
                              `/execute/${id}`
                            )}`}
                            className="text-xs bg-blue-600 hover:bg-blue-700 text-white rounded px-3 py-1.5"
                          >
                            Connect
                          </a>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <button
                onClick={handleAuthorizeAndExecute}
                disabled={
                  authorizing ||
                  !recipientUserId ||
                  connectedProviders === null ||
                  missingProviders.length > 0
                }
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:opacity-50 text-white font-semibold py-3 px-4 rounded-md transition flex items-center justify-center gap-2"
              >
                {authorizing ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Authorizing...
                  </>
                ) : (
                  <>
                    <Lock className="w-5 h-5" />
                    {missingProviders.length > 0
                      ? `Connect ${missingProviders.length} app${missingProviders.length > 1 ? 's' : ''} to continue`
                      : 'Authorize & Execute'}
                  </>
                )}
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
