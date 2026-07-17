import { parseIntentFromPrompt } from '@/lib/intent-parser';
import { ExecutionPlan, ExecutionPlanStep, RiskLevel } from './types';

interface PlannerInput {
  action: string;
  targetAPIs: string[];
  requiredScopes?: Record<string, string[]>;
  parameters?: Record<string, unknown>;
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
    steps.push({
      stepIndex: index++,
      executorType: 'os',
      action: 'windows.set_theme',
      args: { mode: mentionsDarkMode ? 'dark' : 'light' },
      riskLevel: 'high',
      requiresApproval: true,
      requiredPermissions: ['os:theme:write'],
      successCriteria: 'System theme is changed successfully',
      fallback: 'Prompt user to change theme manually',
    });
  }

  const urlMatch = goal.match(/https?:\/\/[^\s)]+/i);
  if (urlMatch) {
    steps.push({
      stepIndex: index++,
      executorType: 'browser',
      action: 'browser.open_url',
      args: { url: urlMatch[0] },
      riskLevel: 'medium',
      requiresApproval: true,
      requiredPermissions: ['browser:navigate'],
      successCriteria: 'Browser navigates to requested URL',
      fallback: 'Provide URL to user for manual navigation',
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
    steps.push({
      stepIndex: index++,
      executorType: 'browser',
      action: 'browser.click',
      args: { selector },
      riskLevel: 'medium',
      requiresApproval: true,
      requiredPermissions: ['browser:interact'],
      successCriteria: `Element ${selector} is clicked`,
      fallback: 'User clicks the element manually',
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
    steps.push({
      stepIndex: index++,
      executorType: 'browser',
      action: 'browser.type',
      args: { selector, text, clear: true },
      riskLevel: 'medium',
      requiresApproval: true,
      requiredPermissions: ['browser:interact'],
      successCriteria: `Text is entered into ${selector}`,
      fallback: 'User types manually',
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
    steps.push({
      stepIndex: index++,
      executorType: 'browser',
      action: 'browser.extract_text',
      args: { selector },
      riskLevel: 'low',
      requiresApproval: true,
      requiredPermissions: ['browser:read'],
      successCriteria: `Text content extracted from ${selector}`,
      fallback: 'User copies text manually',
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
    steps.push({
      stepIndex: index++,
      executorType: 'api',
      action: 'http.request',
      args: { method: 'POST', url: webhookMatch[0], body: { message: goal } },
      riskLevel: 'high',
      requiresApproval: true,
      requiredPermissions: ['network:http:outbound'],
      successCriteria: 'HTTP endpoint returns success response',
      fallback: 'Manually trigger external API/webhook',
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
    });
  });

  const inferred = inferNonApiSteps(goal, steps.length);
  steps.push(...inferred.steps);
  blockedReasons.push(...inferred.blockedReasons);

  const riskLevels = steps.map((s) => s.riskLevel);
  const approvalRequiredSteps = steps.filter((s) => s.requiresApproval).length;

  return {
    goal,
    steps,
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
