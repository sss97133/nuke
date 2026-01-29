# SBX Cars Full Ingestion Implementation

## Overview

SBX Cars (sbxcars.com) is an online auction platform specializing in high-end and rare automobiles. This document describes the full ingestion system implemented to scrape and import all vehicle listings from SBX Cars into the Nuke database.

## Implementation

### 1. Bulk Scraper Edge Function

**Location:** `supabase/functions/scrape-sbxcars/index.ts`

This Edge Function handles full ingestion of SBX Cars listings:

- **Discovery**: Automatically discovers listings from browse/search pages:
  - `https://sbxcars.com/auctions` (live auctions)
  - `https://sbxcars.com/upcoming` (upcoming auctions)
  - `https://sbxcars.com/ended` (ended auctions)
  - `https://sbxcars.com` (homepage)

- **Scraping**: Scrapes individual listing pages to extract:
  - Vehicle details (year, make, model, VIN)
  - Pricing (current bid, reserve price)
  - Auction information (end date, lot number, status)
  - Images (full gallery)
  - Description and location

- **Queue Management**: Adds all discovered listings to `import_queue` for processing

### 2. Individual Listing Support

**Location:** `supabase/functions/scrape-vehicle/index.ts`

The universal `scrape-vehicle` function now includes SBX Cars detection and parsing, allowing individual SBX Cars URLs to be scraped directly.

## Usage

### Full Ingestion (All Listings)

```typescript
// Invoke the scraper Edge Function
const { data } = await supabase.functions.invoke('scrape-sbxcars', {
  body: {
    max_listings: 100,  // Optional: limit number of listings
    use_firecrawl: true  // Optional: use Firecrawl for better JS rendering
  }
})
```

### Single Listing

```typescript
// Scrape a single listing
const { data } = await supabase.functions.invoke('scrape-sbxcars', {
  body: {
    listing_url: 'https://sbxcars.com/auction/example-lot-123',
    use_firecrawl: true
  }
})
```

Or use the universal scraper:

```typescript
const { data } = await supabase.functions.invoke('scrape-vehicle', {
  body: {
    url: 'https://sbxcars.com/auction/example-lot-123'
  }
})
```

## Data Flow

1. **Discovery**: Scraper discovers listing URLs from browse pages
2. **Scraping**: Each listing is scraped to extract vehicle data
3. **Queue**: Listings are added to `import_queue` table
4. **Processing**: `process-import-queue` Edge Function processes queued items
5. **Vehicle Creation**: Vehicles are created in the `vehicles` table with:
   - Discovery metadata (source: 'sbxcars')
   - Auction information stored in `raw_data`
   - Images downloaded and linked
   - Timeline events created

## Data Extracted

### Vehicle Information
- Year, Make, Model
- VIN (if available)
- Mileage
- Color, Transmission, Engine
- Description

### Auction Information
- Current bid / Price
- Reserve price
- Auction end date
- Lot number
- Auction status (upcoming/live/ended/sold)
- Location

### Media
- Full image gallery
- High-resolution images preferred

## Configuration

### Required Environment Variables

- `SUPABASE_URL`: Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY`: Service role key for database access
- `FIRECRAWL_API_KEY`: (Optional but recommended) For better JS rendering

### Scrape Source

The scraper automatically creates a `scrape_sources` entry for 'sbxcars.com' if it doesn't exist:
- Domain: `sbxcars.com`
- Source Name: `SBX Cars`
- Source Type: `auction_house`

## Processing Priority

Listings are prioritized in the import queue:
- **Live auctions**: Priority 10
- **Other listings**: Priority 5

This ensures live auctions are processed first.

## Error Handling

- Failed listings are logged but don't stop the ingestion process
- Duplicate listings (already in queue or existing vehicles) are skipped
- Rate limiting: 1 second delay between listing scrapes

## Next Steps

1. **Deploy the Edge Function**:
   ```bash
   supabase functions deploy scrape-sbxcars
   ```

2. **Run Full Ingestion**:
   ```bash
   # Via Supabase Dashboard → Edge Functions → Invoke
   # Or via API call
   ```

3. **Monitor Progress**:
   - Check `import_queue` table for queued items
   - Monitor `process-import-queue` function logs
   - Verify vehicles created in `vehicles` table

4. **Schedule Regular Updates**:
   - Set up a cron job or scheduled function to periodically run the scraper
   - Update existing listings and discover new ones

## Notes

- The scraper uses Firecrawl when available for better handling of JavaScript-rendered content
- Image extraction prioritizes high-resolution images
- Auction-specific metadata is preserved in `raw_data` for future reference
- The system handles both live and ended auctions

