import { encryptToken, decryptToken } from './encryption';

/**
 * OAuth provider configuration and helpers.
 *
 * Each provider declares its authorize/token endpoints, the scopes we request,
 * and how to read its client credentials from the environment. The `state`
 * parameter is an encrypted JSON blob (using the same NaCl key as everything
 * else) so the callback can trust the userId/returnTo without a session store.
 */

export type ProviderId = 'slack' | 'google-calendar' | 'google-gmail';

interface ProviderConfig {
  /** Human label for logs/UI. */
  name: string;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  /** Env var names for credentials. Google Calendar + Gmail share one app. */
  clientIdEnv: string;
  clientSecretEnv: string;
  /** Slack returns the bot token under authed_user/access_token differently. */
  flavor: 'google' | 'slack';
}

const PROVIDERS: Record<ProviderId, ProviderConfig> = {
  'slack': {
    name: 'Slack',
    authorizeUrl: 'https://slack.com/oauth/v2/authorize',
    tokenUrl: 'https://slack.com/api/oauth.v2.access',
    scopes: ['chat:write', 'users:read'],
    clientIdEnv: 'SLACK_CLIENT_ID',
    clientSecretEnv: 'SLACK_CLIENT_SECRET',
    flavor: 'slack',
  },
  'google-calendar': {
    name: 'Google Calendar',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/calendar.events'],
    clientIdEnv: 'GOOGLE_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_CLIENT_SECRET',
    flavor: 'google',
  },
  'google-gmail': {
    name: 'Google Gmail',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/gmail.send'],
    clientIdEnv: 'GOOGLE_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_CLIENT_SECRET',
    flavor: 'google',
  },
};

export function isKnownProvider(id: string): id is ProviderId {
  return Object.prototype.hasOwnProperty.call(PROVIDERS, id);
}

export function getProviderConfig(id: ProviderId): ProviderConfig {
  return PROVIDERS[id];
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
}

function redirectUri(provider: ProviderId): string {
  return `${appUrl()}/api/oauth/${provider}/callback`;
}

function readCredentials(config: ProviderConfig): { clientId: string; clientSecret: string } {
  const clientId = process.env[config.clientIdEnv];
  const clientSecret = process.env[config.clientSecretEnv];
  if (!clientId || !clientSecret) {
    throw new Error(
      `Missing OAuth credentials for ${config.name}. Set ${config.clientIdEnv} and ${config.clientSecretEnv} in .env.local.`
    );
  }
  return { clientId, clientSecret };
}

interface OAuthState {
  userId: string;
  provider: ProviderId;
  returnTo: string;
}

/** Encrypt the OAuth state so the callback can trust it without a DB lookup. */
export function encodeState(state: OAuthState): string {
  return encodeURIComponent(encryptToken(JSON.stringify(state)));
}

export function decodeState(raw: string): OAuthState {
  const parsed = JSON.parse(decryptToken(decodeURIComponent(raw))) as OAuthState;
  if (!parsed.userId || !parsed.provider) {
    throw new Error('Invalid OAuth state');
  }
  return parsed;
}

/** Build the provider authorize URL the user is redirected to. */
export function buildAuthorizeUrl(
  provider: ProviderId,
  userId: string,
  returnTo: string
): string {
  const config = getProviderConfig(provider);
  const { clientId } = readCredentials(config);
  const state = encodeState({ userId, provider, returnTo });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(provider),
    state,
  });

  if (config.flavor === 'google') {
    params.set('response_type', 'code');
    params.set('scope', config.scopes.join(' '));
    // Needed to receive a refresh_token from Google.
    params.set('access_type', 'offline');
    params.set('prompt', 'consent');
  } else {
    // Slack v2: bot scopes go in `scope`.
    params.set('scope', config.scopes.join(','));
  }

  return `${config.authorizeUrl}?${params.toString()}`;
}

export interface ExchangedToken {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  scopes: string[];
}

/** Exchange an authorization code for real tokens. */
export async function exchangeCode(
  provider: ProviderId,
  code: string
): Promise<ExchangedToken> {
  const config = getProviderConfig(provider);
  const { clientId, clientSecret } = readCredentials(config);

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri(provider),
    grant_type: 'authorization_code',
  });

  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const data = await response.json();

  if (config.flavor === 'slack') {
    // Slack always returns HTTP 200; success is signalled by `ok`.
    if (!data.ok) {
      throw new Error(`Slack OAuth exchange failed: ${data.error || 'unknown_error'}`);
    }
    // We request bot scopes, so the bot token lives at the top level.
    const accessToken = data.access_token as string;
    const grantedScopes =
      typeof data.scope === 'string' ? data.scope.split(',') : config.scopes;
    if (!accessToken) {
      throw new Error('Slack OAuth exchange returned no access_token');
    }
    return { accessToken, scopes: grantedScopes };
  }

  // Google
  if (!response.ok || data.error) {
    throw new Error(
      `Google OAuth exchange failed: ${data.error_description || data.error || response.statusText}`
    );
  }
  const grantedScopes =
    typeof data.scope === 'string' ? data.scope.split(' ') : config.scopes;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    scopes: grantedScopes,
  };
}

/** Whether a provider issues refreshable, expiring access tokens. */
export function isRefreshable(provider: ProviderId): boolean {
  return getProviderConfig(provider).flavor === 'google';
}

/**
 * Exchange a refresh token for a fresh access token (Google). Slack bot tokens
 * don't expire by default, so refresh is unsupported there.
 */
export async function refreshAccessToken(
  provider: ProviderId,
  refreshToken: string
): Promise<{ accessToken: string; expiresIn?: number }> {
  const config = getProviderConfig(provider);
  if (config.flavor !== 'google') {
    throw new Error(`Token refresh is not supported for ${config.name}`);
  }
  const { clientId, clientSecret } = readCredentials(config);

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });

  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(
      `Google token refresh failed: ${data.error_description || data.error || response.statusText}`
    );
  }
  return { accessToken: data.access_token, expiresIn: data.expires_in };
}
