import { ExecutorContext, ExecutorResult, ExecutorStep, StepExecutor } from './types';

type BrowserSession = {
  browser: import('playwright').Browser;
  page: import('playwright').Page;
};

const SESSIONS = new Map<string, BrowserSession>();

function getAllowlistedHosts(): string[] {
  const raw = process.env.BROWSER_ACTION_ALLOWLIST || '';
  return raw
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
}

function validateUrl(urlRaw: string): { ok: boolean; reason?: string; host?: string } {
  try {
    const url = new URL(urlRaw);
    if (!['http:', 'https:'].includes(url.protocol)) {
      return { ok: false, reason: 'Only http/https URLs are allowed for browser.open_url' };
    }
    const allowlist = getAllowlistedHosts();
    if (allowlist.length > 0 && !allowlist.includes(url.host.toLowerCase())) {
      return {
        ok: false,
        reason:
          'Target host is not allowlisted. Set BROWSER_ACTION_ALLOWLIST (comma-separated hosts).',
      };
    }
    return { ok: true, host: url.host.toLowerCase() };
  } catch {
    return { ok: false, reason: 'Invalid URL for browser.open_url' };
  }
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

async function getOrCreateSession(runId: string): Promise<BrowserSession> {
  const existing = SESSIONS.get(runId);
  if (existing) return existing;

  const playwright = await import('playwright');
  const browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage();
  const created = { browser, page };
  SESSIONS.set(runId, created);
  return created;
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
  if (!session) return;
  SESSIONS.delete(runId);
  try {
    await session.page.close();
  } catch {
    // no-op
  }
  try {
    await session.browser.close();
  } catch {
    // no-op
  }
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
      const session = await getOrCreateSession(context.runId);
      const page = session.page;
      const timeout = Number(step.args_json?.timeoutMs ?? 20000);

      switch (step.action) {
        case 'browser.open_url': {
          const url = String(step.args_json?.url ?? '');
          const waitUntil =
            String(step.args_json?.waitUntil ?? 'domcontentloaded') as
              | 'load'
              | 'domcontentloaded'
              | 'networkidle'
              | 'commit';
          await page.goto(url, { waitUntil, timeout });
          const title = await page.title();
          const artifacts = await capturePageArtifacts(page, step.action);
          return {
            success: true,
            output: {
              action: step.action,
              requestedUrl: url,
              finalUrl: page.url(),
              title,
            },
            artifacts,
          };
        }
        case 'browser.click': {
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
