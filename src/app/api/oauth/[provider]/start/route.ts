import { NextRequest, NextResponse } from 'next/server';
import { buildAuthorizeUrl, isKnownProvider } from '@/lib/oauth-providers';
import { getUserIdFromRequest } from '@/lib/auth';

/**
 * Begins the OAuth flow for a provider. The executing user must already be
 * logged in. We redirect them to the provider's
 * authorize page with an encrypted `state` carrying their userId + returnTo.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { provider: string } }
) {
  const provider = params.provider;
  if (!isKnownProvider(provider)) {
    return NextResponse.json(
      { error: `Unknown provider: ${provider}` },
      { status: 400 }
    );
  }

  const userId = getUserIdFromRequest(request);

  if (!userId) {
    return NextResponse.json(
      { error: 'Not authenticated. Log in before connecting an integration.' },
      { status: 401 }
    );
  }

  const returnTo = request.nextUrl.searchParams.get('returnTo') || '/';

  try {
    const authorizeUrl = buildAuthorizeUrl(provider, userId, returnTo);
    return NextResponse.redirect(authorizeUrl);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
