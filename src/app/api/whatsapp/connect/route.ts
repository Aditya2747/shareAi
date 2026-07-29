import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest } from '@/lib/auth';
import { OAuthTokenManager } from '@/lib/oauth-token-manager';
import { isWhatsAppConfigured } from '@/lib/connectors/whatsapp';
import { resolveAppUrlFromHeaders } from '@/lib/app-url';

/**
 * Connect WhatsApp for the current user using the server Cloud API token.
 * (Meta Embedded Signup OAuth is optional later; env token is the supported MVP.)
 */
export async function GET(request: NextRequest) {
  const userId = getUserIdFromRequest(request);
  const appUrl = resolveAppUrlFromHeaders(request.headers);
  const returnTo = request.nextUrl.searchParams.get('returnTo') || '/';

  if (!userId) {
    return NextResponse.redirect(
      `${appUrl}/login?next=${encodeURIComponent(returnTo)}`
    );
  }

  if (!isWhatsAppConfigured()) {
    const dest = new URL(returnTo, appUrl);
    dest.searchParams.set(
      'oauth_error',
      'WhatsApp is not configured. Set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID.'
    );
    return NextResponse.redirect(dest.toString());
  }

  try {
    await OAuthTokenManager.storeToken(userId, 'whatsapp', {
      accessToken: process.env.WHATSAPP_ACCESS_TOKEN as string,
      scopes: ['whatsapp_business_messaging'],
    });
    const dest = new URL(returnTo, appUrl);
    dest.searchParams.set('connected', 'whatsapp');
    return NextResponse.redirect(dest.toString());
  } catch (err) {
    const dest = new URL('/', appUrl);
    dest.searchParams.set(
      'oauth_error',
      err instanceof Error ? err.message : 'WhatsApp connect failed'
    );
    return NextResponse.redirect(dest.toString());
  }
}
