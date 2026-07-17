import { APIExecutor } from '@/lib/api-executor';
import { supabaseAdmin } from '@/lib/supabase';
import {
  ApiActionContext,
  ApiActionPlugin,
  ApiActionRequest,
  ApiActionResult,
  ApiActionValidation,
} from './types';

function parseProviderAction(action: string): { providerId: string; connectorAction: string } {
  const [providerId, connectorAction] = action.split('.');
  if (!providerId || !connectorAction) {
    throw new Error(`Invalid action format: ${action}`);
  }
  return { providerId, connectorAction };
}

async function validateRequiredScopes(
  userId: string,
  providerId: string,
  requiredScopes: string[]
): Promise<boolean> {
  if (requiredScopes.length === 0) return true;
  const { data, error } = await supabaseAdmin
    .from('oauth_tokens')
    .select('scopes')
    .eq('user_id', userId)
    .eq('provider', providerId)
    .single();
  if (error || !data) return false;
  const scopes = Array.isArray(data.scopes) ? (data.scopes as string[]) : [];
  return requiredScopes.every((s) => scopes.includes(s));
}

const OAUTH_PROVIDER_PREFIXES = new Set(['slack', 'google-calendar', 'google-gmail']);

export const oauthConnectorApiPlugin: ApiActionPlugin = {
  id: 'oauth-connector',

  supports(action: string): boolean {
    const [provider] = action.split('.');
    return Boolean(provider && OAUTH_PROVIDER_PREFIXES.has(provider));
  },

  async validate(
    input: ApiActionRequest,
    context: ApiActionContext
  ): Promise<ApiActionValidation> {
    try {
      const parsed = parseProviderAction(input.action);
      const hasScopes = await validateRequiredScopes(
        context.userId,
        parsed.providerId,
        input.requiredPermissions
      );
      if (!hasScopes) {
        return {
          ok: false,
          reason: `Missing required OAuth scopes for ${parsed.providerId}`,
        };
      }
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        reason: err instanceof Error ? err.message : 'OAuth connector validation failed',
      };
    }
  },

  async execute(input: ApiActionRequest, context: ApiActionContext): Promise<ApiActionResult> {
    try {
      const parsed = parseProviderAction(input.action);
      const output = await APIExecutor.execute({
        userId: context.userId,
        providerId: parsed.providerId,
        action: parsed.connectorAction,
        parameters: input.args,
      });
      return { success: true, output };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'OAuth connector execution failed',
      };
    }
  },
};
