import crypto from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';
import { ExecutionPlan, ExecutionPlanStep } from './types';
import { getExecutor } from './executors';
import { cleanupBrowserSession } from './executors/browser';
import { validateStepPolicy } from './policy';
import { buildExecutionPlanFromWorkflowPayload } from './planner';
import { computeStepHash, verifyApprovedStepHash } from './step-hash';

const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

function nowIso(): string {
  return new Date().toISOString();
}

const STEP_TIMEOUT_MS = Number(process.env.V2_STEP_TIMEOUT_MS || 30_000);
const STEP_MAX_RETRIES = Number(process.env.V2_STEP_MAX_RETRIES || 1);
const RUN_RATE_LIMIT_WINDOW_SECONDS = Number(
  process.env.V2_RUN_RATE_LIMIT_WINDOW_SECONDS || 60
);
const RUN_RATE_LIMIT_MAX = Number(process.env.V2_RUN_RATE_LIMIT_MAX || 20);

export async function createPlanRecord(input: {
  userId: string;
  prompt: string;
  plan: ExecutionPlan;
  workflowId?: string | null;
}): Promise<string> {
  const planId = `plan_${crypto.randomUUID()}`;
  const { error } = await supabaseAdmin.from('automation_plans').insert([
    {
      id: planId,
      workflow_id: input.workflowId ?? null,
      created_by: input.userId,
      source_prompt: input.prompt,
      plan_json: input.plan as unknown as Record<string, unknown>,
      risk_summary: input.plan.globalRiskSummary as unknown as Record<string, unknown>,
      status: 'draft',
    },
  ]);

  if (error) throw new Error(`Failed to create plan: ${error.message}`);
  return planId;
}

export async function findLatestPlanForWorkflow(workflowId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('automation_plans')
    .select('id')
    .eq('workflow_id', workflowId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Failed to lookup workflow plan: ${error.message}`);
  return data?.id ?? null;
}

export async function findOrCreatePlanForWorkflow(input: {
  workflowId: string;
  prompt: string;
  createdBy: string;
  payload: {
    action: string;
    targetAPIs: string[];
    requiredScopes?: Record<string, string[]>;
    parameters?: Record<string, unknown>;
  };
}): Promise<string> {
  const existing = await findLatestPlanForWorkflow(input.workflowId);
  if (existing) return existing;

  const plan = buildExecutionPlanFromWorkflowPayload(input.payload);
  return createPlanRecord({
    userId: input.createdBy,
    prompt: input.prompt,
    plan,
    workflowId: input.workflowId,
  });
}

async function createRunSteps(runId: string, steps: ExecutionPlanStep[]): Promise<string[]> {
  if (steps.length === 0) return [];
  const records = steps.map((step) => ({
    id: `step_${crypto.randomUUID()}`,
    run_id: runId,
    step_index: step.stepIndex,
    executor_type: step.executorType,
    action: step.action,
    args_json: {
      ...(step.args as Record<string, unknown>),
      __requiredPermissions: step.requiredPermissions ?? [],
    },
    risk_level: step.riskLevel,
    requires_approval: step.requiresApproval,
    status: 'pending',
  }));
  const { error } = await supabaseAdmin.from('execution_steps').insert(records);
  if (error) throw new Error(`Failed to create run steps: ${error.message}`);
  return records.map((r) => r.id);
}

async function createApprovalRequests(runId: string): Promise<number> {
  const { data: steps, error: stepErr } = await supabaseAdmin
    .from('execution_steps')
    .select('id, requires_approval')
    .eq('run_id', runId)
    .eq('requires_approval', true);
  if (stepErr) throw new Error(`Failed to load steps for approval creation: ${stepErr.message}`);
  if (!steps || steps.length === 0) return 0;

  const records = steps.map((s) => ({
    id: `apr_${crypto.randomUUID()}`,
    run_id: runId,
    step_id: s.id,
    status: 'pending',
  }));
  const { error } = await supabaseAdmin.from('approval_requests').insert(records);
  if (error) throw new Error(`Failed to create approval requests: ${error.message}`);
  return records.length;
}

export async function startRun(input: {
  userId: string;
  planId: string;
}): Promise<{ runId: string; status: string }> {
  const windowStartIso = new Date(
    Date.now() - RUN_RATE_LIMIT_WINDOW_SECONDS * 1000
  ).toISOString();
  const { count, error: rateErr } = await supabaseAdmin
    .from('execution_runs')
    .select('id', { count: 'exact', head: true })
    .eq('executed_by', input.userId)
    .gte('created_at', windowStartIso);
  if (rateErr) {
    throw new Error(`Failed to check run rate limit: ${rateErr.message}`);
  }
  if ((count ?? 0) >= RUN_RATE_LIMIT_MAX) {
    throw new Error(
      `Run rate limit exceeded. Max ${RUN_RATE_LIMIT_MAX} runs per ${RUN_RATE_LIMIT_WINDOW_SECONDS}s`
    );
  }

  const { data: plan, error: planErr } = await supabaseAdmin
    .from('automation_plans')
    .select('id, created_by, workflow_id, plan_json')
    .eq('id', input.planId)
    .single();
  if (planErr || !plan) throw new Error('Plan not found');

  // For workflow-linked plans, recipients can execute shared links.
  const canExecute =
    plan.created_by === input.userId || Boolean(plan.workflow_id);
  if (!canExecute) {
    throw new Error('You can only execute plans created by your account');
  }

  const runId = `run_${crypto.randomUUID()}`;
  const planJson = plan.plan_json as ExecutionPlan;
  const steps = Array.isArray(planJson?.steps) ? planJson.steps : [];

  const { error: runErr } = await supabaseAdmin.from('execution_runs').insert([
    {
      id: runId,
      plan_id: plan.id,
      workflow_id: plan.workflow_id,
      executed_by: input.userId,
      status: 'pending',
    },
  ]);
  if (runErr) throw new Error(`Failed to create run: ${runErr.message}`);

  await createRunSteps(runId, steps);
  const approvalCount = await createApprovalRequests(runId);
  const initialStatus = approvalCount > 0 ? 'waiting_approval' : 'running';

  await supabaseAdmin
    .from('execution_runs')
    .update({ status: initialStatus, started_at: nowIso() })
    .eq('id', runId);

  if (initialStatus === 'running') {
    await executeRunSteps(runId, input.userId);
    const { data: refreshed } = await supabaseAdmin
      .from('execution_runs')
      .select('status')
      .eq('id', runId)
      .single();
    return { runId, status: refreshed?.status ?? 'running' };
  }

  return { runId, status: initialStatus };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Step timed out after ${timeoutMs}ms`)),
      timeoutMs
    );
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

async function insertArtifacts(
  stepId: string,
  artifacts: Array<{
    kind: 'screenshot' | 'log' | 'json';
    content: string;
    metadata?: Record<string, unknown>;
  }>
) {
  if (!artifacts || artifacts.length === 0) return;
  const rows = artifacts.map((a) => ({
    id: `art_${crypto.randomUUID()}`,
    step_id: stepId,
    kind: a.kind,
    url_or_blob: a.content,
    metadata: a.metadata ?? {},
  }));
  await supabaseAdmin.from('execution_artifacts').insert(rows);
}

export async function executeRunSteps(runId: string, userId: string): Promise<void> {
  const { data: run, error: runErr } = await supabaseAdmin
    .from('execution_runs')
    .select('id, status')
    .eq('id', runId)
    .single();
  if (runErr || !run) throw new Error('Run not found');
  if (run.status === 'cancelled') return;

  try {
    const { data: pendingApprovals, error: approvalErr } = await supabaseAdmin
      .from('approval_requests')
      .select('id')
      .eq('run_id', runId)
      .eq('status', 'pending');
    if (approvalErr) throw new Error(`Failed to check approvals: ${approvalErr.message}`);
    if (pendingApprovals && pendingApprovals.length > 0) {
      await supabaseAdmin
        .from('execution_runs')
        .update({ status: 'waiting_approval' })
        .eq('id', runId);
      return;
    }

    await supabaseAdmin
      .from('execution_runs')
      .update({ status: 'running', started_at: nowIso() })
      .eq('id', runId);

    const { data: steps, error: stepErr } = await supabaseAdmin
      .from('execution_steps')
      .select(
        'id, step_index, executor_type, action, args_json, status, requires_approval'
      )
      .eq('run_id', runId)
      .order('step_index', { ascending: true });
    if (stepErr) throw new Error(`Failed to load steps: ${stepErr.message}`);

    for (const step of steps ?? []) {
      if (step.status !== 'pending') continue;

      await supabaseAdmin
        .from('execution_steps')
        .update({
          status: 'running',
          started_at: nowIso(),
        })
        .eq('id', step.id);

      if (step.requires_approval) {
        const { data: approval, error: stepApprovalErr } = await supabaseAdmin
          .from('approval_requests')
          .select('id, status, approved_step_hash, expires_at')
          .eq('run_id', runId)
          .eq('step_id', step.id)
          .eq('status', 'approved')
          .maybeSingle();
        if (stepApprovalErr) {
          throw new Error(
            `Failed to load approval for step: ${stepApprovalErr.message}`
          );
        }
        if (!approval) {
          const reason = 'Approval required before execution';
          await supabaseAdmin
            .from('execution_steps')
            .update({
              status: 'blocked',
              error: reason,
              ended_at: nowIso(),
            })
            .eq('id', step.id);
          await supabaseAdmin
            .from('execution_runs')
            .update({ status: 'failed', ended_at: nowIso() })
            .eq('id', runId);
          await insertArtifacts(step.id, [
            {
              kind: 'log',
              content: reason,
              metadata: { source: 'executeRunSteps', reason: 'missing_approval' },
            },
          ]);
          return;
        }
        if (approval.expires_at && new Date(approval.expires_at).getTime() < Date.now()) {
          const reason = 'Approval has expired';
          await supabaseAdmin
            .from('execution_steps')
            .update({
              status: 'blocked',
              error: reason,
              ended_at: nowIso(),
            })
            .eq('id', step.id);
          await supabaseAdmin
            .from('execution_runs')
            .update({ status: 'failed', ended_at: nowIso() })
            .eq('id', runId);
          await insertArtifacts(step.id, [
            {
              kind: 'log',
              content: reason,
              metadata: { source: 'executeRunSteps', reason: 'approval_expired' },
            },
          ]);
          return;
        }

        const hashCheck = verifyApprovedStepHash(
          {
            executor_type: step.executor_type,
            action: step.action,
            args_json: step.args_json,
          },
          approval.approved_step_hash
        );
        if (!hashCheck.ok) {
          await supabaseAdmin
            .from('execution_steps')
            .update({
              status: 'blocked',
              error: hashCheck.reason,
              ended_at: nowIso(),
            })
            .eq('id', step.id);
          await supabaseAdmin
            .from('execution_runs')
            .update({ status: 'failed', ended_at: nowIso() })
            .eq('id', runId);
          await insertArtifacts(step.id, [
            {
              kind: 'log',
              content: hashCheck.reason,
              metadata: {
                source: 'executeRunSteps',
                reason: 'step_hash_mismatch',
                approved_step_hash: approval.approved_step_hash,
                current_step_hash: hashCheck.currentHash,
              },
            },
          ]);
          return;
        }
      }

      const policy = await validateStepPolicy(step);
      if (!policy.ok) {
        await supabaseAdmin
          .from('execution_steps')
          .update({
            status: 'blocked',
            error: policy.reason || 'Blocked by policy',
            ended_at: nowIso(),
          })
          .eq('id', step.id);
        await supabaseAdmin
          .from('execution_runs')
          .update({ status: 'failed', ended_at: nowIso() })
          .eq('id', runId);
        return;
      }

      const executor = getExecutor(step.executor_type);
      if (!executor) {
        await supabaseAdmin
          .from('execution_steps')
          .update({
            status: 'blocked',
            error: `No executor registered for ${step.executor_type}`,
            ended_at: nowIso(),
          })
          .eq('id', step.id);
        await supabaseAdmin
          .from('execution_runs')
          .update({ status: 'failed', ended_at: nowIso() })
          .eq('id', runId);
        return;
      }

      const validation = await executor.validate(step, { userId, runId, stepId: step.id });
      if (!validation.ok) {
        await supabaseAdmin
          .from('execution_steps')
          .update({
            status: 'blocked',
            error: validation.reason || 'Executor validation failed',
            ended_at: nowIso(),
          })
          .eq('id', step.id);
        await supabaseAdmin
          .from('execution_runs')
          .update({ status: 'failed', ended_at: nowIso() })
          .eq('id', runId);
        return;
      }

      try {
        let attempt = 0;
        let finalError: string | null = null;
        let finalOutput: Record<string, unknown> = {};
        let finalArtifacts: Array<{
          kind: 'screenshot' | 'log' | 'json';
          content: string;
          metadata?: Record<string, unknown>;
        }> = [];

        while (attempt <= STEP_MAX_RETRIES) {
          attempt += 1;
          const result = await withTimeout(
            executor.execute(step, { userId, runId, stepId: step.id }),
            STEP_TIMEOUT_MS
          );
          finalArtifacts = result.artifacts ?? [];
          if (result.success) {
            finalOutput = result.output ?? {};
            finalError = null;
            break;
          }
          finalError = result.error || 'Unknown step error';
          if (attempt > STEP_MAX_RETRIES) break;
        }

        await insertArtifacts(step.id, finalArtifacts);
        if (finalError) {
          throw new Error(
            `${finalError} (attempts=${Math.min(attempt, STEP_MAX_RETRIES + 1)})`
          );
        }

        await supabaseAdmin
          .from('execution_steps')
          .update({
            status: 'success',
            output_json: finalOutput,
            ended_at: nowIso(),
          })
          .eq('id', step.id);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown step error';
        await supabaseAdmin
          .from('execution_steps')
          .update({
            status: 'failed',
            error: message,
            ended_at: nowIso(),
          })
          .eq('id', step.id);

        await supabaseAdmin
          .from('execution_runs')
          .update({ status: 'failed', ended_at: nowIso() })
          .eq('id', runId);
        await insertArtifacts(step.id, [
          {
            kind: 'log',
            content: message,
            metadata: { source: 'executeRunSteps' },
          },
        ]);
        return;
      }
    }

    await supabaseAdmin
      .from('execution_runs')
      .update({ status: 'success', ended_at: nowIso() })
      .eq('id', runId);
  } finally {
    await cleanupBrowserSession(runId);
  }
}

export async function getRunDetails(runId: string, userId: string) {
  const { data: run, error: runErr } = await supabaseAdmin
    .from('execution_runs')
    .select('*')
    .eq('id', runId)
    .eq('executed_by', userId)
    .single();
  if (runErr || !run) throw new Error('Run not found');

  const [stepsRes, approvalsRes, artifactsRes] = await Promise.all([
    supabaseAdmin
      .from('execution_steps')
      .select('*')
      .eq('run_id', runId)
      .order('step_index', { ascending: true }),
    supabaseAdmin.from('approval_requests').select('*').eq('run_id', runId),
    supabaseAdmin
      .from('execution_artifacts')
      .select('*, execution_steps!inner(run_id)')
      .eq('execution_steps.run_id', runId),
  ]);

  if (stepsRes.error) throw new Error(`Failed to read steps: ${stepsRes.error.message}`);
  if (approvalsRes.error) {
    throw new Error(`Failed to read approvals: ${approvalsRes.error.message}`);
  }
  if (artifactsRes.error) {
    throw new Error(`Failed to read artifacts: ${artifactsRes.error.message}`);
  }

  return {
    run,
    steps: stepsRes.data ?? [],
    approvals: approvalsRes.data ?? [],
    artifacts: artifactsRes.data ?? [],
  };
}

export async function approveStep(input: {
  runId: string;
  stepId: string;
  reviewerId: string;
  approved: boolean;
  note?: string;
}) {
  const { data: step, error: stepErr } = await supabaseAdmin
    .from('execution_steps')
    .select('id, executor_type, action, args_json')
    .eq('id', input.stepId)
    .eq('run_id', input.runId)
    .single();
  if (stepErr || !step) throw new Error('Step not found for approval');

  const nextStatus = input.approved ? 'approved' : 'rejected';
  const approvalPatch: Record<string, unknown> = {
    status: nextStatus,
    reviewed_by: input.reviewerId,
    reviewed_at: nowIso(),
    review_note: input.note ?? null,
  };

  if (input.approved) {
    const { data: run, error: runErr } = await supabaseAdmin
      .from('execution_runs')
      .select('plan_id')
      .eq('id', input.runId)
      .single();
    if (runErr || !run) throw new Error('Run not found for approval');

    const { data: plan, error: planErr } = await supabaseAdmin
      .from('automation_plans')
      .select('version')
      .eq('id', run.plan_id)
      .single();
    if (planErr || !plan) throw new Error('Plan not found for approval');

    approvalPatch.approved_step_hash = computeStepHash({
      executor_type: step.executor_type,
      action: step.action,
      args_json: step.args_json,
    });
    approvalPatch.expires_at = new Date(Date.now() + APPROVAL_TTL_MS).toISOString();
    approvalPatch.plan_version = plan.version ?? 1;
  }

  const { data: approval, error } = await supabaseAdmin
    .from('approval_requests')
    .update(approvalPatch)
    .eq('run_id', input.runId)
    .eq('step_id', input.stepId)
    .eq('status', 'pending')
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`Failed to update approval: ${error.message}`);
  if (!approval) throw new Error('No pending approval request for that step');

  if (!input.approved) {
    await supabaseAdmin
      .from('execution_steps')
      .update({
        status: 'blocked',
        error: input.note || 'Step rejected by reviewer',
        ended_at: nowIso(),
      })
      .eq('id', input.stepId);
    await supabaseAdmin
      .from('execution_runs')
      .update({ status: 'failed', ended_at: nowIso() })
      .eq('id', input.runId);
    return { status: 'rejected' as const };
  }

  const { data: pending, error: pendingErr } = await supabaseAdmin
    .from('approval_requests')
    .select('id')
    .eq('run_id', input.runId)
    .eq('status', 'pending');
  if (pendingErr) throw new Error(`Failed to verify approvals: ${pendingErr.message}`);
  if (!pending || pending.length === 0) {
    await executeRunSteps(input.runId, input.reviewerId);
  }

  return { status: 'approved' as const };
}

export async function autoApproveAllPendingSteps(input: {
  runId: string;
  reviewerId: string;
  note?: string;
}) {
  const { data: pending, error } = await supabaseAdmin
    .from('approval_requests')
    .select('step_id')
    .eq('run_id', input.runId)
    .eq('status', 'pending');
  if (error) throw new Error(`Failed to list pending approvals: ${error.message}`);
  for (const approval of pending ?? []) {
    await approveStep({
      runId: input.runId,
      stepId: approval.step_id,
      reviewerId: input.reviewerId,
      approved: true,
      note: input.note ?? 'Auto-approved for v1 compatibility flow',
    });
  }
}

export function summarizeRunResults(
  steps: Array<{ action: string; status: string; output_json?: Record<string, unknown> | null }>
): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  for (const step of steps) {
    if (step.status !== 'success') continue;
    const [providerId] = step.action.split('.');
    if (!providerId) continue;
    summary[providerId] = step.output_json ?? {};
  }
  return summary;
}

export async function startRunForWorkflow(input: {
  userId: string;
  workflowId: string;
  workflowPayload: {
    action: string;
    targetAPIs: string[];
    requiredScopes?: Record<string, string[]>;
    parameters?: Record<string, unknown>;
  };
}): Promise<{ runId: string; status: string }> {
  const { data: workflow, error } = await supabaseAdmin
    .from('workflows')
    .select('created_by')
    .eq('id', input.workflowId)
    .single();
  if (error || !workflow) throw new Error('Workflow not found');

  const planId = await findOrCreatePlanForWorkflow({
    workflowId: input.workflowId,
    prompt: input.workflowPayload.action,
    createdBy: workflow.created_by,
    payload: input.workflowPayload,
  });

  return startRun({ userId: input.userId, planId });
}

export async function cancelRun(runId: string, userId: string) {
  const { data: run, error: runErr } = await supabaseAdmin
    .from('execution_runs')
    .select('id, status, executed_by')
    .eq('id', runId)
    .single();
  if (runErr || !run) throw new Error('Run not found');
  if (run.executed_by !== userId) throw new Error('Not authorized to cancel this run');

  if (!['pending', 'waiting_approval', 'running'].includes(run.status)) {
    return { status: run.status };
  }

  const { error } = await supabaseAdmin
    .from('execution_runs')
    .update({ status: 'cancelled', ended_at: nowIso() })
    .eq('id', runId);
  if (error) throw new Error(`Failed to cancel run: ${error.message}`);
  return { status: 'cancelled' as const };
}
