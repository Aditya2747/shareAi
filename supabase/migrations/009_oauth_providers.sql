-- Generic OAuth provider registry (DB-driven connector config).
-- Credentials stay in env (client_id_env / client_secret_env); this table
-- holds authorize/token endpoints, scopes, and OAuth dialect (flavor).

CREATE TABLE IF NOT EXISTS oauth_providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  authorize_url TEXT NOT NULL,
  token_url TEXT NOT NULL,
  scopes TEXT[] NOT NULL DEFAULT '{}',
  client_id_env TEXT NOT NULL,
  client_secret_env TEXT NOT NULL,
  -- google | slack | github | oauth2 (standard code+JSON token response)
  flavor TEXT NOT NULL DEFAULT 'oauth2'
    CHECK (flavor IN ('google', 'slack', 'github', 'oauth2')),
  supports_refresh BOOLEAN NOT NULL DEFAULT FALSE,
  -- Default planner action for this provider, e.g. github.create_gist
  default_action TEXT,
  risk_level TEXT NOT NULL DEFAULT 'medium'
    CHECK (risk_level IN ('low', 'medium', 'high')),
  requires_approval BOOLEAN NOT NULL DEFAULT TRUE,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oauth_providers_enabled
  ON oauth_providers(is_enabled);

INSERT INTO oauth_providers (
  id, name, authorize_url, token_url, scopes,
  client_id_env, client_secret_env, flavor, supports_refresh,
  default_action, risk_level, requires_approval, metadata
) VALUES
  (
    'slack',
    'Slack',
    'https://slack.com/oauth/v2/authorize',
    'https://slack.com/api/oauth.v2.access',
    ARRAY['chat:write', 'users:read'],
    'SLACK_CLIENT_ID',
    'SLACK_CLIENT_SECRET',
    'slack',
    FALSE,
    'slack.send_message',
    'medium',
    TRUE,
    '{"category":"communication"}'::jsonb
  ),
  (
    'google-calendar',
    'Google Calendar',
    'https://accounts.google.com/o/oauth2/v2/auth',
    'https://oauth2.googleapis.com/token',
    ARRAY['https://www.googleapis.com/auth/calendar.events'],
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'google',
    TRUE,
    'google-calendar.create_event',
    'low',
    FALSE,
    '{"category":"productivity"}'::jsonb
  ),
  (
    'google-gmail',
    'Google Gmail',
    'https://accounts.google.com/o/oauth2/v2/auth',
    'https://oauth2.googleapis.com/token',
    ARRAY['https://www.googleapis.com/auth/gmail.send'],
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'google',
    TRUE,
    'google-gmail.send_email',
    'high',
    TRUE,
    '{"category":"communication"}'::jsonb
  ),
  (
    'github',
    'GitHub',
    'https://github.com/login/oauth/authorize',
    'https://github.com/login/oauth/access_token',
    ARRAY['gist'],
    'GITHUB_CLIENT_ID',
    'GITHUB_CLIENT_SECRET',
    'github',
    FALSE,
    'github.create_gist',
    'medium',
    TRUE,
    '{"category":"storage","docs":"Add repo scope for issues.create"}'::jsonb
  )
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  authorize_url = EXCLUDED.authorize_url,
  token_url = EXCLUDED.token_url,
  scopes = EXCLUDED.scopes,
  client_id_env = EXCLUDED.client_id_env,
  client_secret_env = EXCLUDED.client_secret_env,
  flavor = EXCLUDED.flavor,
  supports_refresh = EXCLUDED.supports_refresh,
  default_action = EXCLUDED.default_action,
  risk_level = EXCLUDED.risk_level,
  requires_approval = EXCLUDED.requires_approval,
  metadata = EXCLUDED.metadata,
  updated_at = NOW();

-- Capability for GitHub gist create
INSERT INTO capabilities (
  id, executor_type, action, description, risk_level, requires_approval, metadata, is_enabled
) VALUES (
  'cap_api_github_create_gist',
  'api',
  'github.create_gist',
  'Create a GitHub gist',
  'medium',
  TRUE,
  '{"provider":"github"}'::jsonb,
  TRUE
), (
  'cap_api_github_create_issue',
  'api',
  'github.create_issue',
  'Create a GitHub issue (requires repo scope)',
  'high',
  TRUE,
  '{"provider":"github","requiredScopes":["repo"]}'::jsonb,
  TRUE
)
ON CONFLICT (id) DO NOTHING;

-- Keep api_providers in sync for legacy readers
INSERT INTO api_providers (id, name, base_url, auth_type, scopes_required, icon_url)
VALUES (
  'github',
  'GitHub',
  'https://api.github.com',
  'oauth2',
  ARRAY['gist'],
  'https://github.githubassets.com/favicons/favicon.png'
)
ON CONFLICT (id) DO NOTHING;
