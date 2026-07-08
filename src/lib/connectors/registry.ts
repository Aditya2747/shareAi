import { Connector } from './types';
import { googleWorkspaceConnector } from './google-workspace';
import { slackConnector } from './slack';

/**
 * Maps an OAuth provider id to the connector that handles it. Google's two
 * provider ids (gmail/calendar) both resolve to the single Google Workspace
 * connector — one connector, multiple auth grants.
 */
const BY_PROVIDER: Record<string, Connector> = {
  'google-gmail': googleWorkspaceConnector,
  'google-calendar': googleWorkspaceConnector,
  'slack': slackConnector,
};

export function getConnectorByProvider(providerId: string): Connector | null {
  return BY_PROVIDER[providerId] ?? null;
}

export function listConnectors(): Connector[] {
  return Array.from(new Set(Object.values(BY_PROVIDER)));
}

export * from './types';
