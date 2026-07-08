import { ActionResult, ConnectionStatus, Connector, ConnectorCredentials } from './types';

/**
 * Slack connector — action-only (send a channel message). Same portable
 * contract as Google Workspace; no discovery surface for the MVP.
 */
export const slackConnector: Connector = {
  id: 'slack',
  name: 'Slack',
  category: 'communication',
  authProviders: ['slack'],
  supportedActions: ['send_message'],
  supportsDiscovery: false,

  async testConnection(creds: ConnectorCredentials): Promise<ConnectionStatus> {
    const res = await fetch('https://slack.com/api/auth.test', {
      method: 'POST',
      headers: { Authorization: `Bearer ${creds.accessToken}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) return { ok: false, error: data.error || 'auth.test failed' };
    return { ok: true, info: { team: data.team, user: data.user } };
  },

  async executeAction(action, params, creds): Promise<ActionResult> {
    if (action !== 'send_message') {
      return { ok: false, error: `Unsupported Slack action: ${action}` };
    }
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ channel: params.channel, text: params.text }),
    });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) {
      return { ok: false, error: `Slack API error: ${data.error || res.statusText}` };
    }
    return { ok: true, data: { messageTs: data.ts, channel: data.channel } };
  },
};
