# Production deployment (Vercel + Supabase)

This guide deploys shareAi (Next.js App Router) to **Vercel** with **Supabase** as Postgres.

## 1. Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. **Project Settings → API**: copy
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` `public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (**server only**, never expose to the browser)
3. **SQL Editor**: run migrations **in order** from `supabase/migrations/`:
   - `001_init_schema.sql` … through the latest (`012_whatsapp.sql` as of this writing)
4. Confirm tables exist (`workflows`, `oauth_tokens`, `automation_plans`, `schedules`, `browser_sessions`, etc.).

## 2. Vercel project

1. Push the `shareAi` app repo to GitHub/GitLab/Bitbucket.
2. [Vercel](https://vercel.com) → **Add New Project** → import the repo.
3. **Root Directory**: set to `shareAi` if the Next app lives in a monorepo subfolder.
4. Framework preset: **Next.js** (default).
5. Add environment variables (below) for **Production** (and Preview if you use preview OAuth apps).
6. Deploy.
7. Note the production URL, e.g. `https://shareai.example.com` or `https://your-app.vercel.app`.
8. Set `NEXT_PUBLIC_APP_URL` to that **exact** origin (no trailing slash) and **redeploy**.

### Custom domain

Vercel → Project → **Settings → Domains** → add `app.yourdomain.com` → update DNS → set `NEXT_PUBLIC_APP_URL=https://app.yourdomain.com` → redeploy.

## 3. Required production env vars

Generate secrets (do **not** reuse local/dev values):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

| Variable | Required in prod | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | **Yes** | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Yes** | Anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | **Yes** | Service role; server-only |
| `ENCRYPTION_KEY` | **Yes** | Base64 → **exactly 32 bytes**; encrypts OAuth tokens, workflow payloads, browser sessions |
| `AUTH_SESSION_SECRET` | **Yes** | Session cookie HMAC; **do not** leave empty in prod (avoid falling back to `ENCRYPTION_KEY`) |
| `OTP_SECRET` | **Recommended** | OTP hash secret; else falls back to `AUTH_SESSION_SECRET` |
| `NEXT_PUBLIC_APP_URL` | **Yes** | Public HTTPS origin, e.g. `https://app.example.com` |
| `HTTP_ACTION_ALLOWLIST` | **Yes (mandatory)** | Comma-separated hosts for `http.request`. Empty deny-all is safer than open, but prod should list only intended webhook hosts |
| `BROWSER_ACTION_ALLOWLIST` | **Yes (mandatory)** | Comma-separated hosts for browser navigation. Empty = **allow any host** in code — **must set in prod** |
| `INTERNAL_CRON_SECRET` | **Yes** if using schedules | ≥16 chars; Bearer for `/api/internal/run-schedules` |
| `RESEND_API_KEY` + `OTP_FROM_EMAIL` | **Yes** for real OTP email | See Resend section |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Recommended | Intent parsing |
| OAuth client IDs/secrets | Per connector you enable | Slack / Google / GitHub / WhatsApp |

Optional but common:

- `GOOGLE_MODEL=gemini-2.0-flash`
- `V2_STEP_TIMEOUT_MS`, `V2_STEP_MAX_RETRIES`, `V2_RUN_RATE_LIMIT_*`
- `CALENDAR_DEFAULT_TIMEZONE=Asia/Kolkata`
- `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`

### Allowlists (prod policy)

```bash
# Example — only hosts you intentionally call
HTTP_ACTION_ALLOWLIST=hooks.zapier.com,api.make.com,webhook.site

# Example — only sites browser automation may open
BROWSER_ACTION_ALLOWLIST=example.com,www.example.com,docs.google.com
```

Never leave `BROWSER_ACTION_ALLOWLIST` empty in production.

## 4. Resend domain verification (OTP email)

OTP login needs working email delivery in production.

1. Create an account at [resend.com](https://resend.com) → API Keys → create key → `RESEND_API_KEY`.
2. **Domains** → **Add Domain** → enter `your-domain.com` (or a subdomain like `mail.your-domain.com`).
3. Add the DNS records Resend shows (typically **DKIM**, **SPF**, and sometimes **DMARC** / MX as instructed).
4. Wait until Resend marks the domain **Verified**.
5. Set:
   ```bash
   RESEND_API_KEY=re_...
   OTP_FROM_EMAIL=noreply@your-domain.com
   ```
   `OTP_FROM_EMAIL` must use a **verified** domain (not `onboarding@resend.dev` for serious prod traffic).
6. Redeploy Vercel and request an OTP from the login page; check Resend **Logs** if delivery fails.

Local tip: without Resend, some setups log OTP for testing — production must use verified Resend.

## 5. OAuth redirect URL checklist (production domain)

Replace `https://YOUR_PROD_DOMAIN` with your real `NEXT_PUBLIC_APP_URL`.

| Provider | Where to configure | Exact redirect / callback URLs |
| --- | --- | --- |
| **Slack** | api.slack.com → your app → OAuth & Permissions → Redirect URLs | `https://YOUR_PROD_DOMAIN/api/oauth/slack/callback` |
| **Google** | Google Cloud Console → Credentials → OAuth 2.0 Client → Authorized redirect URIs | `https://YOUR_PROD_DOMAIN/api/oauth/google-calendar/callback` **and** `https://YOUR_PROD_DOMAIN/api/oauth/google-gmail/callback` |
| **GitHub** | github.com/settings/developers → OAuth App → Authorization callback URL | `https://YOUR_PROD_DOMAIN/api/oauth/github/callback` |
| **WhatsApp** | Meta Cloud API token (env); connect is `/api/whatsapp/connect` (no OAuth redirect) | Ensure `NEXT_PUBLIC_APP_URL` is the prod HTTPS origin so post-connect redirects stay on prod |

Also set each provider’s **App / Homepage URL** to `https://YOUR_PROD_DOMAIN` where required.

After changing redirects, redeploy if you changed env, then reconnect apps from the execute page (old tokens still work until revoked).

## 6. Scheduled runs worker

Vercel serverless does not keep a long-running cron inside Node. Use one of:

- **Vercel Cron** (Pro) hitting `POST /api/internal/run-schedules` with header `Authorization: Bearer $INTERNAL_CRON_SECRET`
- **External cron** (cron-job.org, GitHub Actions `schedule`, etc.) every 1–5 minutes:

```bash
curl -X POST "https://YOUR_PROD_DOMAIN/api/internal/run-schedules" \
  -H "Authorization: Bearer $INTERNAL_CRON_SECRET"
```

See `docs/SCHEDULED_RUNS.md`.

## 7. Playwright / browser actions on Vercel

**Limitation:** `browser.*` steps launch Chromium via Playwright inside the Node process. On Vercel this is usually **unreliable or unsupported**:

- No persistent filesystem / large Chromium binary by default
- Short function timeouts and memory limits
- Headed mode (`BROWSER_HEADLESS=false`) will not work on serverless

**Recommendations**

1. **Production default:** treat browser automation as **local / dedicated worker only**. Keep `BROWSER_ACTION_ALLOWLIST` set; document that browser plans should run on a machine with Playwright installed, or disable browser capabilities in prod.
2. **Better architecture:** run browser steps on a **dedicated worker** (Fly.io, Railway, Render, ECS, or a always-on VM) that:
   - Installs Playwright browsers (`npx playwright install chromium`)
   - Exposes an internal execute API, **or**
   - Shares the same Supabase DB and polls/claims runs that need `executor_type = browser`
3. **Do not** rely on Vercel serverless for `browser.open_url` / click / type / extract in production without a custom Playwright layer (e.g. `@sparticuz/chromium` + `playwright-core`) — even then, prefer a worker.

OS actions (`windows.*`) also require a Windows host; they will not run on Vercel Linux.

## 8. Post-deploy smoke test

1. Open `https://YOUR_PROD_DOMAIN` → request OTP → verify email arrives (Resend).
2. Create a simple workflow (e.g. calendar or Slack) → open execute link → Connect OAuth → Approve → Run.
3. Confirm OAuth callbacks land on prod (not localhost).
4. If schedules enabled: manually `POST /api/internal/run-schedules` with the secret once.
5. Confirm `/runs` shows history.

## 9. Related docs

- `docs/ADDING_CONNECTORS.md` — new OAuth providers
- `docs/SCHEDULED_RUNS.md` — cron + standing approval
- `docs/BROWSER_SESSIONS.md` — encrypted browser session opt-in
- `docs/WHATSAPP.md` — WhatsApp Cloud API + Status helper
