# Setup Micro-Scrape Cron Job

## Via Supabase Dashboard (Easiest)

1. Go to: https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/database/cron
2. Click "Create a new cron job"
3. Fill in:
   - **Name:** `micro-scrape-bandaid-auto`
   - **Schedule:** `*/5 * * * *` (every 5 minutes)
   - **Command:**
     ```sql
     SELECT net.http_post(
       url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/micro-scrape-bandaid',
       headers := '{"Content-Type": "application/json", "Authorization": "Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb,
       body := '{"batch_size": 20, "max_runtime_ms": 25000}'::jsonb
     );
     ```
   - Replace `YOUR_SERVICE_ROLE_KEY` with actual service role key

## Alternative: Edge Function Cron

If pg_cron not available, use Supabase's built-in cron:
- Go to Dashboard → Edge Functions → micro-scrape-bandaid
- Set up scheduled invocation (if available)

## Test It Works

After setting up, check logs:
```bash
supabase functions logs micro-scrape-bandaid --tail
```

Or check database:
```sql
SELECT * FROM micro_scrape_runs ORDER BY started_at DESC LIMIT 5;
```

