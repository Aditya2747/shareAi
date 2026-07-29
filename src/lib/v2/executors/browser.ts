import { ExecutorContext, ExecutorResult, ExecutorStep, StepExecutor } from './types';
import { validateFinalUrlHost, validateInitialUrlHost } from '@/lib/v2/url-policy';
import {
  getBrowserSessionStorageState,
  normalizeDomain,
  persistStorageStateForDomains,
  PlaywrightStorageState,
} from '@/lib/v2/browser-sessions';

type BrowserSession = {
  browser: import('playwright').Browser;
  context: import('playwright').BrowserContext;
  page: import('playwright').Page;
  userId: string;
  reuseConsent: boolean;
  persistConsent: boolean;
  primaryDomain: string | null;
  contextBoundToDomain: string | null;
};

const SESSIONS = new Map<string, BrowserSession>();

export type BrowserRunPolicy = {
  userId: string;
  reuseConsent: boolean;
  persistConsent: boolean;
};

/** Per-run consent — never default to persist/reuse. */
const RUN_POLICIES = new Map<string, BrowserRunPolicy>();

export function setBrowserRunPolicy(runId: string, policy: BrowserRunPolicy): void {
  RUN_POLICIES.set(runId, {
    userId: policy.userId,
    reuseConsent: Boolean(policy.reuseConsent),
    persistConsent: Boolean(policy.persistConsent),
  });
}

export function clearBrowserRunPolicy(runId: string): void {
  RUN_POLICIES.delete(runId);
}

function validateUrl(urlRaw: string): { ok: boolean; reason?: string; host?: string } {
  const result = validateInitialUrlHost(urlRaw, 'browser');
  if (!result.ok) {
    if (result.reason === 'Only http/https URLs are allowed') {
      return { ok: false, reason: 'Only http/https URLs are allowed for browser.open_url' };
    }
    if (result.reason === 'Invalid URL') {
      return { ok: false, reason: 'Invalid URL for browser.open_url' };
    }
    return { ok: false, reason: result.reason };
  }
  return { ok: true, host: result.host };
}

function parseSelector(step: ExecutorStep): string {
  const selector = String(step.args_json?.selector ?? '').trim();
  if (!selector) {
    throw new Error(`${step.action} requires args.selector`);
  }
  return selector;
}

function parseText(step: ExecutorStep): string {
  const text = String(step.args_json?.text ?? '');
  if (!text) {
    throw new Error(`${step.action} requires args.text`);
  }
  return text;
}

async function launchBrowser(): Promise<import('playwright').Browser> {
  const headless = !['0', 'false', 'no'].includes(
    String(process.env.BROWSER_HEADLESS ?? 'true').toLowerCase()
  );
  const playwright = await import('playwright');
  return playwright.chromium.launch({
    headless,
    slowMo: headless ? 0 : Number(process.env.BROWSER_SLOW_MO_MS || 50),
  });
}

async function getOrCreateSession(
  runId: string,
  userId: string
): Promise<BrowserSession> {
  const existing = SESSIONS.get(runId);
  if (existing) return existing;

  const policy = RUN_POLICIES.get(runId);
  const reuseConsent = Boolean(policy?.reuseConsent);
  const persistConsent = Boolean(policy?.persistConsent);
  // Policy userId wins when set (should match executor context).
  const recipientId = policy?.userId || userId;

  const browser = await launchBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();
  const created: BrowserSession = {
    browser,
    context,
    page,
    userId: recipientId,
    reuseConsent,
    persistConsent,
    primaryDomain: null,
    contextBoundToDomain: null,
  };
  SESSIONS.set(runId, created);
  return created;
}

/**
 * For the first navigation, optionally rebuild the context from a saved
 * storageState when the recipient opted into reuse for this run.
 */
async function ensureContextForDomain(
  session: BrowserSession,
  domain: string
): Promise<void> {
  const normalized = normalizeDomain(domain);
  if (!session.primaryDomain) {
    session.primaryDomain = normalized;
  }

  if (session.contextBoundToDomain) return;
  if (!session.reuseConsent) {
    session.contextBoundToDomain = normalized;
    return;
  }

  const stored = await getBrowserSessionStorageState(session.userId, normalized);
  if (!stored) {
    session.contextBoundToDomain = normalized;
    return;
  }

  try {
    await session.page.close().catch(() => undefined);
    await session.context.close().catch(() => undefined);
    session.context = await session.browser.newContext({
      storageState: stored as never,
    });
    session.page = await session.context.newPage();
    session.contextBoundToDomain = normalized;
  } catch (err) {
    console.warn(
      '[browser] failed to restore storageState, continuing fresh:',
      err instanceof Error ? err.message : err
    );
    session.context = await session.browser.newContext();
    session.page = await session.context.newPage();
    session.contextBoundToDomain = normalized;
  }
}

async function capturePageArtifacts(
  page: import('playwright').Page,
  action: string
): Promise<ExecutorResult['artifacts']> {
  const title = await page.title().catch(() => '');
  const finalUrl = page.url();
  const screenshot = await page
    .screenshot({
      type: 'jpeg',
      quality: 55,
      fullPage: false,
    })
    .catch(() => null);

  const artifacts: NonNullable<ExecutorResult['artifacts']> = [
    {
      kind: 'json',
      content: JSON.stringify({ finalUrl, title }),
      metadata: { action },
    },
  ];

  if (screenshot) {
    const screenshotBase64 = Buffer.from(screenshot).toString('base64');
    artifacts.push({
      kind: 'screenshot',
      content: `data:image/jpeg;base64,${screenshotBase64}`,
      metadata: { finalUrl, title },
    });
  }

  return artifacts;
}

export async function cleanupBrowserSession(runId: string): Promise<void> {
  const session = SESSIONS.get(runId);
  if (!session) {
    clearBrowserRunPolicy(runId);
    return;
  }
  SESSIONS.delete(runId);

  // Persist only with explicit per-run consent.
  if (session.persistConsent) {
    try {
      const storageState = (await session.context.storageState()) as PlaywrightStorageState;
      const saved = await persistStorageStateForDomains({
        recipientId: session.userId,
        storageState,
        primaryDomain: session.primaryDomain,
      });
      if (saved.length > 0) {
        console.info(
          `[browser] persisted encrypted sessions for domains: ${saved.join(', ')}`
        );
      }
    } catch (err) {
      console.warn(
        '[browser] failed to persist session:',
        err instanceof Error ? err.message : err
      );
    }
  }

  const keepOpenMs = Number(process.env.BROWSER_KEEP_OPEN_MS || 0);
  if (keepOpenMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, keepOpenMs));
  }

  try {
    await session.page.close();
  } catch {
    // no-op
  }
  try {
    await session.context.close();
  } catch {
    // no-op
  }
  try {
    await session.browser.close();
  } catch {
    // no-op
  }

  clearBrowserRunPolicy(runId);
}

export const browserStepExecutor: StepExecutor = {
  type: 'browser',
  async validate(step: ExecutorStep, _context: ExecutorContext) {
    switch (step.action) {
      case 'browser.open_url': {
        const url = String(step.args_json?.url ?? '');
        if (!url) {
          return { ok: false, reason: 'browser.open_url requires args.url' };
        }
        return validateUrl(url);
      }
      case 'browser.click':
      case 'browser.type':
      case 'browser.extract_text': {
        try {
          parseSelector(step);
          if (step.action === 'browser.type') parseText(step);
          return { ok: true };
        } catch (err) {
          return {
            ok: false,
            reason: err instanceof Error ? err.message : 'Invalid browser step',
          };
        }
      }
      default:
        return { ok: false, reason: `Unsupported browser action: ${step.action}` };
    }
  },

  async execute(step: ExecutorStep, context: ExecutorContext): Promise<ExecutorResult> {
    try {
      const session = await getOrCreateSession(context.runId, context.userId);
      const timeout = Number(step.args_json?.timeoutMs ?? 20000);

      switch (step.action) {
        case 'browser.open_url': {
          const url = String(step.args_json?.url ?? '');
          const hostCheck = validateUrl(url);
          if (!hostCheck.ok || !hostCheck.host) {
            return {
              success: false,
              error: hostCheck.reason || 'Invalid URL',
            };
          }
          await ensureContextForDomain(session, hostCheck.host);
          const page = session.page;
          const waitUntil =
            String(step.args_json?.waitUntil ?? 'domcontentloaded') as
              | 'load'
              | 'domcontentloaded'
              | 'networkidle'
              | 'commit';
          await page.goto(url, { waitUntil, timeout });
          const finalUrl = page.url();
          const finalHostCheck = validateFinalUrlHost(finalUrl, 'browser');
          if (!finalHostCheck.ok) {
            return {
              success: false,
              error: finalHostCheck.reason,
              output: {
                action: step.action,
                requestedUrl: url,
                finalUrl,
              },
              artifacts: [
                {
                  kind: 'log',
                  content: finalHostCheck.reason,
                  metadata: { action: step.action, requestedUrl: url, finalUrl },
                },
              ],
            };
          }
          const title = await page.title();
          const artifacts = await capturePageArtifacts(page, step.action);
          return {
            success: true,
            output: {
              action: step.action,
              requestedUrl: url,
              finalUrl,
              title,
              sessionReused: Boolean(
                session.reuseConsent && session.contextBoundToDomain
              ),
            },
            artifacts,
          };
        }
        case 'browser.click': {
          const page = session.page;
          const selector = parseSelector(step);
          await page.waitForSelector(selector, { timeout });
          await page.click(selector, { timeout });
          const artifacts = await capturePageArtifacts(page, step.action);
          return {
            success: true,
            output: {
              action: step.action,
              selector,
              finalUrl: page.url(),
            },
            artifacts,
          };
        }
        case 'browser.type': {
          const page = session.page;
          const selector = parseSelector(step);
          const text = parseText(step);
          const clear = Boolean(step.args_json?.clear ?? true);
          await page.waitForSelector(selector, { timeout });
          if (clear) await page.fill(selector, '');
          await page.type(selector, text, {
            delay: Number(step.args_json?.delayMs ?? 20),
            timeout,
          });
          const artifacts = await capturePageArtifacts(page, step.action);
          return {
            success: true,
            output: {
              action: step.action,
              selector,
              typedLength: text.length,
              finalUrl: page.url(),
            },
            artifacts,
          };
        }
        case 'browser.extract_text': {
          const page = session.page;
          const selector = parseSelector(step);
          await page.waitForSelector(selector, { timeout });
          const extracted = await page.textContent(selector);
          const artifacts = await capturePageArtifacts(page, step.action);
          return {
            success: true,
            output: {
              action: step.action,
              selector,
              text: extracted ?? '',
              finalUrl: page.url(),
            },
            artifacts,
          };
        }
        default:
          return {
            success: false,
            error: `Unsupported browser action: ${step.action}`,
          };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Browser execution failed';
      return {
        success: false,
        error: message,
        artifacts: [
          {
            kind: 'log',
            content: message,
            metadata: { action: step.action },
          },
        ],
      };
    }
  },
};
