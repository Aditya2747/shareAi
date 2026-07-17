import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserIdFromRequest } from '@/lib/auth';
import { buildExecutionPlan } from '@/lib/v2/planner';
import { createPlanRecord } from '@/lib/v2/runs';

const CreatePlanSchema = z.object({
  prompt: z.string().min(5).max(4000),
  workflowId: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const payload = await request.json();
    const { prompt, workflowId } = CreatePlanSchema.parse(payload);

    const plan = await buildExecutionPlan(prompt);
    const planId = await createPlanRecord({
      userId,
      prompt,
      workflowId: workflowId ?? null,
      plan,
    });

    return NextResponse.json({ planId, plan }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid payload', details: err.errors },
        { status: 400 }
      );
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
