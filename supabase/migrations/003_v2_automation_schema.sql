-- v2 Automation Platform Schema
-- Adds support for planning, multi-step execution, approval workflows, and auditability

-- automation_plans: Store parsed + structured plans before execution
create table automation_plans (
  id text primary key,
  workflow_id text not null references workflows(id) on delete cascade,
  created_by text not null,
  plan_json jsonb not null, -- Array of planned steps with action/args/riskLevel
  risk_summary jsonb not null, -- {overallRisk, requiresApproval, highRiskSteps}
  created_at timestamp with time zone default now(),
  constraint fk_created_by foreign key(created_by) references auth.users(id)
);
create index idx_automation_plans_workflow on automation_plans(workflow_id);
create index idx_automation_plans_creator on automation_plans(created_by);

-- execution_runs: Track individual executions of a plan
create table execution_runs (
  id text primary key,
  automation_plan_id text not null references automation_plans(id) on delete cascade,
  workflow_id text not null references workflows(id) on delete cascade,
  executed_by text not null,
  status text not null default 'pending', -- pending, running, paused, success, failed, cancelled
  started_at timestamp with time zone,
  ended_at timestamp with time zone,
  error_message text,
  created_at timestamp with time zone default now(),
  constraint fk_executed_by foreign key(executed_by) references auth.users(id)
);
create index idx_execution_runs_workflow on execution_runs(workflow_id);
create index idx_execution_runs_executor on execution_runs(executed_by);
create index idx_execution_runs_status on execution_runs(status);

-- execution_steps: Individual steps within a run
create table execution_steps (
  id text primary key,
  run_id text not null references execution_runs(id) on delete cascade,
  step_index integer not null,
  executor_type text not null, -- api, os, browser, desktop
  action text not null,
  args_json jsonb not null,
  status text not null default 'pending', -- pending, running, success, failed, skipped
  output_json jsonb,
  error_message text,
  started_at timestamp with time zone,
  ended_at timestamp with time zone,
  created_at timestamp with time zone default now()
);
create index idx_execution_steps_run on execution_steps(run_id);
create index idx_execution_steps_status on execution_steps(status);

-- approval_requests: Track manual approvals for risky steps
create table approval_requests (
  id text primary key,
  run_id text not null references execution_runs(id) on delete cascade,
  step_id text not null references execution_steps(id) on delete cascade,
  status text not null default 'pending', -- pending, approved, rejected
  reviewed_by text,
  reviewed_at timestamp with time zone,
  rejection_reason text,
  created_at timestamp with time zone default now(),
  constraint fk_reviewed_by foreign key(reviewed_by) references auth.users(id)
);
create index idx_approval_requests_run on approval_requests(run_id);
create index idx_approval_requests_status on approval_requests(status);

-- execution_artifacts: Logs, screenshots, outputs from steps
create table execution_artifacts (
  id text primary key,
  step_id text not null references execution_steps(id) on delete cascade,
  kind text not null, -- log, screenshot, json, error
  content_type text,
  url_or_blob text not null,
  created_at timestamp with time zone default now()
);
create index idx_execution_artifacts_step on execution_artifacts(step_id);

-- capabilities: Registry of available actions + risk metadata
create table capabilities (
  id text primary key,
  executor_type text not null, -- api, os, browser, desktop
  action text not null,
  description text,
  risk_level text not null default 'medium', -- low, medium, high, critical
  requires_approval boolean default false,
  scopes text[], -- for API actions
  allowlist_pattern text, -- regex for OS/browser safety
  example_args jsonb,
  created_at timestamp with time zone default now(),
  unique(executor_type, action)
);
create index idx_capabilities_executor on capabilities(executor_type);

-- Run-level and step-level indices for fast queries
create index idx_execution_runs_created at on execution_runs(created_at desc);
create index idx_execution_steps_created on execution_steps(created_at desc);
