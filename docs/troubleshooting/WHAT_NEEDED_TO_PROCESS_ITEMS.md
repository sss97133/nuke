# WHAT'S NEEDED TO GET ITEMS THROUGH

**Last Updated:** December 25, 2025

---

## ✅ CURRENT STATUS

- **Unlocked:** 372 stuck items reset to pending
- **Processing:** Items are now ready to be processed
- **Recent Activity:** 277 vehicles created in last 24 hours ✅

---

## 🔧 REQUIREMENTS FOR PROCESSING

### 1. **Cron Job Must Be Running**
The `process-import-queue` cron job runs every 5 minutes automatically.

**Check Status:**
```sql
SELECT jobname, active, schedule, last_run_started_at, last_run_status
FROM cron.job
WHERE jobname = 'process-import-queue';
```

**Requirements:**
- ✅ `active = true` (job enabled)
- ✅ `last_run_started_at` < 10 minutes ago (recently ran)
- ✅ `last_run_status = 'succeeded'` (no failures)

**If not running:**
```sql
-- Re-enable if disabled
UPDATE cron.job SET active = true WHERE jobname = 'process-import-queue';
```

---

### 2. **Service Role Key Must Be Set**
The cron job needs the service role key to authenticate with the Edge Function.

**Check:**
```sql
SELECT 
  current_setting('app.settings.service_role_key', true) IS NOT NULL as has_settings_key,
  current_setting('app.service_role_key', true) IS NOT NULL as has_legacy_key;
```

**If missing, set it:**
```sql
-- Get key from Supabase Dashboard → Settings → API → service_role key
ALTER DATABASE postgres SET app.settings.service_role_key = 'YOUR_SERVICE_ROLE_KEY_HERE';
```

---

### 3. **Edge Function Must Be Deployed**
The `process-import-queue` Edge Function must be deployed and accessible.

**Check:**
- Supabase Dashboard → Edge Functions → `process-import-queue`
- Should show recent invocations
- No errors in logs

---

### 4. **Items Must Be in Valid State**
Items need to be:
- ✅ Status = `pending` (not `processing` or `failed`)
- ✅ `attempts < 3` (not exceeded max retries)
- ✅ `next_attempt_at <= NOW()` (ready for retry)

**Fix stuck items:**
```bash
node scripts/unlock-all-stuck-items.js
```

---

## 🚀 QUICK START

### Option 1: Let Cron Handle It (Recommended)
The cron job runs every 5 minutes automatically. Just ensure:
1. Cron is active (see above)
2. Service role key is set (see above)
3. Items are unlocked (already done ✅)

### Option 2: Manual Trigger
If you want to process items immediately:

```bash
node scripts/ensure-ingestion-running.js
```

This will:
- Check for stuck items
- Unlock them if needed
- Trigger processing immediately
- Show you the results

---

## 📊 MONITORING

### Check Queue Status
```bash
node scripts/diagnose-ingestion.js
```

### Check Recent Activity
```sql
-- Vehicles created in last 24h
SELECT 
  discovery_source,
  COUNT(*) as vehicles_created,
  MAX(created_at) as last_created
FROM vehicles
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY discovery_source
ORDER BY vehicles_created DESC;
```

### Check Processing Rate
```sql
-- Items processed in last hour
SELECT 
  DATE_TRUNC('minute', processed_at) as minute,
  status,
  COUNT(*) as count
FROM import_queue
WHERE processed_at > NOW() - INTERVAL '1 hour'
GROUP BY minute, status
ORDER BY minute DESC;
```

---

## ⚠️ COMMON BLOCKERS

### 1. **Items Stuck in Processing**
**Symptom:** Items with `status = 'processing'` for >30 minutes

**Fix:**
```bash
node scripts/unlock-all-stuck-items.js
```

### 2. **Cron Job Not Running**
**Symptom:** No new vehicles, `last_run_started_at` is old

**Fix:**
```sql
UPDATE cron.job SET active = true WHERE jobname = 'process-import-queue';
```

### 3. **Service Role Key Missing**
**Symptom:** Cron job fails with authentication errors

**Fix:**
```sql
ALTER DATABASE postgres SET app.settings.service_role_key = 'YOUR_KEY';
```

### 4. **Edge Function Errors**
**Symptom:** Items failing with specific error messages

**Fix:**
- Check Edge Function logs in Supabase Dashboard
- Review error messages in `import_queue.error_message`
- Fix the underlying issue (e.g., Firecrawl API limits, invalid data)

---

## 🎯 WHAT YOU NEED RIGHT NOW

Based on current status:

1. ✅ **Items Unlocked** - 372 items reset to pending
2. ✅ **Cron Job** - Should be running (check with SQL above)
3. ✅ **Service Role Key** - Should be set (check with SQL above)
4. ✅ **Edge Function** - Should be deployed (check Dashboard)

**Next Steps:**
1. Run `node scripts/ensure-ingestion-running.js` to verify everything
2. Wait 5-10 minutes for cron to process items
3. Check `node scripts/diagnose-ingestion.js` to see progress

---

## 📝 NOTES

- Items process in batches of 10-40 per cron run
- Processing rate: ~40 items every 5 minutes = ~480 items/hour
- With 372 items unlocked, they should all process within ~1 hour
- Failed items (with attempts < 3) will retry automatically
- Items with attempts >= 3 need manual intervention

---

## 🛠️ TOOLS AVAILABLE

1. **`scripts/diagnose-ingestion.js`** - Full diagnostic report
2. **`scripts/fix-ingestion.js`** - Quick fixes
3. **`scripts/ensure-ingestion-running.js`** - Ensure system is running
4. **`scripts/unlock-all-stuck-items.js`** - Unlock stuck items

