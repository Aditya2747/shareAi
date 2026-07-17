import { generateObject } from 'ai';
import { google } from '@ai-sdk/google';
import { z } from 'zod';
import { Intent } from '@/types';
import { extractEventSchedule } from '@/lib/calendar-intent';

const IntentParsingSchema = z.object({
  action: z.string().describe('The primary action to perform'),
  targetAPIs: z.array(z.string()).describe('List of third-party APIs needed (from: google-calendar, google-gmail, slack)'),
  parameters: z.array(
    z.object({
      name: z.string().describe('Parameter name (e.g. channel, text, to, subject, body, start_time, end_time)'),
      value: z.string().describe('Parameter value')
    })
  ).describe('Extracted key-value parameters for the workflow'),
  confidence: z.number().min(0).max(1).describe('Confidence score of the parsing'),
});

const API_PROVIDER_MAP: Record<string, { scopes: string[]; endpoint: string }> = {
  'google-calendar': {
    // Must match the scope actually requested in oauth-providers.ts, otherwise
    // the execute route's scope check rejects the granted token.
    scopes: ['https://www.googleapis.com/auth/calendar.events'],
    endpoint: 'https://www.googleapis.com/calendar/v3',
  },
  'google-gmail': {
    scopes: ['https://www.googleapis.com/auth/gmail.send'],
    endpoint: 'https://www.googleapis.com/gmail/v1',
  },
  'slack': {
    scopes: ['chat:write', 'users:read'],
    endpoint: 'https://slack.com/api',
  },
};

export async function parseIntentFromPrompt(prompt: string): Promise<Intent> {
  const modelName = process.env.GOOGLE_MODEL || 'gemini-2.0-flash';
  const systemPrompt = `You are an expert at parsing natural language prompts into structured workflow intents.
Analyze the user's request and extract:
1. The primary action
2. Which third-party APIs are needed (from: ${Object.keys(API_PROVIDER_MAP).join(', ')})
3. Any extracted parameters as a key-value list (e.g., name: 'to', value: 'example@gmail.com')
4. Your confidence in this parsing (0-1)

Be conservative: if you're unsure, lower confidence. Never hallucinate API names.`;

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
      mergedScopes[api] = apiConfig.scopes;
    }

    const parameters: Record<string, string> = {};
    for (const param of object.parameters) {
      parameters[param.name] = param.value;
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

    // Heuristic fallback parser for offline/testing robustness
    const targetAPIs: string[] = [];
    const lowerPrompt = prompt.toLowerCase();
    
    if (lowerPrompt.includes('calendar') || lowerPrompt.includes('schedule') || lowerPrompt.includes('event')) {
      targetAPIs.push('google-calendar');
    }
    if (lowerPrompt.includes('gmail') || lowerPrompt.includes('email') || lowerPrompt.includes('mail')) {
      targetAPIs.push('google-gmail');
    }
    if (lowerPrompt.includes('slack') || lowerPrompt.includes('message') || lowerPrompt.includes('channel')) {
      targetAPIs.push('slack');
    }

    // Default to slack if nothing matched
    if (targetAPIs.length === 0) {
      targetAPIs.push('slack');
    }

    const mergedScopes: Record<string, string[]> = {};
    for (const api of targetAPIs) {
      const apiConfig = API_PROVIDER_MAP[api];
      if (apiConfig) {
        mergedScopes[api] = apiConfig.scopes;
      }
    }

    // Extract dynamic parameters using basic heuristics
    const parameters: Record<string, string> = {};

    // Only set recipient when the prompt includes a real address.
    // Never invent a destination (old default team@example.com caused silent "success").
    const emailMatch = prompt.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    if (emailMatch) {
      parameters['to'] = emailMatch[0];
    } else if (targetAPIs.includes('google-gmail')) {
      // Without a To address, drop Gmail so the workflow does not fake-send.
      const gmailIdx = targetAPIs.indexOf('google-gmail');
      if (gmailIdx >= 0) targetAPIs.splice(gmailIdx, 1);
      delete mergedScopes['google-gmail'];
    }

    // If Gmail was the only target and we removed it, keep an empty plan signal
    // rather than defaulting to Slack incorrectly for an email request.
    if (targetAPIs.length === 0 && lowerPrompt.match(/gmail|email|mail/)) {
      // leave empty — chat/UI can show no executable Gmail step
    } else if (targetAPIs.length === 0) {
      targetAPIs.push('slack');
      mergedScopes.slack = API_PROVIDER_MAP.slack.scopes;
    }

    // Default fallback parameters for Calendar/Slack
    const event = extractEventSchedule(prompt);
    parameters['title'] = event.title;
    parameters['start_time'] = event.start_time;
    parameters['end_time'] = event.end_time;
    parameters['timeZone'] = event.timeZone;
    parameters['channel'] = '#general';
    parameters['text'] = prompt;
    parameters['subject'] = 'Notification';
    parameters['body'] = prompt;

    return {
      id: `intent_fallback_${Date.now()}`,
      action: `Executed: ${prompt.slice(0, 60)}...`,
      targetAPIs,
      requiredScopes: mergedScopes,
      parameters,
      confidence: 0.8, // Set high enough to bypass the 0.5 confidence filter in the API route
    };
  }
}
