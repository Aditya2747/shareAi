import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { decryptToken } from '@/lib/encryption';
import { loadOrCreatePlanForWorkflow } from '@/lib/v2/runs';
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

    try {
      const plan = await loadOrCreatePlanForWorkflow({
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
      steps = mapPlanStepsForClient(plan);
      globalRiskSummary = plan.globalRiskSummary ?? null;
      blockedReasons = Array.isArray(plan.blockedReasons) ? plan.blockedReasons : [];
    } catch (planErr) {
      // Keep v1 metadata available even if v2 plan tables are missing.
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
    });
  } catch (error) {
    console.error('[workflows/metadata]', error);
    return NextResponse.json(
      { error: 'Failed to retrieve workflow metadata' },
      { status: 500 }
    );
  }
}
