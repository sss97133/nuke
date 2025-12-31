# Remote Execution Architecture

## Overview

This document explains how the organization ingestion workflow runs remotely, what tools are used, and how to execute the complete workflow from any location.

## Architecture Components

```
┌─────────────────────────────────────────────────────────────┐
│                    REMOTE EXECUTION LAYER                   │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐      ┌──────────────┐      ┌──────────┐ │
│  │   Edge       │      │   MCP        │      │   AI      │ │
│  │  Function    │◄────►│   Tools      │◄────►│ Assistant │ │
│  │ (Supabase)   │      │  (Supabase)  │      │  (Cursor) │ │
│  └──────────────┘      └──────────────┘      └──────────┘ │
│         │                      │                            │
│         └──────────┬──────────┘                            │
│                    │                                         │
│              ┌─────▼─────┐                                  │
│              │  Supabase │                                  │
│              │  Database │                                  │
│              └───────────┘                                  │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

## Tools & Execution Methods

### 1. Supabase Edge Function: `scrape-org`

**Location:** Deployed on Supabase Cloud  
**Purpose:** Scrape organization and vehicle data from websites  
**Runtime:** Deno (serverless)  
**Access:** HTTP endpoint

#### Remote Invocation Methods

##### Method A: Direct HTTP Request (cURL/Postman/HTTP Client)

```bash
curl -X POST https://qkgaybvrernstplzjaam.supabase.co/functions/v1/scrape-org \
  -H "Authorization: Bearer YOUR_SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.velocityrestorations.com/"}'
```

**Required:**
- `SUPABASE_URL`: `https://qkgaybvrernstplzjaam.supabase.co`
- `SUPABASE_ANON_KEY`: Public anonymous key (safe for client-side)

##### Method B: Supabase Client SDK (TypeScript/JavaScript)

```typescript
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://qkgaybvrernstplzjaam.supabase.co',
  'YOUR_SUPABASE_ANON_KEY'
);

const { data, error } = await supabase.functions.invoke('scrape-org', {
  body: { url: 'https://www.velocityrestorations.com/' }
});
```

**Works from:**
- Browser (frontend)
- Node.js/Deno scripts
- Server-side applications
- CI/CD pipelines

##### Method C: Deno Script (Local/Remote Server)

```bash
# From any machine with Deno installed
deno run --allow-net --allow-env scripts/ingest-org-via-mcp.ts \
  https://www.velocityrestorations.com/
```

**Required Environment Variables:**
```bash
export SUPABASE_URL="https://qkgaybvrernstplzjaam.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
```

**Works from:**
- Local development machine
- Remote server (VPS, EC2, etc.)
- CI/CD runners
- Docker containers

---

### 2. MCP Supabase Tools

**Location:** MCP Server (Model Context Protocol)  
**Purpose:** Execute SQL operations on Supabase database  
**Access:** Via MCP CLI or AI Assistant

#### MCP Configuration

**File:** `data/json/mcp_config.json`

```json
{
  "mcpServers": {
    "supabase": {
      "command": "npx",
      "args": [
        "-y",
        "@supabase/mcp-server-supabase@latest",
        "--project-ref=qkgaybvrernstplzjaam"
      ],
      "env": {
        "supabase_access_token": "${SUPABASE_ACCESS_TOKEN}"
      }
    }
  }
}
```

**Project Reference:** `qkgaybvrernstplzjaam`  
**Authentication:** `SUPABASE_ACCESS_TOKEN` (Supabase Personal Access Token)

#### Available MCP Tools

1. **`mcp_supabase_execute_sql`** - Execute SQL queries (INSERT, UPDATE, SELECT)
2. **`mcp_supabase_apply_migration`** - Apply database migrations
3. **`mcp_supabase_list_tables`** - List all database tables
4. **`mcp_supabase_list_migrations`** - View migration history
5. **`mcp_supabase_get_logs`** - Get service logs
6. **`mcp_supabase_get_advisors`** - Security/performance checks

#### Remote Execution Methods

##### Method A: AI Assistant (Cursor/Claude Desktop)

The AI assistant has direct access to MCP tools. Simply request:

```
"Scrape https://www.velocityrestorations.com/ and insert the data into the database"
```

The AI will:
1. Call the `scrape-org` Edge Function
2. Use `mcp_supabase_execute_sql` to insert organization
3. Use `mcp_supabase_execute_sql` to insert vehicles
4. Use `mcp_supabase_execute_sql` to link organization to vehicles

**No manual SQL required** - the AI handles everything.

##### Method B: MCP CLI (Command Line)

```bash
# Install MCP CLI (if not already installed)
npm install -g @modelcontextprotocol/cli

# Set up authentication
export SUPABASE_ACCESS_TOKEN="your-supabase-access-token"

# Execute SQL via MCP
mcp supabase execute-sql "
  INSERT INTO businesses (business_name, website, ...)
  VALUES ('Velocity Restorations', 'https://...', ...)
  ON CONFLICT (website) DO UPDATE SET ...
  RETURNING id;
"
```

**Note:** MCP CLI usage may vary depending on the MCP server implementation. The primary method is via AI Assistant.

##### Method C: Programmatic MCP Client

```typescript
// Using MCP client library (if available)
import { MCPServer } from '@modelcontextprotocol/sdk';

const mcp = new MCPServer({
  name: 'supabase',
  version: '1.0.0',
});

await mcp.callTool('mcp_supabase_execute_sql', {
  query: 'INSERT INTO businesses (...) VALUES (...)'
});
```

---

### 3. Complete Remote Workflow

#### Option 1: AI Assistant Orchestration (Recommended)

**Best for:** One-off ingestions, exploratory work, rapid iteration

**Steps:**
1. User provides URL to AI Assistant
2. AI Assistant calls `scrape-org` Edge Function
3. AI Assistant uses MCP tools to insert data
4. Done - no manual SQL required

**Example:**
```
User: "Ingest https://www.velocityrestorations.com/"

AI: 
1. ✅ Calling scrape-org Edge Function...
2. ✅ Scraped: Velocity Restorations (8 fields, 12 vehicles)
3. ✅ Inserting organization via MCP...
4. ✅ Organization ID: abc-123-def
5. ✅ Inserting 12 vehicles via MCP...
6. ✅ Linking vehicles to organization...
7. ✅ Complete! Ingested 1 org and 12 vehicles.
```

#### Option 2: Script-Based Orchestration

**Best for:** Batch processing, scheduled jobs, CI/CD pipelines

**Script:** `scripts/ingest-org-via-mcp.ts`

```bash
# From any machine with Deno
deno run --allow-net --allow-env scripts/ingest-org-via-mcp.ts \
  https://www.velocityrestorations.com/
```

**What it does:**
1. Calls `scrape-org` Edge Function (remote)
2. Generates SQL statements
3. Outputs SQL for manual execution or MCP insertion

**To complete the workflow:**
- Copy generated SQL
- Execute via MCP tools (AI Assistant or CLI)
- Or use the script's output as input to another automation tool

#### Option 3: Hybrid: Script + MCP Tools

**Best for:** Automated pipelines with MCP integration

**Workflow:**
1. Script calls Edge Function and generates SQL
2. Script invokes MCP tools programmatically (if MCP client available)
3. Or script outputs structured data for MCP consumption

**Example Enhancement:**
```typescript
// Enhanced script that uses MCP tools directly
import { invokeMCPTool } from './mcp-client';

const scrapeResult = await scrapeOrg(url);
const orgId = await invokeMCPTool('mcp_supabase_execute_sql', {
  query: generateOrgSQL(scrapeResult.org)
});
// ... continue with vehicles
```

---

## Authentication & Configuration

### Required Credentials

#### For Edge Function Invocation

1. **Supabase URL**
   - Value: `https://qkgaybvrernstplzjaam.supabase.co`
   - Source: Supabase project dashboard
   - Public: Yes (safe to expose)

2. **Supabase Anon Key**
   - Value: Public anonymous key
   - Source: Supabase project dashboard → Settings → API
   - Public: Yes (safe for client-side)
   - Usage: Edge Function invocation

3. **Supabase Service Role Key** (Optional, for scripts)
   - Value: Service role key (bypasses RLS)
   - Source: Supabase project dashboard → Settings → API
   - Public: **NO** (keep secret)
   - Usage: Server-side scripts, admin operations

#### For MCP Tools

1. **Supabase Access Token**
   - Value: Personal access token
   - Source: Supabase dashboard → Account → Access Tokens
   - Public: **NO** (keep secret)
   - Usage: MCP server authentication

2. **Project Reference**
   - Value: `qkgaybvrernstplzjaam`
   - Source: Supabase project URL
   - Public: Yes (part of URL)

### Environment Variables

**For Scripts:**
```bash
export SUPABASE_URL="https://qkgaybvrernstplzjaam.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
```

**For MCP:**
```bash
export SUPABASE_ACCESS_TOKEN="your-access-token"
```

**For Frontend:**
```bash
export VITE_SUPABASE_URL="https://qkgaybvrernstplzjaam.supabase.co"
export VITE_SUPABASE_ANON_KEY="your-anon-key"
```

---

## Remote Execution Scenarios

### Scenario 1: One-Off Ingestion (AI Assistant)

**User:** Developer with Cursor IDE  
**Location:** Anywhere with internet  
**Tools:** AI Assistant (MCP-enabled)

```
User: "Ingest https://kindredmotorworks.com/"
AI: [Executes complete workflow via MCP tools]
Result: Data in database
```

**Time:** ~30 seconds  
**Manual Steps:** 0

### Scenario 2: Batch Processing (Script)

**User:** DevOps engineer  
**Location:** CI/CD runner or remote server  
**Tools:** Deno script + MCP CLI (or manual SQL execution)

```bash
# Batch script
for url in $(cat urls.txt); do
  deno run scripts/ingest-org-via-mcp.ts "$url"
  # SQL output can be piped to MCP or executed manually
done
```

**Time:** ~1 minute per URL  
**Manual Steps:** Review SQL output, execute via MCP

### Scenario 3: Scheduled Ingestion (Cron + Script)

**User:** System scheduler  
**Location:** Remote server (VPS, EC2, etc.)  
**Tools:** Cron + Deno script + MCP integration

```bash
# Crontab entry
0 2 * * * /usr/bin/deno run /path/to/scripts/ingest-org-via-mcp.ts https://example.com/
```

**Time:** Automated  
**Manual Steps:** 0 (if MCP integration is automated)

### Scenario 4: API Endpoint (Edge Function Orchestration)

**User:** External system  
**Location:** Any HTTP client  
**Tools:** Custom Edge Function that orchestrates scraping + insertion

```typescript
// New Edge Function: ingest-org-complete
serve(async (req) => {
  const { url } = await req.json();
  
  // 1. Scrape
  const scrapeResult = await invokeScrapeOrg(url);
  
  // 2. Insert via Supabase client (bypasses MCP, direct DB access)
  const orgId = await insertOrganization(scrapeResult.org);
  await insertVehicles(scrapeResult.vehicles, orgId);
  
  return { success: true, orgId };
});
```

**Time:** ~30 seconds  
**Manual Steps:** 0

---

## Tool Comparison

| Tool | Location | Access Method | Best For |
|------|----------|--------------|----------|
| **Edge Function** | Supabase Cloud | HTTP endpoint | Scraping (remote execution) |
| **MCP Tools** | MCP Server | AI Assistant / CLI | Database operations (remote SQL) |
| **Deno Script** | Local/Remote | Command line | Orchestration, batch processing |
| **AI Assistant** | Cursor IDE | Natural language | One-off tasks, rapid iteration |

---

## Security Considerations

### Public Access (Safe to Expose)
- ✅ Supabase URL
- ✅ Supabase Anon Key
- ✅ Edge Function endpoints (with anon key)

### Private Access (Keep Secret)
- ❌ Supabase Service Role Key
- ❌ Supabase Access Token (for MCP)
- ❌ Database credentials

### Best Practices
1. **Edge Functions:** Use anon key for public invocation
2. **MCP Tools:** Require access token (server-side only)
3. **Scripts:** Use service role key only in secure environments
4. **RLS Policies:** Database has Row Level Security enabled

---

## Troubleshooting

### Edge Function Not Accessible

**Error:** `401 Unauthorized`  
**Solution:** Check `SUPABASE_ANON_KEY` is correct

**Error:** `404 Not Found`  
**Solution:** Verify function is deployed: `supabase functions deploy scrape-org`

### MCP Tools Not Working

**Error:** `Authentication failed`  
**Solution:** Check `SUPABASE_ACCESS_TOKEN` is set and valid

**Error:** `Tool not found`  
**Solution:** Verify MCP server is configured in `mcp_config.json`

### Script Execution Issues

**Error:** `SUPABASE_URL not set`  
**Solution:** Export environment variables before running script

**Error:** `Permission denied`  
**Solution:** Use `--allow-net --allow-env` flags with Deno

---

## Fully Automated Option

For **zero manual intervention**, use the `ingest-org-complete` Edge Function:

```bash
curl -X POST https://qkgaybvrernstplzjaam.supabase.co/functions/v1/ingest-org-complete \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.velocityrestorations.com/"}'
```

This function:
- ✅ Scrapes organization and vehicles
- ✅ Inserts everything into database automatically
- ✅ Links organization to vehicles
- ✅ Inserts vehicle images
- ✅ **No MCP tools needed**
- ✅ **No manual SQL required**

See **[Automated Ingestion](./AUTOMATED_INGESTION.md)** for complete documentation.

## Summary

**Remote execution is enabled through:**

1. **Edge Functions** - Run on Supabase Cloud (always remote)
   - `scrape-org`: Scrapes data, returns JSON (requires MCP for insertion)
   - `ingest-org-complete`: **Fully automated** - scrapes + inserts (recommended)
2. **MCP Tools** - Execute SQL remotely via MCP server (optional, if using `scrape-org`)
3. **Scripts** - Can run from any machine with Deno installed
4. **AI Assistant** - Orchestrates everything via MCP tools (optional)

**No local database required** - everything runs against the remote Supabase database.

**Recommended workflow:** `ingest-org-complete` Edge Function (fully automated)

