# Partial Scrape Retry System

## Overview

**Yes, this is a best practice!** Partial retry (selective retry) is a well-established pattern in distributed systems and scraping infrastructure. It allows you to:

1. **Avoid redundant work** - Don't re-scrape data that already succeeded
2. **Save time and resources** - Only retry the failed component
3. **Improve reliability** - Handle transient failures gracefully
4. **Enable monitoring** - Track which components fail most often

## Current Implementation

### Architecture

The BaT import pipeline uses a **modular, retryable design**:

```
┌─────────────────────────────────────┐
│  import-bat-listing                  │
│  (Main orchestrator)                 │
└──────────────┬──────────────────────┘
               │
       ┌───────┴────────┐
       │                 │
       ▼                 ▼
┌──────────────┐  ┌──────────────┐
│ Extract Data │  │ Extract URLs │
│ (VIN, price) │  │ (images)     │
└──────┬───────┘  └──────┬───────┘
       │                 │
       ▼                 ▼
┌──────────────┐  ┌──────────────┐
│ Store in DB  │  │ Store URLs   │
│              │  │ in metadata  │
└──────────────┘  └──────┬───────┘
                         │
                         ▼
                 ┌──────────────┐
                 │ backfill-    │
                 │ images       │
                 │ (async)      │
                 └──────────────┘
```

### Key Components

#### 1. **Image URL Storage** (`origin_metadata.image_urls`)

When `import-bat-listing` extracts images, it stores the URLs in `vehicles.origin_metadata`:

```typescript
origin_metadata: {
  image_urls: images,        // Array of image URLs
  image_count: images.length // Count for quick checks
}
```

**Why this matters:** Even if `backfill-images` fails, the URLs are preserved for retry.

#### 2. **Partial Retry Function** (`retry-image-backfill`)

**Location:** `supabase/functions/retry-image-backfill/index.ts`

**What it does:**
- Finds vehicles with `origin_metadata.image_urls` but missing actual images
- Retries only the image backfill step
- Does NOT re-scrape the listing
- Does NOT re-extract vehicle data

**Usage:**
```bash
# Retry images for specific vehicles
curl -X POST https://your-project.supabase.co/functions/v1/retry-image-backfill \
  -H "Authorization: Bearer YOUR_SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "vehicle_ids": ["uuid1", "uuid2"],
    "only_missing": true
  }'

# Retry images for all vehicles with stored URLs
curl -X POST https://your-project.supabase.co/functions/v1/retry-image-backfill \
  -H "Authorization: Bearer YOUR_SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"batch_size": 50}'
```

#### 3. **Error Isolation**

Each step in `import-bat-listing` is wrapped in try-catch:

```typescript
// Step 1: Extract and store vehicle data
try {
  // ... extract VIN, price, etc.
} catch {
  // Non-blocking - continues to next step
}

// Step 2: Extract and store image URLs
try {
  const images = extractBatGalleryImagesFromHtml(html);
  // Store in origin_metadata
} catch {
  // Non-blocking - URLs can be retried later
}

// Step 3: Backfill images (async)
try {
  await supabase.functions.invoke('backfill-images', {...});
} catch {
  // Non-blocking - retry-image-backfill can handle this
}
```

## Best Practices (Industry Standard)

### 1. **Idempotent Operations**
✅ **Current:** Image backfill is idempotent - running it twice doesn't create duplicates
✅ **Current:** Vehicle data updates use upsert logic

### 2. **State Preservation**
✅ **Current:** Image URLs stored in `origin_metadata` for retry
✅ **Current:** Vehicle data stored even if images fail

### 3. **Granular Error Tracking**
⚠️ **Needs Enhancement:** Currently logs errors but could track per-step failures

### 4. **Retry Strategies**
✅ **Current:** Exponential backoff in `backfill-images`
✅ **Current:** Configurable retry limits

## Monitoring & Logging

### Current Logging

**Edge Function Logs:**
```bash
# View BaT import logs
supabase functions logs import-bat-listing

# View image backfill logs
supabase functions logs backfill-images

# View retry logs
supabase functions logs retry-image-backfill
```

**Database Queries:**

```sql
-- Find vehicles with stored image URLs but no images
SELECT 
  v.id,
  v.make,
  v.model,
  v.year,
  v.origin_metadata->>'image_count' as stored_image_count,
  COUNT(vi.id) as actual_image_count,
  v.origin_metadata->'image_urls' as stored_urls
FROM vehicles v
LEFT JOIN vehicle_images vi ON v.id = vi.vehicle_id
WHERE v.origin_metadata->'image_urls' IS NOT NULL
  AND v.origin_metadata->'image_urls' != '[]'::jsonb
GROUP BY v.id, v.make, v.model, v.year, v.origin_metadata
HAVING COUNT(vi.id) = 0
ORDER BY v.created_at DESC
LIMIT 20;
```

### Enhanced Monitoring (Recommended)

**1. Track Partial Failures:**

```sql
-- Create a view for monitoring partial scrape failures
CREATE OR REPLACE VIEW scrape_failure_analysis AS
SELECT 
  v.id as vehicle_id,
  v.make,
  v.model,
  v.year,
  v.discovery_url,
  CASE 
    WHEN v.vin IS NULL THEN 'missing_vin'
    WHEN v.sale_price IS NULL THEN 'missing_price'
    WHEN COUNT(vi.id) = 0 AND v.origin_metadata->'image_urls' IS NOT NULL THEN 'missing_images'
    WHEN COUNT(vi.id) = 0 AND v.origin_metadata->'image_urls' IS NULL THEN 'missing_image_urls'
    ELSE 'complete'
  END as failure_type,
  v.origin_metadata->>'image_count' as stored_image_count,
  COUNT(vi.id) as actual_image_count,
  v.created_at
FROM vehicles v
LEFT JOIN vehicle_images vi ON v.id = vi.vehicle_id
WHERE v.origin_metadata->>'source' = 'bringatrailer.com'
GROUP BY v.id, v.make, v.model, v.year, v.discovery_url, v.vin, v.sale_price, v.origin_metadata, v.created_at
HAVING 
  v.vin IS NULL 
  OR v.sale_price IS NULL
  OR (COUNT(vi.id) = 0 AND v.origin_metadata->'image_urls' IS NOT NULL)
ORDER BY v.created_at DESC;
```

**2. Monitor Retry Success Rates:**

```sql
-- Track retry attempts and success rates
SELECT 
  DATE(created_at) as date,
  COUNT(*) as total_retries,
  COUNT(*) FILTER (WHERE status = 'completed') as succeeded,
  COUNT(*) FILTER (WHERE status = 'failed') as failed,
  ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'completed') / COUNT(*), 2) as success_rate
FROM backfill_queue
WHERE reason = 'scraper_improved'
GROUP BY DATE(created_at)
ORDER BY date DESC;
```

## Usage Examples

### Scenario 1: Images Failed to Download

**Problem:** Vehicle imported but has 0 images despite stored URLs

**Solution:**
```bash
# Retry just the images for this vehicle
curl -X POST https://your-project.supabase.co/functions/v1/retry-image-backfill \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "vehicle_ids": ["vehicle-uuid-here"],
    "only_missing": true
  }'
```

### Scenario 2: Batch Retry Failed Images

**Problem:** Multiple vehicles missing images from recent import

**Solution:**
```sql
-- Find all vehicles needing image retry
SELECT id 
FROM vehicles 
WHERE origin_metadata->'image_urls' IS NOT NULL
  AND origin_metadata->'image_urls' != '[]'::jsonb
  AND NOT EXISTS (
    SELECT 1 FROM vehicle_images WHERE vehicle_id = vehicles.id
  )
LIMIT 50;
```

Then call `retry-image-backfill` with those IDs.

### Scenario 3: Re-extract Only VIN

**Problem:** VIN extraction failed but images are fine

**Solution:**
```bash
# Call VIN extraction function directly
curl -X POST https://your-project.supabase.co/functions/v1/extract-vin-from-vehicle \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "vehicle_id": "vehicle-uuid-here",
    "extra_text": "optional HTML if available"
  }'
```

## Future Enhancements

### 1. **Scrape Step Tracking Table**

Track each step of a scrape:

```sql
CREATE TABLE scrape_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID REFERENCES vehicles(id),
  step_name TEXT NOT NULL, -- 'extract_data', 'extract_images', 'backfill_images', 'extract_vin'
  status TEXT NOT NULL, -- 'pending', 'success', 'failed', 'skipped'
  error_message TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
```

### 2. **Automatic Retry Queue**

Automatically queue failed steps for retry:

```sql
CREATE TABLE scrape_retry_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID REFERENCES vehicles(id),
  step_name TEXT NOT NULL,
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  next_retry_at TIMESTAMPTZ,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 3. **Dashboard View**

Create a monitoring dashboard showing:
- Vehicles with partial failures
- Success rates by step
- Retry queue status
- Recent failures

## References

- **Industry Pattern:** [Circuit Breaker Pattern](https://martinfowler.com/bliki/CircuitBreaker.html)
- **Retry Strategies:** [Exponential Backoff](https://en.wikipedia.org/wiki/Exponential_backoff)
- **Idempotency:** [REST API Design](https://restfulapi.net/idempotent-rest-apis/)

## Summary

✅ **Partial retry is implemented and working**
✅ **Follows industry best practices**
✅ **Image URLs preserved for retry**
✅ **Logging infrastructure exists**

⚠️ **Enhancements needed:**
- Better step-level failure tracking
- Automatic retry queue
- Monitoring dashboard
- Per-step success rate metrics

