'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, History } from 'lucide-react';

type RunListItem = {
  id: string;
  workflowId: string | null;
  status: string;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  stepCount: number;
  summary: string;
};

function statusClass(status: string): string {
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

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function RunsPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunListItem[]>([]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    async function load() {
      try {
        const me = await fetch('/api/auth/me');
        if (!me.ok) {
          router.replace('/login?returnUrl=' + encodeURIComponent('/runs'));
          return;
        }

        const res = await fetch('/api/runs?limit=20');
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to load runs');
        }
        const data = (await res.json()) as { runs: RunListItem[] };
        setRuns(data.runs ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load runs');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [router]);

  if (!mounted || loading) {
    return (
      <div className="min-h-screen bg-dark flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-dark via-slate-900 to-slate-800 px-4 py-10">
      <div className="w-full max-w-3xl mx-auto space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <h1 className="text-3xl font-bold text-white flex items-center gap-2">
              <History className="w-7 h-7 text-blue-400" />
              Run history
            </h1>
            <p className="text-gray-300">Your recent workflow executions</p>
          </div>
          <Link
            href="/"
            className="text-gray-400 hover:text-white text-sm flex items-center gap-1"
          >
            <ArrowLeft className="w-4 h-4" />
            Home
          </Link>
        </div>

        {error && (
          <div className="bg-red-900/20 border border-red-700 rounded-md p-3 text-red-300 text-sm">
            {error}
          </div>
        )}

        <div className="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden">
          {runs.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">
              No runs yet. Create a workflow from the home page and execute it.
            </div>
          ) : (
            <ul className="divide-y divide-slate-700">
              {runs.map((run) => (
                <li key={run.id}>
                  <Link
                    href={`/runs/${run.id}`}
                    className="block px-4 py-4 hover:bg-slate-700/50 transition"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <p className="text-white text-sm font-medium truncate">
                          {run.summary || 'Untitled run'}
                        </p>
                        <p className="text-xs text-gray-500">
                          {formatWhen(run.createdAt)} · {run.stepCount} step
                          {run.stepCount === 1 ? '' : 's'}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 text-xs font-semibold uppercase ${statusClass(
                          run.status
                        )}`}
                      >
                        {run.status.replace(/_/g, ' ')}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
