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

Generate encryption key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### 3) Set up database

Run the migration in Supabase SQL editor:

- `supabase/migrations/001_init_schema.sql`
- `supabase/migrations/002_otp_codes.sql`

### 4) Start app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Core routes

- `POST /api/workflows/create` - parse prompt and create encrypted workflow
- `GET /api/workflows/[id]/metadata` - read safe metadata for execution UI
- `POST /api/workflows/[id]/execute` - execute workflow using recipient tokens
- `POST /api/otp/request` - issue OTP, persist hash/expiry in DB, send email if configured
- `POST /api/auth/otp/verify` - verify OTP and set signed session cookie

## Important notes

- In local dev (without Resend config), OTP response returns `devOtp` for testing.
- OAuth callbacks must exactly match URLs shown in `.env.example`.
- Execution uses recipient-owned OAuth tokens from `oauth_tokens`.

## Recommended next milestones

- Add automated tests for auth/create/execute routes
- Add execution history/dashboard UI
