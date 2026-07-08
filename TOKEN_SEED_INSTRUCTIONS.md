# OAuth token setup for execution

`POST /api/workflows/[id]/execute` requires valid rows in `oauth_tokens` for the
executing user and each provider in `targetAPIs`.

## Preferred flow (no manual seeding)

1. Log in at `/login` using OTP (MVP code: `123456`)
2. Open `/execute/<workflowId>`
3. Click **Connect** next to required providers (Slack / Google)
4. Complete OAuth consent
5. Click **Authorize & Execute**

The OAuth callback routes write encrypted tokens into `oauth_tokens`
automatically.

## Manual seeding (debug fallback)

Only use this if you cannot run OAuth locally.

### 1) Determine the `user_id`

The app stores a deterministic user id in cookie `shareai_user_id` after
`POST /api/auth/otp/verify`. Use that same value in `oauth_tokens.user_id`.

### 2) Insert or update token row

```sql
insert into oauth_tokens
  (id, provider, user_id, encrypted_access_token, encrypted_refresh_token, expires_at, scopes)
values
  (
    'token_slack_<user_id>',
    'slack',
    '<user_id>',
    '<ENCRYPTED_ACCESS_TOKEN_BASE64>',
    null,
    null,
    ARRAY['chat:write','users:read']
  )
on conflict (provider, user_id) do update
set
  encrypted_access_token = excluded.encrypted_access_token,
  encrypted_refresh_token = excluded.encrypted_refresh_token,
  expires_at = excluded.expires_at,
  scopes = excluded.scopes,
  updated_at = now();
```

### 3) Encrypt access token before insert

Token values must be encrypted with `encryptToken` from `src/lib/encryption.ts`
using your local `ENCRYPTION_KEY`.

## Common failure symptom

If token lookup fails, execute route returns a 400 with missing providers and
required scopes. Connect those providers (or seed tokens) before retrying.

