# Actionable Links

Turn natural language prompts into secure, shareable, executable workflow URLs.

## Architecture Overview

### Components

1. **Intent Parser** (`src/lib/intent-parser.ts`)
   - Parses natural language prompts using OpenAI + function calling
   - Outputs structured Intent with action, target APIs, and required scopes

2. **Workflow Generator** (`src/lib/workflow-generator.ts`)
   - Encrypts intent payload
   - Creates shareable URLs
   - Stores in Supabase with RLS

3. **Encryption Layer** (`src/lib/encryption.ts`)
   - NaCl SecretBox for authenticated encryption
   - All tokens encrypted at rest
   - Never exposed to client

4. **Frontend** (`src/app/page.tsx`)
   - User A: Creates workflows from prompts
   - Displays shareable URL

5. **Execution Flow** (`src/app/execute/[id]/page.tsx`)
   - User B: Reviews encrypted workflow intent
   - Authorizes OAuth scopes (minimum required)
   - Executes API calls server-side

## Security Model

- **Encrypted URLs**: Payload encrypted with NaCl, tamper-proof
- **Server-Side Execution**: All OAuth tokens handled server-only
- **Transparent Intent**: Users see what they're authorizing before OAuth
- **Audit Logging**: All executions logged immutably

## Setup

### Prerequisites

- Node.js 18+
- Supabase project
- OpenAI API key

### Installation

```bash
npm install
```

### Environment Variables

Copy `.env.example` to `.env.local` and fill in:

```bash
cp .env.example .env.local
```

Generate encryption key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### Database Setup

Create tables in Supabase:

```sql
-- Workflows table
CREATE TABLE workflows (
  id TEXT PRIMARY KEY,
  created_by TEXT NOT NULL,
  intent_id TEXT NOT NULL,
  encrypted_payload TEXT NOT NULL,
  shareable_url TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMP,
  executed_by TEXT,
  executed_at TIMESTAMP,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- OAuth tokens table (with encryption)
CREATE TABLE oauth_tokens (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  user_id TEXT NOT NULL,
  encrypted_access_token TEXT NOT NULL,
  encrypted_refresh_token TEXT,
  expires_at TIMESTAMP,
  scopes TEXT[] NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(provider, user_id)
);

-- Execution logs table
CREATE TABLE execution_logs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflows(id),
  user_id TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  result JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

### Running

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## API Endpoints

### Create Workflow

`POST /api/workflows/create`

```json
{
  "prompt": "Schedule a call and send a Slack alert"
}
```

### Get Workflow Metadata

`GET /api/workflows/[id]/metadata`

Returns decrypted action, APIs, and scopes (safe for client).

### Execute Workflow

`POST /api/workflows/[id]/execute`

Executes the workflow server-side with user's authorized tokens.

## Development Roadmap

- [ ] OAuth token management system
- [ ] Dynamic API executor (Google Calendar, Slack, etc.)
- [ ] Execution result streaming
- [ ] User dashboard with workflow history
- [ ] Advanced scheduling and retry logic
- [ ] Supermemory integration for context-aware tasks
