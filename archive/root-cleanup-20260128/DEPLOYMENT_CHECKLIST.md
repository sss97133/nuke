# 🚀 Deployment Checklist - Pipeline Orchestrator

## ✅ Completed

1. ✅ Created GitHub Action: `.github/workflows/pipeline-orchestrator.yml`
   - Runs every 10 minutes
   - Triggers pipeline orchestrator Edge Function

2. ✅ Fixed orchestrator to use working queue processor
   - Switched from broken `process-import-queue` to `process-import-queue-fast`
   - Optimized metrics collection queries

3. ✅ Identified conflicting scrapers
   - Found 5 active Supabase cron jobs that duplicate orchestrator work
   - Created migration SQL to disable conflicts

4. ✅ Tested immediate results
   - **3 vehicles created** from import queue
   - **1 BaT extraction completed**
   - Functions are working!

## ⚠️ Action Required

### Step 1: Disable Conflicting Supabase Cron Jobs

Run this SQL in **Supabase Dashboard → SQL Editor**:

```sql
-- Disable conflicting cron jobs
UPDATE cron.job SET active = false WHERE jobname = 'process-import-queue-manual';
UPDATE cron.job SET active = false WHERE jobname = 'process-bat-queue';
UPDATE cron.job SET active = false WHERE jobname = 'daytime-extraction-pulse';
UPDATE cron.job SET active = false WHERE jobname = 'overnight-extraction-pulse';
UPDATE cron.job SET active = false WHERE jobname = 'go-grinder-continuous';

-- Verify disabled
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

**Why**: These jobs conflict with the orchestrator, causing:
- Duplicate queue processing
- Race conditions
- Wasted resources (especially `process-import-queue-manual` which calls a broken function)

### Step 2: Commit & Push GitHub Action

The orchestrator GitHub Action is ready. Once you commit and push:
- It will run automatically every 10 minutes
- Processes queues continuously
- Triggers scrapers to discover new listings
- Creates new profiles automatically

### Step 3: Monitor First Few Runs

After disabling conflicts and deploying:
- Check GitHub Actions → Pipeline Orchestrator (should run every 10 min)
- Check Supabase Edge Function logs for `pipeline-orchestrator`
- Verify queue depths are decreasing
- Verify new vehicles appearing on homepage

## What Will Happen

### Every 10 Minutes (GitHub Action):
1. **Unlocks** orphaned queue items (stuck in "processing")
2. **Triggers scrapers**:
   - `sync-active-auctions` (discovers BaT auctions)
   - `extract-all-orgs-inventory` (scrapes org sites)
3. **Processes queues**:
   - `process-import-queue-fast` (creates vehicles from listings)
   - `process-bat-extraction-queue` (completes BaT extractions)

### Expected Results:
- **Queue depths decrease** (1,026 pending → processing → complete)
- **New profiles appear** on homepage (currently showing same vehicles)
- **Continuous flow** of data from all sources

## Current Status

- ✅ Code ready
- ✅ GitHub Action created
- ⚠️ Conflicts identified (need to disable 5 Supabase cron jobs)
- ⏳ Waiting for: SQL migration + commit/push

## Files Created/Modified

1. `.github/workflows/pipeline-orchestrator.yml` - NEW (orchestrator schedule)
2. `supabase/functions/pipeline-orchestrator/index.ts` - MODIFIED (uses working queue processor)
3. `supabase/migrations/20250109_disable_conflicting_crons_for_orchestrator.sql` - NEW (fix conflicts)
4. `CONFLICTING_SCRAPERS_ANALYSIS.md` - NEW (documentation)
5. `FIX_CONFLICTING_SCRAPERS.md` - NEW (instructions)
6. `IMMEDIATE_RESULTS.md` - NEW (test results)

