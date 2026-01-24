# Playwright-Based Extraction Scripts

These scripts handle anti-bot protection using real browser automation via Playwright.

## Created Files

1. **dupont-registry-playwright-extractor.ts** - DuPont Registry marketplace & live auctions
2. **rm-sothebys-playwright-extractor.ts** - RM Sotheby's auction lots
3. **bonhams-playwright-extractor.ts** - Bonhams motor car auctions

## Installation

Ensure Playwright is installed:

```bash
npm install playwright
npx playwright install chromium
```

## Usage

### Single URL Mode

Extract data from a specific listing:

```bash
# DuPont Registry
npx tsx scripts/dupont-registry-playwright-extractor.ts "https://www.dupontregistry.com/autos/listing/2024/porsche/911/..."

# RM Sotheby's
npx tsx scripts/rm-sothebys-playwright-extractor.ts "https://rmsothebys.com/en/auctions/ps24/lots/123/"

# Bonhams
npx tsx scripts/bonhams-playwright-extractor.ts "https://www.bonhams.com/auction/12345/lot/67/"
```

### Batch/Discovery Mode

Auto-discover and extract multiple listings:

```bash
# DuPont Registry - pages 1-5
npx tsx scripts/dupont-registry-playwright-extractor.ts 1 5

# RM Sotheby's - discovers current sales automatically
npx tsx scripts/rm-sothebys-playwright-extractor.ts

# Bonhams - discovers motor car department sales
npx tsx scripts/bonhams-playwright-extractor.ts
```

## Features

All scripts follow the CAB comprehensive extractor pattern:

- **Real Browser**: Launches Chromium with `headless: false` for debugging
- **Anti-Bot Handling**: Waits for Cloudflare/reCAPTCHA challenges to clear
- **Session Warmup**: Visits homepage first to establish legitimate session
- **Complete Data Extraction**:
  - Vehicle specs (year, make, model, VIN, mileage, colors, engine, transmission)
  - Auction details (estimates, sold prices, status, lot numbers)
  - Full image galleries with navigation
  - Descriptions, provenance, equipment lists
- **Database Integration**:
  - Saves to `vehicles` table
  - Creates `external_listings` entries
  - Stores images in `vehicle_images`
  - Tracks auction history in `auction_events`
- **Upsert Logic**: Updates existing vehicles by VIN or URL
- **Progress Logging**: Real-time extraction status with stats

## Platform-Specific Details

### DuPont Registry

- **Discovery URL**: `https://www.dupontregistry.com/autos/results/all`
- **Listing Pattern**: `/autos/listing/{year}/{make}/{model}/{id}`
- **Live Auctions**: `live.dupontregistry.com/auction/...`
- **Platform**: `dupont_registry`
- **Org ID**: Placeholder (needs database entry)

### RM Sotheby's

- **Discovery URL**: `https://rmsothebys.com/en/auctions/`
- **Lot Pattern**: `/en/auctions/{code}/lots/{slug}/`
- **Images**: `cdn.rmsothebys.com`
- **Platform**: `rmsothebys`
- **Org ID**: `5761f2bf-d37f-4b24-aa38-0d8c95ea2ae1`

### Bonhams

- **Discovery URL**: `https://www.bonhams.com/department/MOT/`
- **Lot Pattern**: `/auction/{sale-id}/lot/{lot-number}/`
- **Images**: `bonhams.com` and `bonhams1793.com`
- **Platform**: `bonhams`
- **Org ID**: Placeholder (needs database entry)

## TODO

1. Create organization entries in database for:
   - DuPont Registry (replace placeholder org ID)
   - Bonhams (replace placeholder org ID)

2. Test with real URLs from each platform

3. Adjust selectors if DOM structure differs from assumptions

4. Consider adding headless mode after debugging (`headless: true`)

5. Add rate limiting/delays if sites detect scraping patterns

## Database Schema

All extractors save to these tables:

- **vehicles**: Core vehicle data (year, make, model, VIN, etc.)
- **external_listings**: Platform-specific listing data with metadata
- **vehicle_images**: Image URLs with source tracking
- **auction_events**: Historical auction results

## Error Handling

Scripts handle:
- Cloudflare challenges (30 second timeout)
- 404/not found pages
- Missing data fields (graceful null fallback)
- Database upsert conflicts
- Image extraction failures
- Network timeouts

## Performance

- **Wait times**: 2-3 seconds between page navigations
- **Batch size**: 20 lots per sale (configurable)
- **Image limit**: 150 images per vehicle
- **Browser**: Chromium with standard user agent

## Monitoring

Check extraction stats:

```bash
# Total vehicles from each platform
psql -c "SELECT discovery_source, COUNT(*) FROM vehicles WHERE discovery_source IN ('dupont_registry', 'rmsothebys', 'bonhams') GROUP BY discovery_source;"

# External listings by platform
psql -c "SELECT platform, COUNT(*) FROM external_listings WHERE platform IN ('dupont_registry', 'rmsothebys', 'bonhams') GROUP BY platform;"
```
