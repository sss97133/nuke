# Deploy Facebook Marketplace Scraper

## Quick Deploy Steps

The Facebook Marketplace parser is integrated into the `scrape-vehicle` edge function.

### Option 1: Deploy via Supabase CLI

```bash
cd /Users/skylar/nuke
supabase functions deploy scrape-vehicle
```

### Option 2: Deploy via Dashboard

1. Go to: https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/functions
2. Find `scrape-vehicle`
3. Click **Redeploy** or **Deploy**

### Verify Firecrawl Key

Before deploying, ensure `FIRECRAWL_API_KEY` is set:
- Dashboard → Settings → Edge Functions → Secrets
- Should have: `FIRECRAWL_API_KEY`

## After Deployment

1. **Test the scraper:**
   ```bash
   node scripts/test-facebook-scrape.js "https://www.facebook.com/share/1GZv29h62H/?mibextid=wwXIfr"
   ```

2. **Import a vehicle:**
   ```bash
   node scripts/import-facebook-marketplace.js "https://www.facebook.com/share/1GZv29h62H/?mibextid=wwXIfr"
   ```

3. **Query Facebook vehicles:**
   ```bash
   node scripts/query-facebook-vehicles.js
   ```

## What's Included

- ✅ Facebook Marketplace parser (scrapeFacebookMarketplace function)
- ✅ Firecrawl integration with aggressive settings
- ✅ Favicon caching
- ✅ Deep data extraction (year, make, model, price, mileage, VIN, images, etc.)

---

**Status**: Ready to deploy ✅

