import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { BUILTIN_CAPABILITIES } from '@/lib/v2/capabilities';

export async function GET(_request: NextRequest) {
  try {
    const { data, error } = await supabaseAdmin
      .from('capabilities')
      .select(
        'id, executor_type, action, description, risk_level, requires_approval, metadata, is_enabled'
      )
      .eq('is_enabled', true);

    if (error) {
      // Fallback to in-code registry if DB table isn't migrated yet.
      return NextResponse.json({ capabilities: BUILTIN_CAPABILITIES }, { status: 200 });
    }

    const capabilities =
      data?.map((row) => ({
        id: row.id,
        executorType: row.executor_type,
        action: row.action,
        description: row.description,
        riskLevel: row.risk_level,
        requiresApproval: row.requires_approval,
        metadata: row.metadata ?? {},
      })) ?? BUILTIN_CAPABILITIES;

    return NextResponse.json({ capabilities }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
