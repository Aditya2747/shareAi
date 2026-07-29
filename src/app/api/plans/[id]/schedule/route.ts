import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest } from '@/lib/auth';
import {
  createOrUpdateSchedule,
  deleteSchedule,
  getScheduleForPlan,
  planHasApprovalSteps,
  SCHEDULE_PRESETS,
} from '@/lib/v2/schedules';
import { supabaseAdmin } from '@/lib/supabase';
import { ExecutionPlan } from '@/lib/v2/types';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const userId = getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const schedule = await getScheduleForPlan(params.id);
    const { data: plan } = await supabaseAdmin
      .from('automation_plans')
      .select('plan_json, created_by')
      .eq('id', params.id)
      .maybeSingle();

    return NextResponse.json({
      schedule,
      presets: SCHEDULE_PRESETS,
      requiresStandingApproval: plan
        ? planHasApprovalSteps(plan.plan_json as ExecutionPlan)
        : false,
      isOwner: plan?.created_by === userId,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load schedule' },
      { status: 500 }
    );
  }
}

/**
 * Enable or update a schedule for a plan.
 * Body: {
 *   cronExpression, timezone?, dryRunAcknowledged: true,
 *   standingApprovalExpiresAt?: ISO (required if plan has requiresApproval steps)
 * }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const userId = getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const body = (await request.json()) as {
      cronExpression?: string;
      timezone?: string;
      dryRunAcknowledged?: boolean;
      standingApprovalExpiresAt?: string | null;
    };

    if (!body.cronExpression?.trim()) {
      return NextResponse.json(
        { error: 'cronExpression is required' },
        { status: 400 }
      );
    }

    const schedule = await createOrUpdateSchedule({
      planId: params.id,
      userId,
      cronExpression: body.cronExpression,
      timezone: body.timezone,
      dryRunAcknowledged: Boolean(body.dryRunAcknowledged),
      standingApprovalExpiresAt: body.standingApprovalExpiresAt,
    });

    return NextResponse.json({ schedule });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to save schedule';
    const status =
      message.includes('Dry-run') ||
      message.includes('standingApproval') ||
      message.includes('requires approval') ||
      message.includes('Only the plan creator') ||
      message.includes('Invalid cron')
        ? 400
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const userId = getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    await deleteSchedule({ planId: params.id, userId });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete schedule';
    const status = message.includes('Only the plan creator') ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
