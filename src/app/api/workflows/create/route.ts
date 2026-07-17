import { NextRequest, NextResponse } from 'next/server';
import { parseIntentFromPrompt } from '@/lib/intent-parser';
import { generateWorkflowURL } from '@/lib/workflow-generator';
import { getUserIdFromRequest } from '@/lib/auth';
import { buildExecutionPlan } from '@/lib/v2/planner';
import { createPlanRecord } from '@/lib/v2/runs';
import { z } from 'zod';

const CreateWorkflowSchema = z.object({
  prompt: z.string().min(10).max(2000),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { prompt } = CreateWorkflowSchema.parse(body);

    const creatorId = getUserIdFromRequest(request);
    if (!creatorId) {
      return NextResponse.json(
        { error: 'Not authenticated. Please log in first.' },
        { status: 401 }
      );
    }

    // Parse intent from prompt
    const intent = await parseIntentFromPrompt(prompt);

    if (intent.confidence < 0.5) {
      return NextResponse.json(
        {
          error: `Could not understand your request (confidence: ${(intent.confidence * 100).toFixed(0)}%). Try being more specific about which APIs you want to use.`,
        },
        { status: 400 }
      );
    }

    // Generate workflow URL
    const workflow = await generateWorkflowURL(intent, creatorId);

    // v2 compatibility layer: persist an automation plan linked to this workflow
    // while keeping the existing v1 response/UX unchanged.
    try {
      const plan = await buildExecutionPlan(prompt);
      await createPlanRecord({
        userId: creatorId,
        prompt,
        plan,
        workflowId: workflow.id,
      });
    } catch (v2Err) {
      // Don't fail v1 create flow if v2 tables/migration are not yet applied.
      console.warn('[workflows/create] v2 plan persistence skipped:', v2Err);
    }

    return NextResponse.json(
      {
        workflowId: workflow.id,
        shareableUrl: workflow.shareableUrl,
        action: intent.action,
        apis: intent.targetAPIs,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('[workflows/create]', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request payload', details: error.errors },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to create workflow' },
      { status: 500 }
    );
  }
}
