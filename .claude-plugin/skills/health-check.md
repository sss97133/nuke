# /nuke-ops:health-check

Morning health check for the Nuke platform. Run this daily or on-demand to get a full status report.

## What this does

1. Database health: connection count, lock waiters, stale locks, active queries
2. Queue health: import_queue stuck items, image pipeline status
3. Edge function errors: last 24h error rate from logs
4. Cron job status: any failed or overdue crons
5. Disk/storage: snapshot table size, image bucket growth
6. Data quality: recent extraction success rates

## Instructions

Run these checks sequentially and produce a severity-rated report.

```bash
cd /Users/skylar/nuke
```

### 1. Database Health
```sql
-- via mcp__claude_ai_Supabase__execute_sql
SELECT count(*) as active_connections FROM pg_stat_activity WHERE state = 'active';
SELECT count(*) as lock_waiters FROM pg_stat_activity WHERE wait_event_type = 'Lock';
SELECT * FROM queue_lock_health;
SELECT count(*) as long_queries FROM pg_stat_activity WHERE state = 'active' AND now() - query_start > interval '60 seconds';
```

### 2. Queue Health
```sql
SELECT status, count(*) FROM import_queue GROUP BY status ORDER BY count DESC;
SELECT ai_processing_status, count(*) FROM vehicle_images WHERE ai_processing_status IN ('pending', 'processing') GROUP BY ai_processing_status;
```

### 3. Edge Function Errors (last 24h)
Use `mcp__claude_ai_Supabase__get_logs` with service "edge-function" and look for error patterns.

### 4. Cron Status
```sql
SELECT jobname, schedule, active, last_run, last_run_status
FROM cron.job_run_details jrd
JOIN cron.job j ON j.jobid = jrd.jobid
WHERE jrd.start_time > now() - interval '24 hours' AND jrd.status = 'failed'
ORDER BY jrd.start_time DESC LIMIT 20;
```

### 5. Quick Stats
```bash
dotenvx run -- bash -c 'curl -s "$VITE_SUPABASE_URL/functions/v1/db-stats" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"' | jq
```

### 6. Report Format

Output a report like:

```
## Nuke Health Report — [date]

### CRITICAL (fix now)
- [item]

### WARNING (fix today)
- [item]

### OK
- DB connections: X active
- Lock waiters: 0
- Queue: X pending, Y processing
- Errors (24h): Z
```

Write the report to `.claude/HEALTH_REPORT.md` and append a one-line summary to HANDOFF.md.
