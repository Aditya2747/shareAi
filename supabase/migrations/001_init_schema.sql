-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Workflows table
CREATE TABLE workflows (
  id TEXT PRIMARY KEY,
  created_by TEXT NOT NULL,
  intent_id TEXT NOT NULL,
  encrypted_payload TEXT NOT NULL,
  shareable_url TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMP,
  executed_by TEXT,
  executed_at TIMESTAMP,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'executing', 'success', 'failed')),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_workflows_created_by ON workflows(created_by);
CREATE INDEX idx_workflows_status ON workflows(status);
CREATE INDEX idx_workflows_created_at ON workflows(created_at DESC);

-- OAuth tokens table (encrypted at rest)
CREATE TABLE oauth_tokens (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  user_id TEXT NOT NULL,
  encrypted_access_token TEXT NOT NULL,
  encrypted_refresh_token TEXT,
  expires_at TIMESTAMP,
  scopes TEXT[] NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(provider, user_id)
);

CREATE INDEX idx_oauth_tokens_user_id ON oauth_tokens(user_id);
CREATE INDEX idx_oauth_tokens_provider ON oauth_tokens(provider);

-- Execution logs table (audit trail)
CREATE TABLE execution_logs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'success', 'failed')),
  error TEXT,
  result JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_execution_logs_workflow_id ON execution_logs(workflow_id);
CREATE INDEX idx_execution_logs_user_id ON execution_logs(user_id);
CREATE INDEX idx_execution_logs_created_at ON execution_logs(created_at DESC);

-- API providers registry (for dynamic execution)
CREATE TABLE api_providers (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  base_url TEXT NOT NULL,
  auth_type TEXT NOT NULL CHECK (auth_type IN ('oauth2', 'api_key', 'bearer')),
  scopes_required TEXT[] NOT NULL,
  icon_url TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO api_providers (id, name, base_url, auth_type, scopes_required, icon_url) VALUES
  ('google-calendar', 'Google Calendar', 'https://www.googleapis.com/calendar/v3', 'oauth2', ARRAY['https://www.googleapis.com/auth/calendar'], 'https://www.gstatic.com/images/branding/product/1x/calendar_48dp.png'),
  ('google-gmail', 'Google Gmail', 'https://www.googleapis.com/gmail/v1', 'oauth2', ARRAY['https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/gmail.readonly'], 'https://www.gstatic.com/images/branding/product/1x/gmail_48dp.png'),
  ('slack', 'Slack', 'https://slack.com/api', 'oauth2', ARRAY['chat:write', 'users:read', 'channels:read'], 'https://a.slack-edge.com/80588/marketing/img/icons/icon_slack_hash_nobg.png');

-- Row-level security policies
ALTER TABLE workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE execution_logs ENABLE ROW LEVEL SECURITY;

-- Workflows: Users can see their own workflows and shared ones
CREATE POLICY workflows_select_policy ON workflows
  FOR SELECT
  USING (created_by = auth.uid()::text OR executed_by = auth.uid()::text);

CREATE POLICY workflows_insert_policy ON workflows
  FOR INSERT
  WITH CHECK (created_by = auth.uid()::text);

CREATE POLICY workflows_update_policy ON workflows
  FOR UPDATE
  USING (created_by = auth.uid()::text OR executed_by IS NULL);

-- OAuth tokens: Users can only access their own tokens
CREATE POLICY oauth_tokens_select_policy ON oauth_tokens
  FOR SELECT
  USING (user_id = auth.uid()::text);

CREATE POLICY oauth_tokens_insert_policy ON oauth_tokens
  FOR INSERT
  WITH CHECK (user_id = auth.uid()::text);

CREATE POLICY oauth_tokens_update_policy ON oauth_tokens
  FOR UPDATE
  USING (user_id = auth.uid()::text);

CREATE POLICY oauth_tokens_delete_policy ON oauth_tokens
  FOR DELETE
  USING (user_id = auth.uid()::text);

-- Execution logs: Users can see their own logs
CREATE POLICY execution_logs_select_policy ON execution_logs
  FOR SELECT
  USING (user_id = auth.uid()::text);

CREATE POLICY execution_logs_insert_policy ON execution_logs
  FOR INSERT
  WITH CHECK (user_id = auth.uid()::text);
