/**
 * Portable connector framework.
 *
 * This file has NO dependency on shareAi's storage (Supabase) or auth. A
 * connector is a pure unit that, given credentials, can (a) execute actions
 * and (b) discover records. The host application is responsible for obtaining
 * and refreshing credentials and for persisting whatever the connector returns.
 *
 * That boundary is deliberate: this `connectors/` folder can be lifted into
 * another project (e.g. Prooflyt) unchanged — only the credential-providing
 * glue differs per host.
 */

export type ConnectorCategory =
  | 'productivity'
  | 'communication'
  | 'crm'
  | 'payments'
  | 'hr'
  | 'storage';

/** Provider-agnostic credentials handed to a connector at call time. */
export interface ConnectorCredentials {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: Date | null;
  scopes?: string[];
}

export interface ConnectionStatus {
  ok: boolean;
  error?: string;
  info?: Record<string, unknown>;
}

/** Result of an "action" call (shareAi: do something). */
export interface ActionResult {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

/**
 * A record surfaced by discovery (Prooflyt: find PII / data).
 *
 * `subjectEmail` is the key field for identity resolution — it lets the host
 * link "this record in Gmail = this person in Razorpay = this person in Zoho"
 * into one Data Principal. `piTypes` are the detected categories of personal
 * data; raw values are intentionally NOT carried (privacy-first).
 */
export interface DiscoveredRecord {
  connectorId: string;
  recordType: string; // 'email' | 'event' | 'contact' | ...
  externalId: string;
  subjectEmail?: string | null;
  piTypes: string[]; // ['email','name','phone','aadhaar','pan',...]
  metadata: Record<string, unknown>;
  discoveredAt: string; // ISO timestamp, stamped by the host/connector caller
}

export interface DiscoverOptions {
  maxResults?: number;
  /** Provider-native query string (e.g. a Gmail search expression). */
  query?: string;
  /** ISO timestamp to stamp discovered records with (host supplies it). */
  now?: string;
}

export interface Connector {
  id: string;
  name: string;
  category: ConnectorCategory;
  /** OAuth provider id(s) (see oauth-providers) this connector authenticates with. */
  authProviders: string[];
  /** Action names this connector understands. */
  supportedActions: string[];
  supportsDiscovery: boolean;

  /** Cheapest authenticated call to confirm the credential works. */
  testConnection(creds: ConnectorCredentials): Promise<ConnectionStatus>;

  /** Action mode — perform a side-effecting operation. */
  executeAction(
    action: string,
    params: Record<string, unknown>,
    creds: ConnectorCredentials
  ): Promise<ActionResult>;

  /** Discovery mode — read and surface records/PII (optional per connector). */
  discover?(
    creds: ConnectorCredentials,
    options?: DiscoverOptions
  ): Promise<DiscoveredRecord[]>;
}

/**
 * Lightweight PII detection shared by discovery implementations.
 * Indian-context patterns (Aadhaar, PAN, +91 phone) plus email.
 */
export function detectPiTypes(text: string): string[] {
  const types: string[] = [];
  if (!text) return types;
  if (/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(text)) types.push('email');
  if (/\b\d{4}\s?\d{4}\s?\d{4}\b/.test(text)) types.push('aadhaar');
  if (/\b[A-Z]{5}\d{4}[A-Z]\b/.test(text)) types.push('pan');
  if (/(?:\+91[-\s]?)?[6-9]\d{9}\b/.test(text)) types.push('phone');
  return types;
}

/** Extract the bare email address from a header like `Name <a@b.com>`. */
export function extractEmail(headerValue: string): string | null {
  if (!headerValue) return null;
  const angle = headerValue.match(/<([^>]+)>/);
  const candidate = angle ? angle[1] : headerValue;
  const m = candidate.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return m ? m[0].toLowerCase() : null;
}
