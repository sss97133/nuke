# Extraction Quality Review Session

**Purpose:** Discuss extraction quality issues, compare source vs extracted data, identify gaps, plan fixes.

---

## CONTEXT

### The System
Nuke extracts vehicle data from auction sites (BaT, Mecum, Cars & Bids, PCarMarket, etc.) into a PostgreSQL database via Supabase.

### Quality Benchmark
**Bring a Trailer (BaT)** is the gold standard. All extractors should capture:
- Title, year, make, model (parsed)
- VIN
- Mileage
- Sale price / high bid / asking price
- ALL images (15-50 per vehicle)
- Seller info
- Location
- Description
- Auction dates

### Known Issues
- Some extractors miss fields
- Image extraction incomplete
- Title not always parsed into year/make/model
- VIN extraction inconsistent

---

## EXAMPLES TO REVIEW

### Example 1: Mecum Trans Am
**Source:** https://www.mecum.com/lots/550167/1978-pontiac-trans-am/
**Extracted:** https://n-zero.dev/vehicle/05bdfe89-58fb-4bcf-ba90-50d795ff1bda
**Vehicle ID:** `05bdfe89-58fb-4bcf-ba90-50d795ff1bda`

---

## DATABASE ACCESS

```bash
# Direct psql connection
PGPASSWORD='RbzKq32A0uhqvJMQ' psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres
```

### Key Queries

```sql
-- Get full vehicle record
SELECT * FROM vehicles WHERE id = '05bdfe89-58fb-4bcf-ba90-50d795ff1bda';

-- Get all images for vehicle
SELECT * FROM vehicle_images WHERE vehicle_id = '05bdfe89-58fb-4bcf-ba90-50d795ff1bda';

-- Count images
SELECT COUNT(*) FROM vehicle_images WHERE vehicle_id = '05bdfe89-58fb-4bcf-ba90-50d795ff1bda';

-- Get auction events
SELECT * FROM auction_events WHERE vehicle_id = '05bdfe89-58fb-4bcf-ba90-50d795ff1bda';

-- Compare extracted fields to source
SELECT
  id, title, year, make, model, vin, mileage,
  sale_price, asking_price, high_bid,
  exterior_color, interior_color, engine, transmission,
  auction_source, listing_url, discovery_url,
  created_at, updated_at
FROM vehicles
WHERE id = '05bdfe89-58fb-4bcf-ba90-50d795ff1bda';
```

### Field Coverage Query
```sql
-- Check what percentage of fields are populated for a vehicle
SELECT
  id,
  CASE WHEN title IS NOT NULL THEN 1 ELSE 0 END as has_title,
  CASE WHEN year IS NOT NULL THEN 1 ELSE 0 END as has_year,
  CASE WHEN make IS NOT NULL THEN 1 ELSE 0 END as has_make,
  CASE WHEN model IS NOT NULL THEN 1 ELSE 0 END as has_model,
  CASE WHEN vin IS NOT NULL THEN 1 ELSE 0 END as has_vin,
  CASE WHEN mileage IS NOT NULL THEN 1 ELSE 0 END as has_mileage,
  CASE WHEN (sale_price IS NOT NULL OR asking_price IS NOT NULL OR high_bid IS NOT NULL) THEN 1 ELSE 0 END as has_price,
  CASE WHEN exterior_color IS NOT NULL THEN 1 ELSE 0 END as has_ext_color,
  CASE WHEN interior_color IS NOT NULL THEN 1 ELSE 0 END as has_int_color,
  CASE WHEN engine IS NOT NULL THEN 1 ELSE 0 END as has_engine,
  CASE WHEN transmission IS NOT NULL THEN 1 ELSE 0 END as has_transmission,
  (SELECT COUNT(*) FROM vehicle_images vi WHERE vi.vehicle_id = v.id) as image_count
FROM vehicles v
WHERE id = '05bdfe89-58fb-4bcf-ba90-50d795ff1bda';
```

---

## KEY FILES

### Extractors
| Source | File | Location |
|--------|------|----------|
| Mecum | `mecum-proper-extract.js` | `/Users/skylar/nuke/scripts/` |
| PCarMarket | `pcarmarket-proper-extract.js` | `/Users/skylar/nuke/scripts/` |
| BaT | `bat-simple-extract/index.ts` | `/Users/skylar/nuke/supabase/functions/` |
| Generic AI | `extract-vehicle-data-ai/index.ts` | `/Users/skylar/nuke/supabase/functions/` |

### Quality Docs
| Doc | Purpose |
|-----|---------|
| `.ralph/EXTRACTOR_QUALITY_COMPARISON.md` | Field-by-field comparison |
| `.ralph/EXTRACTOR_QUALITY_PROMPT.md` | Quality guidelines |
| `.ralph/SESSION_HANDOFF.md` | Current state summary |

---

## REVIEW WORKFLOW

1. **Fetch source page** - Use Firecrawl MCP or browser
2. **Query extracted data** - Use SQL above
3. **Compare field by field:**
   - What's on source but missing in DB?
   - What's in DB but wrong/incomplete?
   - How many images on source vs extracted?
4. **Identify pattern** - Is this a one-off or systemic?
5. **Trace to extractor code** - Find where the gap originates
6. **Plan fix** - Code change needed

---

## COMMON ISSUES

| Issue | Symptom | Likely Cause |
|-------|---------|--------------|
| Missing images | image_count = 0 or low | Extractor not saving to vehicle_images table |
| No year/make/model | Fields NULL despite title existing | Title not being parsed |
| Wrong price | sale_price NULL but auction sold | Price field mapping wrong |
| No VIN | vin NULL | VIN regex not matching format |
| Truncated description | description cut off | Character limit or parsing issue |

---

## DISCUSSION STARTERS

1. "Look at this vehicle: [ID]. Compare to source: [URL]. What's missing?"
2. "Why does Mecum extractor miss [field]? Show me the code."
3. "How do I add [field] extraction to [extractor]?"
4. "This vehicle has 2 images but source has 47. Fix the image extraction."
5. "Compare extraction quality: Mecum vs BaT for similar vehicles."

---

## FIX PATTERNS

### Adding a missing field
```javascript
// In extractor, find the scraping section and add:
const newField = $('selector-for-field').text().trim();
// Then include in the insert/update object
```

### Fixing image extraction
```javascript
// Ensure ALL images are saved to vehicle_images table
const images = $$('img.gallery-image').map(img => img.src);
for (let i = 0; i < images.length; i++) {
  await supabase.from('vehicle_images').insert({
    vehicle_id: vehicleId,
    image_url: images[i],
    position: i,
    is_primary: i === 0
  });
}
```

### Adding title parsing
```javascript
function parseTitle(title) {
  const match = title?.match(/^(\d{4})\s+([A-Za-z-]+)\s+(.+)$/);
  if (match) {
    return { year: parseInt(match[1]), make: match[2], model: match[3] };
  }
  return {};
}
```

---

## READY TO START

Paste your critiques. For each issue:
1. Source URL
2. Vehicle ID (or n-zero.dev URL)
3. What's wrong/missing

I'll query the data, compare to source, trace to code, and help fix.
