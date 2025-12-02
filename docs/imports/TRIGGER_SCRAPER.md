# Trigger the Scraper - Easiest Way

## Option 1: Supabase Dashboard (Recommended - No Keys Needed)

1. **Go to Functions Dashboard:**
   https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/functions

2. **Find `scrape-all-craigslist-squarebodies`**

3. **Click "Invoke Function"**

4. **Paste this payload:**
```json
{
  "max_regions": 5,
  "max_listings_per_search": 50,
  "user_id": null
}
```

5. **Click "Invoke"**

6. **Watch it run!** Check the logs tab to see progress.

## Option 2: Get Service Key and Use Terminal

1. **Get your service role key:**
   - Go to: https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/settings/api
   - Copy the `service_role` key (starts with `eyJ...`)

2. **Run this command:**
```bash
curl -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/scrape-all-craigslist-squarebodies" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY_HERE" \
  -H "Content-Type: application/json" \
  -d '{"max_regions": 5, "max_listings_per_search": 50, "user_id": null}'
```

## Test vs Full Scrape

**Test (5 regions):**
- ~10-15 minutes
- ~50-200 listings
- Good for testing

**Full (100 regions):**
- ~2-4 hours  
- ~500-2000 listings
- Complete coverage

Change `max_regions` to 100 for full scrape!
