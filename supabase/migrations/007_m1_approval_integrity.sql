-- Milestone 1: approval integrity (step-hash pinning).
-- Additive columns only; no breaking changes to existing contracts.

ALTER TABLE approval_requests
  ADD COLUMN IF NOT EXISTS approved_step_hash TEXT,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS approved_scopes JSONB,
  ADD COLUMN IF NOT EXISTS plan_version INT;

ALTER TABLE automation_plans
  ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS plan_hash TEXT;

ALTER TABLE execution_steps
  ADD COLUMN IF NOT EXISTS human_summary TEXT;
