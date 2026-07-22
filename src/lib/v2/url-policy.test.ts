import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getAllowlistedHosts,
  validateFinalUrlHost,
  validateInitialUrlHost,
} from './url-policy';
import { webhookApiPlugin } from './api-plugins/webhook-plugin';

describe('url-policy', () => {
  const originalHttp = process.env.HTTP_ACTION_ALLOWLIST;
  const originalBrowser = process.env.BROWSER_ACTION_ALLOWLIST;

  afterEach(() => {
    if (originalHttp === undefined) delete process.env.HTTP_ACTION_ALLOWLIST;
    else process.env.HTTP_ACTION_ALLOWLIST = originalHttp;
    if (originalBrowser === undefined) delete process.env.BROWSER_ACTION_ALLOWLIST;
    else process.env.BROWSER_ACTION_ALLOWLIST = originalBrowser;
  });

  it('parses comma-separated allowlists', () => {
    process.env.HTTP_ACTION_ALLOWLIST = ' Hooks.Example.com , api.example.com ';
    expect(getAllowlistedHosts('http')).toEqual(['hooks.example.com', 'api.example.com']);
  });

  it('validateInitialUrlHost blocks non-allowlisted HTTP hosts', () => {
    process.env.HTTP_ACTION_ALLOWLIST = 'hooks.example.com';
    const denied = validateInitialUrlHost('https://evil.example/path', 'http');
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.reason).toMatch(/not allowlisted/i);

    const allowed = validateInitialUrlHost('https://hooks.example.com/hook', 'http');
    expect(allowed.ok).toBe(true);
  });

  it('HTTP empty allowlist denies all hosts', () => {
    process.env.HTTP_ACTION_ALLOWLIST = '';
    const result = validateInitialUrlHost('https://hooks.example.com/hook', 'http');
    expect(result.ok).toBe(false);
  });

  it('browser empty allowlist allows any http(s) host', () => {
    process.env.BROWSER_ACTION_ALLOWLIST = '';
    const result = validateInitialUrlHost('https://example.com', 'browser');
    expect(result.ok).toBe(true);
  });

  it('validateFinalUrlHost blocks redirect to non-allowlisted host', () => {
    process.env.HTTP_ACTION_ALLOWLIST = 'safe.example';
    process.env.BROWSER_ACTION_ALLOWLIST = 'safe.example';

    const httpFinal = validateFinalUrlHost('https://evil.example/leak', 'http');
    expect(httpFinal.ok).toBe(false);
    if (!httpFinal.ok) {
      expect(httpFinal.reason).toMatch(/Final URL host is not allowlisted/i);
    }

    const browserFinal = validateFinalUrlHost('https://evil.example/leak', 'browser');
    expect(browserFinal.ok).toBe(false);
    if (!browserFinal.ok) {
      expect(browserFinal.reason).toMatch(/Final URL host is not allowlisted/i);
    }
  });

  it('rejects non-http(s) schemes', () => {
    process.env.BROWSER_ACTION_ALLOWLIST = '';
    const result = validateInitialUrlHost('file:///etc/passwd', 'browser');
    expect(result.ok).toBe(false);
  });
});

describe('webhook-plugin redirect host validation', () => {
  const originalHttp = process.env.HTTP_ACTION_ALLOWLIST;
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    if (originalHttp === undefined) delete process.env.HTTP_ACTION_ALLOWLIST;
    else process.env.HTTP_ACTION_ALLOWLIST = originalHttp;
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('blocks when a redirect hop lands on a non-allowlisted host', async () => {
    process.env.HTTP_ACTION_ALLOWLIST = 'allowed.example';

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://allowed.example/start') {
        return new Response(null, {
          status: 302,
          headers: { Location: 'https://evil.example/steal' },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    const result = await webhookApiPlugin.execute(
      {
        action: 'http.request',
        args: { method: 'POST', url: 'https://allowed.example/start', body: { ok: true } },
        requiredPermissions: [],
      },
      { userId: 'u1' }
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Final URL host is not allowlisted/i);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('allows redirect when every hop stays on allowlisted hosts', async () => {
    process.env.HTTP_ACTION_ALLOWLIST = 'allowed.example,also-allowed.example';

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://allowed.example/start') {
        return new Response(null, {
          status: 302,
          headers: { Location: 'https://also-allowed.example/next' },
        });
      }
      if (url === 'https://also-allowed.example/next') {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    const result = await webhookApiPlugin.execute(
      {
        action: 'http.request',
        args: { method: 'GET', url: 'https://allowed.example/start' },
        requiredPermissions: [],
      },
      { userId: 'u1' }
    );

    expect(result.success).toBe(true);
    expect(result.output?.finalUrl).toBe('https://also-allowed.example/next');
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('validate() still rejects non-allowlisted initial URL', async () => {
    process.env.HTTP_ACTION_ALLOWLIST = 'allowed.example';
    const validation = await webhookApiPlugin.validate(
      {
        action: 'http.request',
        args: { method: 'POST', url: 'https://evil.example/x' },
        requiredPermissions: [],
      },
      { userId: 'u1' }
    );
    expect(validation.ok).toBe(false);
  });
});
