# Technical Access, Keys, and Configuration Reference

**Last Updated:** January 25, 2025  
**Purpose:** Document all technical access points, API keys, and configuration sources

## Overview

This document tracks where access credentials come from, how services are configured, and what tools are used to interact with the system.

## Access Methods

### 1. Supabase Database Access

#### MCP Server (Primary Method)
**Location:** `mcp_config.json`

```json
{
  "supabase": {
    "command": "npx",
    "args": [
      "-y",
      "@supabase/mcp-server-supabase@latest",
      "--read-only",
      "--project-ref=qkgaybvrernstplzjaam"
    ]
  }
}
```

**Project Reference:** `qkgaybvrernstplzjaam`  
**Access Level:** Read-only via MCP (Model Context Protocol)  
**Tools Available:**
- `mcp_supabase_execute_sql` - Execute SQL queries
- `mcp_supabase_apply_migration` - Apply database migrations
- `mcp_supabase_list_tables` - List all tables
- `mcp_supabase_list_migrations` - View migration history
- `mcp_supabase_get_logs` - Get service logs
- `mcp_supabase_get_advisors` - Security/performance checks

**Note:** MCP server is read-only by default. For write operations, use direct Supabase client or migrations.

#### Direct Supabase Client (Frontend)
**Location:** `nuke_frontend/src/lib/supabase.ts`

**Environment Variables Required:**
- `VITE_SUPABASE_URL` - Project URL
- `VITE_SUPABASE_ANON_KEY` - Anonymous/public key

**Access:**
```typescript
import { supabase } from '../lib/supabase';

// Uses environment variables from:
// - Local: .env or .env.local
// - Vercel: Environment Variables dashboard
// - Runtime: import.meta.env.VITE_SUPABASE_URL
```

**Current Production Values:**
- URL: `https://qkgaybvrernstplzjaam.supabase.co`
- Anon Key: Set in Vercel environment variables (not in code)

#### Service Role Key (Backend/Scripts)
**Location:** Environment variable `SUPABASE_SERVICE_ROLE_KEY`

**Usage:**
- Server-side operations
- Bypass RLS policies
- Admin operations
- Edge Functions

**Security:** Never expose in frontend code. Only use in:
- Supabase Edge Functions
- Backend scripts
- Server-side operations

### 2. Vercel Deployment Access

#### CLI Authentication
**Method:** Vercel CLI with stored credentials

**Commands:**
```bash
vercel --prod --force --yes  # Deploy to production
vercel env ls                 # List environment variables
vercel logs <deployment-url>  # View deployment logs
```

**Authentication:** Stored in `~/.vercel` directory (managed by Vercel CLI)

#### Environment Variables
**Location:** Vercel Dashboard → Project Settings → Environment Variables

**Required Variables:**
- `VITE_SUPABASE_URL` - Supabase project URL
- `VITE_SUPABASE_ANON_KEY` - Supabase anonymous key
- `VITE_STRIPE_PUBLISHABLE_KEY` - Stripe publishable key (if using Stripe)
- `STRIPE_SECRET_KEY` - Stripe secret key (Edge Functions only)

**Access Levels:**
- Production: Live site (n-zero.dev)
- Preview: Pull request deployments
- Development: Local development

**Setting Variables:**
```bash
# Via CLI
vercel env add VITE_SUPABASE_URL production
# Paste value when prompted

# Via Dashboard
# Go to: vercel.com/dashboard → Project → Settings → Environment Variables
```

### 3. GitHub Access

#### Repository
**URL:** `https://github.com/sss97133/nuke`  
**Branch:** `main` (production)

**Authentication:**
- SSH keys or HTTPS credentials stored in `~/.ssh` or Git credential manager
- Access via `git push origin main`

**OAuth Integration:**
- Client ID: `Ov23lie2ivkxA9C6hiNA`
- App Name: "nuke"
- Callback: `https://qkgaybvrernstplzjaam.supabase.co/auth/v1/callback`

### 4. Database Migrations

#### Migration Files
**Location:** `supabase/migrations/`

**Naming Convention:** `YYYYMMDDHHMMSS_description.sql`

**Execution Methods:**

1. **Via Supabase CLI:**
   ```bash
   supabase db reset  # Applies all migrations
   supabase migration up  # Apply new migrations
   ```

2. **Via MCP:**
   ```typescript
   mcp_supabase_apply_migration({
     name: "migration_name",
     query: "SQL here"
   })
   ```

3. **Direct SQL (via MCP):**
   ```typescript
   mcp_supabase_execute_sql({
     query: "SELECT * FROM table"
   })
   ```

**Best Practices:**
- Always use `IF NOT EXISTS` for safety
- Include shims for `db reset` compatibility
- Test migrations locally first
- Never modify existing migrations (create new ones)

### 5. API Keys and Third-Party Services

#### OpenAI
**Environment Variable:** `VITE_OPENAI_API_KEY` or `OPENAI_API_KEY`

**Usage:**
- Image analysis
- AI processing
- Content generation

**Storage:**
- Frontend: `VITE_OPENAI_API_KEY` (exposed to client - use carefully)
- Backend/Edge Functions: `OPENAI_API_KEY` (server-side only)

**User-Managed Keys:**
- Users can add their own OpenAI keys in Capsule → Settings → AI Providers
- Stored in `user_ai_providers` table (encrypted)
- Used for user-specific AI tool usage

#### Anthropic Claude
**Environment Variable:** `ANTHROPIC_API_KEY` or `NUKE_CLAUDE_API`

**Usage:**
- Alternative AI provider
- Image analysis
- Content processing

**User-Managed Keys:**
- Users can add Anthropic keys in Capsule → Settings → AI Providers
- Stored in `user_ai_providers` table (encrypted)

#### Stripe
**Environment Variables:**
- `VITE_STRIPE_PUBLISHABLE_KEY` - Frontend (public)
- `STRIPE_SECRET_KEY` - Backend/Edge Functions (secret)

**User-Managed Keys:**
- Users can add their own Stripe keys in Capsule → Settings → Stripe Integration
- Stored in `user_stripe_keys` table (encrypted)
- Used for user-specific payments

**Edge Functions:**
- Access via `Deno.env.get('STRIPE_SECRET_KEY')`
- Used in: `process-auction-settlement`, `place-bid-with-deposit`, etc.

### 6. Storage Buckets

#### Supabase Storage
**Access:** Via Supabase client

**Buckets:**
- `vehicle-data` - Vehicle images, documents
- `user-documents` - User-uploaded documents

**Access Pattern:**
```typescript
const { data, error } = await supabase.storage
  .from('vehicle-data')
  .upload('path/to/file', file);
```

**RLS Policies:** Applied at bucket level in Supabase dashboard

### 7. Edge Functions

#### Location
`supabase/functions/`

#### Environment Variables
Accessed via `Deno.env.get('VARIABLE_NAME')`

**Common Variables:**
- `SUPABASE_URL` - Project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key
- `STRIPE_SECRET_KEY` - Stripe secret
- `OPENAI_API_KEY` - OpenAI key

#### Deployment
```bash
supabase functions deploy function-name
```

**Access:** Via Supabase Dashboard → Edge Functions

### 8. Local Development

#### Environment File
**Location:** `nuke_frontend/.env` or `nuke_frontend/.env.local`

**Required Variables:**
```env
VITE_SUPABASE_URL=https://qkgaybvrernstplzjaam.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

**Note:** `.env.local` takes precedence over `.env`

#### Supabase CLI
**Installation:** `npm install -g supabase`

**Authentication:**
- Login: `supabase login`
- Link project: `supabase link --project-ref qkgaybvrernstplzjaam`

**Commands:**
```bash
supabase db reset          # Reset database with all migrations
supabase db push           # Push local migrations
supabase functions deploy  # Deploy edge functions
```

## Access Flow Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    Cursor AI Assistant                  │
│  (This is where we are - using MCP tools)               │
└─────────────────┬───────────────────────────────────────┘
                  │
                  ├─── MCP Supabase Server ────┐
                  │   (Read-only, project-ref)  │
                  │                             │
                  ├─── Git Operations ─────────┤
                  │   (SSH/HTTPS auth)          │
                  │                             │
                  ├─── Vercel CLI ──────────────┤
                  │   (Stored credentials)      │
                  │                             │
                  └─── File System ─────────────┤
                      (Direct read/write)      │
                                              │
┌─────────────────────────────────────────────┴──────────┐
│                  Production Environment                 │
│                                                         │
│  ┌──────────────┐    ┌──────────────┐                 │
│  │   Vercel     │───▶│   Supabase   │                 │
│  │  (Hosting)   │    │  (Database)  │                 │
│  └──────────────┘    └──────────────┘                 │
│         │                    │                         │
│         │                    │                         │
│         └─────────┬──────────┘                         │
│                   │                                    │
│         ┌─────────▼──────────┐                        │
│         │  Environment Vars  │                        │
│         │  (Vercel Dashboard)│                        │
│         └─────────────────────┘                        │
└─────────────────────────────────────────────────────────┘
```

## Key Locations Reference

### Configuration Files

| File | Purpose | Location |
|------|---------|----------|
| `mcp_config.json` | MCP server configuration | `/Users/skylar/nuke/` |
| `vercel.json` | Vercel deployment config | `/Users/skylar/nuke/` |
| `env.example` | Environment variable template | `/Users/skylar/nuke/` |
| `.env.local` | Local environment (gitignored) | `/Users/skylar/nuke/nuke_frontend/` |
| `supabase.ts` | Supabase client config | `nuke_frontend/src/lib/` |

### Credential Storage

| Credential Type | Storage Location | Access Method |
|----------------|------------------|---------------|
| Supabase Anon Key | Vercel Environment Variables | `import.meta.env.VITE_SUPABASE_ANON_KEY` |
| Supabase Service Key | Vercel Environment Variables | `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')` |
| Stripe Keys | Vercel Environment Variables + Database | User-managed in `user_stripe_keys` table |
| OpenAI Keys | Vercel Environment Variables + Database | User-managed in `user_ai_providers` table |
| GitHub OAuth | Supabase Dashboard | Configured in Supabase Auth settings |
| Vercel Auth | `~/.vercel` | Managed by Vercel CLI |

## Security Best Practices

### ✅ DO:
- Store secrets in Vercel Environment Variables
- Use `VITE_` prefix only for public keys (publishable keys)
- Encrypt user-provided keys in database
- Use RLS policies for database access
- Use service role key only in Edge Functions/backend

### ❌ DON'T:
- Commit `.env` files to Git
- Expose service role keys in frontend
- Hardcode API keys in source code
- Share credentials in documentation (use placeholders)

## Access Verification

### Check Supabase Connection
```typescript
// In browser console on production site
console.log('Supabase URL:', import.meta.env.VITE_SUPABASE_URL);
console.log('Has Key:', !!import.meta.env.VITE_SUPABASE_ANON_KEY);
```

### Check Vercel Environment Variables
```bash
vercel env ls
```

### Check MCP Access
```typescript
// Via MCP tools
mcp_supabase_list_tables({ schemas: ['public'] })
```

### Check Database Access
```sql
-- Via MCP
SELECT current_database(), current_user;
```

## Troubleshooting Access Issues

### Issue: "Missing Supabase configuration"
**Solution:**
1. Check Vercel environment variables: `vercel env ls`
2. Verify variables are set for Production environment
3. Redeploy after adding variables

### Issue: "MCP server connection failed"
**Solution:**
1. Check `mcp_config.json` has correct project-ref
2. Verify Supabase project is accessible
3. Check MCP server is running

### Issue: "Git push rejected"
**Solution:**
1. Check SSH key is added to GitHub
2. Verify repository permissions
3. Check branch protection rules

### Issue: "Vercel deployment failed"
**Solution:**
1. Check build logs: `vercel logs <deployment-url>`
2. Verify environment variables are set
3. Check `vercel.json` configuration

## Quick Access Commands

```bash
# Check Vercel environment variables
vercel env ls

# Add environment variable
vercel env add VARIABLE_NAME production

# View deployment logs
vercel logs <deployment-url>

# Check Supabase connection (local)
cd nuke_frontend && npm run build

# List Supabase tables (via MCP)
# Use: mcp_supabase_list_tables()

# Execute SQL (via MCP)
# Use: mcp_supabase_execute_sql({ query: "..." })
```

## Project-Specific Details

### Supabase Project
- **Project ID:** `qkgaybvrernstplzjaam`
- **URL:** `https://qkgaybvrernstplzjaam.supabase.co`
- **Region:** (Check Supabase Dashboard)
- **Database:** PostgreSQL (managed by Supabase)

### Vercel Project
- **Project Name:** `nuke` or `n-zero`
- **Production URL:** `https://n-zero.dev`
- **Framework:** Vite (React)
- **Build Command:** `cd nuke_frontend && npm run build`

### GitHub Repository
- **Owner:** `sss97133`
- **Repository:** `nuke`
- **Default Branch:** `main`
- **Primary Language:** TypeScript/JavaScript

## Notes

- **MCP Server:** Provides read-only database access via Model Context Protocol
- **Direct Access:** Frontend uses Supabase client with anon key
- **Service Role:** Only used in Edge Functions and backend scripts
- **User Keys:** Users can manage their own Stripe and AI provider keys
- **Environment Variables:** Always set in Vercel, never hardcoded

---

**Remember:** Never commit actual keys to Git. Always use environment variables or secure storage.

