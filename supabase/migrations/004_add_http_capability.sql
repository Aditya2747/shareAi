INSERT INTO capabilities (
  id,
  executor_type,
  action,
  description,
  risk_level,
  requires_approval,
  metadata,
  is_enabled
)
VALUES (
  'cap_api_http_request',
  'api',
  'http.request',
  'Send an allowlisted outbound HTTP request',
  'high',
  TRUE,
  '{"allowlistEnv":"HTTP_ACTION_ALLOWLIST","notes":"Use for webhook/API integrations when no native connector exists"}'::jsonb,
  TRUE
)
ON CONFLICT (id) DO NOTHING;
