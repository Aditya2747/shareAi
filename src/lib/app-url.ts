/**
 * Resolve a public app base URL that works for the current client
 * (localhost, LAN IP, or reverse-proxy / ngrok / production).
 */
export function resolveAppUrl(opts?: {
  forwardedHost?: string | null;
  forwardedProto?: string | null;
  host?: string | null;
}): string {
  const envUrl = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '');
  const host = (opts?.forwardedHost || opts?.host || '').split(',')[0]?.trim();
  if (host) {
    const proto =
      (opts?.forwardedProto || '').split(',')[0]?.trim() ||
      (host.includes('localhost') || /^\d+\.\d+\.\d+\.\d+/.test(host.split(':')[0])
        ? 'http'
        : 'https');
    return `${proto}://${host}`.replace(/\/$/, '');
  }
  return envUrl || 'http://localhost:3000';
}

export function resolveAppUrlFromHeaders(headers: Headers): string {
  return resolveAppUrl({
    forwardedHost: headers.get('x-forwarded-host'),
    forwardedProto: headers.get('x-forwarded-proto'),
    host: headers.get('host'),
  });
}

/** Universal WhatsApp click-to-chat / prefill link (mobile app, desktop app, web.whatsapp.com). */
export function buildWhatsAppShareLink(text: string, phoneE164?: string): string {
  const q = encodeURIComponent(text);
  const digits = (phoneE164 || '').replace(/\D/g, '');
  if (digits) return `https://wa.me/${digits}?text=${q}`;
  return `https://wa.me/?text=${q}`;
}
