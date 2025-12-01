# KSL Scraper Tooling - Complete

## Overview
Backend tooling to automatically import trucks from KSL Cars. The system includes:
- Test script to fetch listings
- Parallel scraper for bulk imports
- Admin UI for controlling scrapes
- Integration with existing vehicle import pipeline

## Files Created

### Scripts
1. **`scripts/test-ksl-scraper.js`** - Test script to fetch ~20 listings and take screenshots
2. **`scripts/scrape-ksl-parallel.js`** - Production scraper that processes listings in parallel batches
3. **`scripts/import-ksl-from-json.js`** - Import listings from JSON file

### Edge Functions
1. **`supabase/functions/scrape-ksl-listings/index.ts`** - Edge function endpoint (note: can't run Playwright directly)

### Admin UI
1. **`nuke_frontend/src/pages/admin/KSLScraper.tsx`** - Admin interface for controlling KSL scraping
2. **Route added to** `nuke_frontend/src/routes/modules/admin/routes.tsx`

## Usage

### Access Admin UI
Navigate to: **`/admin/ksl-scraper`**

### Run Scraper Locally
```bash
# Scrape and import 20 listings
node scripts/scrape-ksl-parallel.js "https://cars.ksl.com/v2/search/make/Chevrolet/yearFrom/1970/yearTo/1991" 20 true

# Scrape only (no import)
node scripts/scrape-ksl-parallel.js "https://cars.ksl.com/v2/search/make/Chevrolet/yearFrom/1970/yearTo/1991" 20 false
```

### Test with Single Listing
The existing `scrape-vehicle` edge function already supports KSL:
```javascript
const { data } = await supabase.functions.invoke('scrape-vehicle', {
  body: { url: 'https://cars.ksl.com/listing/10302276' }
});
```

## How It Works

1. **Search Scraping**: Uses Playwright to navigate to KSL search pages and extract listing URLs
2. **Listing Scraping**: Uses existing `scrape-vehicle` edge function which has KSL support built-in
3. **Import**: Creates vehicles with:
   - `profile_origin: 'ksl_import'`
   - `discovery_source: 'ksl_automated_import'`
   - `discovery_url: <ksl_listing_url>`
   - Proper origin metadata tracking

## Integration Points

- Uses existing `scrape-vehicle` function for individual listing data
- Follows same patterns as BAT import system
- Integrates with vehicle origin tracking system
- Respects duplicate detection (by VIN and discovery_url)

## Limitations

- **Edge Functions**: Cannot run Playwright directly, so search scraping must run:
  - Locally via scripts
  - Via external service (Vercel serverless, etc.)
  - Via scheduled cron job on server with Playwright

## Next Steps

1. **Test with real listings**: Run the scraper with actual KSL URLs
2. **Set up production scraping**: Configure Vercel serverless function or similar
3. **Add to admin dashboard**: Link from main admin page
4. **Schedule automated runs**: Set up cron job for regular imports

## Example KSL Search URLs

- Chevrolet 1970-1991: `https://cars.ksl.com/v2/search/make/Chevrolet/yearFrom/1970/yearTo/1991`
- Custom search: `https://cars.ksl.com/v2/search/make/<Make>/yearFrom/<Year>/yearTo/<Year>`

