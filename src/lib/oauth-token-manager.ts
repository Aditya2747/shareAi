import { supabaseAdmin } from './supabase';
import { encryptToken, decryptToken } from './encryption';
import { OAuthToken } from '@/types';

interface TokenOptions {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  scopes: string[];
}

export class OAuthTokenManager {
  static async storeToken(
    userId: string,
    provider: string,
    options: TokenOptions
  ): Promise<OAuthToken> {
    const encryptedAccessToken = encryptToken(options.accessToken);
    const encryptedRefreshToken = options.refreshToken
      ? encryptToken(options.refreshToken)
      : null;

    const expiresAt = options.expiresIn
      ? new Date(Date.now() + options.expiresIn * 1000)
      : null;

    const tokenId = `token_${provider}_${userId}_${Date.now()}`;

    const { data, error } = await supabaseAdmin
      .from('oauth_tokens')
      .upsert(
        {
          id: tokenId,
          provider,
          user_id: userId,
          encrypted_access_token: encryptedAccessToken,
          encrypted_refresh_token: encryptedRefreshToken,
          expires_at: expiresAt?.toISOString(),
          scopes: options.scopes,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'provider,user_id' }
      )
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to store OAuth token: ${error.message}`);
    }

    return {
      provider: data.provider,
      userId: data.user_id,
      encryptedAccessToken: data.encrypted_access_token,
      encryptedRefreshToken: data.encrypted_refresh_token,
      expiresAt: data.expires_at ? new Date(data.expires_at) : null,
      scopes: data.scopes,
      createdAt: new Date(data.created_at),
      updatedAt: new Date(data.updated_at),
    };
  }

  static async getAccessToken(
    userId: string,
    provider: string
  ): Promise<string | null> {
    const { data, error } = await supabaseAdmin
      .from('oauth_tokens')
      .select('encrypted_access_token')
      .eq('user_id', userId)
      .eq('provider', provider)
      .single();

    if (error || !data) {
      return null;
    }

    try {
      return decryptToken(data.encrypted_access_token);
    } catch (err) {
      console.error(`Failed to decrypt access token for ${provider}:`, err);
      return null;
    }
  }

  static async isTokenExpired(userId: string, provider: string): Promise<boolean> {
    const { data, error } = await supabaseAdmin
      .from('oauth_tokens')
      .select('expires_at')
      .eq('user_id', userId)
      .eq('provider', provider)
      .single();

    if (error || !data) {
      return true;
    }

    if (!data.expires_at) {
      return false;
    }

    return new Date(data.expires_at) <= new Date();
  }

  static async getUserTokens(userId: string): Promise<OAuthToken[]> {
    const { data, error } = await supabaseAdmin
      .from('oauth_tokens')
      .select('*')
      .eq('user_id', userId);

    if (error) {
      throw new Error(`Failed to retrieve user tokens: ${error.message}`);
    }

    return data.map((token) => ({
      provider: token.provider,
      userId: token.user_id,
      encryptedAccessToken: token.encrypted_access_token,
      encryptedRefreshToken: token.encrypted_refresh_token,
      expiresAt: token.expires_at ? new Date(token.expires_at) : null,
      scopes: token.scopes,
      createdAt: new Date(token.created_at),
      updatedAt: new Date(token.updated_at),
    }));
  }

  static async revokeToken(userId: string, provider: string): Promise<void> {
    const { error } = await supabaseAdmin
      .from('oauth_tokens')
      .delete()
      .eq('user_id', userId)
      .eq('provider', provider);

    if (error) {
      throw new Error(`Failed to revoke token: ${error.message}`);
    }
  }
}
