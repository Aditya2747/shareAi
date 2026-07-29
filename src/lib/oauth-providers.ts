import { encryptToken, decryptToken } from './encryption';
import { supabaseAdmin } from './supabase';

/**
 * OAuth provider configuration.
 *
 * Built-in defaults keep the app working before migration 009 is applied.
 * When `oauth_providers` exists, DB rows override/extend the builtin map
 * (credentials remain env-only via client_id_env / client_secret_env).
 */

export type OAuthFlavor = 'google' | 'slack' | 'github' | 'oauth2';

/** Provider ids are free-form strings (DB + builtins). */
export type ProviderId = string;

export interface ProviderConfig {
  id: string;
  name: string;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  clientIdEnv: string;
  clientSecretEnv: string;
  flavor: OAuthFlavor;
  supportsRefresh: boolean;
  defaultAction: string | null;
  riskLevel: 'low' | 'medium' | 'high';
  requiresApproval: boolean;
}

const BUILTIN_PROVIDERS: Record<string, ProviderConfig> = {
  slack: {
    id: 'slack',
    name: 'Slack',
    authorizeUrl: 'https://slack.com/oauth/v2/authorize',
    tokenUrl: 'https://slack.com/api/oauth.v2.access',
    scopes: ['chat:write', 'users:read'],
    clientIdEnv: 'SLACK_CLIENT_ID',
    clientSecretEnv: 'SLACK_CLIENT_SECRET',
    flavor: 'slack',
    supportsRefresh: false,
    defaultAction: 'slack.send_message',
    riskLevel: 'medium',
    requiresApproval: true,
  },
  'google-calendar': {
    id: 'google-calendar',
    name: 'Google Calendar',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/calendar.events'],
    clientIdEnv: 'GOOGLE_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_CLIENT_SECRET',
    flavor: 'google',
    supportsRefresh: true,
    defaultAction: 'google-calendar.create_event',
    riskLevel: 'low',
    requiresApproval: false,
  },
  'google-gmail': {
    id: 'google-gmail',
    name: 'Google Gmail',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/gmail.send'],
    clientIdEnv: 'GOOGLE_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_CLIENT_SECRET',
    flavor: 'google',
    supportsRefresh: true,
    defaultAction: 'google-gmail.send_email',
    riskLevel: 'high',
    requiresApproval: true,
  },
  github: {
    id: 'github',
    name: 'GitHub',
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scopes: ['gist'],
    clientIdEnv: 'GITHUB_CLIENT_ID',
    clientSecretEnv: 'GITHUB_CLIENT_SECRET',
    flavor: 'github',
    supportsRefresh: false,
    defaultAction: 'github.create_gist',
    riskLevel: 'medium',
    requiresApproval: true,
  },
};

let providerCache: Map<string, ProviderConfig> | null = null;
let loadPromise: Promise<void> | null = null;

function rowToConfig(row: Record<string, unknown>): ProviderConfig {
  return {
    id: String(row.id),
    name: String(row.name),
    authorizeUrl: String(row.authorize_url),
    tokenUrl: String(row.token_url),
    scopes: Array.isArray(row.scopes) ? (row.scopes as string[]) : [],
    clientIdEnv: String(row.client_id_env),
    clientSecretEnv: String(row.client_secret_env),
    flavor: (row.flavor as OAuthFlavor) || 'oauth2',
    supportsRefresh: Boolean(row.supports_refresh),
    defaultAction: row.default_action ? String(row.default_action) : null,
    riskLevel: (row.risk_level as ProviderConfig['riskLevel']) || 'medium',
    requiresApproval: row.requires_approval !== false,
  };
}

/** Load/merge DB providers into memory (idempotent). Safe if table missing. */
export async function ensureProvidersLoaded(): Promise<void> {
  if (providerCache) return;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const map = new Map<string, ProviderConfig>(
      Object.entries(BUILTIN_PROVIDERS).map(([id, cfg]) => [id, cfg])
    );
    try {
      const { data, error } = await supabaseAdmin
        .from('oauth_providers')
        .select('*')
        .eq('is_enabled', true);
      if (!error && data) {
        for (const row of data) {
          const cfg = rowToConfig(row as Record<string, unknown>);
          map.set(cfg.id, cfg);
        }
      }
    } catch {
      // Table may not exist yet — builtins are enough.
    }
    providerCache = map;
  })();

  try {
    await loadPromise;
  } finally {
    loadPromise = null;
  }
}

/** Force reload (after admin edits). */
export function invalidateProviderCache(): void {
  providerCache = null;
}

function activeProviders(): Map<string, ProviderConfig> {
  if (providerCache) return providerCache;
  return new Map(Object.entries(BUILTIN_PROVIDERS));
}

export function isKnownProvider(id: string): boolean {
  return activeProviders().has(id);
}

export function getProviderConfig(id: string): ProviderConfig {
  const cfg = activeProviders().get(id);
  if (!cfg) throw new Error(`Unknown OAuth provider: ${id}`);
  return cfg;
}

export function listProviderIds(): string[] {
  return Array.from(activeProviders().keys());
}

export function listProviderConfigs(): ProviderConfig[] {
  return Array.from(activeProviders().values());
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
}

function redirectUri(provider: string): string {
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
  provider: string;
  returnTo: string;
}

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

export function buildAuthorizeUrl(
  provider: string,
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
    params.set('access_type', 'offline');
    params.set('prompt', 'consent');
  } else if (config.flavor === 'slack') {
    params.set('scope', config.scopes.join(','));
  } else {
    // github + generic oauth2
    params.set('scope', config.scopes.join(' '));
  }

  return `${config.authorizeUrl}?${params.toString()}`;
}

export interface ExchangedToken {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  scopes: string[];
}

export async function exchangeCode(
  provider: string,
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

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  // GitHub returns URL-encoded by default; ask for JSON.
  if (config.flavor === 'github' || config.flavor === 'oauth2') {
    headers.Accept = 'application/json';
  }

  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers,
    body: body.toString(),
  });

  const data = await response.json();

  if (config.flavor === 'slack') {
    if (!data.ok) {
      throw new Error(`Slack OAuth exchange failed: ${data.error || 'unknown_error'}`);
    }
    const accessToken = data.access_token as string;
    const grantedScopes =
      typeof data.scope === 'string' ? data.scope.split(',') : config.scopes;
    if (!accessToken) {
      throw new Error('Slack OAuth exchange returned no access_token');
    }
    return { accessToken, scopes: grantedScopes };
  }

  if (!response.ok || data.error) {
    throw new Error(
      `${config.name} OAuth exchange failed: ${data.error_description || data.error || response.statusText}`
    );
  }

  const scopeRaw = data.scope;
  const grantedScopes =
    typeof scopeRaw === 'string'
      ? scopeRaw.split(/[,\s]+/).filter(Boolean)
      : config.scopes;

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    scopes: grantedScopes,
  };
}

export function isRefreshable(provider: string): boolean {
  return getProviderConfig(provider).supportsRefresh;
}

export async function refreshAccessToken(
  provider: string,
  refreshToken: string
): Promise<{ accessToken: string; expiresIn?: number }> {
  const config = getProviderConfig(provider);
  if (!config.supportsRefresh) {
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
      `${config.name} token refresh failed: ${data.error_description || data.error || response.statusText}`
    );
  }
  return { accessToken: data.access_token, expiresIn: data.expires_in };
}

/** Scopes map for intent parsing (provider → scopes). */
export function getProviderScopesMap(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const cfg of listProviderConfigs()) {
    out[cfg.id] = cfg.scopes;
  }
  return out;
}
