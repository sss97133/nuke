# Hillbank Motorsports - Complete Inventory Extraction Plan

**Organization ID**: `1152029f-316d-4379-80b6-e74706700490`  
**Website**: `https://www.hillbankmotorsports.com`  
**Status**: Organization exists, but NO vehicles in database yet

---

## Quick Start

### Step 1: Extract Inventory
```bash
# Set your service role key
export SUPABASE_SERVICE_ROLE_KEY="your-key-here"

# Run extraction script
./scripts/extract-hillbank-inventory.sh
```

This will:
1. Scrape the website using `scrape-multi-source`
2. Queue listings in `import_queue`
3. Process the queue to create vehicles in the database

### Step 2: Get All Data
```sql
-- Run the comprehensive SQL query
\i scripts/get_hillbank_inventory.sql
```

Or use the Supabase SQL editor to run the queries from `scripts/get_hillbank_inventory.sql`

---

## What You'll Get

The SQL query provides:

1. **Counts** - For sale vs sold vehicles
2. **All Vehicle URLs** - Both n-zero.dev and external URLs
3. **Prices** - Asking price, current value, sale price
4. **Y/M/M** - Year, Make, Model, Trim, VIN, Mileage
5. **Descriptions** - Full vehicle descriptions
6. **Image URLs** - Primary image + ALL images as JSON array
7. **Status** - Listing status, sale status, etc.
8. **Timestamps** - When added to inventory, when created

---

## Manual Extraction (if script doesn't work)

### Trigger Scraping
```bash
curl -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/scrape-multi-source" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "source_url": "https://www.hillbankmotorsports.com",
    "source_type": "dealer_website",
    "extract_listings": true,
    "extract_dealer_info": true,
    "use_llm_extraction": true,
    "cheap_mode": false,
    "max_listings": 500,
    "organization_id": "1152029f-316d-4379-80b6-e74706700490"
  }'
```

### Process Import Queue
```bash
curl -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/process-import-queue" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "batch_size": 20,
    "max_results": 500
  }'
```

---

## Future: Make It Automatic

**The Problem**: When you add a new org URL, it doesn't automatically extract inventory.

**The Solution**: The system DOES have automation, but it might not be triggered. Here's what should happen:

1. **When org is created/updated with website** → Should trigger `process-inventory-sync-queue`
2. **Inventory sync queue** → Calls `scrape-multi-source` for the website
3. **Import queue** → Processes scraped listings into vehicles

**To Fix**: Ensure that when an organization is created/updated with a website, it's automatically added to `organization_inventory_sync_queue` OR the website URL triggers `scrape-multi-source` directly.

The code exists in:
- `process-import-queue/index.ts` → `triggerDealerInventorySync()` function
- `process-inventory-sync-queue/index.ts` → Processes queued orgs
- `bulk-enqueue-inventory-extraction/index.ts` → Can queue orgs for extraction

---

## Notes

- **JavaScript-rendered site**: `cheap_mode: false` is required (uses Firecrawl)
- **LLM extraction**: `use_llm_extraction: true` for better data quality
- **Deduplication**: Automatic via `import_queue` constraints
- **Processing**: Listings are queued, then processed by `process-import-queue`

