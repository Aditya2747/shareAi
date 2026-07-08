'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Sparkles, Copy, Check, AlertCircle, LogOut } from 'lucide-react';

interface CreateResult {
  workflowId: string;
  shareableUrl: string;
  action: string;
  apis: string[];
}

export default function Home() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateResult | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    async function checkAuth() {
      try {
        const res = await fetch('/api/auth/me');
        if (!res.ok) {
          router.replace('/login?returnUrl=' + encodeURIComponent('/'));
          return;
        }
      } catch {
        router.replace('/login');
        return;
      } finally {
        setAuthLoading(false);
      }
    }
    checkAuth();
  }, [router]);

  async function handleCreate() {
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const res = await fetch('/api/workflows/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to create workflow');
      }
      setResult(data as CreateResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  async function copyUrl() {
    if (!result) return;
    await navigator.clipboard.writeText(result.shareableUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!mounted || authLoading) {
    return (
      <div className="min-h-screen bg-dark flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-dark via-slate-900 to-slate-800 px-4 py-10">
      <div className="w-full max-w-2xl mx-auto space-y-8">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <h1 className="text-3xl font-bold text-white flex items-center gap-2">
              <Sparkles className="w-7 h-7 text-blue-400" />
              Actionable Links
            </h1>
            <p className="text-gray-300">
              Describe an action in plain language. Get a secure link anyone can run with their own apps.
            </p>
          </div>
          <button
            onClick={async () => {
              await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
              router.replace('/login');
            }}
            className="text-gray-400 hover:text-white text-sm flex items-center gap-1"
          >
            <LogOut className="w-4 h-4" />
            Log out
          </button>
        </div>

        <div className="bg-slate-800 border border-slate-700 rounded-lg p-6 space-y-4">
          <label className="text-sm font-medium text-gray-300">Your prompt</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. Send a Slack message to #general saying the deploy is done"
            rows={4}
            disabled={loading}
            className="w-full bg-slate-700 border border-slate-600 rounded-md px-3 py-2 text-sm text-white resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
          />

          {error && (
            <div className="bg-red-900/20 border border-red-700 rounded-md p-3 text-red-300 text-sm flex items-start gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          <button
            onClick={handleCreate}
            disabled={loading || prompt.trim().length < 10}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:opacity-50 text-white font-semibold py-3 px-4 rounded-md transition flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Generating link...
              </>
            ) : (
              <>
                <Sparkles className="w-5 h-5" />
                Create Actionable Link
              </>
            )}
          </button>
          <p className="text-xs text-gray-500">Minimum 10 characters. Supported apps: Slack, Google Calendar, Gmail.</p>
        </div>

        {result && (
          <div className="bg-slate-800 border border-green-700/50 rounded-lg p-6 space-y-4">
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-300">Detected action</label>
              <p className="text-white font-semibold">{result.action}</p>
              <div className="flex gap-2 flex-wrap pt-1">
                {result.apis.map((api) => (
                  <span key={api} className="text-xs bg-slate-700 text-gray-200 rounded px-2 py-1 capitalize">
                    {api.replace(/-/g, ' ')}
                  </span>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-300">Shareable link</label>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={result.shareableUrl}
                  className="flex-1 bg-slate-900 border border-slate-600 rounded-md px-3 py-2 text-sm text-blue-300 font-mono"
                />
                <button
                  onClick={copyUrl}
                  className="bg-slate-700 hover:bg-slate-600 text-white rounded-md px-4 flex items-center gap-1 text-sm"
                >
                  {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <p className="text-xs text-gray-500">
                Send this to whoever should run it. They&apos;ll review the action, connect their own apps, and execute.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
