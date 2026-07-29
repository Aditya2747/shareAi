import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { generateText } from 'ai';
import { google } from '@ai-sdk/google';
import { getUserIdFromRequest } from '@/lib/auth';
import {
  appendMessage,
  ChatTimelineItem,
  getOrCreateThread,
  listMessages,
} from '@/lib/chat-store';
import { isOAuthConnectorProvider } from '@/lib/connectors/registry';
import { parseIntentFromPrompt } from '@/lib/intent-parser';
import { resolveAppUrlFromHeaders } from '@/lib/app-url';
import { generateWorkflowURL } from '@/lib/workflow-generator';
import { buildExecutionPlan } from '@/lib/v2/planner';
import { createPlanRecord } from '@/lib/v2/runs';
import {
  linkAttachmentsToMessage,
  listAttachmentMetaForIds,
  getAttachmentForUser,
} from '@/lib/chat-attachments';

const ChatRequestSchema = z.object({
  message: z.string().min(1).max(4000),
  attachmentIds: z.array(z.string().min(1)).max(5).optional(),
});

function extractOAuthProvidersFromPlan(plan: Awaited<ReturnType<typeof buildExecutionPlan>>) {
  const providers: string[] = [];
  for (const step of plan.steps) {
    if (step.executorType !== 'api') continue;
    const dot = step.action.indexOf('.');
    if (dot <= 0) continue;
    const provider = step.action.slice(0, dot);
    if (!isOAuthConnectorProvider(provider)) continue;
    if (!providers.includes(provider)) providers.push(provider);
  }
  return providers;
}

function timelineForActionable(params: {
  workflowId: string;
  blockedReasons: string[];
}): ChatTimelineItem[] {
  return [
    {
      label: 'Plan generated',
      status: 'done',
      detail: 'Structured execution plan prepared.',
    },
    {
      label: 'Workflow link created',
      status: 'done',
      detail: `Workflow ID: ${params.workflowId}`,
    },
    {
      label: 'Run status',
      status: params.blockedReasons.length > 0 ? 'blocked' : 'waiting',
      detail:
        params.blockedReasons.length > 0
          ? params.blockedReasons.join(' | ')
          : 'Waiting for recipient to open link, connect apps, and execute.',
    },
  ];
}

function timelineForNonActionable(blockedReasons: string[]): ChatTimelineItem[] {
  return [
    {
      label: 'Plan generated',
      status: blockedReasons.length > 0 ? 'blocked' : 'in_progress',
      detail:
        blockedReasons.length > 0
          ? blockedReasons.join(' | ')
          : 'No executable steps inferred yet.',
    },
    {
      label: 'Workflow link',
      status: 'waiting',
      detail: 'Not created for this message.',
    },
    {
      label: 'Run status',
      status: 'waiting',
      detail: 'No run until executable plan is available.',
    },
  ];
}

async function renderAssistantText(input: {
  message: string;
  action?: string;
  apis?: string[];
  shareableUrl?: string;
  blockedReasons?: string[];
}): Promise<string> {
  const modelName = process.env.GOOGLE_MODEL || 'gemini-2.0-flash';
  const system = `You are an automation assistant. Keep responses concise, practical, and action-oriented.
If a shareable URL is provided, mention that the user can send it to a recipient for execution.
If blocked reasons exist, explain what is blocked and suggest practical next steps.`;

  const prompt = `User message: ${input.message}
Action: ${input.action ?? 'n/a'}
APIs: ${(input.apis ?? []).join(', ') || 'none'}
Shareable URL: ${input.shareableUrl ?? 'n/a'}
Blocked reasons: ${(input.blockedReasons ?? []).join(' | ') || 'none'}

Write a short assistant reply in plain English.`;

  try {
    const result = await generateText({
      model: google(modelName),
      system,
      prompt,
    });
    return result.text.trim();
  } catch {
    if (input.shareableUrl) {
      return `Created a workflow for "${input.action}". Share this link to execute: ${input.shareableUrl}`;
    }
    if (input.blockedReasons && input.blockedReasons.length > 0) {
      return `I understood your request, but some parts are blocked right now: ${input.blockedReasons.join(
        '; '
      )}.`;
    }
    return 'I can help automate tasks. Try asking for a specific action with app names, channels, or times.';
  }
}

export async function GET(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const threadId = await getOrCreateThread(userId);
    const messages = await listMessages(threadId, 120);
    return NextResponse.json({ threadId, messages }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const body = await request.json();
    const { message, attachmentIds } = ChatRequestSchema.parse(body);
    const threadId = await getOrCreateThread(userId);

    const attachmentMeta = await listAttachmentMetaForIds(
      userId,
      attachmentIds ?? []
    );

    // Enrich prompt with image URLs so WhatsApp status / send_image can pick them up.
    let enrichedMessage = message;
    const imageAtt = attachmentMeta.find((a) => a.mimeType.startsWith('image/'));
    if (imageAtt) {
      const abs = `${resolveAppUrlFromHeaders(request.headers)}${imageAtt.url}`;
      if (!/https?:\/\//i.test(message)) {
        enrichedMessage = `${message}\n\nAttached image: ${abs}`;
      }
    }

    const userMessageId = await appendMessage({
      threadId,
      role: 'user',
      content: message,
      meta: attachmentMeta.length
        ? { attachments: attachmentMeta }
        : undefined,
    });

    if (attachmentMeta.length > 0) {
      await linkAttachmentsToMessage(
        userId,
        userMessageId,
        attachmentMeta.map((a) => a.id)
      );
    }

    const intent = await parseIntentFromPrompt(enrichedMessage);
    if (imageAtt) {
      const file = await getAttachmentForUser(userId, imageAtt.id);
      if (file && file.bytes.length <= 2 * 1024 * 1024) {
        intent.parameters.image_base64 = `data:${file.mimeType};base64,${file.bytes.toString('base64')}`;
      }
      intent.parameters.image_url =
        intent.parameters.image_url ||
        `${resolveAppUrlFromHeaders(request.headers)}${imageAtt.url}`;
      intent.parameters.filename = imageAtt.filename;
    }
    const plan = await buildExecutionPlan(enrichedMessage);
    const hasActionableSteps = plan.steps.length > 0;
    const oauthProviders = extractOAuthProvidersFromPlan(plan);

    if (!hasActionableSteps) {
      const assistantMessage = await renderAssistantText({
        message,
        blockedReasons:
          plan.steps.length === 0
            ? [
                'No executable steps were inferred from this request yet. Try being specific about action, app, and parameters.',
              ]
            : plan.blockedReasons,
      });
      const timeline = timelineForNonActionable(
        plan.steps.length === 0
          ? [
              'No executable steps were inferred from this request yet. Try being specific about action, app, and parameters.',
            ]
          : plan.blockedReasons
      );

      await appendMessage({
        threadId,
        role: 'assistant',
        content: assistantMessage,
        meta: {
          plan: {
            steps: plan.steps.length,
            blockedReasons: plan.blockedReasons,
          },
          timeline,
        },
      });
      return NextResponse.json(
        {
          threadId,
          assistantMessage,
          plan,
          actionable: false,
          timeline,
        },
        { status: 200 }
      );
    }

    const workflowIntent = {
      ...intent,
      targetAPIs: oauthProviders,
      requiredScopes: Object.fromEntries(
        Object.entries(intent.requiredScopes ?? {}).filter(([provider]) =>
          oauthProviders.includes(provider)
        )
      ),
    };
    const workflow = await generateWorkflowURL(workflowIntent, userId, {
      appUrl: resolveAppUrlFromHeaders(request.headers),
    });
    try {
      await createPlanRecord({
        userId,
        prompt: enrichedMessage,
        plan,
        workflowId: workflow.id,
      });
    } catch (planErr) {
      console.warn('[chat] unable to persist plan record', planErr);
    }

    const assistantMessage = await renderAssistantText({
      message,
      action: intent.action,
      apis: oauthProviders,
      shareableUrl: workflow.shareableUrl,
      blockedReasons: plan.blockedReasons,
    });
    const timeline = timelineForActionable({
      workflowId: workflow.id,
      blockedReasons: plan.blockedReasons,
    });
    const workflowMeta = {
      workflowId: workflow.id,
      shareableUrl: workflow.shareableUrl,
      action: intent.action,
      apis: oauthProviders,
    };

    await appendMessage({
      threadId,
      role: 'assistant',
      content: assistantMessage,
      meta: {
        workflow: workflowMeta,
        plan: {
          steps: plan.steps.length,
          blockedReasons: plan.blockedReasons,
        },
        timeline,
      },
    });

    return NextResponse.json(
      {
        threadId,
        assistantMessage,
        actionable: true,
        workflow: workflowMeta,
        timeline,
        plan,
      },
      { status: 201 }
    );
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
