# INGESTION FAILURE DIAGNOSTICS

**Quick Reference for Diagnosing Ingestion Failures**

---

## 🚨 QUICK CHECKS

### 1. **Check Queue Status**
```sql
-- Run in Supabase Dashboard → SQL Editor
SELECT 
  status,
  COUNT(*) as count,
  COUNT(DISTINCT source_id) as sources
FROM import_queue
GROUP BY status;
```

**Expected:**
- `pending`: Items waiting to be processed
- `processing`: Items currently being processed (should be low/zero)
- `complete`: Successfully processed
- `failed`: Failed after 3 attempts (investigate these)

**Red Flags:**
- Many items stuck in `processing` for >30 minutes = stuck/locked
- Many `failed` items = systematic issue
- No `pending` items but no new vehicles = nothing being queued

---

### 2. **Check Source Health**
```sql
SELECT 
  domain,
  source_name,
  is_active,
  last_scraped_at,
  last_successful_scrape,
  total_listings_found,
  EXTRACT(EPOCH FROM (NOW() - last_scraped_at))/3600 as hours_since_scrape
FROM scrape_sources
WHERE is_active = true
ORDER BY last_scraped_at DESC NULLS LAST;
```

**Red Flags:**
- `last_scraped_at` is NULL = scraper never ran
- `last_scraped_at` > 24 hours ago = scraper not running
- `last_successful_scrape` is NULL = scraper always failing
- `is_active = false` = source disabled

---

### 3. **Check Recent Failures**
```sql
SELECT 
  listing_url,
  status,
  attempts,
  error_message,
  created_at,
  processed_at
FROM import_queue
WHERE status = 'failed'
ORDER BY processed_at DESC
LIMIT 20;
```

**Common Error Patterns:**
- `"Invalid make"` = Data quality issue (make field is junk)
- `"Scrape failed: 403"` = Firecrawl rate limit or auth issue
- `"Scrape timeout"` = Page too slow or blocked
- `"Failed to claim queue"` = Database locking issue
- `"Firecrawl failed"` = Firecrawl API issue

---

### 4. **Check Cron Job Status**
```sql
SELECT 
  jobid,
  jobname,
  schedule,
  active,
  last_run_started_at,
  last_run_finished_at,
  last_run_status,
  last_run_duration_ms
FROM cron.job
WHERE jobname LIKE '%import%' OR jobname LIKE '%queue%';
```

**Red Flags:**
- `active = false` = Cron job disabled
- `last_run_started_at` is NULL = Never ran
- `last_run_status = 'failed'` = Cron job failing
- `last_run_started_at` > 1 hour ago = Cron not running

---

### 5. **Check Processing Rate**
```sql
-- Vehicles created in last 24 hours
SELECT 
  discovery_source,
  COUNT(*) as vehicles_created,
  MAX(created_at) as last_created
FROM vehicles
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY discovery_source
ORDER BY vehicles_created DESC;

-- Queue processing rate
SELECT 
  DATE_TRUNC('hour', processed_at) as hour,
  status,
  COUNT(*) as count
FROM import_queue
WHERE processed_at > NOW() - INTERVAL '24 hours'
GROUP BY hour, status
ORDER BY hour DESC;
```

**Red Flags:**
- Zero vehicles created in 24h = Nothing processing
- Queue items not being processed = Cron not running or stuck

---

## 🔧 COMMON FIXES

### **Issue: Cron Job Not Running**

**Symptoms:**
- No new vehicles
- Queue items stuck in `pending`
- `last_run_started_at` is NULL or old

**Fix:**
```sql
-- Check if cron is enabled
SELECT * FROM cron.job WHERE jobname = 'process-import-queue';

-- Re-enable if disabled
UPDATE cron.job SET active = true WHERE jobname = 'process-import-queue';

-- Check service role key is set
SELECT current_setting('app.settings.service_role_key', true) IS NOT NULL as has_key;
-- If false, set it:
-- ALTER DATABASE postgres SET app.settings.service_role_key = 'YOUR_SERVICE_ROLE_KEY';
```

---

### **Issue: Items Stuck in "processing"**

**Symptoms:**
- Items with `status = 'processing'` and `locked_at` > 30 minutes ago

**Fix:**
```sql
-- Unlock stuck items
UPDATE import_queue
SET 
  status = 'pending',
  locked_at = NULL,
  locked_by = NULL,
  next_attempt_at = NOW()
WHERE status = 'processing'
  AND locked_at < NOW() - INTERVAL '30 minutes';
```

---

### **Issue: Firecrawl API Failures**

**Symptoms:**
- Error: `"Firecrawl failed: 403"` or `"Firecrawl failed: 429"`
- Many items failing with Firecrawl errors

**Fix:**
1. Check Firecrawl API key: `Deno.env.get('FIRECRAWL_API_KEY')`
2. Check Firecrawl quota/rate limits
3. Add retry logic or fallback to direct fetch

---

### **Issue: Invalid Make/Model Data**

**Symptoms:**
- Error: `"Invalid make: [junk data]"`
- Items failing validation

**Fix:**
```sql
-- Find items with junk data
SELECT 
  listing_url,
  listing_make,
  listing_model,
  raw_data->>'source' as source
FROM import_queue
WHERE status = 'failed'
  AND error_message LIKE '%Invalid make%'
LIMIT 20;

-- Clean up junk data (manual review needed)
-- Or improve scraper data cleaning
```

---

### **Issue: Queue Not Being Filled**

**Symptoms:**
- No `pending` items
- Sources not scraping

**Fix:**
1. Check if scrapers are running:
   ```sql
   SELECT * FROM scrape_sources WHERE is_active = true;
   ```
2. Manually trigger a scraper:
   ```bash
   curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/scrape-ksl-listings \
     -H "Authorization: Bearer YOUR_SERVICE_KEY" \
     -H "Content-Type: application/json" \
     -d '{"maxListings": 10}'
   ```
3. Check `unified-scraper-orchestrator` status
4. Check `database-fill-agent` is activating sources

---

## 🎯 SYSTEMATIC DIAGNOSIS

### **Step 1: Is the Queue Being Filled?**
```sql
SELECT 
  COUNT(*) as total_items,
  COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
  COUNT(CASE WHEN status = 'processing' THEN 1 END) as processing,
  COUNT(CASE WHEN status = 'complete' THEN 1 END) as complete,
  COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
  MAX(created_at) as last_item_added
FROM import_queue;
```

**If `total_items = 0`:** Scrapers aren't running or not adding to queue
**If `pending = 0` and `failed > 0`:** All items failed, investigate errors
**If `pending > 0`:** Queue has items, check if processor is running

---

### **Step 2: Is the Processor Running?**
```sql
SELECT 
  jobname,
  active,
  last_run_started_at,
  last_run_finished_at,
  last_run_status
FROM cron.job
WHERE jobname = 'process-import-queue';
```

**If `active = false`:** Enable the cron job
**If `last_run_started_at` is NULL:** Cron never ran, check setup
**If `last_run_status = 'failed'`:** Check Edge Function logs

---

### **Step 3: What's Failing?**
```sql
SELECT 
  LEFT(error_message, 150) as error,
  COUNT(*) as count,
  MAX(processed_at) as last_occurrence
FROM import_queue
WHERE status = 'failed'
  AND error_message IS NOT NULL
GROUP BY LEFT(error_message, 150)
ORDER BY count DESC
LIMIT 10;
```

**Common Failures:**
1. **Firecrawl errors** → API key or quota issue
2. **Invalid make/model** → Data quality issue, improve scraper cleaning
3. **Scrape timeout** → Page too slow, increase timeout or skip
4. **Database errors** → Check constraints, missing fields

---

### **Step 4: Check Source Activity**
```sql
SELECT 
  s.domain,
  s.source_name,
  s.is_active,
  s.last_scraped_at,
  COUNT(DISTINCT q.id) as items_in_queue,
  COUNT(DISTINCT CASE WHEN q.status = 'pending' THEN q.id END) as pending,
  COUNT(DISTINCT CASE WHEN q.status = 'failed' THEN q.id END) as failed
FROM scrape_sources s
LEFT JOIN import_queue q ON q.source_id = s.id
WHERE s.is_active = true
GROUP BY s.id, s.domain, s.source_name, s.is_active, s.last_scraped_at
ORDER BY items_in_queue DESC;
```

**If `last_scraped_at` is NULL:** Scraper never ran
**If `items_in_queue = 0`:** Scraper ran but found nothing or failed silently
**If `failed > pending`:** Source has systematic issues

---

## 🔍 MANUAL TESTING

### **Test Queue Processor Manually**
```bash
curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/process-import-queue \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"batch_size": 5}'
```

**Expected Response:**
```json
{
  "success": true,
  "processed": 5,
  "succeeded": 4,
  "failed": 1,
  "vehicles_created": ["uuid1", "uuid2", ...]
}
```

**If it fails:** Check Edge Function logs for errors

---

### **Test a Scraper Manually**
```bash
# Test KSL scraper
curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/scrape-ksl-listings \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"maxListings": 5}'
```

**Expected Response:**
```json
{
  "success": true,
  "listings": [...],
  "queued": 5,
  "source_id": "uuid"
}
```

**If it fails:** Check scraper-specific issues (Firecrawl, API keys, etc.)

---

## 📋 CHECKLIST

When ingestions fail, check in this order:

- [ ] **Queue has items?** (`SELECT COUNT(*) FROM import_queue WHERE status = 'pending'`)
- [ ] **Cron job active?** (`SELECT active FROM cron.job WHERE jobname = 'process-import-queue'`)
- [ ] **Cron job running?** (`SELECT last_run_started_at FROM cron.job WHERE jobname = 'process-import-queue'`)
- [ ] **Service role key set?** (`SELECT current_setting('app.settings.service_role_key', true) IS NOT NULL`)
- [ ] **Items stuck?** (`SELECT COUNT(*) FROM import_queue WHERE status = 'processing' AND locked_at < NOW() - INTERVAL '30 minutes'`)
- [ ] **Recent failures?** (`SELECT error_message FROM import_queue WHERE status = 'failed' ORDER BY processed_at DESC LIMIT 10`)
- [ ] **Sources scraping?** (`SELECT last_scraped_at FROM scrape_sources WHERE is_active = true`)
- [ ] **Edge Function logs?** (Check Supabase Dashboard → Edge Functions → Logs)

---

## 🆘 EMERGENCY FIXES

### **Unlock All Stuck Items**
```sql
UPDATE import_queue
SET 
  status = 'pending',
  locked_at = NULL,
  locked_by = NULL,
  next_attempt_at = NOW()
WHERE status = 'processing'
  AND locked_at < NOW() - INTERVAL '30 minutes';
```

### **Reset Failed Items (After Fixing Root Cause)**
```sql
UPDATE import_queue
SET 
  status = 'pending',
  attempts = 0,
  error_message = NULL,
  next_attempt_at = NOW()
WHERE status = 'failed'
  AND processed_at > NOW() - INTERVAL '7 days';
```

### **Force Process Queue**
```bash
# Manually trigger processor
curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/process-import-queue \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"batch_size": 50, "priority_only": false}'
```

---

**Last Updated:** 2025-01-XX

