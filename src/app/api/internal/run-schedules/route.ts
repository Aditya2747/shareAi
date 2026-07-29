import { NextRequest, NextResponse } from 'next/server';
import { processDueSchedules } from '@/lib/v2/schedules';

/**
 * Internal worker: claim due schedules and start runs.
 * Protect with INTERNAL_CRON_SECRET via Authorization: Bearer <secret>
 * or header x-internal-cron-secret.
 *
 * Example (GitHub Actions / curl):
 *   curl -X POST "$APP_URL/api/internal/run-schedules" \
 *     -H "Authorization: Bearer $INTERNAL_CRON_SECRET"
 */
export async function POST(request: NextRequest) {
  const expected = process.env.INTERNAL_CRON_SECRET;
  if (!expected || expected.length < 16) {
    return NextResponse.json(
      { error: 'INTERNAL_CRON_SECRET is not configured' },
      { status: 503 }
    );
  }

  const auth = request.headers.get('authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const headerSecret = request.headers.get('x-internal-cron-secret') || '';
  const provided = bearer || headerSecret;

  if (!provided || provided !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const limitRaw = request.nextUrl.searchParams.get('limit');
    const limit = Math.min(Math.max(Number(limitRaw) || 20, 1), 100);
    const result = await processDueSchedules(limit);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : 'Failed to process schedules',
      },
      { status: 500 }
    );
  }
}
