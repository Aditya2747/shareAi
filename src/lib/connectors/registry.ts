import { Connector } from './types';
import { googleWorkspaceConnector } from './google-workspace';
import { slackConnector } from './slack';
import { githubConnector } from './github';
import { whatsappConnector } from './whatsapp';

/**
 * Connector plugin registry: OAuth provider id → connector that owns its actions.
 */
const BY_PROVIDER: Record<string, Connector> = {
  'google-gmail': googleWorkspaceConnector,
  'google-calendar': googleWorkspaceConnector,
  slack: slackConnector,
  github: githubConnector,
  whatsapp: whatsappConnector,
};

export function getConnectorByProvider(providerId: string): Connector | null {
  return BY_PROVIDER[providerId] ?? null;
}

/** True when an oauth-connector plugin can run `provider.action` style actions. */
export function isOAuthConnectorProvider(providerId: string): boolean {
  return Boolean(BY_PROVIDER[providerId]);
}

export function listConnectors(): Connector[] {
  return Array.from(new Set(Object.values(BY_PROVIDER)));
}

export function listRegisteredProviderIds(): string[] {
  return Object.keys(BY_PROVIDER);
}

export * from './types';
