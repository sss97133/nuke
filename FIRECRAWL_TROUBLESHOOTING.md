# Firecrawl Troubleshooting

## Current Status
- ✅ Firecrawl API key is set in Supabase Edge Functions secrets
- ✅ Edge function is deployed (scrape-vehicle)
- ❌ Edge function returns 500 Internal Server Error

## What to Check

### 1. Verify Secret Name
The secret must be named exactly: **`FIRECRAWL_API_KEY`** (case-sensitive)

In Supabase Dashboard:
- Go to: Project Settings → Edge Functions → Secrets
- Check that the secret name is exactly `FIRECRAWL_API_KEY`

### 2. Check Supabase Logs
View the actual error in Supabase Dashboard:

1. Go to: **Logs** → **Edge Functions**
2. Filter by: `scrape-vehicle`
3. Look for recent errors
4. The logs will show if:
   - The secret is missing
   - Firecrawl API call failed
   - There's another error

### 3. Test Firecrawl API Directly
Verify your Firecrawl API key works:

```bash
curl -X POST https://api.firecrawl.dev/v1/scrape \
  -H "Authorization: Bearer YOUR_FIRECRAWL_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://cars.ksl.com/listing/10323198"}'
```

### 4. Redeploy After Secret Changes
If you just added/updated the secret, you MUST redeploy:

```bash
supabase functions deploy scrape-vehicle
```

## Next Steps

1. **Check Supabase Dashboard logs** to see the actual error
2. **Verify secret name** is exactly `FIRECRAWL_API_KEY`
3. **Test Firecrawl API** directly to confirm key works
4. **Redeploy** if you made changes

## Alternative: Manual Import Works

For now, you can use manual import which works:

```bash
# Edit scripts/import-ksl-manual.js with listing data
node scripts/import-ksl-manual.js
```

Or use the admin UI at `/admin/ksl-scraper` once Firecrawl is working.

