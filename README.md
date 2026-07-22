# Actionable Links (shareAi)

Turn natural language prompts into secure, shareable workflow URLs that execute
against the recipient's connected apps (Slack, Google Calendar, Gmail).

## What is implemented

- Prompt -> structured intent parsing (`src/lib/intent-parser.ts`)
- Workflow generation + encrypted payload storage (`src/lib/workflow-generator.ts`)
- Shareable execution page (`src/app/execute/[id]/page.tsx`)
- OAuth connect flows for Slack and Google (`src/app/api/oauth/*`)
- Signed session-cookie auth + DB-backed OTP verification (`src/lib/auth.ts`)
- Server-side workflow execution (`src/app/api/workflows/[id]/execute/route.ts`)
- Encrypted token storage at rest (`src/lib/encryption.ts`, `oauth_tokens` table)

## Tech stack

- Next.js 14 (App Router), React 18, TypeScript
- Supabase (Postgres + storage via service role)
- Gemini through Vercel AI SDK (`@ai-sdk/google`, `ai`)
- NaCl (`tweetnacl`) for authenticated encryption

## Local setup

### 1) Install

```bash
npm install
```

### 2) Configure env vars

Copy `.env.example` to `.env.local` and fill required values.

Required for basic startup:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ENCRYPTION_KEY` (base64 string decoding to exactly 32 bytes)
- `NEXT_PUBLIC_APP_URL` (usually `http://localhost:3000`)

Optional (recommended):
- `AUTH_SESSION_SECRET` (session signing secret)
- `OTP_SECRET` (OTP hashing secret)
- `GOOGLE_GENERATIVE_AI_API_KEY` (intent parsing; app falls back heuristically if missing)
- `GOOGLE_MODEL` (defaults to `gemini-2.0-flash`)
- `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- `RESEND_API_KEY`, `OTP_FROM_EMAIL` (for real OTP delivery)
- `HTTP_ACTION_ALLOWLIST` (comma-separated hosts for `http.request`, e.g. `hooks.zapier.com,api.make.com`)
- `BROWSER_ACTION_ALLOWLIST` (optional comma-separated hosts for `browser.open_url`)
- `OS_ACTION_SANDBOX_ROOT` (optional safe root for file-path based OS actions)

Generate encryption key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### 3) Set up database

Run the migration in Supabase SQL editor:

- `supabase/migrations/001_init_schema.sql`
- `supabase/migrations/002_otp_codes.sql`
- `supabase/migrations/003_v2_automation_core.sql`
- `supabase/migrations/004_add_http_capability.sql`
- `supabase/migrations/005_chat_history.sql`
- `supabase/migrations/006_add_browser_capabilities.sql`
- `supabase/migrations/007_m1_approval_integrity.sql`
- `supabase/migrations/008_add_windows_screenshot.sql`

### 4) Start app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Core routes

- `POST /api/chat` - chat-style assistant endpoint that can create actionable workflow links
- `GET /api/chat` - load persistent chat thread/messages for logged-in user
- `POST /api/workflows/create` - parse prompt and create encrypted workflow
- `GET /api/workflows/[id]/metadata` - read safe metadata for execution UI
- `POST /api/workflows/[id]/execute` - execute workflow using recipient tokens
- `POST /api/otp/request` - issue OTP, persist hash/expiry in DB, send email if configured
- `POST /api/auth/otp/verify` - verify OTP and set signed session cookie

## v2 automation foundation (new)

- `GET /api/capabilities` - list enabled executor capabilities
- `POST /api/plans/create` - generate and persist structured execution plan from a prompt
- `POST /api/runs/start` - create run from a plan and execute safe steps
- `GET /api/runs/[id]` - fetch run status, step timeline, approvals, artifacts
- `GET /api/runs/[id]/artifacts` - authenticated artifact list (executed_by only; 401/403 otherwise)
- `POST /api/runs/[id]/approve-step` - approve or reject risky step
- `POST /api/runs/[id]/cancel` - cancel active run

### `POST /api/workflows/[id]/execute` response shape

Risky steps are **not** auto-approved. The execute page (or any client) should branch on `status`:

| `status` | Meaning | Client action |
|----------|---------|---------------|
| `success` | Run finished (only low-risk / `requiresApproval=false` plans, or already done) | Show success; use `result` |
| `waiting_approval` | One or more steps need human approval | Show Approve/Reject UI; poll `GET /api/runs/{runId}` |
| `running` | Execution still in progress | Poll `GET /api/runs/{runId}` until terminal |
| `failed` (HTTP 500) | Start/run failed | Show `error` |

Example — approval required:

```json
{
  "success": true,
  "status": "waiting_approval",
  "runId": "run_…",
  "message": "Approval required before continuing",
  "pendingApprovals": [
    {
      "approvalId": "apr_…",
      "stepId": "step_…",
      "stepIndex": 0,
      "action": "browser.open_url",
      "executorType": "browser",
      "riskLevel": "medium",
      "requiresApproval": true,
      "humanSummary": "Open https://example.com in the browser",
      "status": "pending",
      "expiresAt": "2026-07-22T00:00:00.000Z"
    }
  ],
  "result": null
}
```

Example — one-click (no approval steps):

```json
{
  "success": true,
  "status": "success",
  "runId": "run_…",
  "message": "Workflow executed",
  "pendingApprovals": [],
  "result": { "google-calendar": { "...": "..." } }
}
```

Approve/reject via `POST /api/runs/{runId}/approve-step` with `{ "stepId", "approved": true|false, "note?" }`. When the last pending approval is granted, the run executes automatically.

Current v2 execution behavior:
- API steps run through existing connectors (`slack`, `google-calendar`, `google-gmail`)
- OS executor includes a Windows allowlisted action (`windows.set_theme`) with policy checks
- Browser executor supports real `browser.open_url` navigation via Playwright
- Browser executor also supports `browser.click`, `browser.type`, `browser.extract_text`
- Desktop executor remains scaffolded for later milestones
- v1 `/api/workflows/[id]/execute` orchestrates through v2 and returns `waiting_approval` for risky steps (no silent auto-approve)
- API execution now supports plugin-based actions, including `http.request` for allowlisted webhook/API calls

## Important notes

- In local dev (without Resend config), OTP response returns `devOtp` for testing.
- OAuth callbacks must exactly match URLs shown in `.env.example`.
- Execution uses recipient-owned OAuth tokens from `oauth_tokens`.

## Recommended next milestones

- Add automated tests for auth/create/execute routes
- ~~Add execution history/dashboard UI~~ (`/runs` list + `/runs/[id]` detail)

## Browser / OS automation prompt hints

- `Open https://example.com`
- `Open https://example.com and click "#login"`
- `Open https://example.com/login and type "alice@example.com" into "#email"`
- `Open https://example.com and extract text from "h1"`
- `Set dark mode` / `Set light mode`
- `Take a screenshot of my screen`
