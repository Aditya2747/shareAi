import {
  ApiActionContext,
  ApiActionPlugin,
  ApiActionRequest,
  ApiActionResult,
  ApiActionValidation,
} from './types';
import { validateFinalUrlHost, validateInitialUrlHost } from '@/lib/v2/url-policy';

const MAX_REDIRECT_HOPS = 5;

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function resolveRedirectUrl(currentUrl: string, locationHeader: string | null): string | null {
  if (!locationHeader) return null;
  try {
    return new URL(locationHeader, currentUrl).toString();
  } catch {
    return null;
  }
}

async function fetchWithValidatedRedirects(
  initialUrl: string,
  init: RequestInit
): Promise<{ response: Response; finalUrl: string } | { error: string }> {
  let currentUrl = initialUrl;

  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
    const response = await fetch(currentUrl, {
      ...init,
      redirect: 'manual',
    });

    if (!isRedirectStatus(response.status)) {
      const finalCheck = validateFinalUrlHost(currentUrl, 'http');
      if (!finalCheck.ok) {
        return { error: finalCheck.reason };
      }
      return { response, finalUrl: currentUrl };
    }

    if (hop === MAX_REDIRECT_HOPS) {
      return { error: `http.request exceeded max redirect hops (${MAX_REDIRECT_HOPS})` };
    }

    const nextUrl = resolveRedirectUrl(currentUrl, response.headers.get('location'));
    if (!nextUrl) {
      return {
        error: `http.request redirect missing/invalid Location header (status ${response.status})`,
      };
    }

    const hopCheck = validateFinalUrlHost(nextUrl, 'http');
    if (!hopCheck.ok) {
      return { error: hopCheck.reason };
    }

    // 303 switches method to GET; 301/302 historically often treated as GET for non-GET.
    const method = String(init.method ?? 'GET').toUpperCase();
    if (response.status === 303 || ((response.status === 301 || response.status === 302) && method !== 'GET' && method !== 'HEAD')) {
      init = {
        ...init,
        method: 'GET',
        body: undefined,
      };
    }

    currentUrl = nextUrl;
  }

  return { error: 'http.request redirect handling failed' };
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

    const hostCheck = validateInitialUrlHost(url, 'http');
    if (!hostCheck.ok) {
      return { ok: false, reason: hostCheck.reason };
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

      const initialCheck = validateInitialUrlHost(url, 'http');
      if (!initialCheck.ok) {
        return { success: false, error: initialCheck.reason };
      }

      const fetched = await fetchWithValidatedRedirects(url, {
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

      if ('error' in fetched) {
        return { success: false, error: fetched.error };
      }

      const { response, finalUrl } = fetched;
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
            finalUrl,
            body: parsedBody as unknown as Record<string, unknown>,
          },
        };
      }

      return {
        success: true,
        output: {
          status: response.status,
          statusText: response.statusText,
          finalUrl,
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
