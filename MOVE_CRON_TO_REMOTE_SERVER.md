# Move BAT Scraping to Remote Server

## ✅ Current Situation

Your cron job is currently running **on your local Mac**, which means:
- ❌ Your computer needs to be on and awake
- ❌ It uses your computer's resources
- ❌ If your computer sleeps, the job might not run

## 🚀 Solution: Move to Supabase pg_cron

We'll use **Supabase's built-in `pg_cron`** extension, which runs jobs directly on Supabase's database servers. This means:
- ✅ Runs 24/7 on Supabase's infrastructure
- ✅ No impact on your computer
- ✅ More reliable (no sleep/wake issues)
- ✅ Free (included with Supabase)

## Step 1: Apply Migration

**Option A: Supabase Dashboard (Easiest)**
1. Go to https://supabase.com/dashboard → Your Project
2. Navigate to **SQL Editor**
3. Copy/paste contents of `supabase/migrations/20251203000001_move_bat_scrape_to_supabase_cron.sql`
4. Run it

**Option B: Supabase CLI**
```bash
cd /Users/skylar/nuke
supabase db push
```

## Step 2: Set Service Role Key (Required)

The cron job needs your service role key to authenticate. You have two options:

### Option A: Set as Database Setting (Recommended)
```sql
-- Run this in Supabase SQL Editor
ALTER DATABASE postgres SET app.settings.service_role_key = 'YOUR_SERVICE_ROLE_KEY_HERE';
```

### Option B: Update Cron Job to Use Direct Key
Edit the migration file and replace `current_setting('app.settings.service_role_key', true)` with your actual key (less secure, but works).

## Step 3: Remove Local Cron Jobs

After verifying the remote cron works, remove the local ones:

```bash
# View current cron jobs
crontab -l

# Remove BAT scraping cron jobs
crontab -l | grep -v "bat-scrape\|monitor-bat-seller" | crontab -

# Verify they're gone
crontab -l
```

## Step 4: Verify It's Working

### Check Cron Job Status
```sql
-- View all scheduled jobs
SELECT * FROM cron.job WHERE jobname = 'bat-scrape-automated';

-- View job run history
SELECT * FROM cron.job_run_details 
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'bat-scrape-automated')
ORDER BY start_time DESC 
LIMIT 10;
```

### Test Manually
```sql
-- Manually trigger the scrape to test
SELECT net.http_post(
  url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/monitor-bat-seller',
  headers := jsonb_build_object(
    'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY',
    'Content-Type', 'application/json'
  ),
  body := jsonb_build_object(
    'sellerUsername', 'VivaLasVegasAutos',
    'organizationId', 'c433d27e-2159-4f8c-b4ae-32a5e44a77cf'
  )
);
```

## 📊 Schedule

The job runs **every 6 hours** at:
- 12:00 AM (midnight)
- 6:00 AM
- 12:00 PM (noon)
- 6:00 PM

To change the schedule, update the cron expression in the migration:
- `'0 */6 * * *'` = Every 6 hours
- `'0 12 * * *'` = Once daily at noon
- `'0 */4 * * *'` = Every 4 hours

## 🔧 Troubleshooting

### Cron Job Not Running
1. Check if `pg_cron` extension is enabled:
   ```sql
   SELECT * FROM pg_extension WHERE extname = 'pg_cron';
   ```

2. Check for errors in job run details:
   ```sql
   SELECT * FROM cron.job_run_details 
   WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'bat-scrape-automated')
   ORDER BY start_time DESC 
   LIMIT 5;
   ```

3. Verify service role key is set correctly

### Alternative: Use GitHub Actions (Free, No Setup)

If `pg_cron` doesn't work, you can use GitHub Actions (completely free):

Create `.github/workflows/bat-scrape.yml`:
```yaml
name: BAT Scrape
on:
  schedule:
    - cron: '0 */6 * * *'  # Every 6 hours
  workflow_dispatch:  # Allow manual trigger

jobs:
  scrape:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger BAT Scrape
        run: |
          curl -X POST "${{ secrets.SUPABASE_URL }}/functions/v1/monitor-bat-seller" \
            -H "Authorization: Bearer ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}" \
            -H "Content-Type: application/json" \
            -d '{"sellerUsername":"VivaLasVegasAutos","organizationId":"c433d27e-2159-4f8c-b4ae-32a5e44a77cf"}'
```

Then add secrets in GitHub repo settings:
- `SUPABASE_URL`: `https://qkgaybvrernstplzjaam.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY`: Your service role key

## ✅ Benefits

- ✅ **No local resources used** - Runs on Supabase servers
- ✅ **Always running** - Doesn't depend on your computer
- ✅ **More reliable** - No sleep/wake issues
- ✅ **Free** - Included with Supabase
- ✅ **Easy to monitor** - View logs in Supabase dashboard

