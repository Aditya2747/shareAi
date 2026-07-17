import {
  ActionResult,
  ConnectionStatus,
  Connector,
  ConnectorCredentials,
  DiscoverOptions,
  DiscoveredRecord,
  detectPiTypes,
  extractEmail,
} from './types';

/**
 * Google Workspace connector — the reference implementation of the portable
 * Connector contract. It exercises every capability:
 *   - actions:   send_email (Gmail), create_event (Calendar)   [shareAi]
 *   - discovery: scan Gmail metadata for PII                    [Prooflyt]
 *
 * Authenticated purely via the access token passed in `creds` — no storage
 * or app-specific code, so it ports to another project as-is.
 */

const GMAIL_BASE = 'https://www.googleapis.com/gmail/v1';
const CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3';

function authHeaders(creds: ConnectorCredentials) {
  return {
    Authorization: `Bearer ${creds.accessToken}`,
    'Content-Type': 'application/json',
  };
}

function isPlaceholderEmail(to: string): boolean {
  const lower = to.trim().toLowerCase();
  if (!lower) return true;
  if (lower.startsWith('your_email@') || lower.startsWith('youremail@')) return true;
  // Old heuristic default that caused silent "success" with no real delivery.
  if (lower === 'team@example.com' || lower === 'me@me.com') return true;
  return false;
}

async function sendEmail(
  params: Record<string, unknown>,
  creds: ConnectorCredentials
): Promise<ActionResult> {
  const to = String(params.to ?? '').trim();
  const subject = String(params.subject ?? '');
  const body = String(params.body ?? params.text ?? '');
  if (!to) return { ok: false, error: 'send_email requires a "to" address' };
  if (isPlaceholderEmail(to)) {
    return {
      ok: false,
      error: `Refusing to send to placeholder address "${to}". Include a real recipient email in the prompt.`,
    };
  }

  const mime = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    body,
  ].join('\r\n');
  const raw = Buffer.from(mime)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const res = await fetch(`${GMAIL_BASE}/users/me/messages/send`, {
    method: 'POST',
    headers: authHeaders(creds),
    body: JSON.stringify({ raw }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: `Gmail send failed: ${data?.error?.message || res.statusText}` };
  }
  return {
    ok: true,
    data: { messageId: data.id, threadId: data.threadId, to, subject },
  };
}

async function createEvent(
  params: Record<string, unknown>,
  creds: ConnectorCredentials
): Promise<ActionResult> {
  const timeZone =
    typeof params.timeZone === 'string' && params.timeZone
      ? params.timeZone
      : process.env.CALENDAR_DEFAULT_TIMEZONE ||
        Intl.DateTimeFormat().resolvedOptions().timeZone ||
        'UTC';
  const summary = String(params.title ?? params.summary ?? 'Event');
  const startTime = params.start_time;
  const endTime = params.end_time;
  if (!startTime || !endTime) {
    return { ok: false, error: 'create_event requires start_time and end_time' };
  }

  const res = await fetch(`${CALENDAR_BASE}/calendars/primary/events`, {
    method: 'POST',
    headers: authHeaders(creds),
    body: JSON.stringify({
      summary,
      description: params.description ?? '',
      start: { dateTime: startTime, timeZone },
      end: { dateTime: endTime, timeZone },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: `Calendar create failed: ${data?.error?.message || res.statusText}` };
  }
  return {
    ok: true,
    data: {
      eventId: data.id,
      eventLink: data.htmlLink,
      summary: data.summary ?? summary,
      start: startTime,
      end: endTime,
      timeZone,
    },
  };
}

export const googleWorkspaceConnector: Connector = {
  id: 'google-workspace',
  name: 'Google Workspace',
  category: 'productivity',
  authProviders: ['google-gmail', 'google-calendar'],
  supportedActions: ['send_email', 'create_event'],
  supportsDiscovery: true,

  async testConnection(creds: ConnectorCredentials): Promise<ConnectionStatus> {
    // Gmail profile is the cheapest scoped call. 401 = bad token; 403 = token
    // valid but missing this scope (still a usable connection for other scopes).
    const res = await fetch(`${GMAIL_BASE}/users/me/profile`, {
      headers: { Authorization: `Bearer ${creds.accessToken}` },
    });
    if (res.status === 401) {
      return { ok: false, error: 'Token invalid or expired' };
    }
    return { ok: true, info: { status: res.status } };
  },

  async executeAction(action, params, creds): Promise<ActionResult> {
    switch (action) {
      case 'send_email':
        return sendEmail(params, creds);
      case 'create_event':
        return createEvent(params, creds);
      default:
        return { ok: false, error: `Unsupported Google Workspace action: ${action}` };
    }
  },

  /**
   * Scan recent Gmail messages and surface PII metadata. Privacy-first: we read
   * only headers + the short snippet, never store raw bodies, and return only
   * detected PII *types* plus the counterparty email for identity resolution.
   */
  async discover(creds: ConnectorCredentials, options?: DiscoverOptions): Promise<DiscoveredRecord[]> {
    const max = Math.min(options?.maxResults ?? 10, 50);
    const now = options?.now ?? new Date(0).toISOString();

    const listUrl = new URL(`${GMAIL_BASE}/users/me/messages`);
    listUrl.searchParams.set('maxResults', String(max));
    if (options?.query) listUrl.searchParams.set('q', options.query);

    const listRes = await fetch(listUrl.toString(), {
      headers: { Authorization: `Bearer ${creds.accessToken}` },
    });
    if (!listRes.ok) {
      throw new Error(`Gmail list failed: ${listRes.statusText}`);
    }
    const listData = (await listRes.json()) as { messages?: { id: string }[] };
    const ids = (listData.messages ?? []).map((m) => m.id);

    const records: DiscoveredRecord[] = [];
    for (const id of ids) {
      const msgUrl = new URL(`${GMAIL_BASE}/users/me/messages/${id}`);
      msgUrl.searchParams.set('format', 'metadata');
      ['From', 'To', 'Subject'].forEach((h) => msgUrl.searchParams.append('metadataHeaders', h));

      const msgRes = await fetch(msgUrl.toString(), {
        headers: { Authorization: `Bearer ${creds.accessToken}` },
      });
      if (!msgRes.ok) continue; // skip individual failures, keep going

      const msg = (await msgRes.json()) as {
        snippet?: string;
        payload?: { headers?: { name: string; value: string }[] };
      };
      const headers = msg.payload?.headers ?? [];
      const get = (n: string) => headers.find((h) => h.name.toLowerCase() === n.toLowerCase())?.value ?? '';
      const from = get('From');
      const subject = get('Subject');

      const haystack = `${from} ${get('To')} ${subject} ${msg.snippet ?? ''}`;
      records.push({
        connectorId: 'google-workspace',
        recordType: 'email',
        externalId: id,
        subjectEmail: extractEmail(from),
        piTypes: detectPiTypes(haystack),
        metadata: { subject, from },
        discoveredAt: now,
      });
    }
    return records;
  },
};
