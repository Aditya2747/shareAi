import { OAuthTokenManager } from './oauth-token-manager';
import { getConnectorByProvider } from './connectors/registry';
import { isWhatsAppConfigured } from './connectors/whatsapp';
import { ConnectorCredentials } from './connectors/types';

interface APIExecutionContext {
  userId: string;
  providerId: string;
  action: string;
  parameters: Record<string, unknown>;
}

/**
 * shareAi execution glue. Resolves the portable connector for a provider,
 * obtains valid (auto-refreshed) credentials from our token store, and
 * delegates the actual API call to the connector.
 */
export class APIExecutor {
  static async execute(context: APIExecutionContext): Promise<Record<string, unknown>> {
    const connector = getConnectorByProvider(context.providerId);
    if (!connector) {
      throw new Error(`No connector registered for provider: ${context.providerId}`);
    }

    let creds: ConnectorCredentials | null = await OAuthTokenManager.getValidCredentials(
      context.userId,
      context.providerId
    );

    // WhatsApp Cloud API: fall back to server env token when configured.
    if (!creds && context.providerId === 'whatsapp' && isWhatsAppConfigured()) {
      creds = { accessToken: process.env.WHATSAPP_ACCESS_TOKEN as string };
    }

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
