# Start Scraping - Get Data Flowing

## Quick Start: Manual Trigger

### Option 1: Test Squarebody Scraping (Right Now)
```bash
curl -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/scrape-squarebody-inventory" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"max_results": 50, "user_id": null}'
```

### Option 2: Scrape Single URL
```bash
curl -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/scrape-vehicle" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://bringatrailer.com/listing/1972-chevrolet-k5-blazer-94/"}'
```

## Set Up Automation

### 1. Create Cron Job in Supabase

Go to Supabase Dashboard → Database → Cron Jobs → Create New:

**Name**: `scrape-squarebodies-daily`
**Schedule**: `0 2 * * *` (2 AM daily)
**SQL**:
```sql
SELECT net.http_post(
  url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/scrape-squarebody-inventory',
  headers := jsonb_build_object(
    'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
    'Content-Type', 'application/json'
  ),
  body := jsonb_build_object(
    'max_results', 100,
    'user_id', null
  )::jsonb
);
```

### 2. Or Use Vercel Cron (Recommended)

Create `vercel.json` cron job:
```json
{
  "crons": [{
    "path": "/api/scrape-squarebodies",
    "schedule": "0 2 * * *"
  }]
}
```

Then create `pages/api/scrape-squarebodies.ts`:
```typescript
import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data, error } = await supabase.functions.invoke('scrape-squarebody-inventory', {
    body: { max_results: 100, user_id: null }
  })

  res.json({ success: !error, data, error })
}
```

## What Each Function Does

- **scrape-squarebody-inventory**: Searches multiple sites for squarebody trucks, extracts data, creates/updates vehicles
- **scrape-vehicle**: Extracts data from a single listing URL
- **scrape-vehicle-with-firecrawl**: Same as above but bypasses 403 errors

## Monitor Progress

Check your database:
```sql
-- See recently created vehicles
SELECT id, year, make, model, created_at 
FROM vehicles 
WHERE created_at > NOW() - INTERVAL '1 day'
ORDER BY created_at DESC
LIMIT 20;

-- See vehicles from scraping
SELECT id, year, make, model, discovery_source
FROM vehicles 
WHERE discovery_source LIKE '%scrape%'
ORDER BY created_at DESC
LIMIT 20;
```

## Next Steps

1. **Test manually first** - Make sure it works
2. **Set up cron** - Automate it
3. **Monitor** - Check database for new vehicles
4. **Scale up** - Increase max_results once it's working

