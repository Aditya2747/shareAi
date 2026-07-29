-- WhatsApp Business Cloud API connector capabilities.
-- Auth uses a system access token (see WHATSAPP_* env); connect stores it per recipient.

INSERT INTO api_providers (id, name, base_url, auth_type, scopes_required, icon_url)
VALUES (
  'whatsapp',
  'WhatsApp',
  'https://graph.facebook.com',
  'bearer',
  ARRAY['whatsapp_business_messaging'],
  'https://static.whatsapp.net/rsrc.php/v3/yP/r/rYZqPCBaG70.png'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO capabilities (
  id, executor_type, action, description, risk_level, requires_approval, metadata, is_enabled
) VALUES (
  'cap_api_whatsapp_send_message',
  'api',
  'whatsapp.send_message',
  'Send a WhatsApp text message via Cloud API',
  'high',
  TRUE,
  '{"provider":"whatsapp"}'::jsonb,
  TRUE
), (
  'cap_api_whatsapp_send_image',
  'api',
  'whatsapp.send_image',
  'Send an image in a WhatsApp chat via Cloud API',
  'high',
  TRUE,
  '{"provider":"whatsapp"}'::jsonb,
  TRUE
), (
  'cap_api_whatsapp_share_status',
  'api',
  'whatsapp.share_status',
  'Prepare a photo for WhatsApp Status (Web Share / cross-platform helper; Cloud API cannot post Status)',
  'medium',
  TRUE,
  '{"provider":"whatsapp","note":"Opens share helper; user confirms Status on device"}'::jsonb,
  TRUE
)
ON CONFLICT (id) DO NOTHING;
