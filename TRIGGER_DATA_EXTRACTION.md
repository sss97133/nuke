# How to Trigger Data Extraction for Vehicle Profiles

## Current Data Status (as of analysis)

| Field | Completion Rate | Status |
|-------|----------------|--------|
| VIN | 36.5% | ⚠️ Needs work |
| Mileage | 13.0% | 🔴 Critical |
| Color | 7.2% | 🔴 Critical |
| Engine | 11.9% | 🔴 Critical |
| Transmission | 14.8% | 🔴 Critical |
| Price | 71.4% | ✅ Good |
| Discovery URL | 91.8% | ✅ Excellent |

**Key Insight**: 918 out of 1000 vehicles have discovery URLs - meaning we CAN re-scrape them to extract missing data!

---

## Method 1: GitHub Actions (Recommended)

The BAT scraper is already configured to run automatically every 6 hours. To trigger manually:

1. Go to: https://github.com/sss97133/nuke/actions
2. Find "BAT Scrape" workflow
3. Click "Run workflow" → "Run workflow"

This will scrape BringATrailer for new listings and extract comprehensive data.

---

## Method 2: Supabase SQL Editor (Direct Database)

1. Go to: https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/sql
2. Run the SQL from: `scripts/sql/trigger-data-extraction.sql`

This will:
- Show current data completeness
- List vehicles needing re-scraping
- (With service key) Trigger extraction functions directly

---

## Method 3: Node.js Script (Local)

### With Service Role Key:
```bash
export SUPABASE_SERVICE_ROLE_KEY="your-key-here"
node scripts/trigger-all-extraction.js
```

### Without Service Role Key (Analysis Only):
```bash
node scripts/trigger-all-extraction.js
```

---

## Method 4: Enable Database Cron Jobs

To set up automated scraping via Supabase pg_cron:

1. Go to Supabase Dashboard → Settings → Database
2. Add custom config:
   ```sql
   ALTER DATABASE postgres SET app.settings.service_role_key = 'YOUR_SERVICE_ROLE_KEY';
   ```

3. Run in SQL Editor:
   ```sql
   -- Enable extensions
   CREATE EXTENSION IF NOT EXISTS pg_cron;
   CREATE EXTENSION IF NOT EXISTS pg_net;

   -- Schedule BAT scraping every 6 hours
   SELECT cron.schedule(
     'bat-scrape-automated',
     '0 */6 * * *',
     $$
     SELECT net.http_post(
       url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/monitor-bat-seller',
       headers := jsonb_build_object(
         'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
         'Content-Type', 'application/json'
       ),
       body := jsonb_build_object(
         'sellerUsername', 'VivaLasVegasAutos',
         'organizationId', 'c433d27e-2159-4f8c-b4ae-32a5e44a77cf'
       )
     );
     $$
   );
   ```

---

## Edge Functions Available for Extraction

| Function | Purpose | Trigger |
|----------|---------|---------|
| `monitor-bat-seller` | Scrape BAT seller's listings | Cron/Manual |
| `comprehensive-bat-extraction` | Full BAT listing extraction with AI | Per-vehicle |
| `extract-vehicle-data-ai` | AI extraction from any URL | Per-vehicle |
| `scrape-all-craigslist-squarebodies` | Bulk Craigslist scraping | Cron/Manual |
| `scrape-vehicle` | Universal URL scraper | Per-URL |
| `analyze-image-tier1` | Image AI analysis | Per-image |
| `normalize-all-vehicles` | Normalize make/model/series | Batch |

---

## What Gets Extracted

### From BAT Listings:
- ✅ VIN (with AI fallback)
- ✅ Sale price and date
- ✅ Mileage
- ✅ Engine specs
- ✅ Transmission
- ✅ Color (exterior/interior)
- ✅ Drivetrain
- ✅ Auction timeline events
- ✅ Bid history

### From Craigslist:
- ✅ Title/year/make/model
- ✅ Price
- ⚠️ VIN (if listed)
- ⚠️ Mileage (if listed)
- ✅ Images

### From Images (AI Analysis):
- ✅ Vehicle angle classification
- ✅ Category (exterior/interior/engine/etc)
- ✅ Condition notes
- ✅ SPID sheet extraction
- ✅ VIN from photo

---

## Quick Commands

```bash
# Analyze current data status
node scripts/trigger-all-extraction.js

# Re-scrape pending BAT vehicles
SUPABASE_SERVICE_ROLE_KEY=xxx node scripts/rescrape-pending-vehicles.js

# Backfill pending vehicles with AI extraction
SUPABASE_SERVICE_ROLE_KEY=xxx node scripts/backfill-pending-vehicles.js

# Run image analysis on all unprocessed images
SUPABASE_SERVICE_ROLE_KEY=xxx node scripts/analyze-scraped-vehicles.js
```

---

## Why Data Is Missing

1. **Scrapers use basic regex** instead of AI extraction
2. **Cron jobs not running** - need to enable via pg_cron or GitHub Actions
3. **Service role key not configured** in database settings
4. **VehicleDataExtractionService** is frontend-only (not used in Edge Functions)

## Solution Priority

1. ⭐ **Enable GitHub Actions BAT scrape** (already configured, just needs manual trigger)
2. ⭐ **Set up pg_cron** with service role key for automated scraping
3. Run `backfill-pending-vehicles.js` on existing vehicles with URLs
4. Ensure all new imports use `comprehensive-bat-extraction` function
