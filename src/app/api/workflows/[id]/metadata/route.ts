import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { decryptToken } from '@/lib/encryption';
import { findOrCreatePlanForWorkflow } from '@/lib/v2/runs';
import { getScheduleForPlan, planHasApprovalSteps } from '@/lib/v2/schedules';
import { SCHEDULE_PRESETS } from '@/lib/v2/cron-next';
import { buildHumanSummary, toSafeClientArgs } from '@/lib/v2/planner';
import { ExecutionPlan, ExecutionPlanStep, RiskLevel } from '@/lib/v2/types';

function parseDbTimestampAsUtc(value: string | null | undefined): number {
  if (!value) return Number.NaN;
  const hasTimezone = /(?:[zZ]|[+\-]\d{2}:\d{2})$/.test(value);
  const normalized = hasTimezone ? value : `${value}Z`;
  return new Date(normalized).getTime();
}

function mapPlanStepsForClient(plan: ExecutionPlan) {
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  return steps.map((step: ExecutionPlanStep) => {
    const args = (step.args ?? {}) as Record<string, unknown>;
    return {
      stepIndex: step.stepIndex,
      executorType: step.executorType,
      action: step.action,
      args: toSafeClientArgs(args),
      riskLevel: step.riskLevel as RiskLevel,
      requiresApproval: Boolean(step.requiresApproval),
      requiredPermissions: Array.isArray(step.requiredPermissions)
        ? step.requiredPermissions
        : [],
      humanSummary:
        step.humanSummary || buildHumanSummary(step.action, args),
    };
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const viewerId = getUserIdFromRequest(request);

    const { data, error } = await supabaseAdmin
      .from('workflows')
      .select('encrypted_payload, expires_at, created_by')
      .eq('id', params.id)
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: 'Workflow not found' },
        { status: 404 }
      );
    }

    if (data.expires_at && parseDbTimestampAsUtc(data.expires_at) <= Date.now()) {
      return NextResponse.json(
        { error: 'Workflow link has expired' },
        { status: 410 }
      );
    }

    const decrypted = decryptToken(data.encrypted_payload);
    const payload = JSON.parse(decrypted) as {
      action: string;
      targetAPIs: string[];
      requiredScopes?: Record<string, string[]>;
      parameters?: Record<string, unknown>;
    };

    let steps: ReturnType<typeof mapPlanStepsForClient> = [];
    let globalRiskSummary: ExecutionPlan['globalRiskSummary'] | null = null;
    let blockedReasons: string[] = [];
    let planId: string | null = null;
    let schedule: Awaited<ReturnType<typeof getScheduleForPlan>> = null;
    let requiresStandingApproval = false;

    try {
      planId = await findOrCreatePlanForWorkflow({
        workflowId: params.id,
        prompt: payload.action,
        createdBy: data.created_by,
        payload: {
          action: payload.action,
          targetAPIs: payload.targetAPIs ?? [],
          requiredScopes: payload.requiredScopes,
          parameters: payload.parameters,
        },
      });

      const { data: planRow, error: planErr } = await supabaseAdmin
        .from('automation_plans')
        .select('plan_json')
        .eq('id', planId)
        .single();
      if (planErr || !planRow) {
        throw new Error(planErr?.message || 'Plan not found');
      }

      const plan = planRow.plan_json as ExecutionPlan;
      steps = mapPlanStepsForClient(plan);
      globalRiskSummary = plan.globalRiskSummary ?? null;
      blockedReasons = Array.isArray(plan.blockedReasons) ? plan.blockedReasons : [];
      requiresStandingApproval = planHasApprovalSteps(plan);
      schedule = await getScheduleForPlan(planId);
    } catch (planErr) {
      console.warn('[workflows/metadata] plan load skipped:', planErr);
    }

    return NextResponse.json({
      action: payload.action,
      targetAPIs: payload.targetAPIs,
      requiredScopes: payload.requiredScopes,
      parameters: payload.parameters ?? {},
      steps,
      globalRiskSummary,
      blockedReasons,
      planId,
      schedule,
      requiresStandingApproval,
      schedulePresets: SCHEDULE_PRESETS,
      isPlanOwner: Boolean(viewerId && viewerId === data.created_by),
    });
  } catch (error) {
    console.error('[workflows/metadata]', error);
    return NextResponse.json(
      { error: 'Failed to retrieve workflow metadata' },
      { status: 500 }
    );
  }
}
