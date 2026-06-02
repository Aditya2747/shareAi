'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { AlertCircle, CheckCircle2, Loader2, Lock } from 'lucide-react';

interface WorkflowMetadata {
  action: string;
  targetAPIs: string[];
  requiredScopes: Record<string, string[]>;
}

export default function ExecuteWorkflow() {
  const params = useParams();
  const id = params.id as string;
  const [metadata, setMetadata] = useState<WorkflowMetadata | null>(null);
  const [loading, setLoading] = useState(true);
  const [authorizing, setAuthorizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

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
      const response = await fetch(`/api/workflows/${id}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        const { error: apiError } = await response.json();
        throw new Error(apiError || 'Execution failed');
      }

      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setAuthorizing(false);
    }
  }

  if (loading) {
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
    return (
      <div className="min-h-screen bg-dark flex items-center justify-center px-4">
        <div className="bg-green-900/20 border border-green-700 rounded-lg p-8 max-w-md text-center space-y-4">
          <CheckCircle2 className="w-12 h-12 text-green-400 mx-auto" />
          <h2 className="text-xl font-semibold text-white">Workflow Executed Successfully</h2>
          <p className="text-gray-300">Your action has been completed and all required integrations have been executed.</p>
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

          {/* Error */}
          {error && (
            <div className="bg-red-900/20 border border-red-700 rounded-md p-3 text-red-300 text-sm">
              {error}
            </div>
          )}

          {/* CTA */}
          <button
            onClick={handleAuthorizeAndExecute}
            disabled={authorizing}
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
                Authorize & Execute
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
