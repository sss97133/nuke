# Speed Up BaT Queue Processing - Quick Guide

**Status:** ✅ Ready to test

---

## 🎯 Goal

Process BaT extraction queue faster:
- **Current:** 1 item every 5 min = 12/hour = **5.5 days** for 1,577 items ❌
- **Target:** 10-20 items every 5 min = **13 hours - 7 hours** for 1,577 items ✅

---

## 📋 Step-by-Step Process

### **Step 1: Test Processing Now (Show Results)**

Run this to process 5-10 items manually and see results:

```bash
# Process 5 items (show results)
node scripts/process-bat-queue-manual.js 5

# Process 10 items (more results)
node scripts/process-bat-queue-manual.js 10

# Process multiple batches (5 items × 3 runs = 15 total)
node scripts/process-bat-queue-manual.js 5 3
```

**What you'll see:**
- ✅ Vehicles being created
- ✅ Extraction progress
- ✅ Success/failure rates
- ✅ Queue status updates

**Expected output:**
```
🚀 Run 1/1: Processing 5 items...

✅ Success!
   Processed: 5
   Succeeded: 5
   Failed: 0
   Vehicles created: 5
```

### **Step 2: Check Results**

After manual processing, verify everything looks good:

```sql
-- Check recent extractions
SELECT 
  status,
  COUNT(*) as count,
  MAX(processed_at) as last_processed
FROM bat_extraction_queue
WHERE processed_at > NOW() - INTERVAL '1 hour'
GROUP BY status;

-- Check newly created vehicles
SELECT COUNT(*) as new_vehicles
FROM vehicles
WHERE created_at > NOW() - INTERVAL '1 hour';

-- Check queue status
SELECT 
  status,
  COUNT(*) as count
FROM bat_extraction_queue
GROUP BY status
ORDER BY 
  CASE status
    WHEN 'pending' THEN 1
    WHEN 'processing' THEN 2
    WHEN 'complete' THEN 3
    WHEN 'failed' THEN 4
  END;
```

### **Step 3: Speed Up Cron Job**

Once you see good results, speed up the automated processing:

```bash
# Run in Supabase SQL Editor
cat scripts/speed-up-bat-queue.sql | pbcopy  # Mac
# Then paste in Supabase Dashboard → SQL Editor
```

**Or manually update:**

1. Go to: Supabase Dashboard → SQL Editor
2. Run this (adjust `batchSize` as needed):

```sql
-- Remove old cron job
SELECT cron.unschedule('process-bat-queue') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'process-bat-queue'
);

-- Create faster cron job
SELECT cron.schedule(
  'process-bat-queue',
  '*/5 * * * *', -- Every 5 minutes
  $$
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/process-bat-extraction-queue',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer YOUR_SERVICE_KEY'
    ),
    body := jsonb_build_object(
      'batchSize', 10  -- Start with 10, increase to 20-50 once stable
    )
  ) AS request_id;
  $$
);
```

### **Step 4: Monitor Progress**

Watch the queue shrink in real-time:

```sql
-- Quick status check
SELECT 
  status,
  COUNT(*) as count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 1) as percentage
FROM bat_extraction_queue
GROUP BY status;

-- Check processing speed
SELECT 
  DATE_TRUNC('hour', processed_at) as hour,
  COUNT(*) as items_processed
FROM bat_extraction_queue
WHERE status = 'complete'
  AND processed_at > NOW() - INTERVAL '24 hours'
GROUP BY hour
ORDER BY hour DESC;
```

---

## 📊 Speed Options

### **Conservative (Recommended First):**
- **Batch size:** 10
- **Frequency:** Every 5 minutes
- **Speed:** 120 items/hour = **13 hours** for 1,577 items ✅

### **Moderate:**
- **Batch size:** 20
- **Frequency:** Every 5 minutes
- **Speed:** 240 items/hour = **7 hours** for 1,577 items ✅✅

### **Aggressive:**
- **Batch size:** 50
- **Frequency:** Every 5 minutes
- **Speed:** 600 items/hour = **2.6 hours** for 1,577 items ✅✅✅

### **Very Fast (High Frequency):**
- **Batch size:** 10
- **Frequency:** Every 2 minutes
- **Speed:** 300 items/hour = **5.3 hours** for 1,577 items ✅✅

---

## ⚠️ Troubleshooting

### **Problem: Timeouts**
If you see timeouts, reduce batch size:
- Try: `batchSize: 5` instead of 10
- Or: Increase cron frequency but keep batch size small

### **Problem: Too Many Failures**
If failure rate increases:
- Reduce batch size
- Check Edge Function logs: `supabase functions logs process-bat-extraction-queue --tail`
- Check for rate limiting from BaT website

### **Problem: Cron Not Running**
Check cron status:
```sql
SELECT jobname, active, schedule, start_time, status
FROM cron.job j
LEFT JOIN LATERAL (
  SELECT start_time, status
  FROM cron.job_run_details
  WHERE jobid = j.jobid
  ORDER BY start_time DESC
  LIMIT 1
) jrd ON true
WHERE jobname = 'process-bat-queue';
```

### **Rollback to Slow Processing**
If things go wrong, revert:

```sql
SELECT cron.unschedule('process-bat-queue');

SELECT cron.schedule(
  'process-bat-queue',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/process-bat-extraction-queue',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer YOUR_SERVICE_KEY'
    ),
    body := jsonb_build_object('batchSize', 1)
  ) AS request_id;
  $$
);
```

---

## ✅ Quick Commands Reference

```bash
# Process 5 items manually (test)
node scripts/process-bat-queue-manual.js 5

# Process 10 items manually
node scripts/process-bat-queue-manual.js 10

# Process 3 batches of 5 items each
node scripts/process-bat-queue-manual.js 5 3

# Check queue status (SQL)
cat scripts/quick-auction-monitor.sql | pbcopy  # Mac
# Paste in Supabase SQL Editor

# Speed up cron (SQL)
cat scripts/speed-up-bat-queue.sql | pbcopy  # Mac
# Paste in Supabase SQL Editor

# Watch Edge Function logs
npx supabase functions logs process-bat-extraction-queue --tail
```

---

## 🎯 Recommended Workflow

1. **Test manually first:**
   ```bash
   node scripts/process-bat-queue-manual.js 5
   ```

2. **Check results** - Verify vehicles are being created correctly

3. **Speed up gradually:**
   - Start with `batchSize: 10`
   - Monitor for 1-2 hours
   - If stable, increase to `batchSize: 20`
   - Continue monitoring and increase as needed

4. **Monitor continuously:**
   - Use `scripts/quick-auction-monitor.sql` for status checks
   - Watch Edge Function logs for errors
   - Check queue completion rate

---

**Ready to test?** Run: `node scripts/process-bat-queue-manual.js 5`

