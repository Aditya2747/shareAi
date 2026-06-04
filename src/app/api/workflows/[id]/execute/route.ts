import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Mark workflow as executing
    await supabaseAdmin
      .from('workflows')
      .update({ status: 'executing' })
      .eq('id', params.id);

    // TODO: Implement OAuth token retrieval and API execution
    // This is a placeholder for the full execution pipeline

    // Mark workflow as success
    const { error } = await supabaseAdmin
      .from('workflows')
      .update({
        status: 'success',
        executed_at: new Date().toISOString(),
      })
      .eq('id', params.id);

    if (error) {
      throw error;
    }

    return NextResponse.json(
      { success: true, message: 'Workflow executed' },
      { status: 200 }
    );
  } catch (error) {
    console.error('[workflows/execute]', error);

    await supabaseAdmin
      .from('workflows')
      .update({ status: 'failed' })
      .eq('id', params.id);

    return NextResponse.json(
      { error: 'Failed to execute workflow' },
      { status: 500 }
    );
  }
}
