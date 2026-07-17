import { CapabilityDefinition } from './types';

export const BUILTIN_CAPABILITIES: CapabilityDefinition[] = [
  {
    id: 'cap_api_slack_send_message',
    executorType: 'api',
    action: 'slack.send_message',
    description: 'Send a Slack message',
    riskLevel: 'medium',
    requiresApproval: true,
    metadata: { provider: 'slack' },
  },
  {
    id: 'cap_api_google_calendar_create_event',
    executorType: 'api',
    action: 'google-calendar.create_event',
    description: 'Create a Google Calendar event',
    riskLevel: 'low',
    requiresApproval: false,
    metadata: { provider: 'google-calendar' },
  },
  {
    id: 'cap_api_google_gmail_send_email',
    executorType: 'api',
    action: 'google-gmail.send_email',
    description: 'Send an email with Gmail',
    riskLevel: 'high',
    requiresApproval: true,
    metadata: { provider: 'google-gmail' },
  },
  {
    id: 'cap_os_windows_set_theme',
    executorType: 'os',
    action: 'windows.set_theme',
    description: 'Set Windows theme mode',
    riskLevel: 'high',
    requiresApproval: true,
    metadata: { platform: 'windows' },
  },
  {
    id: 'cap_browser_open_url',
    executorType: 'browser',
    action: 'browser.open_url',
    description: 'Open URL in browser automation context',
    riskLevel: 'medium',
    requiresApproval: true,
    metadata: {},
  },
  {
    id: 'cap_browser_click',
    executorType: 'browser',
    action: 'browser.click',
    description: 'Click an element on the current browser page',
    riskLevel: 'medium',
    requiresApproval: true,
    metadata: {},
  },
  {
    id: 'cap_browser_type',
    executorType: 'browser',
    action: 'browser.type',
    description: 'Type text into an input on the current browser page',
    riskLevel: 'medium',
    requiresApproval: true,
    metadata: {},
  },
  {
    id: 'cap_browser_extract_text',
    executorType: 'browser',
    action: 'browser.extract_text',
    description: 'Extract text from an element on the current browser page',
    riskLevel: 'low',
    requiresApproval: true,
    metadata: {},
  },
  {
    id: 'cap_api_http_request',
    executorType: 'api',
    action: 'http.request',
    description: 'Send an allowlisted outbound HTTP request',
    riskLevel: 'high',
    requiresApproval: true,
    metadata: {
      allowlistEnv: 'HTTP_ACTION_ALLOWLIST',
      notes: 'Use for webhook/API integrations when no native connector exists',
    },
  },
];

export function getCapabilityByAction(action: string): CapabilityDefinition | null {
  return BUILTIN_CAPABILITIES.find((c) => c.action === action) ?? null;
}
