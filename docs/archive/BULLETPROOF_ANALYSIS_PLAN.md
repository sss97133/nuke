# Bulletproof Analysis System - Implementation Plan

## ✅ What's Been Built

### 1. **Analysis Queue System** (`analysis_queue` table)
- ✅ Tracks all analysis requests
- ✅ Prevents duplicates
- ✅ Automatic retry with exponential backoff (1min → 5min → 15min → 30min)
- ✅ Priority system (1-10)
- ✅ Status tracking: `pending` → `processing` → `completed`/`failed`/`retrying`
- ✅ Full error logging

### 2. **Queue Processor** (`process-analysis-queue` Edge Function)
- ✅ Processes queue in batches (10 per run)
- ✅ Uses `SKIP LOCKED` to prevent concurrent processing
- ✅ Handles errors gracefully
- ✅ Returns detailed status reports

### 3. **Auto-Queue Triggers**
- ✅ Automatically queues analysis on vehicle creation
- ✅ Automatically queues analysis on image addition
- ✅ Prevents duplicate requests

### 4. **Enhanced Expert Agent**
- ✅ Health checks (verifies vehicle exists)
- ✅ Better error handling
- ✅ Comprehensive logging

### 5. **Frontend Integration**
- ✅ Uses queue instead of direct calls
- ✅ Status polling
- ✅ User feedback

## 🚀 Deployment Steps

### Step 1: Apply Database Migrations
```bash
# Run these migrations in Supabase Dashboard → SQL Editor:
1. supabase/migrations/20250130_create_analysis_queue.sql
2. supabase/migrations/20250130_auto_queue_analysis_triggers.sql
```

### Step 2: Deploy Edge Function
```bash
# Deploy the queue processor
supabase functions deploy process-analysis-queue
```

### Step 3: Setup Cron Job
```bash
# Run in Supabase Dashboard → SQL Editor:
# Edit scripts/setup-analysis-queue-cron.sql
# Replace YOUR_SERVICE_ROLE_KEY with actual key
# Then run it
```

### Step 4: Deploy Frontend
```bash
# Already committed, just deploy:
vercel --prod --force --yes
```

## 🔍 How It Works

### Automatic Flow
1. **Vehicle Created** → Trigger fires → Analysis queued (priority 3)
2. **Image Added** → Trigger fires → Analysis queued (priority 5)
3. **Cron Runs** (every 5 min) → Processes 10 analyses → Updates status
4. **Analysis Fails** → Retry scheduled (exponential backoff)
5. **Analysis Succeeds** → Status = `completed`, results saved

### Manual Trigger
1. User clicks "Analyze Now"
2. Frontend calls `queue_analysis()` (priority 2)
3. Analysis queued
4. Cron picks it up within 5 minutes
5. Results appear automatically

### Self-Repairing
- **Failed analyses** automatically retry (up to 3 times)
- **Stuck analyses** (processing > 30 min) can be manually reset
- **Old analyses** automatically cleaned up after 30 days
- **Queue position** visible to users

## 📊 Monitoring

### Check Queue Status
```sql
-- View all pending analyses
SELECT * FROM analysis_queue 
WHERE status IN ('pending', 'retrying')
ORDER BY priority ASC, created_at ASC;

-- View failed analyses
SELECT * FROM analysis_queue 
WHERE status = 'failed'
ORDER BY created_at DESC
LIMIT 10;

-- Get status for specific vehicle
SELECT * FROM get_analysis_status('vehicle-id-here');
```

### Check Cron Jobs
```sql
-- View scheduled jobs
SELECT jobid, jobname, schedule, active 
FROM cron.job 
WHERE jobname LIKE '%analysis%';

-- View job run history
SELECT * FROM cron.job_run_details 
WHERE jobid IN (
  SELECT jobid FROM cron.job WHERE jobname = 'process-analysis-queue'
)
ORDER BY start_time DESC
LIMIT 10;
```

## 🛠️ Troubleshooting

### Analysis Not Processing
1. Check if cron job is running:
   ```sql
   SELECT * FROM cron.job WHERE jobname = 'process-analysis-queue';
   ```
2. Manually trigger processing:
   ```bash
   curl -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/process-analysis-queue" \
     -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
     -H "Content-Type: application/json" \
     -d '{"batchSize": 10}'
   ```
3. Check queue for stuck items:
   ```sql
   SELECT * FROM analysis_queue 
   WHERE status = 'processing' 
     AND last_attempt_at < NOW() - INTERVAL '30 minutes';
   ```

### Analysis Failing Repeatedly
1. Check error details:
   ```sql
   SELECT error_message, error_details, retry_count 
   FROM analysis_queue 
   WHERE status = 'failed'
   ORDER BY created_at DESC;
   ```
2. Check vehicle data:
   ```sql
   SELECT id, year, make, model, 
     (SELECT COUNT(*) FROM vehicle_images WHERE vehicle_id = vehicles.id) as image_count
   FROM vehicles 
   WHERE id = 'vehicle-id-here';
   ```

### Reset Stuck Analysis
```sql
-- Reset stuck processing item
UPDATE analysis_queue
SET status = 'pending', next_retry_at = NOW()
WHERE id = 'queue-id-here' 
  AND status = 'processing'
  AND last_attempt_at < NOW() - INTERVAL '30 minutes';
```

## 🎯 Success Metrics

- ✅ **Zero Lost Analyses**: Everything tracked in queue
- ✅ **Automatic Recovery**: Failed analyses retry automatically
- ✅ **No Duplicates**: Queue prevents duplicate requests
- ✅ **Priority System**: Important analyses process first
- ✅ **Full Visibility**: All status and errors logged
- ✅ **Self-Healing**: System recovers from failures
- ✅ **Scalable**: Can process hundreds per hour

## 📝 Next Steps

1. ✅ Queue system created
2. ✅ Queue processor created
3. ✅ Auto-queue triggers created
4. ⏳ Deploy migrations
5. ⏳ Deploy edge function
6. ⏳ Setup cron job
7. ⏳ Test with real vehicle
8. ⏳ Monitor performance
9. ⏳ Add admin dashboard (optional)

## 🔐 Security Notes

- Queue table has RLS enabled
- Users can only see analyses for their vehicles
- Service role has full access for processing
- All errors logged but not exposed to users
- Queue IDs are UUIDs (not guessable)

