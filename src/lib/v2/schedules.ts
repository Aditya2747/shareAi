import crypto from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';
import { ExecutionPlan } from './types';
import { computeNextRunAt, SCHEDULE_PRESETS } from './cron-next';
import { computeStepHash } from './step-hash';
import { executeRunSteps, startRun } from './runs';

export { SCHEDULE_PRESETS };

export interface ScheduleRecord {
  id: string;
  planId: string;
  cronExpression: string;
  nextRunAt: string;
  enabled: boolean;
  createdBy: string;
  timezone: string;
  dryRunAcknowledgedAt: string;
  lastRunAt: string | null;
  lastRunId: string | null;
  lastError: string | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function planHasApprovalSteps(plan: ExecutionPlan): boolean {
  return (plan.steps ?? []).some((s) => Boolean(s.requiresApproval));
}

export async function getValidStandingApproval(
  planId: string,
  userId: string
): Promise<{ id: string; expiresAt: string } | null> {
  const { data, error } = await supabaseAdmin
    .from('standing_approvals')
    .select('id, expires_at')
    .eq('plan_id', planId)
    .eq('created_by', userId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load standing approval: ${error.message}`);
  if (!data) return null;
  if (new Date(data.expires_at).getTime() <= Date.now()) return null;
  return { id: data.id, expiresAt: data.expires_at };
}

export async function upsertStandingApproval(input: {
  planId: string;
  userId: string;
  expiresAt: Date;
  note?: string;
}): Promise<void> {
  if (input.expiresAt.getTime() <= Date.now()) {
    throw new Error('Standing approval expiry must be in the future');
  }
  const id = `sa_${crypto
    .createHash('sha256')
    .update(`${input.planId}:${input.userId}`)
    .digest('hex')
    .slice(0, 32)}`;
  const { error } = await supabaseAdmin.from('standing_approvals').upsert(
    {
      id,
      plan_id: input.planId,
      created_by: input.userId,
      expires_at: input.expiresAt.toISOString(),
      note: input.note ?? 'Standing approval for scheduled runs',
      created_at: nowIso(),
    },
    { onConflict: 'plan_id,created_by' }
  );
  if (error) throw new Error(`Failed to save standing approval: ${error.message}`);
}

/** Mark pending approvals approved using standing approval TTL (scheduled runs only). */
export async function applyStandingApprovalsToRun(input: {
  runId: string;
  reviewerId: string;
  expiresAt: string;
  planVersion?: number;
}): Promise<number> {
  const { data: pending, error } = await supabaseAdmin
    .from('approval_requests')
    .select('id, step_id')
    .eq('run_id', input.runId)
    .eq('status', 'pending');
  if (error) throw new Error(`Failed to list pending approvals: ${error.message}`);
  if (!pending?.length) return 0;

  for (const row of pending) {
    const { data: step, error: stepErr } = await supabaseAdmin
      .from('execution_steps')
      .select('id, executor_type, action, args_json')
      .eq('id', row.step_id)
      .single();
    if (stepErr || !step) {
      throw new Error(`Failed to load step for standing approval: ${stepErr?.message}`);
    }
    const hash = computeStepHash({
      executor_type: step.executor_type,
      action: step.action,
      args_json: step.args_json,
    });
    const { error: updErr } = await supabaseAdmin
      .from('approval_requests')
      .update({
        status: 'approved',
        reviewed_by: input.reviewerId,
        review_note: 'Standing approval (scheduled run)',
        reviewed_at: nowIso(),
        approved_step_hash: hash,
        expires_at: input.expiresAt,
        plan_version: input.planVersion ?? 1,
      })
      .eq('id', row.id);
    if (updErr) throw new Error(`Failed to apply standing approval: ${updErr.message}`);
  }
  return pending.length;
}

export async function assertScheduleAllowed(input: {
  plan: ExecutionPlan;
  planId: string;
  userId: string;
  standingApprovalExpiresAt?: string | null;
}): Promise<{ standingExpiresAt: string | null }> {
  const needsApproval = planHasApprovalSteps(input.plan);
  if (!needsApproval) {
    return { standingExpiresAt: null };
  }

  if (!input.standingApprovalExpiresAt) {
    throw new Error(
      'This plan has steps that require approval. Set an explicit standingApprovalExpiresAt (ISO date) before enabling a schedule.'
    );
  }
  const expires = new Date(input.standingApprovalExpiresAt);
  if (Number.isNaN(expires.getTime()) || expires.getTime() <= Date.now()) {
    throw new Error('standingApprovalExpiresAt must be a valid future timestamp');
  }

  await upsertStandingApproval({
    planId: input.planId,
    userId: input.userId,
    expiresAt: expires,
    note: 'Required for scheduling plans with requiresApproval steps',
  });

  return { standingExpiresAt: expires.toISOString() };
}

export async function getScheduleForPlan(planId: string): Promise<ScheduleRecord | null> {
  const { data, error } = await supabaseAdmin
    .from('schedules')
    .select('*')
    .eq('plan_id', planId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load schedule: ${error.message}`);
  if (!data) return null;
  return mapSchedule(data);
}

function mapSchedule(row: Record<string, unknown>): ScheduleRecord {
  return {
    id: String(row.id),
    planId: String(row.plan_id),
    cronExpression: String(row.cron_expression),
    nextRunAt: String(row.next_run_at),
    enabled: Boolean(row.enabled),
    createdBy: String(row.created_by),
    timezone: String(row.timezone || 'UTC'),
    dryRunAcknowledgedAt: String(row.dry_run_acknowledged_at),
    lastRunAt: row.last_run_at ? String(row.last_run_at) : null,
    lastRunId: row.last_run_id ? String(row.last_run_id) : null,
    lastError: row.last_error ? String(row.last_error) : null,
  };
}

export async function createOrUpdateSchedule(input: {
  planId: string;
  userId: string;
  cronExpression: string;
  timezone?: string;
  dryRunAcknowledged: boolean;
  standingApprovalExpiresAt?: string | null;
}): Promise<ScheduleRecord> {
  if (!input.dryRunAcknowledged) {
    throw new Error(
      'Dry-run / plan preview must be acknowledged before enabling a schedule (dryRunAcknowledged=true).'
    );
  }

  const { data: planRow, error: planErr } = await supabaseAdmin
    .from('automation_plans')
    .select('id, created_by, plan_json')
    .eq('id', input.planId)
    .single();
  if (planErr || !planRow) throw new Error('Plan not found');
  if (planRow.created_by !== input.userId) {
    throw new Error('Only the plan creator can manage its schedule');
  }

  const plan = planRow.plan_json as ExecutionPlan;
  await assertScheduleAllowed({
    plan,
    planId: input.planId,
    userId: input.userId,
    standingApprovalExpiresAt: input.standingApprovalExpiresAt,
  });

  const timezone = input.timezone || 'UTC';
  let nextRunAt: Date;
  try {
    nextRunAt = computeNextRunAt(input.cronExpression, timezone);
  } catch (err) {
    throw new Error(
      err instanceof Error ? err.message : 'Invalid cron_expression'
    );
  }

  const existing = await getScheduleForPlan(input.planId);
  const id = existing?.id ?? `sched_${crypto.randomUUID()}`;
  const row = {
    id,
    plan_id: input.planId,
    cron_expression: input.cronExpression.trim(),
    next_run_at: nextRunAt.toISOString(),
    enabled: true,
    created_by: input.userId,
    timezone,
    dry_run_acknowledged_at: nowIso(),
    last_error: null,
    updated_at: nowIso(),
  };

  const { data, error } = await supabaseAdmin
    .from('schedules')
    .upsert(row, { onConflict: 'plan_id' })
    .select('*')
    .single();
  if (error) throw new Error(`Failed to save schedule: ${error.message}`);
  return mapSchedule(data as Record<string, unknown>);
}

export async function deleteSchedule(input: {
  planId: string;
  userId: string;
}): Promise<void> {
  const { data: planRow, error: planErr } = await supabaseAdmin
    .from('automation_plans')
    .select('id, created_by')
    .eq('id', input.planId)
    .single();
  if (planErr || !planRow) throw new Error('Plan not found');
  if (planRow.created_by !== input.userId) {
    throw new Error('Only the plan creator can delete its schedule');
  }

  const { error } = await supabaseAdmin
    .from('schedules')
    .delete()
    .eq('plan_id', input.planId);
  if (error) throw new Error(`Failed to delete schedule: ${error.message}`);
}

async function processOneSchedule(row: Record<string, unknown>): Promise<{
  scheduleId: string;
  runId?: string;
  error?: string;
}> {
  const scheduleId = String(row.id);
  const planId = String(row.plan_id);
  const createdBy = String(row.created_by);
  const timezone = String(row.timezone || 'UTC');
  const cronExpression = String(row.cron_expression);

  try {
    const { data: planRow, error: planErr } = await supabaseAdmin
      .from('automation_plans')
      .select('id, plan_json, version')
      .eq('id', planId)
      .single();
    if (planErr || !planRow) throw new Error('Plan not found');
    const plan = planRow.plan_json as ExecutionPlan;

    if (planHasApprovalSteps(plan)) {
      const standing = await getValidStandingApproval(planId, createdBy);
      if (!standing) {
        await supabaseAdmin
          .from('schedules')
          .update({
            enabled: false,
            last_error:
              'Disabled: standing approval missing or expired for approval-required plan',
            updated_at: nowIso(),
          })
          .eq('id', scheduleId);
        return {
          scheduleId,
          error: 'Standing approval missing or expired — schedule disabled',
        };
      }

      const started = await startRun({ userId: createdBy, planId });
      if (started.status === 'waiting_approval') {
        await applyStandingApprovalsToRun({
          runId: started.runId,
          reviewerId: createdBy,
          expiresAt: standing.expiresAt,
          planVersion: (planRow.version as number) ?? 1,
        });
        await executeRunSteps(started.runId, createdBy);
      }

      const next = computeNextRunAt(cronExpression, timezone, new Date());
      await supabaseAdmin
        .from('schedules')
        .update({
          last_run_at: nowIso(),
          last_run_id: started.runId,
          next_run_at: next.toISOString(),
          last_error: null,
          updated_at: nowIso(),
        })
        .eq('id', scheduleId);

      return { scheduleId, runId: started.runId };
    }

    const started = await startRun({ userId: createdBy, planId });
    const next = computeNextRunAt(cronExpression, timezone, new Date());
    await supabaseAdmin
      .from('schedules')
      .update({
        last_run_at: nowIso(),
        last_run_id: started.runId,
        next_run_at: next.toISOString(),
        last_error: null,
        updated_at: nowIso(),
      })
      .eq('id', scheduleId);

    return { scheduleId, runId: started.runId };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown schedule error';
    // Still advance next_run to avoid hot-looping a failing job every tick
    try {
      const next = computeNextRunAt(cronExpression, timezone, new Date());
      await supabaseAdmin
        .from('schedules')
        .update({
          last_error: message,
          next_run_at: next.toISOString(),
          updated_at: nowIso(),
        })
        .eq('id', scheduleId);
    } catch {
      await supabaseAdmin
        .from('schedules')
        .update({ last_error: message, updated_at: nowIso() })
        .eq('id', scheduleId);
    }
    return { scheduleId, error: message };
  }
}

/** Claim and execute due schedules. Intended for internal cron worker. */
export async function processDueSchedules(limit = 20): Promise<{
  processed: number;
  results: Array<{ scheduleId: string; runId?: string; error?: string }>;
}> {
  const now = nowIso();
  const { data: due, error } = await supabaseAdmin
    .from('schedules')
    .select('*')
    .eq('enabled', true)
    .lte('next_run_at', now)
    .order('next_run_at', { ascending: true })
    .limit(limit);
  if (error) throw new Error(`Failed to list due schedules: ${error.message}`);

  const results: Array<{ scheduleId: string; runId?: string; error?: string }> = [];
  for (const row of due ?? []) {
    results.push(await processOneSchedule(row as Record<string, unknown>));
  }
  return { processed: results.length, results };
}
