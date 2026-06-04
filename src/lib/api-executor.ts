import { OAuthTokenManager } from './oauth-token-manager';
import { APIRegistry } from './api-registry';

interface APIExecutionContext {
  userId: string;
  providerId: string;
  action: string;
  parameters: Record<string, unknown>;
}

export class APIExecutor {
  static async executeGoogleCalendar(userId: string, action: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const accessToken = await OAuthTokenManager.getAccessToken(userId, 'google-calendar');
    if (!accessToken) throw new Error('No Google Calendar access token found.');
    if (action === 'create_event') {
      const response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summary: params.title,
          description: params.description || '',
          start: { dateTime: params.start_time },
          end: { dateTime: params.end_time },
        }),
      });
      if (!response.ok) throw new Error(`Failed to create calendar event: ${response.statusText}`);
      const data = await response.json();
      return { eventId: data.id, eventLink: data.htmlLink, summary: data.summary };
    }
    throw new Error(`Unknown Google Calendar action: ${action}`);
  }

  static async executeSlack(userId: string, action: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const accessToken = await OAuthTokenManager.getAccessToken(userId, 'slack');
    if (!accessToken) throw new Error('No Slack access token found.');
    if (action === 'send_message') {
      const response = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: params.channel, text: params.text }),
      });
      if (!response.ok) throw new Error(`Failed to send Slack message: ${response.statusText}`);
      const data = await response.json();
      if (!data.ok) throw new Error(`Slack API error: ${data.error}`);
      return { messageTs: data.ts, channel: data.channel, text: params.text };
    }
    throw new Error(`Unknown Slack action: ${action}`);
  }

  static async executeGmail(userId: string, action: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const accessToken = await OAuthTokenManager.getAccessToken(userId, 'google-gmail');
    if (!accessToken) throw new Error('No Gmail access token found.');
    if (action === 'send_email') {
      const to = params.to as string;
      const subject = params.subject as string;
      const body = params.body as string;
      const email = `To: ${to}\r\nSubject: ${subject}\r\n\r\n${body}`;
      const encodedEmail = Buffer.from(email).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
      const response = await fetch('https://www.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw: encodedEmail }),
      });
      if (!response.ok) throw new Error(`Failed to send email: ${response.statusText}`);
      const data = await response.json();
      return { messageId: data.id, threadId: data.threadId };
    }
    throw new Error(`Unknown Gmail action: ${action}`);
  }

  static async execute(context: APIExecutionContext): Promise<Record<string, unknown>> {
    const provider = await APIRegistry.getProvider(context.providerId);
    if (!provider) throw new Error(`Unknown provider: ${context.providerId}`);
    switch (context.providerId) {
      case 'google-calendar':
        return this.executeGoogleCalendar(context.userId, context.action, context.parameters);
      case 'slack':
        return this.executeSlack(context.userId, context.action, context.parameters);
      case 'google-gmail':
        return this.executeGmail(context.userId, context.action, context.parameters);
      default:
        throw new Error(`No executor for provider: ${context.providerId}`);
    }
  }
}
