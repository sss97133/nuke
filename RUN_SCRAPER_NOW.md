# Run the Scraper Now

## Quick Start

### Option 1: Via Supabase Dashboard

1. Go to: https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/functions
2. Find `scrape-all-craigslist-squarebodies`
3. Click "Invoke" 
4. Use this payload:
```json
{
  "max_regions": 5,
  "max_listings_per_search": 50,
  "user_id": null
}
```

### Option 2: Via Terminal (with service key)

```bash
curl -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/scrape-all-craigslist-squarebodies" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "max_regions": 5,
    "max_listings_per_search": 50,
    "user_id": null
  }'
```

### Option 3: Full Scrape (all regions)

```bash
curl -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/scrape-all-craigslist-squarebodies" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "max_regions": 100,
    "max_listings_per_search": 1000,
    "user_id": null
  }'
```

## Get Your Service Role Key

1. Go to: https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/settings/api
2. Copy "service_role" key (secret)
3. Use it in the Authorization header

## Monitor Progress

Check function logs:
- Dashboard → Functions → scrape-all-craigslist-squarebodies → Logs

Check database:
```sql
SELECT COUNT(*) FROM vehicles 
WHERE created_at > NOW() - INTERVAL '1 hour'
AND discovery_source LIKE '%craigslist%';
```

## Expected Results

- **Test (5 regions)**: ~50-200 listings, ~10-15 minutes
- **Full (100 regions)**: ~500-2000 listings, ~2-4 hours

