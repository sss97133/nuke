# How to Set Service Role Key for Cron Job

## Step 1: Get Your Service Role Key

1. Go to: https://supabase.com/dashboard/project/qkgaybvrernstplzjaam
2. Click **Settings** (gear icon in left sidebar)
3. Click **API** (under Project Settings)
4. Find **service_role** key (starts with `eyJ...`)
5. Click the **eye icon** to reveal it, then **copy** it

## Step 2: Set It in Database

1. Still in Supabase Dashboard
2. Click **SQL Editor** (in left sidebar)
3. Click **New Query**
4. Paste this SQL (replace `YOUR_SERVICE_ROLE_KEY` with the key you copied):

```sql
ALTER DATABASE postgres SET app.settings.service_role_key = 'YOUR_SERVICE_ROLE_KEY';
```

5. Click **Run** (or press Cmd+Enter)

## Step 3: Verify It's Set

Run this query to check:

```sql
SELECT current_setting('app.settings.service_role_key', true) as service_key_set;
```

If it returns your key (or at least shows it's not null), you're good!

## Step 4: Wait 5 Minutes

The cron job runs every 5 minutes. After you set the key, wait for the next run and check:

```sql
SELECT * FROM cron.job_run_details 
WHERE jobid = 73
ORDER BY start_time DESC 
LIMIT 1;
```

If `status` is `succeeded` instead of `failed`, it's working!

---

**Location Summary:**
- **Get Key**: Dashboard → Settings → API → service_role key
- **Set Key**: Dashboard → SQL Editor → Run the ALTER DATABASE command

