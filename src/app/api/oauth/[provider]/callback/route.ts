import { NextRequest, NextResponse } from 'next/server';
import { OAuthTokenManager } from '@/lib/oauth-token-manager';
import { decodeState, exchangeCode, isKnownProvider } from '@/lib/oauth-providers';

/**
 * OAuth redirect callback. Verifies the encrypted `state`, exchanges the
 * authorization code for real tokens, stores them (encrypted) against the
 * user, then returns the user to where they started.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { provider: string } }
) {
  const provider = params.provider;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

  try {
    if (!isKnownProvider(provider)) {
      throw new Error(`Unknown provider: ${provider}`);
    }

    const providerError = request.nextUrl.searchParams.get('error');
    if (providerError) {
      throw new Error(`Provider denied authorization: ${providerError}`);
    }

    const code = request.nextUrl.searchParams.get('code');
    const rawState = request.nextUrl.searchParams.get('state');
    if (!code || !rawState) {
      throw new Error('Missing code or state in OAuth callback');
    }

    const state = decodeState(rawState);
    if (state.provider !== provider) {
      throw new Error('OAuth state provider mismatch');
    }

    const token = await exchangeCode(provider, code);

    await OAuthTokenManager.storeToken(state.userId, provider, {
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      expiresIn: token.expiresIn,
      scopes: token.scopes,
    });

    // Send the user back to where they began (e.g. the execute page).
    const dest = new URL(state.returnTo || '/', appUrl);
    dest.searchParams.set('connected', provider);
    return NextResponse.redirect(dest.toString());
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    // Redirect back to the app with an error rather than dumping JSON.
    const dest = new URL('/', appUrl);
    dest.searchParams.set('oauth_error', message);
    return NextResponse.redirect(dest.toString());
  }
}
