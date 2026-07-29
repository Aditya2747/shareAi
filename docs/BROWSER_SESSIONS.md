# Browser session persistence

shareAi can optionally reuse Playwright login state across runs for the **same recipient**. Sessions are encrypted at rest (same `encryptToken` / `ENCRYPTION_KEY` scheme as `oauth_tokens`).

## Safety rules

1. **No silent save** — `browser_persist_session` defaults to `false` on every run.
2. **No silent reuse** — `browser_reuse_session` defaults to `false`.
3. Opt-in is **per run** via the execute API body / execute-page checkboxes.
4. Recipients can **list and revoke** saved domains at any time.

## Schema

Migration: `011_browser_sessions.sql`

| Table / column | Purpose |
| --- | --- |
| `browser_sessions` | `recipient_id`, `domain`, `encrypted_session_blob`, `expires_at` |
| `execution_runs.browser_reuse_session` | Per-run reuse consent |
| `execution_runs.browser_persist_session` | Per-run save consent |

Default TTL: **7 days**.

## Execute API

`POST /api/workflows/[id]/execute`

```json
{
  "browserReuseSession": true,
  "browserPersistSession": true
}
```

Omit or set `false` → fresh browser context; nothing written to `browser_sessions`.

## Session management API

- `GET /api/browser-sessions` → `{ sessions: [{ id, domain, expiresAt, updatedAt }] }`
- `DELETE /api/browser-sessions` body `{ sessionId }` | `{ domain }` | `{ all: true }`

## Execute UI

When the plan includes browser steps, the recipient sees:

- Reuse saved browser sessions for this run
- Save browser session after this run
- List of saved domains with **Revoke** / **Revoke all**

## Apply migration

Run `011_browser_sessions.sql` in the Supabase SQL editor before using this feature.
