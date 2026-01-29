# PCarMarket.com Import Quick Start

## Overview

This guide explains how to use the PCarMarket.com scraping and import tools to map and index vehicles from PCarMarket into the Nuke platform.

## Prerequisites

1. **Environment Setup**: Ensure you have Supabase credentials in your `.env` file:
   ```bash
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   ```

2. **Dependencies**: Install required packages:
   ```bash
   npm install @supabase/supabase-js playwright
   ```

## Quick Start

### Step 1: Set Up PCarMarket Organization

First, create the PCarMarket organization profile in your database:

```bash
node scripts/setup-pcarmarket-org.js
```

This will:
- Create a new organization in the `businesses` table
- Display the organization ID
- Save the ID to use in imports

**Output Example:**
```
✅ Created organization:
   ID: 123e4567-e89b-12d3-a456-426614174000
   Name: PCarMarket
   Website: https://www.pcarmarket.com

💡 Add this to your .env file:
   PCARMARKET_ORG_ID=123e4567-e89b-12d3-a456-426614174000
```

### Step 2: Scrape Listings from PCarMarket

Scrape vehicle listings from a PCarMarket page:

```bash
node scripts/scrape-pcarmarket-listings.js https://www.pcarmarket.com/
```

This will:
- Scrape all listings from the page
- Extract basic listing information
- Save results to `data/pcarmarket/listings_<timestamp>.json`

**Options:**
- `--detailed`: Also scrape detailed data from individual auction pages (first 3 listings)

**Example Output:**
```
📋 Scraping listing page: https://www.pcarmarket.com/
   Loaded more listings (1)...
   Loaded more listings (2)...
   Found 45 unique listings

📊 Found 45 listings

Sample listings:
  1. 5k-Mile 2002 Aston Martin DB7 V12 Vantage Coupe
     URL: https://www.pcarmarket.com/auction/2002-aston-martin-db7-v12-vantage-2
     Status: unsold, Bid: $25000
  2. 5k-Mile 2002 Aston Martin DB7 V12 Vantage GTA
     URL: https://www.pcarmarket.com/auction/2002-aston-martin-db7-v12-gta
     Status: unsold, Bid: $30500
  ...

✅ Saved 45 listings to data/pcarmarket/listings_1234567890.json
```

### Step 3: Import Individual Vehicles

Import a specific vehicle from PCarMarket:

```bash
node scripts/import-pcarmarket-vehicle.js https://www.pcarmarket.com/auction/2002-aston-martin-db7-v12-vantage-2
```

This will:
1. Scrape the auction page for detailed vehicle data
2. Parse vehicle information (year, make, model, VIN, etc.)
3. Check for existing vehicle by VIN or URL
4. Create or update vehicle record
5. Import images from the auction
6. Link vehicle to PCarMarket organization

**Output Example:**
```
🚀 Importing PCarMarket listing: https://www.pcarmarket.com/auction/2002-aston-martin-db7-v12-vantage-2

📋 Step 1: Scraping auction page...
   ✅ Extracted: 5k-Mile 2002 Aston Martin DB7 V12 Vantage Coupe

✅ Scraped vehicle data:
   Year: 2002
   Make: aston martin
   Model: db7 v12 vantage coupe
   VIN: N/A
   Status: N/A
   Price: $N/A

📋 Step 2: Finding/Creating organization...
   Found existing organization: PCarMarket (123e4567-e89b-12d3-a456-426614174000)

📋 Step 3: Checking for existing vehicle...
   No existing vehicle found

📋 Step 4: Creating new vehicle...
   ✅ Created vehicle: 456e7890-e12b-34c5-d678-901234567890

📋 Step 5: Importing images...
   📸 Importing 15 images...
   ✅ Imported 15 images

📋 Step 6: Linking to organization...
   ✅ Linked to organization

✅ Import complete! Vehicle ID: 456e7890-e12b-34c5-d678-901234567890
```

## Bulk Import Workflow

### Option 1: Import from Scraped JSON

After scraping listings to JSON:

```javascript
// scripts/bulk-import-pcarmarket.js (to be created)
const listings = require('./data/pcarmarket/listings_1234567890.json');
for (const listing of listings) {
  await importVehicle(listing.url);
  await new Promise(resolve => setTimeout(resolve, 2000)); // Rate limiting
}
```

### Option 2: Import All from Listing Page

```bash
# Scrape and import all listings from a page
node scripts/scrape-pcarmarket-listings.js https://www.pcarmarket.com/ --detailed | \
  node scripts/bulk-import-pcarmarket.js
```

## Data Structure

### Vehicle Record

Imported vehicles follow the BaT import pattern with PCarMarket-specific metadata:

```json
{
  "year": 2002,
  "make": "aston martin",
  "model": "db7 v12 vantage coupe",
  "vin": null,
  "sale_price": 25000,
  "sale_date": null,
  "auction_outcome": null,
  "profile_origin": "pcarmarket_import",
  "discovery_source": "pcarmarket",
  "discovery_url": "https://www.pcarmarket.com/auction/2002-aston-martin-db7-v12-vantage-2",
  "origin_metadata": {
    "source": "pcarmarket_import",
    "pcarmarket_url": "https://www.pcarmarket.com/auction/2002-aston-martin-db7-v12-vantage-2",
    "pcarmarket_listing_title": "5k-Mile 2002 Aston Martin DB7 V12 Vantage Coupe",
    "pcarmarket_seller_username": null,
    "pcarmarket_auction_slug": "2002-aston-martin-db7-v12-vantage-2",
    "sold_status": "unsold",
    "imported_at": "2025-01-21T12:00:00Z"
  }
}
```

### Organization Link

Vehicles are automatically linked to the PCarMarket organization:

```json
{
  "organization_id": "123e4567-e89b-12d3-a456-426614174000",
  "vehicle_id": "456e7890-e12b-34c5-d678-901234567890",
  "relationship_type": "consigner",
  "status": "active",
  "listing_status": "listed",
  "listing_url": "https://www.pcarmarket.com/auction/2002-aston-martin-db7-v12-vantage-2"
}
```

## Troubleshooting

### No Listings Found

- Check if the page requires JavaScript rendering (may need Playwright)
- Verify the URL is correct
- Check network connectivity

### Missing Vehicle Data

- Some auction pages may not have complete information
- VIN may not be available in public listings
- Try scraping with `--detailed` flag for more data

### Duplicate Vehicles

The import script checks for duplicates by:
1. VIN (if available)
2. Discovery URL
3. Year/Make/Model + PCarMarket URL pattern

If duplicates are found, the existing vehicle is updated with new data.

### Rate Limiting

PCarMarket may rate-limit requests. Add delays between imports:

```javascript
await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay
```

## Next Steps

1. **Member Profile Extraction**: Similar to BaT, extract seller/member profiles
2. **Bulk Import Automation**: Set up scheduled jobs for regular updates
3. **Edge Function**: Create Supabase Edge Function for serverless imports
4. **Monitoring**: Track import status and errors

## Related Files

- `scripts/scrape-pcarmarket-listings.js` - Main scraper
- `scripts/import-pcarmarket-vehicle.js` - Import script
- `scripts/setup-pcarmarket-org.js` - Organization setup
- `docs/imports/PCARMARKET_IMPORT_PLAN.md` - Detailed plan

