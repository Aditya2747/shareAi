import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';
import { decryptToken } from '@/lib/encryption';
import { OAuthTokenManager } from '@/lib/oauth-token-manager';
import { APIExecutor } from '@/lib/api-executor';
import { getUserIdFromRequest } from '@/lib/auth';

interface WorkflowPayload {
  action: string;
  targetAPIs: string[];
  requiredScopes: Record<string, string[]>;
  parameters: Record<string, unknown>;
}

/**
 * Each connector exposes a single MVP action, so we map the provider id to that
 * action rather than trusting the AI's free-form `action` string.
 */
function actionForProvider(providerId: string, fallback: string): string {
  switch (providerId) {
    case 'slack':
      return 'send_message';
    case 'google-calendar':
      return 'create_event';
    case 'google-gmail':
      return 'send_email';
    default:
      return fallback;
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const userId = getUserIdFromRequest(request);

  try {
    if (!userId) {
      return NextResponse.json(
        {
          error: 'Missing authentication. Log in and retry execution.',
        },
        { status: 401 }
      );
    }

    const { data: workflow, error: workflowError } = await supabaseAdmin
      .from('workflows')
      .select('encrypted_payload, status, expires_at')
      .eq('id', params.id)
      .single();

    if (workflowError || !workflow) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });
    }

    if (workflow.expires_at && new Date(workflow.expires_at).getTime() <= Date.now()) {
      return NextResponse.json(
        { error: 'Workflow link has expired' },
        { status: 410 }
      );
    }

    // Guard status transitions (idempotency / reliability).
    if (workflow.status === 'success') {
      return NextResponse.json(
        { success: true, message: 'Workflow already executed', result: null },
        { status: 200 }
      );
    }
    if (workflow.status === 'executing') {
      return NextResponse.json(
        { error: 'Workflow is currently executing' },
        { status: 409 }
      );
    }

    if (!workflow.encrypted_payload) {
      return NextResponse.json(
        { error: 'Workflow payload missing' },
        { status: 400 }
      );
    }

    const payload = JSON.parse(
      decryptToken(workflow.encrypted_payload)
    ) as WorkflowPayload;

    if (
      !payload?.action ||
      !Array.isArray(payload?.targetAPIs) ||
      payload.targetAPIs.length === 0
    ) {
      return NextResponse.json(
        { error: 'Invalid workflow payload' },
        { status: 400 }
      );
    }

    // Verify every required provider has a usable token whose stored scopes
    // satisfy the workflow's requirements BEFORE we mark the row executing, so a
    // validation failure never strands the workflow in 'executing'. The execute
    // UI already gates on this; we re-check server-side to avoid partial runs.
    const unsatisfied: string[] = [];
    for (const providerId of payload.targetAPIs) {
      const access = await OAuthTokenManager.getAccessToken(userId, providerId);
      if (!access) {
        unsatisfied.push(providerId);
        continue;
      }

      const required = payload.requiredScopes?.[providerId] ?? [];
      if (required.length > 0) {
        const { data: tokenRow } = await supabaseAdmin
          .from('oauth_tokens')
          .select('scopes')
          .eq('user_id', userId)
          .eq('provider', providerId)
          .single();

        const tokenScopes = tokenRow?.scopes as string[] | null | undefined;
        const hasAll = Array.isArray(tokenScopes)
          ? required.every((s) => tokenScopes.includes(s))
          : false;

        if (!hasAll) unsatisfied.push(providerId);
      }
    }

    if (unsatisfied.length > 0) {
      return NextResponse.json(
        {
          error:
            'Missing OAuth access (or required scopes) for one or more providers. Connect them before executing.',
          providers: unsatisfied,
          requiredScopes: payload.requiredScopes,
        },
        { status: 400 }
      );
    }

    // All providers are ready — claim the workflow.
    const { error: executingError } = await supabaseAdmin
      .from('workflows')
      .update({ status: 'executing' })
      .eq('id', params.id);
    if (executingError) throw executingError;

    // Execute every target provider. Multi-API workflows (e.g. "create a
    // calendar event and post a Slack alert") run each step in order; the first
    // failure throws and is surfaced by the catch handler below.
    const results: Record<string, unknown> = {};
    for (const providerId of payload.targetAPIs) {
      results[providerId] = await APIExecutor.execute({
        userId,
        providerId,
        action: actionForProvider(providerId, payload.action),
        parameters: payload.parameters || {},
      });
    }

    const { error: successError } = await supabaseAdmin
      .from('workflows')
      .update({
        status: 'success',
        executed_by: userId,
        executed_at: new Date().toISOString(),
      })
      .eq('id', params.id);
    if (successError) throw successError;

    const { error: logError } = await supabaseAdmin
      .from('execution_logs')
      .insert([
        {
          id: `log_${randomUUID()}`,
          workflow_id: params.id,
          user_id: userId,
          status: 'success',
          error: null,
          result: results,
        },
      ]);
    if (logError) {
      // Don't fail the whole request if logging fails; still surface a warning.
      console.warn('[workflows/execute] execution_logs insert failed:', logError);
    }

    return NextResponse.json(
      { success: true, message: 'Workflow executed', result: results },
      { status: 200 }
    );
  } catch (error) {
    console.error('[workflows/execute]', error);

    const message = error instanceof Error ? error.message : 'Unknown error';

    // Only mark failed if we'd actually claimed the workflow (best-effort).
    await supabaseAdmin
      .from('workflows')
      .update({ status: 'failed', executed_at: new Date().toISOString() })
      .eq('id', params.id);

    if (userId) {
      try {
        await supabaseAdmin.from('execution_logs').insert([
          {
            id: `log_${randomUUID()}`,
            workflow_id: params.id,
            user_id: userId,
            status: 'failed',
            error: message,
            result: null,
          },
        ]);
      } catch (logInsertErr) {
        console.warn(
          '[workflows/execute] execution_logs insert failed (on error):',
          logInsertErr
        );
      }
    }

    return NextResponse.json(
      { error: `Failed to execute workflow: ${message}` },
      { status: 500 }
    );
  }
}
