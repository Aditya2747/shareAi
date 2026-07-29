# Adding an OAuth connector

shareAi connectors are plug-in shaped: **DB/env config** for OAuth, a **portable connector** for actions, and a **registry** entry so execution and the execute page pick them up.

This guide uses GitHub (`github.create_gist` / `github.create_issue`) as the reference.

## Architecture

| Layer | Role |
| --- | --- |
| `oauth_providers` table (+ builtins in `src/lib/oauth-providers.ts`) | Authorize/token URLs, scopes, flavor, default action, risk |
| Env vars (`*_CLIENT_ID` / `*_CLIENT_SECRET`) | Credentials only — never stored in DB |
| `/api/oauth/[provider]/start` + `callback` | Generic routes; load config via `ensureProvidersLoaded()` |
| `src/lib/connectors/<name>.ts` | Actions (`executeAction`) + optional discovery |
| `src/lib/connectors/registry.ts` | `providerId` → connector |
| Planner / intent parser / capabilities | Map prompts → `provider.action` steps |
| Execute page | Connector list from workflow `metadata.targetAPIs` |

Action names use a single dot: `{providerId}.{connectorAction}`  
Examples: `slack.send_message`, `google-calendar.create_event`, `github.create_gist`.

## Checklist for a new provider

### 1. OAuth app + env

1. Create the third-party OAuth app.
2. Set the callback URL to:
   ```text
   ${NEXT_PUBLIC_APP_URL}/api/oauth/<providerId>/callback
   ```
3. Add to `.env.local` / `.env.example`:
   ```bash
   FOO_CLIENT_ID=
   FOO_CLIENT_SECRET=
   ```

### 2. Provider config (DB + builtin fallback)

**Preferred:** insert into `oauth_providers` (see migration `009_oauth_providers.sql`):

```sql
INSERT INTO oauth_providers (
  id, name, authorize_url, token_url, scopes,
  client_id_env, client_secret_env, flavor, supports_refresh,
  default_action, risk_level, requires_approval
) VALUES (
  'foo',
  'Foo',
  'https://foo.example/oauth/authorize',
  'https://foo.example/oauth/token',
  ARRAY['read', 'write'],
  'FOO_CLIENT_ID',
  'FOO_CLIENT_SECRET',
  'oauth2',          -- google | slack | github | oauth2
  FALSE,
  'foo.do_thing',
  'medium',
  TRUE
);
```

**Also** add a matching entry under `BUILTIN_PROVIDERS` in `src/lib/oauth-providers.ts` so local/dev works before the migration is applied.

**Flavors**

| Flavor | Scope separator | Notes |
| --- | --- | --- |
| `google` | space | `access_type=offline`, `prompt=consent`, refresh |
| `slack` | comma | Checks `ok` on token response |
| `github` | space | Sends `Accept: application/json` on token exchange |
| `oauth2` | space | Standard code + JSON token body |

After editing the table at runtime, call `invalidateProviderCache()` (or restart the server).

### 3. Connector implementation

Create `src/lib/connectors/foo.ts` implementing `Connector` from `types.ts`:

- `authProviders: ['foo']`
- `supportedActions: ['do_thing', ...]`
- `testConnection`, `executeAction`

Register in `registry.ts`:

```ts
import { fooConnector } from './foo';

const BY_PROVIDER: Record<string, Connector> = {
  // ...
  foo: fooConnector,
};
```

`oauth-connector-plugin` and chat OAuth extraction use `isOAuthConnectorProvider()` — no hard-coded provider sets.

### 4. Capability + planner/intent

1. Add a row to `capabilities` (migration) and `BUILTIN_CAPABILITIES` in `src/lib/v2/capabilities.ts` for each action (`foo.do_thing`).
2. Intent: ensure `listProviderConfigs()` / heuristic keywords know `foo` (`src/lib/intent-parser.ts`).
3. Planner: `default_action` on the provider config is enough for most cases. Special cases (like GitHub gist vs issue) go in `actionForProvider()` in `planner.ts`.
4. Optional: human-readable summaries in `buildHumanSummary()`.

### 5. Smoke test

1. Run the migration in Supabase.
2. Restart the app with env vars set.
3. Prompt that targets the provider (e.g. “Create a GitHub gist with hello world”).
4. Open the workflow execute URL → connect **GitHub** → approve → run.
5. Confirm `/api/oauth/foo/start` redirects to the provider and callback stores a row in `oauth_tokens`.

## GitHub reference

| Item | Value |
| --- | --- |
| Provider id | `github` |
| Env | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` |
| Callback | `/api/oauth/github/callback` |
| Default scopes | `gist` |
| Default action | `github.create_gist` |
| Connector | `src/lib/connectors/github.ts` |
| Extra action | `github.create_issue` (needs `repo` scope — update `oauth_providers.scopes`, reconnect) |

Example prompts:

- `Create a public GitHub gist named notes.md with the text hello from shareAi`
- `Create a GitHub issue in owner/repo titled "Bug" with body "repro steps"`

## What you do **not** need

- New Next.js routes per provider — `[provider]` is already generic.
- Hard-coding the execute page connector list — it follows `metadata.targetAPIs`.
- Storing client secrets in Postgres — env only.
