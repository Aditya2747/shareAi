import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest } from '@/lib/auth';
import { listRunsForUser } from '@/lib/v2/runs';

export async function GET(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const rawLimit = Number(searchParams.get('limit') ?? '20');
    const limit = Number.isFinite(rawLimit) ? rawLimit : 20;

    const runs = await listRunsForUser(userId, limit);
    return NextResponse.json({ runs }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
