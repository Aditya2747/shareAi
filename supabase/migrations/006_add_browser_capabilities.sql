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
    'cap_browser_click',
    'browser',
    'browser.click',
    'Click an element on the current browser page',
    'medium',
    TRUE,
    '{}'::jsonb,
    TRUE
  ),
  (
    'cap_browser_type',
    'browser',
    'browser.type',
    'Type text into an input on the current browser page',
    'medium',
    TRUE,
    '{}'::jsonb,
    TRUE
  ),
  (
    'cap_browser_extract_text',
    'browser',
    'browser.extract_text',
    'Extract text from an element on the current browser page',
    'low',
    TRUE,
    '{}'::jsonb,
    TRUE
  )
ON CONFLICT (id) DO NOTHING;
