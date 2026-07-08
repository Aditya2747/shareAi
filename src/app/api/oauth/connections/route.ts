import { NextRequest, NextResponse } from 'next/server';
import { OAuthTokenManager } from '@/lib/oauth-token-manager';
import { getUserIdFromRequest } from '@/lib/auth';

/**
 * Returns the providers the logged-in user has connected (real tokens only).
 * The execute page uses this to decide which "Connect" buttons to show.
 */
export async function GET(request: NextRequest) {
  const userId = getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const connected = await OAuthTokenManager.getConnectedProviders(userId);
    return NextResponse.json({ connected }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
