import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';
import { decryptToken } from '@/lib/encryption';
import { OAuthTokenManager } from '@/lib/oauth-token-manager';
import { getUserIdFromRequest } from '@/lib/auth';
import {
  getRunDetails,
  listPendingApprovalsForRun,
  startRunForWorkflow,
  summarizeRunResults,
} from '@/lib/v2/runs';

function parseDbTimestampAsUtc(value: string | null | undefined): number {
  if (!value) return Number.NaN;
  const hasTimezone = /(?:[zZ]|[+\-]\d{2}:\d{2})$/.test(value);
  const normalized = hasTimezone ? value : `${value}Z`;
  return new Date(normalized).getTime();
}

interface WorkflowPayload {
  action: string;
  targetAPIs: string[];
  requiredScopes: Record<string, string[]>;
  parameters: Record<string, unknown>;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
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

    if (workflow.expires_at && parseDbTimestampAsUtc(workflow.expires_at) <= Date.now()) {
      return NextResponse.json(
        { error: 'Workflow link has expired' },
        { status: 410 }
      );
    }

    // Guard status transitions (idempotency / reliability).
    if (workflow.status === 'success') {
      return NextResponse.json(
        {
          success: true,
          status: 'success',
          message: 'Workflow already executed',
          result: null,
          runId: null,
        },
        { status: 200 }
      );
    }
    if (workflow.status === 'executing') {
      // Resume an in-flight approval run instead of hard-failing on refresh/retry.
      const { data: existingRun } = await supabaseAdmin
        .from('execution_runs')
        .select('id, status')
        .eq('workflow_id', params.id)
        .eq('executed_by', userId)
        .in('status', ['waiting_approval', 'running', 'pending'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingRun?.status === 'waiting_approval') {
        const pendingApprovals = await listPendingApprovalsForRun(existingRun.id);
        return NextResponse.json(
          {
            success: true,
            status: 'waiting_approval',
            runId: existingRun.id,
            message: 'Approval required before continuing',
            pendingApprovals,
            result: null,
          },
          { status: 200 }
        );
      }

      if (existingRun && ['running', 'pending'].includes(existingRun.status)) {
        return NextResponse.json(
          {
            success: true,
            status: 'running',
            runId: existingRun.id,
            message: 'Workflow execution in progress',
            pendingApprovals: [],
            result: null,
          },
          { status: 200 }
        );
      }

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
      !Array.isArray(payload?.targetAPIs)
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

    // v2 orchestration: do NOT auto-approve medium/high-risk steps.
    // requiresApproval=true → waiting_approval for the client to review.
    // Plans with only auto-executable steps still complete in one click.
    const started = await startRunForWorkflow({
      userId,
      workflowId: params.id,
      workflowPayload: payload,
    });

    if (started.status === 'waiting_approval') {
      const pendingApprovals = await listPendingApprovalsForRun(started.runId);
      return NextResponse.json(
        {
          success: true,
          status: 'waiting_approval',
          runId: started.runId,
          message: 'Approval required before continuing',
          pendingApprovals,
          result: null,
        },
        { status: 200 }
      );
    }

    // Wait briefly for run completion in this synchronous endpoint.
    let details = await getRunDetails(started.runId, userId);
    for (let i = 0; i < 6; i += 1) {
      const status = details.run.status as string;
      if (!['pending', 'running', 'waiting_approval'].includes(status)) break;
      await sleep(250);
      details = await getRunDetails(started.runId, userId);
    }

    const runStatus = details.run.status as string;

    if (runStatus === 'waiting_approval') {
      const pendingApprovals = await listPendingApprovalsForRun(started.runId);
      return NextResponse.json(
        {
          success: true,
          status: 'waiting_approval',
          runId: started.runId,
          message: 'Approval required before continuing',
          pendingApprovals,
          result: null,
        },
        { status: 200 }
      );
    }

    if (runStatus === 'running' || runStatus === 'pending') {
      return NextResponse.json(
        {
          success: true,
          status: 'running',
          runId: started.runId,
          message: 'Workflow execution in progress',
          pendingApprovals: [],
          result: null,
        },
        { status: 200 }
      );
    }

    if (runStatus !== 'success') {
      const failedStep = details.steps.find(
        (s: { status: string }) => s.status === 'failed' || s.status === 'blocked'
      ) as { error?: string } | undefined;
      throw new Error(
        failedStep?.error ||
          `Execution run ended with status "${runStatus}" for workflow ${params.id}`
      );
    }

    const results = summarizeRunResults(
      details.steps as Array<{
        action: string;
        status: string;
        output_json?: Record<string, unknown> | null;
      }>
    );

    // executeRunSteps may have already finalized the workflow; keep idempotent.
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
      {
        success: true,
        status: 'success',
        runId: started.runId,
        message: 'Workflow executed',
        pendingApprovals: [],
        result: results,
      },
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
      { error: `Failed to execute workflow: ${message}`, status: 'failed' },
      { status: 500 }
    );
  }
}
