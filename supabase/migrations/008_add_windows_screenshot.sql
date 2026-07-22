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
VALUES
  (
    'cap_os_windows_screenshot',
    'os',
    'windows.screenshot',
    'Capture a screenshot of the primary Windows screen',
    'medium',
    TRUE,
    '{"platform":"windows"}'::jsonb,
    TRUE
  )
ON CONFLICT (id) DO NOTHING;
