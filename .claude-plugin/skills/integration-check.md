# /nuke-ops:integration-check

Deep integration check for all connectors, API calls, and MCP endpoints. Goes beyond smoke-test to verify data flow end-to-end.

## Instructions

### 1. Supabase Edge Function Inventory
```bash
cd /Users/skylar/nuke
# List all deployed functions
supabase functions list 2>/dev/null | head -60
```

### 2. Test Each Extraction Pipeline

**archiveFetch chain:**
```sql
-- Recent snapshots (is archiving working?)
SELECT source_platform, count(*), max(created_at) as latest
FROM listing_page_snapshots
WHERE created_at > now() - interval '24 hours'
GROUP BY source_platform ORDER BY count DESC;
```

**Import queue → extraction → vehicle:**
```sql
-- End-to-end: items that went pending → complete in last 24h
SELECT count(*) as completed_24h,
  avg(EXTRACT(EPOCH FROM (updated_at - created_at))) as avg_seconds
FROM import_queue
WHERE status = 'complete' AND updated_at > now() - interval '24 hours';
```

### 3. MCP Tool Verification

Test each registered MCP tool:
- `mcp__claude_ai_Supabase__execute_sql` — `SELECT 1`
- `mcp__claude_ai_Supabase__get_logs` — service: "edge-function"
- `mcp__claude_ai_Supabase__list_tables` — schemas: ["public"]
- `mcp__claude_ai_Nuke__search_vehicles` — query: "porsche 911"
- `mcp__claude_ai_Nuke__describe_platform` — no args

Log which ones respond vs timeout vs error.

### 4. External API Connectivity
```bash
cd /Users/skylar/nuke

# Firecrawl (if configured)
dotenvx run -- bash -c 'curl -s -w "\nHTTP %{http_code}" "https://api.firecrawl.dev/v1/scrape" -H "Authorization: Bearer $FIRECRAWL_API_KEY" -H "Content-Type: application/json" -d "{\"url\":\"https://example.com\",\"formats\":[\"markdown\"]}"' | tail -5

# Anthropic API (check credit status)
dotenvx run -- bash -c 'curl -s "https://api.anthropic.com/v1/messages" -H "x-api-key: $ANTHROPIC_API_KEY" -H "anthropic-version: 2023-06-01" -H "content-type: application/json" -d "{\"model\":\"claude-3-5-haiku-latest\",\"max_tokens\":10,\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}]}" | jq .error // jq .content[0].text'
```

### 5. Cron Job Health
```sql
SELECT j.jobname, j.schedule, j.active,
  (SELECT max(start_time) FROM cron.job_run_details WHERE jobid = j.jobid) as last_run,
  (SELECT status FROM cron.job_run_details WHERE jobid = j.jobid ORDER BY start_time DESC LIMIT 1) as last_status
FROM cron.job j
WHERE j.active = true
ORDER BY j.jobname;
```

### 6. Report

Produce a structured report with:
- Each integration point: name, status, last successful call, error if any
- Data flow verification: are records actually moving through the pipeline?
- Broken connections flagged as CRITICAL
- Write to `.claude/INTEGRATION_REPORT.md`
