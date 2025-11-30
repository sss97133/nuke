# Setup BaT Scheduled Evening Scrape

## Step 1: Apply Migrations

Apply both migrations in Supabase Dashboard → SQL Editor:

1. `supabase/migrations/20250205_bat_complete_system.sql` - Creates all tables, functions, notifications
2. This extends `admin_notifications` to support BaT scrape alerts

## Step 2: Deploy Edge Functions

```bash
supabase functions deploy scheduled-bat-scrape
supabase functions deploy import-bat-data
```

## Step 3: Set Up Cron Schedule

### Option A: Supabase Dashboard (Recommended)
1. Go to Database → Cron Jobs
2. Create new cron job:
   - **Name**: `bat-evening-scrape`
   - **Schedule**: `0 20 * * *` (8 PM PST / 11 PM EST daily)
   - **SQL**: 
   ```sql
   SELECT net.http_post(
     url := 'https://YOUR_PROJECT.supabase.co/functions/v1/scheduled-bat-scrape',
     headers := jsonb_build_object(
       'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
       'Content-Type', 'application/json'
     ),
     body := '{}'::jsonb
   );
   ```

### Option B: Via SQL
```sql
-- Enable pg_cron extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule evening scrape (8 PM PST = 20:00)
SELECT cron.schedule(
  'bat-evening-scrape',
  '0 20 * * *', -- 8 PM daily
  $$
  SELECT net.http_post(
    url := 'https://YOUR_PROJECT.supabase.co/functions/v1/scheduled-bat-scrape',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

## Step 4: Set Up Scraping Service

The edge function calls `import-bat-data`, but actual scraping needs to happen first.

**Recommended**: Use a separate service (Vercel Cron, GitHub Actions, or external cron) to:
1. Run `node scripts/scrape-viva-bat-listings.js` (scrapes BaT)
2. Upload results to Supabase Storage
3. Trigger `import-bat-data` edge function to import

**Or**: Update `scheduled-bat-scrape` to call an external scraping service.

## Step 5: View Notifications

Notifications will appear in your admin dashboard:
- **Success**: "BaT Scraping Complete" with stats
- **Errors**: "BaT Scraping Error" with error details

Check `admin_notifications` table or your admin UI for:
- `notification_type = 'bat_scrape_complete'` or `'bat_scrape_error'`
- Priority 1-4 (1=success, 4=error)
- Status 'pending' until you review

## Monitoring

Check scrape job history:
```sql
SELECT * FROM bat_scrape_jobs 
ORDER BY created_at DESC 
LIMIT 10;
```

View recent notifications:
```sql
SELECT * FROM admin_notifications 
WHERE notification_type IN ('bat_scrape_complete', 'bat_scrape_error')
ORDER BY created_at DESC 
LIMIT 10;
```


