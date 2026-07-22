'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, CheckCircle2, Loader2, AlertCircle } from 'lucide-react';

type RunStep = {
  id: string;
  step_index: number;
  action: string;
  status: string;
  human_summary?: string | null;
  output_json?: Record<string, unknown> | null;
  error?: string | null;
  executor_type?: string;
};

type RunArtifact = {
  id: string;
  step_id: string;
  kind: string;
  url_or_blob: string;
  metadata?: Record<string, unknown>;
};

function stepStatusClass(status: string): string {
  switch (status) {
    case 'success':
      return 'text-emerald-300';
    case 'failed':
    case 'blocked':
      return 'text-red-300';
    case 'running':
      return 'text-blue-300';
    default:
      return 'text-gray-400';
  }
}

function runStatusClass(status: string): string {
  switch (status) {
    case 'success':
      return 'text-emerald-300';
    case 'failed':
    case 'cancelled':
      return 'text-red-300';
    case 'running':
      return 'text-blue-300';
    case 'waiting_approval':
      return 'text-amber-300';
    default:
      return 'text-gray-400';
  }
}

export default function RunDetailPage() {
  const params = useParams();
  const router = useRouter();
  const runId = params.id as string;
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<{
    id: string;
    status: string;
    workflow_id?: string | null;
    created_at?: string;
  } | null>(null);
  const [steps, setSteps] = useState<RunStep[]>([]);
  const [artifacts, setArtifacts] = useState<RunArtifact[]>([]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    async function load() {
      try {
        const me = await fetch('/api/auth/me');
        if (!me.ok) {
          router.replace('/login?returnUrl=' + encodeURIComponent(`/runs/${runId}`));
          return;
        }

        const res = await fetch(`/api/runs/${runId}`);
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to load run');
        }
        const data = await res.json();
        setRun(data.run);
        setSteps(data.steps ?? []);
        setArtifacts(
          (data.artifacts ?? []).map((a: Record<string, unknown>) => {
            const { execution_steps: _join, ...rest } = a;
            return rest as RunArtifact;
          })
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load run');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [runId, router]);

  if (!mounted || loading) {
    return (
      <div className="min-h-screen bg-dark flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  if (error || !run) {
    return (
      <div className="min-h-screen bg-dark flex items-center justify-center px-4">
        <div className="bg-red-900/20 border border-red-700 rounded-lg p-8 max-w-md text-center space-y-4">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto" />
          <h2 className="text-xl font-semibold text-white">{error || 'Run not found'}</h2>
          <Link href="/runs" className="text-blue-400 text-sm hover:underline">
            Back to runs
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-dark via-slate-900 to-slate-800 px-4 py-10">
      <div className="w-full max-w-2xl mx-auto space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2 min-w-0">
            <h1 className="text-3xl font-bold text-white">Run detail</h1>
            <p className="text-xs text-gray-400 font-mono truncate">{run.id}</p>
            {run.workflow_id && (
              <p className="text-sm text-gray-300">
                Workflow{' '}
                <Link
                  href={`/execute/${run.workflow_id}`}
                  className="text-blue-400 hover:underline font-mono text-xs"
                >
                  {run.workflow_id}
                </Link>
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-2 shrink-0">
            <span className={`text-xs font-semibold uppercase ${runStatusClass(run.status)}`}>
              {run.status.replace(/_/g, ' ')}
            </span>
            <Link
              href="/runs"
              className="text-gray-400 hover:text-white text-sm flex items-center gap-1"
            >
              <ArrowLeft className="w-4 h-4" />
              Runs
            </Link>
          </div>
        </div>

        <div className="bg-slate-800 border border-slate-700 rounded-lg p-6 space-y-6">
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-gray-300">Step timeline</h3>
            {steps.length === 0 ? (
              <p className="text-sm text-gray-400">No steps</p>
            ) : (
              <ol className="space-y-2">
                {steps
                  .slice()
                  .sort((a, b) => a.step_index - b.step_index)
                  .map((step) => (
                    <li
                      key={step.id}
                      className="bg-slate-700/70 border border-slate-600/80 rounded-md p-3 space-y-1"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs text-gray-400">
                            Step {step.step_index + 1}
                            {step.executor_type ? ` · ${step.executor_type}` : ''}
                          </p>
                          <p className="text-white text-sm font-medium">
                            {step.human_summary || step.action}
                          </p>
                          <p className="text-xs text-gray-400 font-mono truncate">{step.action}</p>
                        </div>
                        <span
                          className={`shrink-0 text-xs font-semibold uppercase ${stepStatusClass(
                            step.status
                          )}`}
                        >
                          {step.status}
                        </span>
                      </div>
                      {step.error && <p className="text-xs text-red-300">{step.error}</p>}
                      {step.output_json && Object.keys(step.output_json).length > 0 && (
                        <pre className="mt-2 text-[11px] text-gray-300 bg-slate-900/60 border border-slate-700 rounded p-2 overflow-x-auto max-h-40">
                          {JSON.stringify(step.output_json, null, 2)}
                        </pre>
                      )}
                    </li>
                  ))}
              </ol>
            )}
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-medium text-gray-300">Artifacts</h3>
            {artifacts.length === 0 ? (
              <p className="text-sm text-gray-400">No artifacts</p>
            ) : (
              <div className="space-y-3">
                {artifacts.map((artifact) => {
                  const step = steps.find((s) => s.id === artifact.step_id);
                  return (
                    <div
                      key={artifact.id}
                      className="bg-slate-700/70 border border-slate-600/80 rounded-md p-3 space-y-2"
                    >
                      <p className="text-xs text-gray-400">
                        {artifact.kind}
                        {step ? ` · step ${step.step_index + 1} (${step.action})` : ''}
                      </p>
                      {artifact.kind === 'screenshot' && artifact.url_or_blob ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={artifact.url_or_blob}
                          alt={`Screenshot for ${step?.action ?? artifact.step_id}`}
                          className="w-full max-h-64 object-contain rounded border border-slate-600 bg-slate-900"
                        />
                      ) : null}
                      {(artifact.kind === 'log' || artifact.kind === 'json') && (
                        <pre className="text-[11px] text-gray-300 bg-slate-900/60 border border-slate-700 rounded p-2 overflow-x-auto max-h-48 whitespace-pre-wrap">
                          {artifact.url_or_blob}
                        </pre>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
