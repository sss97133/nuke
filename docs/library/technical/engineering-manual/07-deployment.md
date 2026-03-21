# Chapter 7: Deployment

## What This Subsystem Does

Deployment covers how edge functions are built, tested, and pushed to production; how database migrations are applied safely; how cron jobs are managed; how secrets are handled without exposure; and how system health is monitored. The platform runs entirely on Supabase (Edge Functions on Deno Deploy, Postgres with pg_cron, Storage for images and snapshots) with supplementary infrastructure on Modal (GPU workloads for YONO).

---

## Edge Function Deployment

### Project Structure

Edge functions live in `supabase/functions/`. Each function is a directory with an `index.ts` entry point:

```
supabase/functions/
  _shared/                  # Shared modules (import, never copy)
    agentTiers.ts
    archiveFetch.ts
    cors.ts
    normalizeVehicle.ts
    extractionQualityGate.ts
    listingUrl.ts
    ...
  process-import-queue/
    index.ts
  extract-bat-core/
    index.ts
  haiku-extraction-worker/
    index.ts
  ingest-observation/
    index.ts
  ...
```

Shared modules in `_shared/` are imported by relative path:

```typescript
import { corsHeaders } from "../_shared/cors.ts";
import { archiveFetch } from "../_shared/archiveFetch.ts";
```

### Deploying a Single Function

```bash
cd /Users/skylar/nuke
supabase functions deploy extract-bat-core --no-verify-jwt
```

The `--no-verify-jwt` flag is used for functions that are called by other functions (service-to-service) rather than by end users. Functions that are only called with the service role key do not need JWT verification.

### Deploying All Functions

```bash
cd /Users/skylar/nuke
supabase functions deploy --no-verify-jwt
```

This deploys every function in `supabase/functions/`. Use with caution -- it deploys everything, including functions you may not have intended to update.

### Checking Deployment Status

```bash
# List deployed functions
supabase functions list

# Check a specific function's logs
supabase functions logs extract-bat-core --tail
```

### Function Naming Conventions

- Kebab-case: `extract-bat-core`, `process-import-queue`
- Source-specific extractors: `extract-{source}` or `extract-{source}-core`
- API endpoints: `api-v1-{resource}`
- Workers: `{tier}-extraction-worker`, `yono-vision-worker`
- Orchestrators: `{domain}-orchestrator`, `photo-pipeline-orchestrator`

### The _shared Directory

Every shared utility goes in `_shared/`. The critical files:

| File | Must Import From Here | Never Do Instead |
|------|----------------------|-----------------|
| `cors.ts` | `import { corsHeaders } from "../_shared/cors.ts"` | Copy-paste CORS headers into your function |
| `archiveFetch.ts` | `import { archiveFetch } from "../_shared/archiveFetch.ts"` | Use raw `fetch()` for external URLs |
| `agentTiers.ts` | `import { callTier } from "../_shared/agentTiers.ts"` | Inline Anthropic API calls |
| `normalizeVehicle.ts` | `import { normalizeVehicleFields } from "../_shared/normalizeVehicle.ts"` | Write your own make normalization |

Before the March 2026 triage:
- 318 functions were duplicating CORS headers
- 444 functions were inlining the Supabase client creation
- Only 5% of functions used `archiveFetch()`

---

## Secrets Management

### The dotenvx Pattern

All secrets are managed via `dotenvx` with encrypted `.env` files. Never source `.env` directly.

```bash
# Run any command with secrets injected
dotenvx run -- node scripts/iphoto-intake.mjs --list

# Run a curl command with secrets
dotenvx run -- bash -c 'curl -s "$VITE_SUPABASE_URL/functions/v1/db-stats" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"' | jq
```

### Key Environment Variables

| Variable | Purpose | Where Used |
|----------|---------|-----------|
| `VITE_SUPABASE_URL` | Supabase project URL | Scripts, edge functions (auto-injected as `SUPABASE_URL`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (full access) | Scripts, inter-function calls |
| `ANTHROPIC_API_KEY` | Claude API key | Edge functions using agentTiers.ts |
| `FIRECRAWL_API_KEY` | Firecrawl scraping API key | archiveFetch.ts Firecrawl mode |
| `YONO_SIDECAR_URL` | Modal GPU service URL | YONO vision functions |

### Edge Function Secrets

Edge functions on Supabase automatically have `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` injected. Additional secrets must be set via the CLI:

```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
supabase secrets set FIRECRAWL_API_KEY=fc-...
```

### Direct Database Access

For operations that need direct Postgres access (bypassing PostgREST):

```bash
PGPASSWORD="..." psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 \
  -U postgres.qkgaybvrernstplzjaam -d postgres
```

Or use the Supabase MCP:

```
mcp__supabase__execute_sql({ project_id: "qkgaybvrernstplzjaam", query: "SELECT 1" })
```

---

## Cron Job Management

Cron jobs are managed via `pg_cron` in the Supabase database. Each job calls an edge function or runs SQL on a schedule.

### Listing Active Crons

```sql
SELECT jobid, schedule, command, nodename, active
FROM cron.job
WHERE active = true
ORDER BY jobid;
```

### Creating a Cron Job

```sql
SELECT cron.schedule(
  'process-import-queue-cron',   -- job name
  '*/5 * * * *',                 -- every 5 minutes
  $$SELECT net.http_post(
    url := current_setting('supabase.url') || '/functions/v1/continuous-queue-processor',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('supabase.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{"batch_size": 10}'
  )$$
);
```

### Cron Frequency Rules

From the hard rules:

- **Minimum interval: 5 minutes.** Most jobs should be 10-15 minutes.
- **Never 1-2 minute frequency.** Before triage, 25 cron jobs ran at 1-2 minute intervals, burning compute and causing lock contention.

### Key Cron Jobs

| Job | Schedule | Function | Purpose |
|-----|----------|----------|---------|
| Process import queue | Every 5 min | `continuous-queue-processor` | Process pending extractions |
| Release stale locks | Hourly | SQL: `release_stale_locks()` | Clean up crashed worker locks |
| Analysis engine sweep | Every 15 min | `analysis-engine-coordinator` | Recompute stale signals |
| Data quality snapshot | Daily 2am UTC | `data-quality-monitor` | Snapshot quality metrics |

### Disabling a Cron Job

```sql
UPDATE cron.job SET active = false WHERE jobid = 188;
```

### Deleting a Cron Job

```sql
SELECT cron.unschedule(188);  -- by job ID
SELECT cron.unschedule('process-import-queue-cron');  -- by job name
```

---

## Monitoring and Health Checks

### Quick System Status

```bash
cd /Users/skylar/nuke && dotenvx run -- bash -c 'curl -s -X POST \
  "$VITE_SUPABASE_URL/functions/v1/ralph-wiggum-rlm-extraction-coordinator" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"action\": \"brief\"}"' | jq
```

This returns:
- Queue health (pending, processing, failed counts)
- Failing domains and error patterns
- Recommended next actions

### Database Stats

```bash
cd /Users/skylar/nuke && dotenvx run -- bash -c 'curl -s \
  "$VITE_SUPABASE_URL/functions/v1/db-stats" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"' | jq
```

Returns:
- Total vehicles, comments, images
- Extraction progress
- Queue depths

### Edge Function Logs

```bash
# Real-time logs for a specific function
supabase functions logs extract-bat-core --tail

# Or via Supabase MCP
mcp__supabase__get_logs({
  project_id: "qkgaybvrernstplzjaam",
  service: "edge-function"
})
```

### Checking Queue Health

```sql
-- Queue status breakdown
SELECT status, count(*) FROM import_queue GROUP BY status ORDER BY count(*) DESC;

-- Failed items by category
SELECT failure_category, count(*) FROM import_queue
WHERE status = 'failed'
GROUP BY failure_category ORDER BY count(*) DESC;

-- Stuck items (processing for > 30 minutes)
SELECT id, listing_url, locked_by, locked_at, now() - locked_at AS age
FROM import_queue
WHERE status = 'processing'
AND locked_at < now() - interval '30 minutes';
```

### Checking for Lock Contention

```sql
-- Active locks
SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock';

-- Long-running queries
SELECT pid, now() - pg_stat_activity.query_start AS duration, query
FROM pg_stat_activity
WHERE (now() - pg_stat_activity.query_start) > interval '5 seconds'
AND state = 'active'
ORDER BY duration DESC;
```

---

## Operational Scripts

### npm Scripts

```bash
# Health check
npm run ops:health

# Smoke test
npm run ops:smoke

# Nightly regression
npm run ops:regression
```

### Scheduled Scripts

Located in `scripts/scheduled/`:

| Script | Purpose | Suggested Schedule |
|--------|---------|-------------------|
| `morning-health-check.sh` | Daily health report | 8:00 AM local |
| `smoke-test.sh` | Core functionality smoke test | Every 4 hours |
| `nightly-regression.sh` | Full regression test suite | 2:00 AM local |

### Plugin Skills

The `.claude-plugin/` directory contains skills for autonomous operations:

| Skill | Command | Purpose |
|-------|---------|---------|
| `health-check` | `/health-check` | Run system health check |
| `debug-extraction` | `/debug-extraction` | Debug extraction failures |
| `audit-design` | `/audit-design` | Audit design system compliance |
| `smoke-test` | `/smoke-test` | Run smoke tests |
| `integration-check` | `/integration-check` | Check system integration |
| `nightly-regression` | `/nightly-regression` | Full regression suite |

### Reports

Health and test reports are written to:

| File | Content |
|------|---------|
| `.claude/HEALTH_REPORT.md` | Latest health check results |
| `.claude/SMOKE_TEST.md` | Latest smoke test results |
| `.claude/NIGHTLY_REGRESSION.md` | Latest regression test results |
| `.claude/DESIGN_AUDIT.md` | Latest design system audit |

---

## How to Deploy from Scratch

### Step 1: Install Prerequisites

```bash
# Supabase CLI
brew install supabase/tap/supabase

# dotenvx
brew install dotenvx/brew/dotenvx

# Deno (for local testing)
brew install deno
```

### Step 2: Link to Project

```bash
cd /Users/skylar/nuke
supabase link --project-ref qkgaybvrernstplzjaam
```

### Step 3: Set Secrets

```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
supabase secrets set FIRECRAWL_API_KEY=fc-...
```

### Step 4: Deploy Functions

```bash
# Deploy all functions
supabase functions deploy --no-verify-jwt

# Or deploy specific functions
supabase functions deploy process-import-queue --no-verify-jwt
supabase functions deploy extract-bat-core --no-verify-jwt
supabase functions deploy ingest-observation --no-verify-jwt
```

### Step 5: Apply Migrations

```bash
supabase db push
```

Or use the Supabase MCP for individual migrations.

### Step 6: Set Up Cron Jobs

Apply the cron schedule via SQL (see Cron Job Management above).

### Step 7: Verify

```bash
# Check function health
dotenvx run -- bash -c 'curl -s "$VITE_SUPABASE_URL/functions/v1/db-stats" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"' | jq

# Check queue is processing
dotenvx run -- bash -c 'curl -s -X POST \
  "$VITE_SUPABASE_URL/functions/v1/process-import-queue" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"batch_size\": 1}"' | jq
```

---

## Known Problems

1. **No staging environment.** Functions deploy directly to production. A staging branch (Supabase branching) would enable testing before production deployment.

2. **No rollback mechanism.** If a deployed function has a bug, the only fix is to deploy a corrected version. There is no one-click rollback to the previous version.

3. **Cron jobs are not version-controlled.** Cron schedules live in the database, not in code. If the database is recreated, all cron jobs must be manually re-created.

4. **Secret rotation is manual.** Rotating the Anthropic API key or Firecrawl key requires `supabase secrets set` and then redeployment of all affected functions.

5. **No function-level metrics.** There is no dashboard showing per-function invocation count, latency, or error rate. Monitoring relies on log inspection.
