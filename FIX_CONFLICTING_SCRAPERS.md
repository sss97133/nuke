# 🔧 Fix Conflicting Scrapers

## ✅ What I Found

**MAJOR CONFLICTS** - Multiple scrapers doing the same work:

### Active Supabase Cron Jobs (Conflicting):
1. **`process-import-queue-manual`** - Every 1 minute
   - ❌ Calls BROKEN `process-import-queue` (BOOT_ERROR)
   - **Waste**: Failing every minute

2. **`process-bat-queue`** - Every 1 minute
   - Calls `process-bat-extraction-queue`
   - **Conflict**: Orchestrator also processes this

3. **`go-grinder-continuous`** - Every 1 minute
   - Calls `go-grinder`
   - **Conflict**: Too frequent, orchestrator triggers go-grinder via sync-active-auctions

4. **`daytime-extraction-pulse`** - Every 10 minutes (8 AM - 7 PM)
   - Calls: `process-import-queue` (BROKEN), `process-bat-extraction-queue`, `go-grinder`
   - **Conflict**: Duplicates orchestrator (also runs every 10 min)

5. **`overnight-extraction-pulse`** - Every 3 minutes (8 PM - 7 AM)
   - Calls: `process-import-queue` (BROKEN), `process-bat-extraction-queue`, `go-grinder`
   - **Conflict**: Duplicates orchestrator

6. **`sync-active-auctions`** - Every 15 minutes
   - ✅ **OK TO KEEP** - Can coexist with orchestrator (has rate limiting)

## Solution

Run this SQL in Supabase Dashboard → SQL Editor to disable conflicting jobs:

```sql
-- Disable conflicting cron jobs (orchestrator handles these now)
UPDATE cron.job SET active = false WHERE jobname = 'process-import-queue-manual';
UPDATE cron.job SET active = false WHERE jobname = 'process-bat-queue';
UPDATE cron.job SET active = false WHERE jobname = 'daytime-extraction-pulse';
UPDATE cron.job SET active = false WHERE jobname = 'overnight-extraction-pulse';
UPDATE cron.job SET active = false WHERE jobname = 'go-grinder-continuous';

-- Verify
SELECT jobid, jobname, schedule, active 
FROM cron.job 
WHERE jobname IN (
  'process-import-queue-manual',
  'process-bat-queue', 
  'daytime-extraction-pulse',
  'overnight-extraction-pulse',
  'go-grinder-continuous'
);
```

## What Will Happen After Fix

✅ **Single source of truth**: Orchestrator runs every 10 minutes
✅ **No conflicts**: No duplicate queue processing
✅ **Efficient**: Only working functions are called
✅ **Reliable**: One scheduled job instead of 5 conflicting ones

## Jobs That Remain Active (OK)

- `sync-active-auctions` (every 15 min) - Can coexist, has rate limiting
- `mecum-extraction-cron` - Different source, OK
- `premium-auction-extractor` - Different source, OK  
- Source-specific scrapers - Fine, different purposes

