import { generateObject } from 'ai';
import { google } from '@ai-sdk/google';
import { z } from 'zod';
import { Intent } from '@/types';
import { extractEventSchedule } from '@/lib/calendar-intent';
import { listProviderConfigs } from '@/lib/oauth-providers';

const PROVIDER_ENDPOINTS: Record<string, string> = {
  'google-calendar': 'https://www.googleapis.com/calendar/v3',
  'google-gmail': 'https://www.googleapis.com/gmail/v1',
  slack: 'https://slack.com/api',
  github: 'https://api.github.com',
  whatsapp: 'https://graph.facebook.com',
};

function getApiProviderMap(): Record<string, { scopes: string[]; endpoint: string }> {
  const out: Record<string, { scopes: string[]; endpoint: string }> = {};
  for (const cfg of listProviderConfigs()) {
    out[cfg.id] = {
      scopes: cfg.scopes,
      endpoint: PROVIDER_ENDPOINTS[cfg.id] || '',
    };
  }
  // WhatsApp uses Cloud API token connect (not classic OAuth provider row).
  out.whatsapp = {
    scopes: ['whatsapp_business_messaging'],
    endpoint: PROVIDER_ENDPOINTS.whatsapp,
  };
  return out;
}

const IntentParsingSchema = z.object({
  action: z.string().describe('The primary action to perform'),
  targetAPIs: z
    .array(z.string())
    .describe(
      'List of third-party APIs needed (from: google-calendar, google-gmail, slack, github, whatsapp)'
    ),
  parameters: z
    .array(
      z.object({
        name: z
          .string()
          .describe(
            'Parameter name (e.g. channel, text, to, subject, body, start_time, end_time, filename, owner, repo, title, content, phone, image_url, caption)'
          ),
        value: z.string().describe('Parameter value'),
      })
    )
    .describe('Extracted key-value parameters for the workflow'),
  confidence: z.number().min(0).max(1).describe('Confidence score of the parsing'),
});

export async function parseIntentFromPrompt(prompt: string): Promise<Intent> {
  const API_PROVIDER_MAP = getApiProviderMap();
  const knownApis = Object.keys(API_PROVIDER_MAP).join(', ');
  const modelName = process.env.GOOGLE_MODEL || 'gemini-2.0-flash';
  const systemPrompt = `You are an expert at parsing natural language prompts into structured workflow intents.
Analyze the user's request and extract:
1. The primary action
2. Which third-party APIs are needed (from: ${knownApis})
3. Any extracted parameters as a key-value list (e.g., name: 'to', value: 'example@gmail.com')
4. Your confidence in this parsing (0-1)

Be conservative: if you're unsure, lower confidence. Never hallucinate API names.
For GitHub: use "github" for gists or issues (params: content/filename for gist; owner, repo, title, body for issues).
For WhatsApp: use "whatsapp" (params: to/phone, text; image_url + caption for photos; status + image_url for Status helper).`;

  try {
    const { object } = await generateObject({
      model: google(modelName),
      schema: IntentParsingSchema,
      system: systemPrompt,
      prompt,
    });

    const mergedScopes: Record<string, string[]> = {};
    for (const api of object.targetAPIs) {
      const apiConfig = API_PROVIDER_MAP[api];
      if (!apiConfig) {
        throw new Error(`Unknown API provider: ${api}`);
      }
      mergedScopes[api] = [...apiConfig.scopes];
    }

    const parameters: Record<string, string> = {};
    for (const param of object.parameters) {
      parameters[param.name] = param.value;
    }

    // Issues need repo scope beyond the default gist grant.
    if (
      object.targetAPIs.includes('github') &&
      /\b(issue|issues)\b/i.test(prompt) &&
      !/\bgist\b/i.test(prompt)
    ) {
      mergedScopes.github = Array.from(new Set([...(mergedScopes.github ?? []), 'repo']));
    }

    return {
      id: `intent_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      action: object.action,
      targetAPIs: object.targetAPIs,
      requiredScopes: mergedScopes,
      parameters,
      confidence: object.confidence,
    };
  } catch (err) {
    console.warn(
      'Gemini API call failed (likely missing GOOGLE_GENERATIVE_AI_API_KEY environment variable). Falling back to heuristic parser. Error:',
      err instanceof Error ? err.message : err
    );

    const targetAPIs: string[] = [];
    const lowerPrompt = prompt.toLowerCase();

    if (
      lowerPrompt.includes('calendar') ||
      lowerPrompt.includes('schedule') ||
      lowerPrompt.includes('event')
    ) {
      targetAPIs.push('google-calendar');
    }
    if (
      lowerPrompt.includes('gmail') ||
      lowerPrompt.includes('email') ||
      lowerPrompt.includes('mail')
    ) {
      targetAPIs.push('google-gmail');
    }
    if (
      lowerPrompt.includes('slack') ||
      lowerPrompt.includes('message') ||
      lowerPrompt.includes('channel')
    ) {
      targetAPIs.push('slack');
    }
    if (
      lowerPrompt.includes('github') ||
      lowerPrompt.includes('gist') ||
      (/\bissue\b/.test(lowerPrompt) && /\b(repo|repository|github)\b/.test(lowerPrompt))
    ) {
      targetAPIs.push('github');
    }
    if (
      lowerPrompt.includes('whatsapp') ||
      lowerPrompt.includes('wa.me') ||
      (/\bstatus\b/.test(lowerPrompt) && /\b(photo|image|picture)\b/.test(lowerPrompt))
    ) {
      targetAPIs.push('whatsapp');
    }

    const isLocalAutomation =
      /\b(screenshot|screen\s*shot|dark\s*mode|light\s*mode|open\s+https?:|click|extract\s+text|type\s+)/i.test(
        prompt
      ) || /https?:\/\//i.test(prompt);

    if (targetAPIs.length === 0 && !isLocalAutomation) {
      targetAPIs.push('slack');
    }

    const mergedScopes: Record<string, string[]> = {};
    for (const api of targetAPIs) {
      const apiConfig = API_PROVIDER_MAP[api];
      if (apiConfig) {
        mergedScopes[api] = [...apiConfig.scopes];
      }
    }

    if (
      targetAPIs.includes('github') &&
      /\b(issue|issues)\b/.test(lowerPrompt) &&
      !/\bgist\b/.test(lowerPrompt)
    ) {
      mergedScopes.github = Array.from(new Set([...(mergedScopes.github ?? []), 'repo']));
    }

    const parameters: Record<string, string> = {};

    const emailMatch = prompt.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    if (emailMatch) {
      parameters['to'] = emailMatch[0];
    } else if (targetAPIs.includes('google-gmail')) {
      const gmailIdx = targetAPIs.indexOf('google-gmail');
      if (gmailIdx >= 0) targetAPIs.splice(gmailIdx, 1);
      delete mergedScopes['google-gmail'];
    }

    if (targetAPIs.length === 0 && lowerPrompt.match(/gmail|email|mail/)) {
      // leave empty
    } else if (targetAPIs.length === 0 && !isLocalAutomation) {
      targetAPIs.push('slack');
      mergedScopes.slack = API_PROVIDER_MAP.slack.scopes;
    }

    const event = extractEventSchedule(prompt);
    parameters['title'] = event.title;
    parameters['start_time'] = event.start_time;
    parameters['end_time'] = event.end_time;
    parameters['timeZone'] = event.timeZone;
    parameters['channel'] = '#general';
    parameters['text'] = prompt;
    parameters['subject'] = 'Notification';
    parameters['body'] = prompt;
    parameters['content'] = prompt;
    parameters['filename'] = 'shareai.md';
    parameters['description'] = event.title || 'Created via shareAi';

    const imageUrlMatch = prompt.match(/https?:\/\/[^\s]+\.(?:png|jpe?g|gif|webp)(?:\?[^\s]*)?/i);
    if (imageUrlMatch) {
      parameters['image_url'] = imageUrlMatch[0];
    }

    const phoneMatch = prompt.match(
      /(?:\+|00)?(?:\d[\s-]*){10,15}/
    );
    if (phoneMatch && targetAPIs.includes('whatsapp')) {
      parameters['to'] = phoneMatch[0].replace(/[^\d+]/g, '');
      parameters['phone'] = parameters['to'];
    }

    // owner/repo from "owner/repo" pattern when creating issues
    const repoMatch = prompt.match(/\b([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\b/);
    if (repoMatch && targetAPIs.includes('github')) {
      parameters['owner'] = repoMatch[1];
      parameters['repo'] = repoMatch[2];
    }

    return {
      id: `intent_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      action: targetAPIs[0] || 'unknown',
      targetAPIs,
      requiredScopes: mergedScopes,
      parameters,
      confidence: 0.55,
    };
  }
}
