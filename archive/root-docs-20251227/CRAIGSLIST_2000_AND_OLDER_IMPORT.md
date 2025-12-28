# Craigslist Import for Vehicles 2000 and Older

## Function: `scrape-all-craigslist-2000-and-older`

This Edge Function searches ALL Craigslist regions for vehicles from 2000 and older, and adds them to the import queue for processing.

## Usage

### Basic Usage (All Regions)

Call the function with no parameters to search all regions:

```bash
curl -X POST https://qkgaybvrernstplzjaam.supabase.co/functions/v1/scrape-all-craigslist-2000-and-older \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

### Limited Regions (Recommended for Testing)

To test with a few regions first:

```bash
curl -X POST https://qkgaybvrernstplzjaam.supabase.co/functions/v1/scrape-all-craigslist-2000-and-older \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "max_regions": 10,
    "search_strategy": "generic"
  }'
```

### Parameters

- `max_regions` (number, optional): Limit number of regions to search (default: all ~80 regions)
- `regions` (array, optional): Specific regions to search (e.g., `["sfbay", "newyork", "losangeles"]`)
- `max_listings_per_search` (number, optional): Max listings per search result page (default: 120)
- `user_id` (UUID, optional): User ID for vehicle creation (auto-detected if not provided)
- `search_strategy` (string, optional): 
  - `"all"` - Use all search strategies (default)
  - `"decades"` - Only decade searches (1950, 1960, etc.)
  - `"generic"` - Only generic terms (classic, vintage, etc.)
  - `"ranges"` - Only year range searches

## Search Strategies

The function uses multiple search strategies to catch everything:

1. **Generic Terms**: classic car, vintage car, antique car, collector car, muscle car, project car, restored, barn find
2. **Decade Searches**: 1950, 1960, 1970, 1980, 1990, 2000
3. **Year Range**: Searches for all vehicles 1900-2000

All searches use `max_auto_year=2000` to filter results.

## What Happens

1. Function searches each region with each search strategy
2. Extracts listing URLs from search results
3. Checks if listing is already in queue or already imported
4. Adds new listings to `import_queue` table
5. Existing `process-cl-queue` function will process them into vehicles

## Processing the Queue

After running the scraper, process the queue:

```bash
curl -X POST https://qkgaybvrernstplzjaam.supabase.co/functions/v1/process-cl-queue \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"batch_size": 50}'
```

## Performance Notes

- **Full import** (all 80 regions × 16 strategies = ~1,280 searches) will take several hours
- Each search has rate limiting (1-2 seconds between searches, 2 seconds between regions)
- Recommended approach:
  1. Test with `max_regions: 5` first
  2. Run full import in batches or schedule it
  3. Monitor the `import_queue` table for progress

## Monitoring

Check import queue status:

```sql
SELECT 
  status,
  COUNT(*) as count
FROM import_queue
WHERE source_id = (
  SELECT id FROM import_sources 
  WHERE name = 'Craigslist - All Vehicles 2000 and Older'
)
GROUP BY status;
```

## Regions Covered

The function searches all major Craigslist regions including:
- Major metros: sfbay, newyork, losangeles, chicago, atlanta, dallas, denver, seattle, etc.
- Secondary markets: portland, phoenix, boston, minneapolis, detroit, etc.
- Smaller markets: All US regions for comprehensive coverage

Total: ~80 regions

