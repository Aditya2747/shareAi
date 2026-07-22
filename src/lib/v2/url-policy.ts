export type UrlAllowlistKind = 'http' | 'browser';

export type UrlHostValidation =
  | { ok: true; host: string; url: URL }
  | { ok: false; reason: string };

function allowlistEnvKey(kind: UrlAllowlistKind): string {
  return kind === 'http' ? 'HTTP_ACTION_ALLOWLIST' : 'BROWSER_ACTION_ALLOWLIST';
}

/** Parse comma-separated host allowlist from env (lowercased, trimmed). */
export function getAllowlistedHosts(kind: UrlAllowlistKind): string[] {
  const raw = process.env[allowlistEnvKey(kind)] || '';
  return raw
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

function parseHttpUrl(urlRaw: string): { ok: true; url: URL } | { ok: false; reason: string } {
  try {
    const url = new URL(urlRaw);
    if (!['http:', 'https:'].includes(url.protocol)) {
      return { ok: false, reason: 'Only http/https URLs are allowed' };
    }
    return { ok: true, url };
  } catch {
    return { ok: false, reason: 'Invalid URL' };
  }
}

/**
 * HTTP: host must appear in HTTP_ACTION_ALLOWLIST (empty list denies all).
 * Browser: if BROWSER_ACTION_ALLOWLIST is empty, any http/https host is allowed;
 * otherwise host must be listed.
 */
function hostPermitted(host: string, kind: UrlAllowlistKind): boolean {
  const allowlist = getAllowlistedHosts(kind);
  const normalized = host.toLowerCase();
  if (kind === 'browser') {
    if (allowlist.length === 0) return true;
    return allowlist.includes(normalized);
  }
  return allowlist.includes(normalized);
}

function allowlistHint(kind: UrlAllowlistKind): string {
  return kind === 'http'
    ? 'Set HTTP_ACTION_ALLOWLIST (comma-separated hosts).'
    : 'Set BROWSER_ACTION_ALLOWLIST (comma-separated hosts).';
}

/** Pre-request / pre-navigation host check. */
export function validateInitialUrlHost(
  urlRaw: string,
  kind: UrlAllowlistKind
): UrlHostValidation {
  const parsed = parseHttpUrl(urlRaw);
  if (!parsed.ok) return parsed;

  const host = parsed.url.host.toLowerCase();
  if (!hostPermitted(host, kind)) {
    return {
      ok: false,
      reason: `Target host is not allowlisted. ${allowlistHint(kind)}`,
    };
  }
  return { ok: true, host, url: parsed.url };
}

/**
 * Post-redirect / post-navigation host check.
 * Same allowlist rules as initial; distinct error messaging for audit clarity.
 */
export function validateFinalUrlHost(
  urlRaw: string,
  kind: UrlAllowlistKind
): UrlHostValidation {
  const parsed = parseHttpUrl(urlRaw);
  if (!parsed.ok) {
    return {
      ok: false,
      reason: `Final URL invalid after redirect/navigation: ${parsed.reason}`,
    };
  }

  const host = parsed.url.host.toLowerCase();
  if (!hostPermitted(host, kind)) {
    return {
      ok: false,
      reason: `Final URL host is not allowlisted after redirect/navigation. ${allowlistHint(kind)}`,
    };
  }
  return { ok: true, host, url: parsed.url };
}
