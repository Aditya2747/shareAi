import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserIdFromRequest } from '@/lib/auth';
import { approveStep } from '@/lib/v2/runs';

const ApproveStepSchema = z.object({
  stepId: z.string().min(1),
  approved: z.boolean().default(true),
  note: z.string().max(1000).optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const reviewerId = getUserIdFromRequest(request);
    if (!reviewerId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const body = await request.json();
    const parsed = ApproveStepSchema.parse(body);
    const result = await approveStep({
      runId: params.id,
      stepId: parsed.stepId,
      reviewerId,
      approved: parsed.approved,
      note: parsed.note,
    });

    return NextResponse.json(result, { status: 200 });
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
