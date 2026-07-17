import { ApiActionPlugin } from './types';
import { oauthConnectorApiPlugin } from './oauth-connector-plugin';
import { webhookApiPlugin } from './webhook-plugin';

const PLUGINS: ApiActionPlugin[] = [oauthConnectorApiPlugin, webhookApiPlugin];

export function getApiPluginForAction(action: string): ApiActionPlugin | null {
  return PLUGINS.find((p) => p.supports(action)) ?? null;
}

export function listApiPlugins(): ApiActionPlugin[] {
  return PLUGINS.slice();
}
