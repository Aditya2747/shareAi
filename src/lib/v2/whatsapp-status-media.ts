import crypto from 'crypto';

export type StatusMediaRecord = {
  id: string;
  contentType: string;
  bytes: Buffer;
  caption: string;
  expiresAt: string;
};

/** In-memory short-lived media for Status share helper (single-server / local). */
const MEDIA = new Map<string, StatusMediaRecord>();
const TTL_MS = 60 * 60 * 1000; // 1 hour

function purgeExpired(): void {
  const now = Date.now();
  for (const [id, row] of MEDIA) {
    if (new Date(row.expiresAt).getTime() <= now) MEDIA.delete(id);
  }
}

function parseDataUrl(dataUrl: string): { contentType: string; bytes: Buffer } | null {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/i);
  if (!m) return null;
  return { contentType: m[1], bytes: Buffer.from(m[2], 'base64') };
}

export async function storeStatusMedia(input: {
  imageUrl?: string;
  imageBase64?: string;
  caption?: string;
}): Promise<{ id: string; expiresAt: string }> {
  purgeExpired();
  let contentType = 'image/jpeg';
  let bytes: Buffer | null = null;

  if (input.imageBase64) {
    const raw = input.imageBase64.trim();
    if (raw.startsWith('data:')) {
      const parsed = parseDataUrl(raw);
      if (!parsed) throw new Error('Invalid image_base64 data URL');
      contentType = parsed.contentType;
      bytes = parsed.bytes;
    } else {
      bytes = Buffer.from(raw, 'base64');
    }
  } else if (input.imageUrl) {
    const res = await fetch(input.imageUrl);
    if (!res.ok) throw new Error(`Failed to fetch image_url (${res.status})`);
    const buf = Buffer.from(await res.arrayBuffer());
    bytes = buf;
    contentType = res.headers.get('content-type') || 'image/jpeg';
  }

  if (!bytes || bytes.length === 0) {
    throw new Error('Empty image for WhatsApp Status');
  }
  if (bytes.length > 5 * 1024 * 1024) {
    throw new Error('Status image must be under 5MB');
  }

  const id = `wsm_${crypto.randomBytes(12).toString('hex')}`;
  const expiresAt = new Date(Date.now() + TTL_MS).toISOString();
  MEDIA.set(id, {
    id,
    contentType,
    bytes,
    caption: (input.caption || '').slice(0, 500),
    expiresAt,
  });
  return { id, expiresAt };
}

export function getStatusMedia(id: string): StatusMediaRecord | null {
  purgeExpired();
  const row = MEDIA.get(id);
  if (!row) return null;
  if (new Date(row.expiresAt).getTime() <= Date.now()) {
    MEDIA.delete(id);
    return null;
  }
  return row;
}
