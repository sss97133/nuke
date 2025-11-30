# How to Trigger Remote Cron Jobs

## ✅ Quick Trigger (Right Now)

### Option 1: Direct Edge Function Call (Easiest)
```bash
./scripts/trigger-bat-scrape-supabase.sh
```

Or manually:
```bash
curl -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/monitor-bat-seller" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"sellerUsername":"VivaLasVegasAutos","organizationId":"c433d27e-2159-4f8c-b4ae-32a5e44a77cf"}'
```

### Option 2: GitHub Actions (If secrets are set up)
```bash
./scripts/trigger-bat-scrape-github.sh
```

Or via GitHub UI:
1. Go to https://github.com/YOUR_USERNAME/YOUR_REPO/actions
2. Click "BAT Scrape" workflow
3. Click "Run workflow" → "Run workflow"

---

## 🗄️ Supabase pg_cron Setup & Trigger

### Step 1: Set Up the Cron Job

**Option A: Via SQL (Recommended)**
1. Go to Supabase Dashboard → SQL Editor
2. Open `scripts/setup-supabase-cron-now.sql`
3. Replace `YOUR_SERVICE_ROLE_KEY` with your actual key
4. Run it

**Option B: Use Migration**
1. Go to Supabase Dashboard → SQL Editor
2. Open `supabase/migrations/20251203000001_move_bat_scrape_to_supabase_cron.sql`
3. Replace `YOUR_SERVICE_ROLE_KEY_HERE` with your actual key
4. Run it

### Step 2: Verify It's Scheduled
```sql
SELECT jobid, jobname, schedule, command 
FROM cron.job 
WHERE jobname = 'bat-scrape-automated';
```

### Step 3: Test It Immediately
```sql
-- Manually trigger (replace YOUR_SERVICE_ROLE_KEY)
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

### Step 4: Check Run History
```sql
SELECT 
  jobid,
  runid,
  job_pid,
  database,
  username,
  command,
  status,
  return_message,
  start_time,
  end_time
FROM cron.job_run_details 
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'bat-scrape-automated')
ORDER BY start_time DESC 
LIMIT 10;
```

---

## 🚀 GitHub Actions Setup & Trigger

### Step 1: Add Secrets
1. Go to GitHub repo → Settings → Secrets and variables → Actions
2. Click "New repository secret"
3. Add:
   - **Name:** `SUPABASE_URL`
   - **Value:** `https://qkgaybvrernstplzjaam.supabase.co`
4. Add:
   - **Name:** `SUPABASE_SERVICE_ROLE_KEY`
   - **Value:** Your service role key

### Step 2: Trigger Manually
**Via Script:**
```bash
./scripts/trigger-bat-scrape-github.sh
```

**Via GitHub UI:**
1. Go to https://github.com/YOUR_USERNAME/YOUR_REPO/actions
2. Click "BAT Scrape" in the left sidebar
3. Click "Run workflow" dropdown
4. Click "Run workflow" button

**Via GitHub CLI:**
```bash
gh workflow run "BAT Scrape"
```

### Step 3: View Results
```bash
# Watch the run in real-time
gh run watch

# Or visit: https://github.com/YOUR_USERNAME/YOUR_REPO/actions
```

---

## 📊 Current Status

### ✅ What's Working
- Edge function is working (tested successfully)
- Scripts are ready to trigger
- GitHub Actions workflow is ready (needs secrets)
- Supabase pg_cron migration is ready (needs to be applied)

### 🔧 What Needs Setup

**Supabase pg_cron:**
1. Apply migration in Supabase Dashboard
2. Add service role key to the SQL
3. Done! (runs every 6 hours automatically)

**GitHub Actions:**
1. Add secrets in GitHub repo settings
2. Done! (runs every 6 hours automatically + manual trigger available)

---

## 🎯 Recommended Next Steps

1. **Set up Supabase pg_cron** (5 min)
   - Most reliable for scheduled runs
   - Runs directly in database

2. **Set up GitHub Actions** (3 min)
   - Best for manual testing
   - Better logging and notifications

3. **Remove local cron jobs** (after both are verified)
   ```bash
   ./scripts/remove-local-cron-jobs.sh
   ```

---

## 🔍 Troubleshooting

### Supabase pg_cron Not Running
```sql
-- Check if extension is enabled
SELECT * FROM pg_extension WHERE extname = 'pg_cron';

-- Check job status
SELECT * FROM cron.job WHERE jobname = 'bat-scrape-automated';

-- Check for errors
SELECT * FROM cron.job_run_details 
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'bat-scrape-automated')
ORDER BY start_time DESC LIMIT 5;
```

### GitHub Actions Not Running
- Check if secrets are set: Settings → Secrets → Actions
- Check workflow file syntax: `.github/workflows/bat-scrape.yml`
- View workflow runs: Actions tab → "BAT Scrape"

### Both Not Working
- Test edge function directly (see Option 1 above)
- Check service role key is correct
- Verify edge function is deployed

