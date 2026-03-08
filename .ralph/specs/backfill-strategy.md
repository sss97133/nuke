# Backfill Strategy - Fixing Missing Data on Existing Profiles

## The Problem

We have ~10,000 vehicle profiles but many are incomplete:
- **9.7%** have VIN + mileage + price + 5+ images (complete)
- **0.25%** have any images at all (only 26 of 10,565!)
- **100%** missing price data
- **100%** missing location data
- **54%** have invalid VINs (not 17 chars)

## Backfill Approach

### Priority 1: Re-extract from Source URLs

For vehicles with `discovery_url`:
1. Fetch the source page again (if still active)
2. Run multi-pass extraction
3. Compare: What fields are in source but missing in our profile?
4. Update only the missing fields (don't overwrite good data)

```sql
-- Find vehicles needing backfill
SELECT id, discovery_url, extraction_completeness
FROM vehicles
WHERE discovery_url IS NOT NULL
  AND (extraction_completeness < 0.8 OR extraction_completeness IS NULL)
ORDER BY created_at DESC;
```

### Priority 2: Image Backfill

Many vehicles have `discovery_url` but no images:

```sql
-- Vehicles with source URL but no images
SELECT v.id, v.discovery_url, v.make, v.model
FROM vehicles v
LEFT JOIN vehicle_images vi ON vi.vehicle_id = v.id
WHERE v.discovery_url IS NOT NULL
  AND vi.id IS NULL
LIMIT 100;
```

**Process:**
1. Fetch source page
2. Extract all gallery images
3. Upload to Supabase storage
4. Link to vehicle

### Priority 3: Price Data Recovery

```sql
-- Populate price from auction data
UPDATE vehicles
SET asking_price = COALESCE(
  NULLIF(sale_price, 0),
  NULLIF(high_bid, 0),
  NULLIF(reserve_price, 0)
)
WHERE asking_price IS NULL OR asking_price = 0;
```

### Priority 4: VIN Cleanup

```sql
-- Mark invalid VINs for re-extraction
UPDATE vehicles
SET
  vin_confidence = 0,
  extraction_missing_fields = array_append(
    COALESCE(extraction_missing_fields, '{}'),
    'vin'
  )
WHERE vin IS NOT NULL AND LENGTH(vin) != 17;
```

## Backfill Queue Structure

Create a dedicated backfill queue:

```sql
CREATE TABLE IF NOT EXISTS extraction_retry_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID REFERENCES vehicles(id),
  listing_url TEXT NOT NULL,
  missing_fields TEXT[] NOT NULL,     -- What we need to extract
  retry_method TEXT NOT NULL,          -- 'firecrawl', 'direct', 'browser'
  attempts INT DEFAULT 0,
  max_attempts INT DEFAULT 3,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT NOW()
);
```

## Backfill Priority Order

1. **High-value auctions** (BaT, C&B with sale price > $50k)
2. **Recent listings** (last 30 days)
3. **Profiles with most fields already** (easy wins)
4. **Profiles with source URL still active**

## Metrics to Track

| Metric | Before | Target |
|--------|--------|--------|
| Complete profiles | 9.7% | 50%+ |
| Image coverage | 0.25% | 50%+ |
| Valid VINs | 46% | 95% |
| Price coverage | 0% | 80% |
| Location coverage | 0% | 80% |

## Implementation Notes

1. **Don't overwrite good data** - Only fill NULL or low-confidence fields
2. **Track source** - Set `field_source = 'backfill_YYYYMMDD'`
3. **Log changes** - Keep audit trail of what was updated
4. **Rate limit** - Don't hammer source sites
5. **Respect dead links** - Skip 404/410 responses
