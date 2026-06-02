'use client';

import { useState } from 'react';
import { Zap, Share2, Lock, Loader2 } from 'lucide-react';

export default function Home() {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerateWorkflow() {
    setError(null);
    setGeneratedUrl(null);
    setLoading(true);

    try {
      const response = await fetch('/api/workflows/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });

      if (!response.ok) {
        const { error: apiError } = await response.json();
        throw new Error(apiError || 'Failed to generate workflow');
      }

      const { shareableUrl } = await response.json();
      setGeneratedUrl(shareableUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-dark via-slate-900 to-slate-800 flex flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-2xl space-y-8">
        {/* Header */}
        <div className="text-center space-y-4">
          <div className="flex items-center justify-center gap-2">
            <Zap className="w-8 h-8 text-blue-500" />
            <h1 className="text-4xl font-bold text-white">Actionable Links</h1>
          </div>
          <p className="text-gray-300 text-lg">
            Convert your ideas into secure, shareable workflows in seconds
          </p>
        </div>

        {/* Input Card */}
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-6 space-y-4">
          <label className="block text-sm font-medium text-gray-300">
            What workflow do you want to create?
          </label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g., Schedule a call with my team and send a Slack alert when it's confirmed..."
            className="w-full h-24 bg-slate-700 border border-slate-600 rounded-md px-4 py-3 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            disabled={loading}
          />
          <button
            onClick={handleGenerateWorkflow}
            disabled={!prompt.trim() || loading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:opacity-50 text-white font-semibold py-3 px-4 rounded-md transition flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Zap className="w-5 h-5" />
                Generate Workflow
              </>
            )}
          </button>
        </div>

        {/* Error State */}
        {error && (
          <div className="bg-red-900/20 border border-red-700 rounded-lg p-4 text-red-300 text-sm">
            {error}
          </div>
        )}

        {/* Success State */}
        {generatedUrl && (
          <div className="bg-green-900/20 border border-green-700 rounded-lg p-6 space-y-4">
            <div className="flex items-start gap-3">
              <Lock className="w-5 h-5 text-green-400 flex-shrink-0 mt-1" />
              <div className="flex-1 space-y-2">
                <p className="font-semibold text-green-300">Workflow Created Successfully</p>
                <p className="text-sm text-green-200/80">
                  Your secure workflow URL is ready to share. Recipients will see what they're executing before authorizing.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={generatedUrl}
                readOnly
                className="flex-1 bg-slate-700 border border-slate-600 rounded-md px-3 py-2 text-sm text-white font-mono"
              />
              <button
                onClick={() => {
                  navigator.clipboard.writeText(generatedUrl);
                }}
                className="bg-green-700 hover:bg-green-600 text-white px-4 py-2 rounded-md flex items-center gap-2 text-sm font-medium"
              >
                <Share2 className="w-4 h-4" />
                Copy
              </button>
            </div>
          </div>
        )}

        {/* Features */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-8">
          <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 space-y-2">
            <Lock className="w-6 h-6 text-blue-400" />
            <h3 className="font-semibold text-white">Encrypted URLs</h3>
            <p className="text-sm text-gray-400">Workflows are encrypted and tamper-proof</p>
          </div>
          <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 space-y-2">
            <Zap className="w-6 h-6 text-yellow-400" />
            <h3 className="font-semibold text-white">AI-Powered</h3>
            <p className="text-sm text-gray-400">Understands intent from natural language</p>
          </div>
          <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 space-y-2">
            <Share2 className="w-6 h-6 text-green-400" />
            <h3 className="font-semibold text-white">Shareable</h3>
            <p className="text-sm text-gray-400">One click execution for recipients</p>
          </div>
        </div>
      </div>
    </div>
  );
}
