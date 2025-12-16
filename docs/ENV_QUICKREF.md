# Environment + Secrets Quick Reference (Nuke)

This doc exists so you (and any agent) never have to re-discover **where keys live**, **what they’re called**, and **which services are wired in**.

## Ground rules

- **Never commit secret values** (API keys, OAuth secrets, service-role keys).
- **Frontend (Vite)** reads env vars at **build time**. Use `VITE_*` names in `nuke_frontend/.env.local`.
- **Supabase Edge Functions (Deno)** read secrets at **runtime** via `Deno.env.get(...)`. Set these in **Supabase Dashboard → Edge Functions → Secrets**.

## Where to set things (by platform)

### Local development (your machine)

- **Frontend env file**: `nuke_frontend/.env.local` (preferred) or `nuke_frontend/.env`
  - Canonical names for frontend are `VITE_*` (see `env.example` and `nuke_frontend/src/lib/env.ts`).
- **Root scripts (Node/tsx)**: shell env vars (export in terminal) or load from your env manager
  - Some scripts require `SUPABASE_DB_URL` (see `scripts/tools/env-doctor.cjs`).

### Supabase (Edge Function runtime secrets)

- **Set secrets**: Supabase Dashboard → Edge Functions → Secrets
- **Code reads**: `Deno.env.get('...')` across `supabase/functions/*`

### Vercel (frontend deployment)

- **Project → Settings → Environment Variables**
- This repo deploys Vite build output (see `vercel.json`).
- Add the same `VITE_*` variables needed by the frontend.

### GitHub (CI / Actions)

- **Repo/org → Settings → Secrets and variables → Actions**
- Store any CI-only values here (never in the repo).

### Supabase MCP (preferred ops workflow)

- Use MCP tools for DB + Edge ops (migrations, logs, types) instead of hunting for local credentials.
- Don’t “print secrets” to verify—verify by invoking a function or checking logs.

## Wired services + expected env var names

### Supabase (core)

- **Frontend (public)**:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
  - (also supported by code: `SUPABASE_URL`, `SUPABASE_ANON_KEY` via Vite env prefix; see `nuke_frontend/src/lib/env.ts`)
- **Server/Edge (secret)**:
  - `SUPABASE_SERVICE_ROLE_KEY` (legacy fallback in some functions: `SERVICE_ROLE_KEY`)
- **Optional**:
  - `SUPABASE_JWT_SECRET` (only if needed by non-Supabase JWT logic)

### OAuth providers (Supabase Auth)

Used by local Supabase config in `supabase/config.toml` and by Supabase Auth provider configuration:

- GitHub:
  - `GITHUB_CLIENT_ID`
  - `GITHUB_CLIENT_SECRET`
- Google:
  - `GOOGLE_CLIENT_ID`
  - `GOOGLE_CLIENT_SECRET`

### AI / extraction providers (Edge Functions + scripts)

- OpenAI:
  - `OPENAI_API_KEY` (some code also checks `OPEN_AI_API_KEY`)
  - Frontend-only usage (if any): `VITE_OPENAI_API_KEY` (see `env.example`)
- Anthropic:
  - `ANTHROPIC_API_KEY`
- Firecrawl:
  - `FIRECRAWL_API_KEY`
- Gemini (if used by scripts/features):
  - `GEMINI_API_KEY`
- Mendable (if used):
  - `MENDABLE_API_KEY`

### Vercel AI Gateway (frontend)

- `VITE_VERCEL_AI_GATEWAY_ID`
- `VITE_VERCEL_AI_GATEWAY_KEY`
- `VITE_VERCEL_AI_GATEWAY_ENABLED`

Example placeholder file: `nuke_frontend/vercel-ai-gateway.env` (should never contain real keys).

### Dropbox integration (frontend)

- `VITE_DROPBOX_CLIENT_ID`
- `VITE_DROPBOX_CLIENT_SECRET`

### VIN decoding (optional)

Defaults are free (NHTSA). Optional paid providers (frontend):

- `VITE_VIN_API_KEY`
- `VITE_VINAUDIT_API_KEY`
- `VITE_DATAONE_API_KEY`

## Repo “source of truth” pointers

- **All canonical env names**: `env.example`
- **Frontend env reading + fallbacks**: `nuke_frontend/src/lib/env.ts`
- **Local env sanity checker**: `scripts/tools/env-doctor.cjs`
- **Supabase local config (providers + local ports)**: `supabase/config.toml`
- **Vercel routing (including `/api/*` proxy to Supabase Functions)**: `vercel.json`

## One-command sanity check

From repo root:

```bash
npm run env:doctor
```


