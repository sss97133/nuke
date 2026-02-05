# Extraction Watchdog System - Deployed 2026-02-03

## Summary
Automated fallback and recovery system for extraction pipeline.

## What's Running

### 1. Watchdog Cron Job (every 5 min)
- **Function:** `extraction-watchdog`
- **Schedule:** `*/5 * * * *` (cron job #117)
- **Actions:**
  - Monitors queue health
  - Clears stale locks (>15 min old)
  - Retries stuck items
  - Triggers processor if queue stalled
  - Sends Telegram alerts on issues

### 2. Telegram Alerts
- **Bot:** @Sss97133_bot (8516184265)
- **Chat:** 7587296683 (Skylar)
- **Triggers:**
  - Queue stall (no workers, items pending)
  - High error rate (>20%)
  - Low throughput

### 3. Dashboard Component
- **File:** `nuke_frontend/src/components/admin/ExtractionWatchdog.tsx`
- **Usage:** Import into AdminMissionControl or create new admin page
- **Features:** Real-time queue status, ETA, error tracking

## Known Issues

### Supabase REST API Schema Cache (Temporary)
- Error: PGRST002 "Could not query the database for the schema cache"
- Impact: Watchdog shows 0 counts
- Workaround: Direct psql shows real data (47k pending)
- Resolution: Usually clears automatically, may need Supabase dashboard restart

## Manual Commands

```bash
# Check watchdog status
curl -X POST "$SUPABASE_URL/functions/v1/extraction-watchdog" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -d '{"action": "status"}'

# Trigger immediate recovery
curl -X POST "$SUPABASE_URL/functions/v1/extraction-watchdog" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -d '{"action": "recover"}'

# Test Telegram alert
curl -X POST "$SUPABASE_URL/functions/v1/extraction-watchdog" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -d '{"action": "alert_test"}'

# Check cron job
psql ... -c "SELECT jobname, schedule FROM cron.job WHERE jobname = 'extraction-watchdog';"

# Check recent watchdog runs
psql ... -c "SELECT created_at, issues, actions_taken FROM watchdog_runs ORDER BY created_at DESC LIMIT 5;"
```

## Files Created/Modified

1. `/supabase/functions/extraction-watchdog/index.ts` - Main watchdog function
2. `/nuke_frontend/src/components/admin/ExtractionWatchdog.tsx` - Dashboard component
3. `/.claude/ACTIVE_AGENTS.md` - Updated with watchdog deployment
4. `/WATCHDOG_STATUS.md` - This file

## Database Objects

- `watchdog_runs` table - Logs each watchdog run
- `sentinel_alerts` table - Stores alerts
- `import_queue_service_role` policy - Allows service role access
- `get_queue_status_counts()` function - Queue stats RPC
- Cron job #117 - Scheduled execution
