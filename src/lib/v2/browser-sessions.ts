import crypto from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';
import { encryptToken, decryptToken } from '@/lib/encryption';

export type PlaywrightStorageState = {
  cookies: Array<Record<string, unknown>>;
  origins: Array<Record<string, unknown>>;
};

export interface BrowserSessionSummary {
  id: string;
  domain: string;
  expiresAt: string;
  updatedAt: string;
}

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function normalizeDomain(hostOrUrl: string): string {
  let host = hostOrUrl.trim().toLowerCase();
  try {
    if (host.includes('://')) {
      host = new URL(host).hostname;
    }
  } catch {
    // keep as-is
  }
  host = host.replace(/^\./, '').replace(/^www\./, '');
  return host;
}

function nowIso(): string {
  return new Date().toISOString();
}

export async function listBrowserSessions(
  recipientId: string
): Promise<BrowserSessionSummary[]> {
  const { data, error } = await supabaseAdmin
    .from('browser_sessions')
    .select('id, domain, expires_at, updated_at')
    .eq('recipient_id', recipientId)
    .gt('expires_at', nowIso())
    .order('updated_at', { ascending: false });
  if (error) throw new Error(`Failed to list browser sessions: ${error.message}`);
  return (data ?? []).map((row) => ({
    id: row.id as string,
    domain: row.domain as string,
    expiresAt: row.expires_at as string,
    updatedAt: row.updated_at as string,
  }));
}

export async function getBrowserSessionStorageState(
  recipientId: string,
  domain: string
): Promise<PlaywrightStorageState | null> {
  const normalized = normalizeDomain(domain);
  const { data, error } = await supabaseAdmin
    .from('browser_sessions')
    .select('encrypted_session_blob, expires_at')
    .eq('recipient_id', recipientId)
    .eq('domain', normalized)
    .maybeSingle();
  if (error) throw new Error(`Failed to load browser session: ${error.message}`);
  if (!data) return null;
  if (new Date(data.expires_at as string).getTime() <= Date.now()) {
    await revokeBrowserSession(recipientId, normalized);
    return null;
  }
  try {
    const json = decryptToken(data.encrypted_session_blob as string);
    return JSON.parse(json) as PlaywrightStorageState;
  } catch {
    return null;
  }
}

export async function upsertBrowserSession(input: {
  recipientId: string;
  domain: string;
  storageState: PlaywrightStorageState;
  ttlMs?: number;
}): Promise<void> {
  const domain = normalizeDomain(input.domain);
  if (!domain) throw new Error('Invalid domain for browser session');
  const blob = encryptToken(JSON.stringify(input.storageState));
  const expiresAt = new Date(
    Date.now() + (input.ttlMs ?? DEFAULT_TTL_MS)
  ).toISOString();
  const id = `bs_${crypto
    .createHash('sha256')
    .update(`${input.recipientId}:${domain}`)
    .digest('hex')
    .slice(0, 32)}`;

  const { error } = await supabaseAdmin.from('browser_sessions').upsert(
    {
      id,
      recipient_id: input.recipientId,
      domain,
      encrypted_session_blob: blob,
      expires_at: expiresAt,
      updated_at: nowIso(),
      created_at: nowIso(),
    },
    { onConflict: 'recipient_id,domain' }
  );
  if (error) throw new Error(`Failed to save browser session: ${error.message}`);
}

/** Persist storage state under each distinct cookie/origin domain. */
export async function persistStorageStateForDomains(input: {
  recipientId: string;
  storageState: PlaywrightStorageState;
  primaryDomain?: string | null;
  ttlMs?: number;
}): Promise<string[]> {
  const domains = new Set<string>();
  if (input.primaryDomain) {
    domains.add(normalizeDomain(input.primaryDomain));
  }
  for (const cookie of input.storageState.cookies ?? []) {
    const d = cookie.domain;
    if (typeof d === 'string' && d) domains.add(normalizeDomain(d));
  }
  for (const origin of input.storageState.origins ?? []) {
    const o = origin.origin;
    if (typeof o === 'string' && o) {
      try {
        domains.add(normalizeDomain(new URL(o).hostname));
      } catch {
        /* skip */
      }
    }
  }
  domains.delete('');
  const saved: string[] = [];
  for (const domain of domains) {
    await upsertBrowserSession({
      recipientId: input.recipientId,
      domain,
      storageState: input.storageState,
      ttlMs: input.ttlMs,
    });
    saved.push(domain);
  }
  return saved;
}

export async function revokeBrowserSession(
  recipientId: string,
  domain: string
): Promise<void> {
  const normalized = normalizeDomain(domain);
  const { error } = await supabaseAdmin
    .from('browser_sessions')
    .delete()
    .eq('recipient_id', recipientId)
    .eq('domain', normalized);
  if (error) throw new Error(`Failed to revoke browser session: ${error.message}`);
}

export async function revokeBrowserSessionById(
  recipientId: string,
  sessionId: string
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('browser_sessions')
    .delete()
    .eq('recipient_id', recipientId)
    .eq('id', sessionId);
  if (error) throw new Error(`Failed to revoke browser session: ${error.message}`);
}

export async function revokeAllBrowserSessions(recipientId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('browser_sessions')
    .delete()
    .eq('recipient_id', recipientId);
  if (error) throw new Error(`Failed to revoke browser sessions: ${error.message}`);
}
