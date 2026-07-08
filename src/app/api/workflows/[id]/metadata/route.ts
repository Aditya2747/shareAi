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
      .select('encrypted_payload, expires_at')
      .eq('id', params.id)
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: 'Workflow not found' },
        { status: 404 }
      );
    }

    if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) {
      return NextResponse.json(
        { error: 'Workflow link has expired' },
        { status: 410 }
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
