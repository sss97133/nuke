# INGESTION QUICK FIX GUIDE

**Run these SQL queries in Supabase Dashboard → SQL Editor**

---

## 🚨 IMMEDIATE DIAGNOSIS (Copy/Paste)

```sql
-- 1. Queue Status
SELECT 
  status,
  COUNT(*) as count,
  MIN(created_at) as oldest,
  MAX(created_at) as newest
FROM import_queue
GROUP BY status;

-- 2. Recent Failures
SELECT 
  listing_url,
  error_message,
  attempts,
  created_at
FROM import_queue
WHERE status = 'failed'
ORDER BY processed_at DESC
LIMIT 10;

-- 3. Stuck Items
SELECT 
  COUNT(*) as stuck_count
FROM import_queue
WHERE status = 'processing'
  AND locked_at < NOW() - INTERVAL '30 minutes';

-- 4. Cron Status
SELECT 
  jobname,
  active,
  last_run_started_at,
  last_run_status
FROM cron.job
WHERE jobname = 'process-import-queue';

-- 5. Source Health
SELECT 
  domain,
  is_active,
  last_scraped_at,
  last_successful_scrape
FROM scrape_sources
WHERE is_active = true
ORDER BY last_scraped_at DESC NULLS LAST
LIMIT 10;
```

---

## 🔧 QUICK FIXES

### **Fix 1: Unlock Stuck Items**
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

### **Fix 2: Enable Cron Job**
```sql
UPDATE cron.job 
SET active = true 
WHERE jobname = 'process-import-queue';
```

### **Fix 3: Manually Trigger Processor**
```bash
# Replace YOUR_PROJECT and YOUR_KEY
curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/process-import-queue \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"batch_size": 20}'
```

### **Fix 4: Check Service Role Key**
```sql
-- Check if key is set
SELECT current_setting('app.settings.service_role_key', true) IS NOT NULL as has_key;

-- If false, set it (get key from Supabase Dashboard → Settings → API)
-- ALTER DATABASE postgres SET app.settings.service_role_key = 'YOUR_KEY_HERE';
```

---

## 📊 WHAT TO LOOK FOR

**Queue Status:**
- ✅ `pending` > 0 = Good, items waiting
- ⚠️ `processing` > 10 for >30min = Stuck, unlock them
- 🔴 `failed` > 50 = Systematic issue, check errors

**Cron Job:**
- ✅ `active = true` = Good
- ✅ `last_run_started_at` < 10 min ago = Running
- 🔴 `active = false` = Disabled, enable it
- 🔴 `last_run_started_at` is NULL = Never ran, check setup

**Sources:**
- ✅ `last_scraped_at` < 2 hours ago = Active
- 🔴 `last_scraped_at` is NULL = Never ran
- 🔴 `last_scraped_at` > 24 hours ago = Not running

---

**See `INGESTION_FAILURE_DIAGNOSTICS.md` for detailed troubleshooting**

