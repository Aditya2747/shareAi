-- v2 automation core tables.

CREATE TABLE IF NOT EXISTS capabilities (
  id TEXT PRIMARY KEY,
  executor_type TEXT NOT NULL CHECK (executor_type IN ('api', 'os', 'browser', 'desktop')),
  action TEXT NOT NULL,
  description TEXT NOT NULL,
  risk_level TEXT NOT NULL CHECK (risk_level IN ('low', 'medium', 'high')),
  requires_approval BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(executor_type, action)
);

CREATE TABLE IF NOT EXISTS automation_plans (
  id TEXT PRIMARY KEY,
  workflow_id TEXT REFERENCES workflows(id) ON DELETE SET NULL,
  created_by TEXT NOT NULL,
  source_prompt TEXT NOT NULL,
  plan_json JSONB NOT NULL,
  risk_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'rejected')),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_plans_created_by ON automation_plans(created_by);
CREATE INDEX IF NOT EXISTS idx_automation_plans_workflow_id ON automation_plans(workflow_id);

CREATE TABLE IF NOT EXISTS execution_runs (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES automation_plans(id) ON DELETE CASCADE,
  workflow_id TEXT REFERENCES workflows(id) ON DELETE SET NULL,
  executed_by TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'waiting_approval', 'running', 'success', 'failed', 'cancelled')),
  started_at TIMESTAMP,
  ended_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_execution_runs_plan_id ON execution_runs(plan_id);
CREATE INDEX IF NOT EXISTS idx_execution_runs_executed_by ON execution_runs(executed_by);
CREATE INDEX IF NOT EXISTS idx_execution_runs_status ON execution_runs(status);

CREATE TABLE IF NOT EXISTS execution_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES execution_runs(id) ON DELETE CASCADE,
  step_index INT NOT NULL,
  executor_type TEXT NOT NULL CHECK (executor_type IN ('api', 'os', 'browser', 'desktop')),
  action TEXT NOT NULL,
  args_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  risk_level TEXT NOT NULL CHECK (risk_level IN ('low', 'medium', 'high')),
  requires_approval BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'success', 'failed', 'skipped', 'blocked')),
  output_json JSONB,
  error TEXT,
  started_at TIMESTAMP,
  ended_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(run_id, step_index)
);

CREATE INDEX IF NOT EXISTS idx_execution_steps_run_id ON execution_steps(run_id);
CREATE INDEX IF NOT EXISTS idx_execution_steps_status ON execution_steps(status);

CREATE TABLE IF NOT EXISTS approval_requests (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES execution_runs(id) ON DELETE CASCADE,
  step_id TEXT NOT NULL REFERENCES execution_steps(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by TEXT,
  review_note TEXT,
  reviewed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(run_id, step_id)
);

CREATE INDEX IF NOT EXISTS idx_approval_requests_run_id ON approval_requests(run_id);
CREATE INDEX IF NOT EXISTS idx_approval_requests_status ON approval_requests(status);

CREATE TABLE IF NOT EXISTS execution_artifacts (
  id TEXT PRIMARY KEY,
  step_id TEXT NOT NULL REFERENCES execution_steps(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('screenshot', 'log', 'json')),
  url_or_blob TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_execution_artifacts_step_id ON execution_artifacts(step_id);

INSERT INTO capabilities (id, executor_type, action, description, risk_level, requires_approval, metadata, is_enabled)
VALUES
  ('cap_api_slack_send_message', 'api', 'slack.send_message', 'Send a Slack message', 'medium', TRUE, '{"provider":"slack"}'::jsonb, TRUE),
  ('cap_api_google_calendar_create_event', 'api', 'google-calendar.create_event', 'Create a Google Calendar event', 'low', FALSE, '{"provider":"google-calendar"}'::jsonb, TRUE),
  ('cap_api_google_gmail_send_email', 'api', 'google-gmail.send_email', 'Send an email using Gmail', 'high', TRUE, '{"provider":"google-gmail"}'::jsonb, TRUE),
  ('cap_os_windows_set_theme', 'os', 'windows.set_theme', 'Set Windows theme mode', 'high', TRUE, '{"platform":"windows"}'::jsonb, TRUE),
  ('cap_browser_open_url', 'browser', 'browser.open_url', 'Open a URL in browser automation context', 'medium', TRUE, '{}'::jsonb, TRUE)
ON CONFLICT (id) DO NOTHING;
