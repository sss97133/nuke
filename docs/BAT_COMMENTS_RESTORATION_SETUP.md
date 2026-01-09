# BaT Comments Restoration - Setup Guide

## ✅ Automatic Service Role Key Setup (Recommended)

The system can automatically get the service role key from **Edge Function secrets** without manual configuration!

### Step 1: Sync Service Role Key from Edge Function Secrets

The `sync-service-key-to-db` Edge Function automatically reads the service role key from Edge Function secrets and stores it in the database:

```bash
# Call the sync function (one time setup)
curl -X POST "https://YOUR_PROJECT.supabase.co/functions/v1/sync-service-key-to-db" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json"
```

This will:
1. ✅ Read `SUPABASE_SERVICE_ROLE_KEY` from Edge Function secrets
2. ✅ Store it in `_app_secrets` table
3. ✅ Make it available to all cron jobs automatically

**Note**: The service role key must already be set in Edge Function secrets. If it's not, add it:
- Go to Supabase Dashboard → Edge Functions → Settings → Secrets
- Add `SUPABASE_SERVICE_ROLE_KEY` with your service role key value

### Step 2: Apply the Migration

```sql
-- Run in Supabase Dashboard → SQL Editor
\i supabase/migrations/20250201_setup_bat_comments_restore_cron.sql
```

The cron job will automatically use the key from `_app_secrets` (synced from Edge Function secrets).

## 🔧 Manual Setup (Alternative)

If you prefer to set it manually:

### Step 1: Get Your Service Role Key

1. Go to: **Dashboard → Settings → API**
2. Find **service_role** key (starts with `eyJ...`)
3. Click the **eye icon** to reveal it, then **copy** it

### Step 2: Set It in Database

```sql
-- Run in Supabase Dashboard → SQL Editor
ALTER DATABASE postgres SET app.settings.service_role_key = 'YOUR_SERVICE_ROLE_KEY';
```

### Step 3: Apply the Migration

```sql
-- Run in Supabase Dashboard → SQL Editor
\i supabase/migrations/20250201_setup_bat_comments_restore_cron.sql
```

## ✅ Verify It's Working

### Check Service Role Key is Available

```sql
-- Check if key is in _app_secrets (from Edge Function secrets)
SELECT key, LENGTH(value) as key_length, updated_at
FROM _app_secrets
WHERE key = 'service_role_key';

-- Or check database setting
SELECT current_setting('app.settings.service_role_key', true) IS NOT NULL as has_key;
```

### Check Cron Job is Scheduled

```sql
SELECT jobid, jobname, schedule, active
FROM cron.job 
WHERE jobname = 'restore-bat-comments';
```

Should show:
- `jobname`: `restore-bat-comments`
- `schedule`: `0 2 * * *` (daily at 2 AM)
- `active`: `true`

### Test the Edge Function Manually

```bash
curl -X POST "https://YOUR_PROJECT.supabase.co/functions/v1/restore-bat-comments" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"batch_size": 10, "start_from": 0}'
```

### Check Cron Job Runs

After the first run (at 2 AM), check:

```sql
SELECT 
  r.start_time,
  r.end_time,
  r.status,
  r.return_message
FROM cron.job_run_details r
JOIN cron.job j ON j.jobid = r.jobid
WHERE j.jobname = 'restore-bat-comments'
ORDER BY r.start_time DESC
LIMIT 5;
```

If `status` is `succeeded`, it's working! ✅

## How the Service Role Key Works

The cron job uses `get_service_role_key_for_cron()` helper function which:

1. **First**: Checks `_app_secrets` table (synced from Edge Function secrets) ✅ **Recommended**
2. **Fallback 1**: Checks `app.settings.service_role_key` database setting
3. **Fallback 2**: Checks `app.service_role_key` database setting

This means:
- ✅ **If you sync from Edge Function secrets**: No manual configuration needed!
- ✅ **If you set database setting**: Works as fallback
- ✅ **Multiple fallbacks**: More reliable

## Troubleshooting

### "Service role key not found"

**Solution**: Sync from Edge Function secrets:
```bash
curl -X POST "https://YOUR_PROJECT.supabase.co/functions/v1/sync-service-key-to-db" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY"
```

### "Cron job failed with 401 Unauthorized"

**Solution**: The service role key isn't available. Check:

```sql
-- Check if key exists
SELECT 
  (SELECT COUNT(*) FROM _app_secrets WHERE key = 'service_role_key') as in_secrets,
  (SELECT current_setting('app.settings.service_role_key', true) IS NOT NULL) as in_settings;

-- If both are 0, sync from Edge Function secrets or set manually
```

### "Edge Function secrets not found"

**Solution**: Add the service role key to Edge Function secrets:
1. Go to **Dashboard → Edge Functions → Settings → Secrets**
2. Add secret: `SUPABASE_SERVICE_ROLE_KEY` = `your-service-role-key`
3. Then call `sync-service-key-to-db` to sync it to the database

---

**Status**: ✅ Ready to use  
**Last Updated**: 2026-02-01  
**Service Role Key Source**: Edge Function secrets (recommended) or database setting (fallback)

