import { supabaseAdmin } from './supabase';

export interface APIProvider {
  id: string;
  name: string;
  baseUrl: string;
  authType: 'oauth2' | 'api_key' | 'bearer';
  scopesRequired: string[];
  iconUrl: string;
}

export class APIRegistry {
  private static cache: Map<string, APIProvider> = new Map();

  static async getProvider(providerId: string): Promise<APIProvider | null> {
    if (this.cache.has(providerId)) return this.cache.get(providerId) || null;
    const { data, error } = await supabaseAdmin.from('api_providers').select('*').eq('id', providerId).single();
    if (error || !data) return null;
    const provider: APIProvider = {
      id: data.id,
      name: data.name,
      baseUrl: data.base_url,
      authType: data.auth_type,
      scopesRequired: data.scopes_required,
      iconUrl: data.icon_url,
    };
    this.cache.set(providerId, provider);
    return provider;
  }

  static async getAllProviders(): Promise<APIProvider[]> {
    const { data, error } = await supabaseAdmin.from('api_providers').select('*');
    if (error) return [];
    return data.map((p) => ({
      id: p.id,
      name: p.name,
      baseUrl: p.base_url,
      authType: p.auth_type,
      scopesRequired: p.scopes_required,
      iconUrl: p.icon_url,
    }));
  }

  static clearCache(): void {
    this.cache.clear();
  }
}
