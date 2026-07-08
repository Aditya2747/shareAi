import { OAuthTokenManager } from './oauth-token-manager';
import { getConnectorByProvider } from './connectors/registry';

interface APIExecutionContext {
  userId: string;
  providerId: string;
  action: string;
  parameters: Record<string, unknown>;
}

/**
 * shareAi execution glue. Resolves the portable connector for a provider,
 * obtains valid (auto-refreshed) credentials from our token store, and
 * delegates the actual API call to the connector. All provider-specific logic
 * now lives in src/lib/connectors/* (portable); this class is the host binding.
 */
export class APIExecutor {
  static async execute(context: APIExecutionContext): Promise<Record<string, unknown>> {
    const connector = getConnectorByProvider(context.providerId);
    if (!connector) {
      throw new Error(`No connector registered for provider: ${context.providerId}`);
    }

    const creds = await OAuthTokenManager.getValidCredentials(context.userId, context.providerId);
    if (!creds) {
      throw new Error(`No valid credentials for provider: ${context.providerId}`);
    }

    const result = await connector.executeAction(context.action, context.parameters, creds);
    if (!result.ok) {
      throw new Error(result.error || `Connector action "${context.action}" failed`);
    }
    return result.data ?? {};
  }
}
