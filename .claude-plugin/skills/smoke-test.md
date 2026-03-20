# /nuke-ops:smoke-test

Quick integration smoke test. Hits every MCP server and critical edge function to verify connectivity.

## Instructions

### 1. MCP Server Connectivity

**Supabase MCP:**
```sql
-- via mcp__claude_ai_Supabase__execute_sql
SELECT 1 as supabase_mcp_ok;
```

**Supabase Nuke MCP (if available):**
Try `mcp__claude_ai_Nuke__describe_platform` — should return platform description.

### 2. Critical Edge Functions
```bash
cd /Users/skylar/nuke

# db-stats (should return JSON with vehicle counts)
dotenvx run -- bash -c 'curl -s -w "\nHTTP %{http_code}" "$VITE_SUPABASE_URL/functions/v1/db-stats" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"' | tail -1

# universal-search (should return results)
dotenvx run -- bash -c 'curl -s -w "\nHTTP %{http_code}" "$VITE_SUPABASE_URL/functions/v1/universal-search?q=porsche" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"' | tail -1

# ralph coordination brief
dotenvx run -- bash -c 'curl -s -w "\nHTTP %{http_code}" -X POST "$VITE_SUPABASE_URL/functions/v1/ralph-wiggum-rlm-extraction-coordinator" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "Content-Type: application/json" -d "{\"action\": \"brief\"}"' | tail -1
```

### 3. Frontend Health
```bash
# Check if Vercel deployment is live
curl -s -w "\nHTTP %{http_code}" "https://nuke.ag" | tail -1
```

### 4. Database Connectivity
```sql
SELECT
  (SELECT count(*) FROM vehicles WHERE status = 'active') as active_vehicles,
  (SELECT count(*) FROM vehicle_images) as total_images,
  (SELECT count(*) FROM import_queue WHERE status = 'pending') as pending_imports;
```

### 5. Report

```
## Smoke Test — [timestamp]

| Service | Status | Latency |
|---------|--------|---------|
| Supabase MCP | OK/FAIL | Xms |
| Nuke MCP | OK/FAIL | Xms |
| db-stats | OK/FAIL | HTTP XXX |
| universal-search | OK/FAIL | HTTP XXX |
| ralph-coordinator | OK/FAIL | HTTP XXX |
| nuke.ag | OK/FAIL | HTTP XXX |
| DB direct | OK/FAIL | Xms |

Overall: X/Y passing
```

Write to `.claude/SMOKE_TEST.md`.
