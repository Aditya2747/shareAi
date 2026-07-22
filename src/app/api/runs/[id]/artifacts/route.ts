import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest } from '@/lib/auth';
import { getRunDetails } from '@/lib/v2/runs';
import { supabaseAdmin } from '@/lib/supabase';

/**
 * Authenticated artifact listing for a run.
 * Only the run's executed_by user may access execution_artifacts.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const userId = getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const runId = params.id;

    const { data: runRow, error: runLookupErr } = await supabaseAdmin
      .from('execution_runs')
      .select('id, executed_by')
      .eq('id', runId)
      .maybeSingle();

    if (runLookupErr) {
      throw new Error(`Failed to lookup run: ${runLookupErr.message}`);
    }
    if (!runRow) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }
    if (runRow.executed_by !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Re-load through getRunDetails so ownership + join semantics stay centralized.
    const details = await getRunDetails(runId, userId);

    const artifacts = (details.artifacts ?? []).map(
      (artifact: Record<string, unknown>) => {
        // Drop joined relation fields from the public response shape.
        const { execution_steps: _join, ...rest } = artifact;
        return rest;
      }
    );

    return NextResponse.json(
      {
        runId,
        artifacts,
        steps: (details.steps ?? []).map(
          (step: {
            id: string;
            step_index: number;
            action: string;
            status: string;
            human_summary?: string | null;
          }) => ({
            id: step.id,
            stepIndex: step.step_index,
            action: step.action,
            status: step.status,
            humanSummary: step.human_summary ?? null,
          })
        ),
      },
      { status: 200 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const status = message.includes('not found') ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
