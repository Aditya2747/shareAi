'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { AlertCircle, CheckCircle2, Loader2, Lock } from 'lucide-react';

type RiskLevel = 'low' | 'medium' | 'high';

interface PlanStep {
  stepIndex: number;
  executorType: string;
  action: string;
  args: Record<string, unknown>;
  riskLevel: RiskLevel;
  requiresApproval: boolean;
  requiredPermissions: string[];
  humanSummary: string;
}

interface WorkflowMetadata {
  action: string;
  targetAPIs: string[];
  requiredScopes: Record<string, string[]>;
  parameters?: Record<string, unknown>;
  steps?: PlanStep[];
  globalRiskSummary?: {
    highestRisk: RiskLevel;
    approvalRequiredSteps: number;
    notes: string[];
  } | null;
  blockedReasons?: string[];
}

interface PendingApproval {
  approvalId: string;
  stepId: string;
  stepIndex: number;
  action: string;
  executorType: string;
  riskLevel: string;
  requiresApproval: boolean;
  humanSummary: string;
  status: string;
  expiresAt: string | null;
}

type RunPhase = 'idle' | 'waiting_approval' | 'running' | 'success' | 'failed';

function riskBadgeClass(risk: string): string {
  switch (risk) {
    case 'low':
      return 'bg-emerald-900/40 text-emerald-300 border-emerald-700/60';
    case 'medium':
      return 'bg-amber-900/40 text-amber-300 border-amber-700/60';
    case 'high':
    default:
      return 'bg-red-900/40 text-red-300 border-red-700/60';
  }
}

function formatCountdown(expiresAt: string | null, nowMs: number): string | null {
  if (!expiresAt) return null;
  const ends = new Date(expiresAt).getTime();
  if (Number.isNaN(ends)) return null;
  const remaining = ends - nowMs;
  if (remaining <= 0) return 'Expired';
  const totalSec = Math.floor(remaining / 1000);
  const hours = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (hours > 0) return `${hours}h ${mins}m ${secs}s`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
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

  const [runId, setRunId] = useState<string | null>(null);
  const [runPhase, setRunPhase] = useState<RunPhase>('idle');
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  const [approvingStepId, setApprovingStepId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [runDetails, setRunDetails] = useState<{
    steps: Array<{
      id: string;
      step_index: number;
      action: string;
      status: string;
      human_summary?: string | null;
      output_json?: Record<string, unknown> | null;
      error?: string | null;
      executor_type?: string;
    }>;
    artifacts: Array<{
      id: string;
      step_id: string;
      kind: string;
      url_or_blob: string;
      metadata?: Record<string, unknown>;
    }>;
  } | null>(null);
  const [runDetailsLoading, setRunDetailsLoading] = useState(false);

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

  useEffect(() => {
    if (runPhase !== 'waiting_approval') return;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [runPhase]);

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

  useEffect(() => {
    if (identityStep !== 'ready') return;
    refreshConnections();
    if (typeof window !== 'undefined') {
      const sp = new URLSearchParams(window.location.search);
      const oauthError = sp.get('oauth_error');
      if (oauthError) setError(oauthError);
    }
  }, [identityStep]);

  const targetAPIs = metadata?.targetAPIs ?? [];
  const needsOAuth = targetAPIs.length > 0;
  const missingProviders =
    metadata && connectedProviders
      ? targetAPIs.filter((p) => !connectedProviders.includes(p))
      : [];

  const pollRun = useCallback(async (activeRunId: string) => {
    const res = await fetch(`/api/runs/${activeRunId}`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to load run status');
    }
    const details = await res.json();
    const status = details.run?.status as string;
    const steps = details.steps ?? [];
    const approvals = details.approvals ?? [];

    if (status === 'success') {
      const summary: Record<string, unknown> = {};
      for (const step of steps) {
        if (step.status !== 'success') continue;
        const [providerId] = String(step.action).split('.');
        if (providerId) summary[providerId] = step.output_json ?? {};
      }
      setExecutionResult(summary);
      setRunDetails({
        steps,
        artifacts: (details.artifacts ?? []).map(
          (a: Record<string, unknown>) => {
            const { execution_steps: _join, ...rest } = a;
            return rest as {
              id: string;
              step_id: string;
              kind: string;
              url_or_blob: string;
              metadata?: Record<string, unknown>;
            };
          }
        ),
      });
      setPendingApprovals([]);
      setRunPhase('success');
      setSuccess(true);
      return status;
    }

    if (status === 'failed' || status === 'cancelled') {
      const failed = steps.find(
        (s: { status: string }) => s.status === 'failed' || s.status === 'blocked'
      );
      setError(failed?.error || `Run ended with status "${status}"`);
      setPendingApprovals([]);
      setRunPhase('failed');
      return status;
    }

    if (status === 'waiting_approval') {
      const pendingRows = approvals.filter(
        (a: { status: string }) => a.status === 'pending'
      );
      const rebuilt: PendingApproval[] = pendingRows.map(
        (a: {
          id: string;
          step_id: string;
          status: string;
          expires_at?: string | null;
        }) => {
          const step = steps.find((s: { id: string }) => s.id === a.step_id);
          return {
            approvalId: a.id,
            stepId: a.step_id,
            stepIndex: step?.step_index ?? 0,
            action: step?.action ?? 'unknown',
            executorType: step?.executor_type ?? 'api',
            riskLevel: step?.risk_level ?? 'high',
            requiresApproval: Boolean(step?.requires_approval),
            humanSummary: step?.human_summary || step?.action || 'Pending step',
            status: a.status,
            expiresAt: a.expires_at ?? null,
          };
        }
      );
      setPendingApprovals(rebuilt);
      setRunPhase('waiting_approval');
      return status;
    }

    if (status === 'running' || status === 'pending') {
      setRunPhase('running');
      setPendingApprovals([]);
    }
    return status;
  }, []);

  useEffect(() => {
    if (!runId) return;
    if (runPhase !== 'waiting_approval' && runPhase !== 'running') return;

    let cancelled = false;
    const tick = async () => {
      try {
        if (cancelled) return;
        await pollRun(runId);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to poll run');
        }
      }
    };

    tick();
    const interval = setInterval(tick, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [runId, runPhase, pollRun]);

  // Load authenticated run details (steps + artifacts) after success.
  useEffect(() => {
    if (!(success || runPhase === 'success') || !runId) return;

    let cancelled = false;
    async function loadDetails() {
      setRunDetailsLoading(true);
      try {
        const res = await fetch(`/api/runs/${runId}`);
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to load run details');
        }
        const data = await res.json();
        if (cancelled) return;
        setRunDetails({
          steps: data.steps ?? [],
          artifacts: (data.artifacts ?? []).map(
            (a: Record<string, unknown>) => {
              const { execution_steps: _join, ...rest } = a;
              return rest as {
                id: string;
                step_id: string;
                kind: string;
                url_or_blob: string;
                metadata?: Record<string, unknown>;
              };
            }
          ),
        });
      } catch (e) {
        if (!cancelled) {
          console.warn('[execute] run details load failed:', e);
        }
      } finally {
        if (!cancelled) setRunDetailsLoading(false);
      }
    }

    loadDetails();
    return () => {
      cancelled = true;
    };
  }, [success, runPhase, runId]);

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
        status?: string;
        runId?: string | null;
        result?: Record<string, unknown> | null;
        pendingApprovals?: PendingApproval[];
        message?: string;
      };

      if (data.runId) setRunId(data.runId);

      if (data.status === 'waiting_approval') {
        setPendingApprovals(data.pendingApprovals ?? []);
        setRunPhase('waiting_approval');
        setInfo(data.message || 'Review and approve each step to continue.');
        return;
      }

      if (data.status === 'running' && data.runId) {
        setRunPhase('running');
        setInfo('Execution in progress…');
        return;
      }

      setExecutionResult(data.result ?? null);
      setRunPhase('success');
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setRunPhase('failed');
    } finally {
      setAuthorizing(false);
    }
  }

  async function handleApprovalDecision(stepId: string, approved: boolean) {
    if (!runId) return;
    setApprovingStepId(stepId);
    setError(null);
    try {
      const res = await fetch(`/api/runs/${runId}/approve-step`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stepId,
          approved,
          note: approved ? 'Approved by recipient' : 'Rejected by recipient',
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to update approval');
      }

      const result = (await res.json()) as { status: string };
      if (result.status === 'rejected') {
        setRunPhase('failed');
        setError('Step rejected — workflow stopped.');
        setPendingApprovals([]);
        return;
      }

      // Refresh run; may move to running/success/still waiting.
      const status = await pollRun(runId);
      if (status === 'running' || status === 'success') {
        setInfo(approved ? 'Approved. Continuing execution…' : null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Approval failed');
    } finally {
      setApprovingStepId(null);
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

  if (success || runPhase === 'success') {
    const gmailResult = executionResult?.['google-gmail'] as
      | { to?: string; subject?: string; messageId?: string }
      | undefined;
    const calendarResult = executionResult?.['google-calendar'] as
      | { summary?: string; start?: string; end?: string; timeZone?: string }
      | undefined;
    const steps = runDetails?.steps ?? [];
    const artifacts = runDetails?.artifacts ?? [];

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

    return (
      <div className="min-h-screen bg-gradient-to-br from-dark via-slate-900 to-slate-800 flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-2xl space-y-6">
          <div className="bg-green-900/20 border border-green-700 rounded-lg p-6 space-y-3 text-center">
            <CheckCircle2 className="w-12 h-12 text-green-400 mx-auto" />
            <h2 className="text-xl font-semibold text-white">Workflow Executed Successfully</h2>
            <p className="text-gray-300 text-sm">
              Your action has been completed. Review the step timeline and artifacts below.
            </p>
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

          <div className="bg-slate-800 border border-slate-700 rounded-lg p-6 space-y-6">
            {runDetailsLoading && (
              <div className="flex items-center gap-2 text-gray-400 text-sm">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading run details…
              </div>
            )}

            {/* Step timeline */}
            {steps.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-gray-300">Step timeline</h3>
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
                            <p className="text-xs text-gray-400 font-mono truncate">
                              {step.action}
                            </p>
                          </div>
                          <span
                            className={`shrink-0 text-xs font-semibold uppercase ${stepStatusClass(
                              step.status
                            )}`}
                          >
                            {step.status}
                          </span>
                        </div>
                        {step.error && (
                          <p className="text-xs text-red-300">{step.error}</p>
                        )}
                        {step.output_json &&
                          Object.keys(step.output_json).length > 0 && (
                            <pre className="mt-2 text-[11px] text-gray-300 bg-slate-900/60 border border-slate-700 rounded p-2 overflow-x-auto max-h-40">
                              {JSON.stringify(step.output_json, null, 2)}
                            </pre>
                          )}
                      </li>
                    ))}
                </ol>
              </div>
            )}

            {/* Artifacts */}
            {artifacts.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-gray-300">Artifacts</h3>
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
                          {step
                            ? ` · step ${step.step_index + 1} (${step.action})`
                            : ''}
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
              </div>
            )}

            {!runDetailsLoading && steps.length === 0 && artifacts.length === 0 && (
              <p className="text-sm text-gray-400">
                No step details available for this run.
              </p>
            )}

            {/* Aggregated output summary */}
            {executionResult && Object.keys(executionResult).length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-medium text-gray-300">Output summary</h3>
                <pre className="text-[11px] text-gray-300 bg-slate-900/60 border border-slate-700 rounded p-3 overflow-x-auto max-h-56">
                  {JSON.stringify(executionResult, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  const planSteps = Array.isArray(metadata.steps) ? metadata.steps : [];
  const blockedReasons = Array.isArray(metadata.blockedReasons) ? metadata.blockedReasons : [];
  const inApprovalFlow = runPhase === 'waiting_approval' || runPhase === 'running';

  return (
    <div className="min-h-screen bg-gradient-to-br from-dark via-slate-900 to-slate-800 flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-lg space-y-6">
        <div className="space-y-4">
          <h1 className="text-3xl font-bold text-white">
            {inApprovalFlow ? 'Approve Steps' : 'Review Workflow'}
          </h1>
          <p className="text-gray-300">
            {inApprovalFlow
              ? 'Approve or reject each risky step. Low-risk steps run automatically.'
              : 'Please review what this workflow will do before authorizing'}
          </p>
        </div>

        <div className="bg-slate-800 border border-slate-700 rounded-lg p-6 space-y-6">
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
            targetAPIs.includes('google-calendar') && (
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

          {/* Approval queue */}
          {runPhase === 'waiting_approval' && (
            <div className="space-y-3">
              <label className="text-sm font-medium text-gray-300">Pending approvals</label>
              {pendingApprovals.length === 0 ? (
                <p className="text-sm text-gray-400">Waiting for approval state…</p>
              ) : (
                <ul className="space-y-3">
                  {pendingApprovals.map((step) => {
                    const countdown = formatCountdown(step.expiresAt, nowMs);
                    return (
                      <li
                        key={step.stepId}
                        className="bg-slate-700/80 border border-slate-600 rounded-md p-3 space-y-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-xs text-gray-400">
                              Step {step.stepIndex + 1} · {step.executorType}
                            </p>
                            <p className="text-white text-sm font-medium mt-0.5">
                              {step.humanSummary}
                            </p>
                            <p className="text-xs text-gray-400 font-mono truncate mt-1">
                              {step.action}
                            </p>
                          </div>
                          <span
                            className={`shrink-0 text-[10px] uppercase tracking-wide px-2 py-0.5 rounded border ${riskBadgeClass(
                              step.riskLevel
                            )}`}
                          >
                            {step.riskLevel}
                          </span>
                        </div>
                        {countdown && (
                          <p
                            className={`text-xs ${
                              countdown === 'Expired' ? 'text-red-300' : 'text-amber-300'
                            }`}
                          >
                            {countdown === 'Expired'
                              ? 'Approval expired'
                              : `Expires in ${countdown}`}
                          </p>
                        )}
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => handleApprovalDecision(step.stepId, true)}
                            disabled={approvingStepId !== null}
                            className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-600 disabled:opacity-50 text-white text-sm font-semibold py-2 px-3 rounded-md transition flex items-center justify-center gap-2"
                          >
                            {approvingStepId === step.stepId ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : null}
                            Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => handleApprovalDecision(step.stepId, false)}
                            disabled={approvingStepId !== null}
                            className="flex-1 bg-red-700/80 hover:bg-red-700 disabled:bg-gray-600 disabled:opacity-50 text-white text-sm font-semibold py-2 px-3 rounded-md transition"
                          >
                            Reject
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          {runPhase === 'running' && (
            <div className="flex items-center gap-2 text-blue-200 text-sm bg-blue-900/20 border border-blue-700 rounded-md p-3">
              <Loader2 className="w-4 h-4 animate-spin" />
              Running approved steps…
            </div>
          )}

          {/* Execution plan preview (pre-execute) */}
          {!inApprovalFlow && planSteps.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <label className="text-sm font-medium text-gray-300">Execution plan</label>
                {metadata.globalRiskSummary && (
                  <span
                    className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded border ${riskBadgeClass(
                      metadata.globalRiskSummary.highestRisk
                    )}`}
                  >
                    {metadata.globalRiskSummary.highestRisk} risk
                  </span>
                )}
              </div>
              <ol className="space-y-2">
                {planSteps
                  .slice()
                  .sort((a, b) => a.stepIndex - b.stepIndex)
                  .map((step) => (
                    <li
                      key={`${step.stepIndex}-${step.action}`}
                      className="bg-slate-700/80 border border-slate-600/80 rounded-md p-3 space-y-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs text-gray-400">
                            Step {step.stepIndex + 1} · {step.executorType}
                          </p>
                          <p className="text-white text-sm font-medium mt-0.5">
                            {step.humanSummary || step.action}
                          </p>
                        </div>
                        <span
                          className={`shrink-0 text-[10px] uppercase tracking-wide px-2 py-0.5 rounded border ${riskBadgeClass(
                            step.riskLevel
                          )}`}
                        >
                          {step.riskLevel}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 font-mono truncate">{step.action}</p>
                      {step.requiredPermissions?.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {step.requiredPermissions.map((perm) => (
                            <span
                              key={perm}
                              className="text-[10px] bg-slate-800 text-gray-300 border border-slate-600 rounded px-1.5 py-0.5"
                            >
                              {perm}
                            </span>
                          ))}
                        </div>
                      )}
                      {step.requiresApproval && (
                        <p className="text-[11px] text-amber-300/90">Requires approval</p>
                      )}
                    </li>
                  ))}
              </ol>
            </div>
          )}

          {!inApprovalFlow && blockedReasons.length > 0 && (
            <div className="bg-amber-900/20 border border-amber-700/70 rounded-md p-3 space-y-1">
              <p className="text-sm font-medium text-amber-200">Limitations</p>
              {blockedReasons.map((reason) => (
                <p key={reason} className="text-xs text-amber-100/90">
                  {reason}
                </p>
              ))}
            </div>
          )}

          {!inApprovalFlow && needsOAuth && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-300">Required Integrations</label>
              <div className="space-y-2">
                {targetAPIs.map((api) => (
                  <div key={api} className="flex items-start gap-2 bg-slate-700 rounded-md p-3">
                    <Lock className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-white font-medium capitalize">{api.replace(/-/g, ' ')}</p>
                      <p className="text-xs text-gray-400 mt-1">
                        {metadata.requiredScopes?.[api]?.join(', ') || 'Standard access'}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

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

          {!inApprovalFlow && identityStep !== 'ready' && (
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
                </div>
              )}
            </div>
          )}

          {!inApprovalFlow && identityStep === 'ready' && (
            <div className="space-y-3">
              {needsOAuth &&
                (connectedProviders === null ? (
                  <div className="flex items-center gap-2 text-gray-400 text-sm">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Checking your connected apps...
                  </div>
                ) : (
                  <div className="space-y-2">
                    {targetAPIs.map((api) => {
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
                ))}

              <button
                onClick={handleAuthorizeAndExecute}
                disabled={
                  authorizing ||
                  !recipientUserId ||
                  (needsOAuth && (connectedProviders === null || missingProviders.length > 0))
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
                    {needsOAuth && missingProviders.length > 0
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
