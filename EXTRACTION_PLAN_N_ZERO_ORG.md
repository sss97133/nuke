# Extraction Plan: n-zero.dev Organization Inventory

**Organization ID**: `1152029f-316d-4379-80b6-e74706700490`  
**URL**: `https://n-zero.dev/org/1152029f-316d-4379-80b6-e74706700490`

---

## Option 1: Direct Database Query (RECOMMENDED - Fastest)

Since this is your own platform (n-zero.dev), the most efficient approach is direct database access:

### Query Strategy:
```sql
-- Check if organization exists and get details
SELECT id, name, business_type, website 
FROM businesses 
WHERE id = '1152029f-316d-4379-80b6-e74706700490';

-- Get all vehicle listings for this organization
SELECT 
  id,
  url,
  title,
  year,
  make,
  model,
  price,
  status,
  created_at
FROM vehicle_listings 
WHERE organization_id = '1152029f-316d-4379-80b6-e74706700490'
ORDER BY created_at DESC;

-- Get all external listings if they exist
SELECT 
  id,
  source_url,
  title,
  year,
  make,
  model,
  price,
  status,
  created_at
FROM external_listings
WHERE organization_id = '1152029f-316d-4379-80b6-e74706700490'
ORDER BY created_at DESC;
```

---

## Option 2: Scrape via scrape-multi-source (For External View)

If you need to scrape it as an external source (testing, validation, or if it's a different organization):

### Edge Function Call:
```bash
curl -X POST "${SUPABASE_URL}/functions/v1/scrape-multi-source" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "source_url": "https://n-zero.dev/org/1152029f-316d-4379-80b6-e74706700490",
    "source_type": "dealer_website",
    "extract_listings": true,
    "extract_dealer_info": true,
    "use_llm_extraction": true,
    "cheap_mode": false,
    "max_listings": 500,
    "organization_id": "1152029f-316d-4379-80b6-e74706700490"
  }'
```

### Parameters Explained:
- **`source_type: "dealer_website"`** - Treats it as a dealer/organization website
- **`cheap_mode: false`** - REQUIRED for JavaScript-rendered pages (n-zero.dev is React)
- **`use_llm_extraction: true`** - Better data extraction quality
- **`max_listings: 500`** - Adjust based on actual inventory size
- **`organization_id`** - Links extracted listings directly to the organization

### How It Works:
1. Firecrawl renders the JavaScript-rendered React page
2. Structured extraction schema extracts listings and dealer info
3. Listings are queued in `import_queue` table
4. `process-import-queue` processes them into `vehicle_listings`

---

## Option 3: Check Existing Inventory First

Before scraping, check what's already in the database:

```sql
-- Count existing listings
SELECT 
  COUNT(*) as total_listings,
  COUNT(*) FILTER (WHERE status = 'in_stock') as in_stock,
  COUNT(*) FILTER (WHERE status = 'sold') as sold
FROM vehicle_listings 
WHERE organization_id = '1152029f-316d-4379-80b6-e74706700490';
```

---

## Recommended Approach

1. **First**: Query database directly (Option 1) - fastest, most accurate
2. **If needed**: Use scrape-multi-source (Option 2) - for validation or if data is missing
3. **Monitor**: Check `import_queue` table after scraping to see queued items

---

## Post-Extraction Steps

After extraction, listings will be in `import_queue`. Process them with:

```bash
curl -X POST "${SUPABASE_URL}/functions/v1/process-import-queue" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "batch_size": 10,
    "max_results": 200
  }'
```

---

## Notes

- n-zero.dev is JavaScript-rendered (React), so `cheap_mode: false` is required
- Firecrawl will handle the JS rendering automatically
- The extraction schema will automatically extract:
  - Vehicle listings (title, year, make, model, price, etc.)
  - Organization/dealer info (name, address, contact, etc.)
- Listings are deduplicated automatically via `import_queue` constraints

