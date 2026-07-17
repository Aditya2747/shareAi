import {
  ApiActionContext,
  ApiActionPlugin,
  ApiActionRequest,
  ApiActionResult,
  ApiActionValidation,
} from './types';

function getAllowedHosts(): string[] {
  const raw = process.env.HTTP_ACTION_ALLOWLIST || '';
  return raw
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

function hostAllowed(urlRaw: string): boolean {
  try {
    const parsed = new URL(urlRaw);
    const hosts = getAllowedHosts();
    return hosts.includes(parsed.host.toLowerCase());
  } catch {
    return false;
  }
}

export const webhookApiPlugin: ApiActionPlugin = {
  id: 'webhook-http',

  supports(action: string): boolean {
    return action === 'http.request';
  },

  async validate(input: ApiActionRequest, _context: ApiActionContext): Promise<ApiActionValidation> {
    const method = String(input.args.method ?? 'POST').toUpperCase();
    const url = String(input.args.url ?? '');
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      return { ok: false, reason: `Unsupported method for http.request: ${method}` };
    }
    if (!url) return { ok: false, reason: 'http.request requires args.url' };
    if (!hostAllowed(url)) {
      return {
        ok: false,
        reason:
          'Target host is not allowlisted. Set HTTP_ACTION_ALLOWLIST (comma-separated hosts).',
      };
    }
    return { ok: true };
  },

  async execute(input: ApiActionRequest, _context: ApiActionContext): Promise<ApiActionResult> {
    try {
      const method = String(input.args.method ?? 'POST').toUpperCase();
      const url = String(input.args.url ?? '');
      const headers =
        typeof input.args.headers === 'object' && input.args.headers
          ? (input.args.headers as Record<string, string>)
          : {};
      const body = input.args.body ?? null;

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body:
          method === 'GET' || method === 'DELETE'
            ? undefined
            : typeof body === 'string'
              ? body
              : JSON.stringify(body ?? {}),
      });

      const contentType = response.headers.get('content-type') || '';
      const parsedBody = contentType.includes('application/json')
        ? await response.json().catch(() => null)
        : await response.text().catch(() => null);

      if (!response.ok) {
        return {
          success: false,
          error: `http.request failed: ${response.status} ${response.statusText}`,
          output: {
            status: response.status,
            statusText: response.statusText,
            body: parsedBody as unknown as Record<string, unknown>,
          },
        };
      }

      return {
        success: true,
        output: {
          status: response.status,
          statusText: response.statusText,
          body: parsedBody as unknown as Record<string, unknown>,
        },
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'http.request execution failed',
      };
    }
  },
};
