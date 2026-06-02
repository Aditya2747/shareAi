import { generateObject } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { Intent } from '@/types';

const IntentSchema = z.object({
  action: z.string().describe('The primary action to perform'),
  targetAPIs: z.array(z.string()).describe('List of third-party APIs needed'),
  requiredScopes: z.record(z.array(z.string())).describe('OAuth scopes per provider'),
  parameters: z.record(z.unknown()).describe('Extracted parameters for the workflow'),
  confidence: z.number().min(0).max(1).describe('Confidence score of the parsing'),
});

const API_PROVIDER_MAP: Record<string, { scopes: string[]; endpoint: string }> = {
  'google-calendar': {
    scopes: ['https://www.googleapis.com/auth/calendar'],
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
  const systemPrompt = `You are an expert at parsing natural language prompts into structured workflow intents.
Analyze the user's request and extract:
1. The primary action
2. Which third-party APIs are needed (from: ${Object.keys(API_PROVIDER_MAP).join(', ')})
3. Required OAuth scopes for each API
4. Any extracted parameters
5. Your confidence in this parsing (0-1)

Be conservative: if you're unsure, lower confidence. Never hallucinate API names.`;

  const { object } = await generateObject({
    model: openai('gpt-4-turbo'),
    schema: IntentSchema,
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

  return {
    id: `intent_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    action: object.action,
    targetAPIs: object.targetAPIs,
    requiredScopes: mergedScopes,
    parameters: object.parameters,
    confidence: object.confidence,
  };
}
