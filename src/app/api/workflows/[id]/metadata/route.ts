import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { decryptToken } from '@/lib/encryption';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { data, error } = await supabaseAdmin
      .from('workflows')
      .select('encrypted_payload')
      .eq('id', params.id)
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: 'Workflow not found' },
        { status: 404 }
      );
    }

    const decrypted = decryptToken(data.encrypted_payload);
    const payload = JSON.parse(decrypted);

    return NextResponse.json({
      action: payload.action,
      targetAPIs: payload.targetAPIs,
      requiredScopes: payload.requiredScopes,
    });
  } catch (error) {
    console.error('[workflows/metadata]', error);
    return NextResponse.json(
      { error: 'Failed to retrieve workflow metadata' },
      { status: 500 }
    );
  }
}
