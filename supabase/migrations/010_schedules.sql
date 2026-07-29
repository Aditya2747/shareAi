-- M4: Scheduled runs with standing approvals (strict safety).

CREATE TABLE IF NOT EXISTS standing_approvals (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES automation_plans(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  note TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (plan_id, created_by)
);

CREATE INDEX IF NOT EXISTS idx_standing_approvals_plan
  ON standing_approvals(plan_id);
CREATE INDEX IF NOT EXISTS idx_standing_approvals_expires
  ON standing_approvals(expires_at);

CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES automation_plans(id) ON DELETE CASCADE,
  cron_expression TEXT NOT NULL,
  next_run_at TIMESTAMP NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_by TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  -- Safety: caller must acknowledge dry-run / plan preview before enable
  dry_run_acknowledged_at TIMESTAMP NOT NULL,
  last_run_at TIMESTAMP,
  last_run_id TEXT,
  last_error TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (plan_id)
);

CREATE INDEX IF NOT EXISTS idx_schedules_due
  ON schedules(enabled, next_run_at)
  WHERE enabled = TRUE;
