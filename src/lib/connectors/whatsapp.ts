import {
  ActionResult,
  ConnectionStatus,
  Connector,
  ConnectorCredentials,
} from './types';
import { resolveAppUrl, buildWhatsAppShareLink } from '@/lib/app-url';
import { storeStatusMedia } from '@/lib/v2/whatsapp-status-media';

/**
 * WhatsApp Business Cloud API connector.
 *
 * - send_message / send_image: official Cloud API (requires WHATSAPP_* env + connected token)
 * - share_status: Cloud API cannot post Status; we stage the photo and return a
 *   cross-platform helper URL (Web Share on mobile; download+instructions on desktop)
 */

const GRAPH = `https://graph.facebook.com/${process.env.WHATSAPP_API_VERSION || 'v21.0'}`;

function phoneNumberId(): string {
  const id = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
  if (!id) throw new Error('WHATSAPP_PHONE_NUMBER_ID is not configured');
  return id;
}

function accessToken(creds: ConnectorCredentials): string {
  const token = creds.accessToken || process.env.WHATSAPP_ACCESS_TOKEN || '';
  if (!token) {
    throw new Error(
      'WhatsApp access token missing. Connect WhatsApp or set WHATSAPP_ACCESS_TOKEN.'
    );
  }
  return token;
}

function normalizeTo(raw: string): string {
  return String(raw || '').replace(/\D/g, '');
}

async function graphPost(
  path: string,
  token: string,
  body: Record<string, unknown>
): Promise<{ ok: boolean; data: Record<string, unknown>; status: number }> {
  const res = await fetch(`${GRAPH}/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, data, status: res.status };
}

async function sendText(
  params: Record<string, unknown>,
  creds: ConnectorCredentials
): Promise<ActionResult> {
  const to = normalizeTo(String(params.to ?? params.phone ?? ''));
  const text = String(params.text ?? params.body ?? params.message ?? '').trim();
  if (!to) return { ok: false, error: 'send_message requires "to" (E.164 phone digits)' };
  if (!text) return { ok: false, error: 'send_message requires text' };

  const token = accessToken(creds);
  const { ok, data } = await graphPost(`${phoneNumberId()}/messages`, token, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { preview_url: true, body: text },
  });
  if (!ok) {
    const err = data.error as { message?: string } | undefined;
    return { ok: false, error: err?.message || `WhatsApp send failed (${JSON.stringify(data)})` };
  }
  const messages = data.messages as Array<{ id?: string }> | undefined;
  return {
    ok: true,
    data: {
      messageId: messages?.[0]?.id,
      to,
      waMeLink: buildWhatsAppShareLink(text, to),
    },
  };
}

async function sendImage(
  params: Record<string, unknown>,
  creds: ConnectorCredentials
): Promise<ActionResult> {
  const to = normalizeTo(String(params.to ?? params.phone ?? ''));
  const imageUrl = String(params.image_url ?? params.imageUrl ?? params.url ?? '').trim();
  const caption = String(params.caption ?? params.text ?? params.body ?? '').trim();
  if (!to) return { ok: false, error: 'send_image requires "to" (phone)' };
  if (!imageUrl) {
    return {
      ok: false,
      error: 'send_image requires image_url (public https URL of the photo)',
    };
  }

  const token = accessToken(creds);
  const image: Record<string, string> = { link: imageUrl };
  if (caption) image.caption = caption.slice(0, 1024);

  const { ok, data } = await graphPost(`${phoneNumberId()}/messages`, token, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'image',
    image,
  });
  if (!ok) {
    const err = data.error as { message?: string } | undefined;
    return { ok: false, error: err?.message || `WhatsApp image send failed` };
  }
  const messages = data.messages as Array<{ id?: string }> | undefined;
  return {
    ok: true,
    data: {
      messageId: messages?.[0]?.id,
      to,
      imageUrl,
    },
  };
}

/**
 * Stage photo for Status. Meta Cloud API cannot publish Status; we return a
 * helper page that works on mobile (Web Share), desktop, and WhatsApp Web.
 */
async function shareStatus(
  params: Record<string, unknown>,
  _creds: ConnectorCredentials
): Promise<ActionResult> {
  const imageUrl = String(params.image_url ?? params.imageUrl ?? params.url ?? '').trim();
  const imageBase64 = String(params.image_base64 ?? params.imageBase64 ?? '').trim();
  const caption = String(params.caption ?? params.text ?? params.body ?? '').trim();

  if (!imageUrl && !imageBase64) {
    return {
      ok: false,
      error:
        'share_status requires image_url or image_base64 (photo attached / linked in the prompt)',
    };
  }

  const media = await storeStatusMedia({
    imageUrl: imageUrl || undefined,
    imageBase64: imageBase64 || undefined,
    caption,
  });

  const appUrl = resolveAppUrl();
  const sharePageUrl = `${appUrl}/share/whatsapp-status?m=${encodeURIComponent(media.id)}`;
  const deepLink = buildWhatsAppShareLink(
    caption
      ? `${caption}\n\nPhoto ready — open to add to Status:\n${sharePageUrl}`
      : `Add this photo to your WhatsApp Status:\n${sharePageUrl}`
  );

  return {
    ok: true,
    data: {
      mode: 'status_helper',
      mediaId: media.id,
      sharePageUrl,
      whatsappDeepLink: deepLink,
      note:
        'WhatsApp Cloud API cannot post Status. Open sharePageUrl on your phone and tap “Add to Status”, or use whatsappDeepLink on any device.',
      expiresAt: media.expiresAt,
    },
  };
}

export const whatsappConnector: Connector = {
  id: 'whatsapp',
  name: 'WhatsApp',
  category: 'communication',
  authProviders: ['whatsapp'],
  supportedActions: ['send_message', 'send_image', 'share_status'],
  supportsDiscovery: false,

  async testConnection(creds: ConnectorCredentials): Promise<ConnectionStatus> {
    try {
      const token = accessToken(creds);
      const id = phoneNumberId();
      const res = await fetch(`${GRAPH}/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          ok: false,
          error: (data as { error?: { message?: string } })?.error?.message || 'WhatsApp auth failed',
        };
      }
      return {
        ok: true,
        info: {
          phoneNumberId: id,
          displayPhone: (data as { display_phone_number?: string }).display_phone_number,
        },
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'WhatsApp connection test failed',
      };
    }
  },

  async executeAction(action, params, creds): Promise<ActionResult> {
    switch (action) {
      case 'send_message':
        return sendText(params, creds);
      case 'send_image':
        return sendImage(params, creds);
      case 'share_status':
        return shareStatus(params, creds);
      default:
        return { ok: false, error: `Unsupported WhatsApp action: ${action}` };
    }
  },
};

export function isWhatsAppConfigured(): boolean {
  return Boolean(
    process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID
  );
}
