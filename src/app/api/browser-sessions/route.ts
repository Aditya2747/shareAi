import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest } from '@/lib/auth';
import {
  listBrowserSessions,
  revokeAllBrowserSessions,
  revokeBrowserSession,
  revokeBrowserSessionById,
} from '@/lib/v2/browser-sessions';

/** List saved browser sessions for the logged-in recipient (no blobs). */
export async function GET(request: NextRequest) {
  const userId = getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const sessions = await listBrowserSessions(userId);
    return NextResponse.json({ sessions });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : 'Failed to list browser sessions',
      },
      { status: 500 }
    );
  }
}

/**
 * Revoke sessions.
 * Body: { sessionId?: string, domain?: string, all?: boolean }
 */
export async function DELETE(request: NextRequest) {
  const userId = getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      sessionId?: string;
      domain?: string;
      all?: boolean;
    };

    if (body.all) {
      await revokeAllBrowserSessions(userId);
      return NextResponse.json({ ok: true, revoked: 'all' });
    }
    if (body.sessionId) {
      await revokeBrowserSessionById(userId, body.sessionId);
      return NextResponse.json({ ok: true, revoked: body.sessionId });
    }
    if (body.domain) {
      await revokeBrowserSession(userId, body.domain);
      return NextResponse.json({ ok: true, revoked: body.domain });
    }

    return NextResponse.json(
      { error: 'Provide sessionId, domain, or all=true' },
      { status: 400 }
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : 'Failed to revoke browser session',
      },
      { status: 500 }
    );
  }
}
