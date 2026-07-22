import { parseIntentFromPrompt } from '@/lib/intent-parser';
import { ExecutionPlan, ExecutionPlanStep, RiskLevel } from './types';

interface PlannerInput {
  action: string;
  targetAPIs: string[];
  requiredScopes?: Record<string, string[]>;
  parameters?: Record<string, unknown>;
}

const SAFE_ARG_KEYS = new Set([
  'url',
  'method',
  'selector',
  'text',
  'mode',
  'channel',
  'to',
  'subject',
  'title',
  'summary',
  'start_time',
  'end_time',
  'timeZone',
  'clear',
  'waitUntil',
  'timeoutMs',
]);

function asShortString(value: unknown, max = 120): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

/** Deterministic recipient-facing summary from action + args (no LLM). */
export function buildHumanSummary(
  action: string,
  args: Record<string, unknown> = {}
): string {
  const url = asShortString(args.url, 80);
  const selector = asShortString(args.selector, 60);
  const text = asShortString(args.text, 40);
  const mode = asShortString(args.mode, 20);
  const channel = asShortString(args.channel, 40);
  const to = asShortString(args.to, 60);
  const subject = asShortString(args.subject, 60);
  const title = asShortString(args.title ?? args.summary, 60);
  const method = asShortString(args.method, 10)?.toUpperCase();

  switch (action) {
    case 'browser.open_url':
      return url ? `Open ${url} in the browser` : 'Open a URL in the browser';
    case 'browser.click':
      return selector ? `Click element ${selector}` : 'Click a page element';
    case 'browser.type':
      return selector
        ? `Type${text ? ` “${text}”` : ''} into ${selector}`
        : 'Type text into a page field';
    case 'browser.extract_text':
      return selector ? `Extract text from ${selector}` : 'Extract text from the page';
    case 'windows.set_theme':
      return mode ? `Set Windows theme to ${mode} mode` : 'Change Windows theme';
    case 'windows.screenshot':
      return 'Capture a screenshot of the primary screen';
    case 'slack.send_message':
      return channel ? `Send a Slack message to ${channel}` : 'Send a Slack message';
    case 'google-gmail.send_email':
      if (to && subject) return `Send Gmail to ${to} (${subject})`;
      if (to) return `Send Gmail to ${to}`;
      return 'Send a Gmail message';
    case 'google-calendar.create_event':
      return title ? `Create calendar event “${title}”` : 'Create a calendar event';
    case 'http.request':
      if (method && url) return `HTTP ${method} ${url}`;
      if (url) return `HTTP request to ${url}`;
      return 'Send an allowlisted HTTP request';
    default:
      return `Run ${action}`;
  }
}

/** Public-safe args for execute-page review (no bodies/headers/secrets). */
export function toSafeClientArgs(
  args: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  const source = args ?? {};
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (!SAFE_ARG_KEYS.has(key)) continue;
    if (typeof value === 'string') {
      const shortened = asShortString(value, 160);
      if (shortened !== undefined) safe[key] = shortened;
      continue;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      safe[key] = value;
    }
  }
  return safe;
}

function withHumanSummary(step: ExecutionPlanStep): ExecutionPlanStep {
  return {
    ...step,
    humanSummary: step.humanSummary || buildHumanSummary(step.action, step.args ?? {}),
  };
}

function riskForProvider(providerId: string): { riskLevel: RiskLevel; requiresApproval: boolean } {
  switch (providerId) {
    case 'google-gmail':
      return { riskLevel: 'high', requiresApproval: true };
    case 'slack':
      return { riskLevel: 'medium', requiresApproval: true };
    case 'google-calendar':
      return { riskLevel: 'low', requiresApproval: false };
    default:
      return { riskLevel: 'high', requiresApproval: true };
  }
}

function actionForProvider(providerId: string): string {
  switch (providerId) {
    case 'slack':
      return 'slack.send_message';
    case 'google-calendar':
      return 'google-calendar.create_event';
    case 'google-gmail':
      return 'google-gmail.send_email';
    default:
      return `${providerId}.execute`;
  }
}

function highestRisk(risks: RiskLevel[]): RiskLevel {
  if (risks.includes('high')) return 'high';
  if (risks.includes('medium')) return 'medium';
  return 'low';
}

function inferNonApiSteps(goal: string, nextIndex: number): {
  steps: ExecutionPlanStep[];
  blockedReasons: string[];
} {
  const lower = goal.toLowerCase();
  const steps: ExecutionPlanStep[] = [];
  const blockedReasons: string[] = [];
  let index = nextIndex;

  const mentionsDarkMode =
    lower.includes('dark mode') || (lower.includes('theme') && lower.includes('dark'));
  const mentionsLightMode =
    lower.includes('light mode') || (lower.includes('theme') && lower.includes('light'));
  if (mentionsDarkMode || mentionsLightMode) {
    const args = { mode: mentionsDarkMode ? 'dark' : 'light' };
    steps.push({
      stepIndex: index++,
      executorType: 'os',
      action: 'windows.set_theme',
      args,
      riskLevel: 'high',
      requiresApproval: true,
      requiredPermissions: ['os:theme:write'],
      successCriteria: 'System theme is changed successfully',
      fallback: 'Prompt user to change theme manually',
      humanSummary: buildHumanSummary('windows.set_theme', args),
    });
  }

  const mentionsScreenshot =
    /\b(screenshot|screen\s*shot|capture\s+(the\s+)?screen|take\s+a\s+screenshot)\b/i.test(
      goal
    );
  if (mentionsScreenshot) {
    const args = {};
    steps.push({
      stepIndex: index++,
      executorType: 'os',
      action: 'windows.screenshot',
      args,
      riskLevel: 'medium',
      requiresApproval: true,
      requiredPermissions: ['os:screen:read'],
      successCriteria: 'Primary screen screenshot is captured as an artifact',
      fallback: 'User captures screenshot with Win+Shift+S',
      humanSummary: buildHumanSummary('windows.screenshot', args),
    });
  }

  const urlMatch = goal.match(/https?:\/\/[^\s)]+/i);
  if (urlMatch) {
    const args = { url: urlMatch[0] };
    steps.push({
      stepIndex: index++,
      executorType: 'browser',
      action: 'browser.open_url',
      args,
      riskLevel: 'medium',
      requiresApproval: true,
      requiredPermissions: ['browser:navigate'],
      successCriteria: 'Browser navigates to requested URL',
      fallback: 'Provide URL to user for manual navigation',
      humanSummary: buildHumanSummary('browser.open_url', args),
    });
  } else if (lower.includes('open ') && lower.includes('website')) {
    blockedReasons.push(
      'Prompt requested browser navigation but no valid URL was found in text'
    );
  }

  const clickMatches = Array.from(
    goal.matchAll(
      /click(?:\s+on)?\s+(?:"([^"]+)"|'([^']+)'|`([^`]+)`|([#.][\w\-:.]+))/gi
    )
  );
  for (const match of clickMatches) {
    const selector = (match[1] || match[2] || match[3] || match[4] || '').trim();
    if (!selector) continue;
    const args = { selector };
    steps.push({
      stepIndex: index++,
      executorType: 'browser',
      action: 'browser.click',
      args,
      riskLevel: 'medium',
      requiresApproval: true,
      requiredPermissions: ['browser:interact'],
      successCriteria: `Element ${selector} is clicked`,
      fallback: 'User clicks the element manually',
      humanSummary: buildHumanSummary('browser.click', args),
    });
  }

  const typeMatches = Array.from(
    goal.matchAll(
      /type\s+(?:"([^"]+)"|'([^']+)'|`([^`]+)`)\s+(?:into|in)\s+(?:"([^"]+)"|'([^']+)'|`([^`]+)`|([#.][\w\-:.]+))/gi
    )
  );
  for (const match of typeMatches) {
    const text = (match[1] || match[2] || match[3] || '').trim();
    const selector = (match[4] || match[5] || match[6] || match[7] || '').trim();
    if (!text || !selector) continue;
    const args = { selector, text, clear: true };
    steps.push({
      stepIndex: index++,
      executorType: 'browser',
      action: 'browser.type',
      args,
      riskLevel: 'medium',
      requiresApproval: true,
      requiredPermissions: ['browser:interact'],
      successCriteria: `Text is entered into ${selector}`,
      fallback: 'User types manually',
      humanSummary: buildHumanSummary('browser.type', args),
    });
  }

  const extractMatches = Array.from(
    goal.matchAll(
      /extract\s+text\s+(?:from|of)\s+(?:"([^"]+)"|'([^']+)'|`([^`]+)`|([#.][\w\-:.]+))/gi
    )
  );
  for (const match of extractMatches) {
    const selector = (match[1] || match[2] || match[3] || match[4] || '').trim();
    if (!selector) continue;
    const args = { selector };
    steps.push({
      stepIndex: index++,
      executorType: 'browser',
      action: 'browser.extract_text',
      args,
      riskLevel: 'low',
      requiresApproval: true,
      requiredPermissions: ['browser:read'],
      successCriteria: `Text content extracted from ${selector}`,
      fallback: 'User copies text manually',
      humanSummary: buildHumanSummary('browser.extract_text', args),
    });
  }

  if (
    (lower.includes('click') || lower.includes('type ') || lower.includes('extract text')) &&
    !urlMatch
  ) {
    blockedReasons.push(
      'Browser interaction requested without a URL. Include a URL so automation can navigate first.'
    );
  }

  const webhookMatch = goal.match(/https?:\/\/[^\s)]+/i);
  if (
    webhookMatch &&
    (lower.includes('webhook') ||
      lower.includes('http request') ||
      lower.includes('call api'))
  ) {
    const args = { method: 'POST', url: webhookMatch[0], body: { message: goal } };
    steps.push({
      stepIndex: index++,
      executorType: 'api',
      action: 'http.request',
      args,
      riskLevel: 'high',
      requiresApproval: true,
      requiredPermissions: ['network:http:outbound'],
      successCriteria: 'HTTP endpoint returns success response',
      fallback: 'Manually trigger external API/webhook',
      humanSummary: buildHumanSummary('http.request', args),
    });
  }

  return { steps, blockedReasons };
}

export async function buildExecutionPlan(prompt: string): Promise<ExecutionPlan> {
  const intent = await parseIntentFromPrompt(prompt);
  return buildExecutionPlanFromInput(
    {
      action: intent.action,
      targetAPIs: intent.targetAPIs,
      requiredScopes: intent.requiredScopes,
      parameters: intent.parameters,
    },
    prompt
  );
}

export function buildExecutionPlanFromInput(
  input: PlannerInput,
  goal: string
): ExecutionPlan {
  const blockedReasons: string[] = [];
  const steps: ExecutionPlanStep[] = [];
  const lowerGoal = goal.toLowerCase();
  const mentionsSlackExplicitly = /\bslack\b/.test(lowerGoal);
  const suppressImplicitSlack =
    input.targetAPIs.length === 1 &&
    input.targetAPIs[0] === 'slack' &&
    !mentionsSlackExplicitly;

  input.targetAPIs.forEach((providerId, idx) => {
    if (suppressImplicitSlack && providerId === 'slack') return;

    const risk = riskForProvider(providerId);
    const action = actionForProvider(providerId);

    if (action.endsWith('.execute')) {
      blockedReasons.push(`Unsupported provider in planner: ${providerId}`);
      return;
    }

    steps.push({
      stepIndex: idx,
      executorType: 'api',
      action,
      args: input.parameters ?? {},
      riskLevel: risk.riskLevel,
      requiresApproval: risk.requiresApproval,
      requiredPermissions: input.requiredScopes?.[providerId] ?? [],
      successCriteria: `${action} completes without connector errors`,
      fallback: 'Ask user to connect app and retry',
      humanSummary: buildHumanSummary(action, input.parameters ?? {}),
    });
  });

  const inferred = inferNonApiSteps(goal, steps.length);
  steps.push(...inferred.steps);
  blockedReasons.push(...inferred.blockedReasons);

  const enrichedSteps = steps.map(withHumanSummary);
  const riskLevels = enrichedSteps.map((s) => s.riskLevel);
  const approvalRequiredSteps = enrichedSteps.filter((s) => s.requiresApproval).length;

  return {
    goal,
    steps: enrichedSteps,
    globalRiskSummary: {
      highestRisk: riskLevels.length > 0 ? highestRisk(riskLevels) : 'high',
      approvalRequiredSteps,
      notes:
        blockedReasons.length > 0
          ? ['Some requested actions are not currently supported']
          : ['Plan generated from existing connectors and inferred capability steps'],
    },
    blockedReasons,
  };
}

export function buildExecutionPlanFromWorkflowPayload(payload: {
  action: string;
  targetAPIs: string[];
  requiredScopes?: Record<string, string[]>;
  parameters?: Record<string, unknown>;
}): ExecutionPlan {
  return buildExecutionPlanFromInput(payload, payload.action);
}
