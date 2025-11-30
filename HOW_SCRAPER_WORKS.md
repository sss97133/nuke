# How the Scraper Works

## It Runs in the Cloud (Supabase Edge Functions)

✅ **No constant internet connection needed on your end**
✅ **Runs independently once triggered**
✅ **You can check results later**

## How It Works

1. **Trigger it** (one time):
   - Manual: Call the function via API
   - Automatic: Set up a cron job in Supabase

2. **It runs in Supabase's cloud**:
   - Uses Supabase's servers (not your computer)
   - Has its own internet connection
   - Runs even if your computer is off

3. **Results go to your database**:
   - Vehicles created/updated in Supabase
   - You can check anytime via your dashboard

## Options

### Option 1: One-Time Manual Run
```bash
# Trigger it once, it runs in the cloud
curl -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/scrape-all-craigslist-squarebodies" \
  -H "Authorization: Bearer YOUR_KEY" \
  -d '{"max_regions": 100}'
```
Then close your laptop - it keeps running in Supabase's cloud.

### Option 2: Automated Daily (Recommended)
Set up a cron job in Supabase Dashboard:
- Runs automatically every day at 2 AM
- No action needed from you
- Results accumulate in your database

## Time Estimates

- **Small test (5 regions)**: ~10-15 minutes
- **Full scrape (100 regions)**: ~2-4 hours
- **Runs in background**: You don't need to wait

## Check Results Later

```sql
-- See vehicles created today
SELECT COUNT(*) FROM vehicles 
WHERE created_at > CURRENT_DATE 
AND discovery_source LIKE '%craigslist%';

-- See recent squarebody trucks
SELECT year, make, model, asking_price, location
FROM vehicles
WHERE year BETWEEN 1973 AND 1991
AND (make ILIKE '%chevrolet%' OR make ILIKE '%gmc%')
ORDER BY created_at DESC
LIMIT 20;
```

## Bottom Line

✅ Runs in Supabase cloud (not your computer)
✅ No constant connection needed
✅ Set it and forget it (with cron)
✅ Check results anytime
