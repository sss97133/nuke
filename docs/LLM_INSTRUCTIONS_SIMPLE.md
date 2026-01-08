# LLM Instructions - BaT Extraction System

## ⚠️ BaT Extraction - CRITICAL RULES

**MANDATORY READING:** `docs/BAT_EXTRACTION_SUCCESS_WORKFLOW.md`

**DO NOT:**
- Use `comprehensive-bat-extraction` for BaT listings
- Use `import-bat-listing` for BaT listings  
- Use `bat-extract-complete-v1/v2/v3` for BaT listings

**ALWAYS:**
1. Use `extract-premium-auction` for core data (VIN, specs, images, auction_events)
2. Use `extract-auction-comments` for comments/bids

**If you see code using deprecated functions, update it to use the approved workflow.**

**These deprecated functions now return 410 Gone errors in production.**

---

## How to Extract ONE BaT Vehicle

```bash
./scripts/extract-bat-vehicle.sh "https://bringatrailer.com/listing/YOUR-LISTING/"
```

That's it. Script does both steps automatically.

## How to Extract MANY BaT Vehicles (Scalable)

### Option 1: Loop Through URLs

```bash
#!/bin/bash
URLS=(
  "https://bringatrailer.com/listing/vehicle-1/"
  "https://bringatrailer.com/listing/vehicle-2/"
  # ... add more
)

for URL in "${URLS[@]}"; do
  ./scripts/extract-bat-vehicle.sh "$URL"
  sleep 5  # Rate limiting
done
```

### Option 2: Use Queue System

```sql
-- 1. Add vehicles to queue
INSERT INTO bat_extraction_queue (vehicle_id, bat_auction_url, status, priority)
VALUES 
  ('vehicle-id-1', 'https://bringatrailer.com/listing/vehicle-1/', 'pending', 1),
  ('vehicle-id-2', 'https://bringatrailer.com/listing/vehicle-2/', 'pending', 1);

-- 2. Process queue (call this function)
-- This needs to be UPDATED first (see below)
```

Then call:
```bash
curl -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/process-bat-extraction-queue" \
  -H "Authorization: Bearer SERVICE_KEY" \
  -d '{"batchSize": 10}'
```

**⚠️ IMPORTANT**: `process-bat-extraction-queue` currently calls old function. Must update it first (see Fix The Queue Processor below).

## How to Verify Extraction Worked

```sql
SELECT v.vin, v.mileage, v.color, v.transmission,
  (SELECT COUNT(*) FROM vehicle_images WHERE vehicle_id = v.id) as imgs,
  (SELECT COUNT(*) FROM auction_comments WHERE vehicle_id = v.id) as comments,
  (SELECT COUNT(*) FROM bat_bids WHERE vehicle_id = v.id) as bids
FROM vehicles v 
WHERE v.discovery_url = 'YOUR_BAT_URL';
```

Expected: VIN (or null if listing doesn't have it), mileage, color, transmission, imgs > 0, comments > 0, bids >= 0

## The Two Functions That Work

1. **`extract-premium-auction`** - Gets VIN, specs, images
2. **`extract-auction-comments`** - Gets comments, bids

**Don't use**: `bat-extract-complete-v2/v3`, `comprehensive-bat-extraction`, `bat-simple-extract`

## Scalable Execution Plan

### Phase 1: Get All BaT URLs (1 vehicle)

```sql
-- Find all BaT vehicles without VIN
SELECT id, discovery_url 
FROM vehicles 
WHERE discovery_url LIKE '%bringatrailer.com%'
  AND (vin IS NULL OR mileage IS NULL)
LIMIT 100;
```

### Phase 2: Extract in Batches (10-50 vehicles/hour)

```bash
# Extract 10 at a time
for i in {1..10}; do
  ./scripts/extract-bat-vehicle.sh "URL_$i"
  sleep 5
done
```

**Speed**: ~45 seconds per vehicle (30s core + 15s comments)  
**Rate**: ~80 vehicles/hour max (to avoid rate limits)

### Phase 3: Monitor Progress

```sql
-- Check extraction success
SELECT 
  COUNT(*) as total,
  COUNT(CASE WHEN vin IS NOT NULL THEN 1 END) as have_vin,
  COUNT(CASE WHEN mileage IS NOT NULL THEN 1 END) as have_mileage,
  AVG((SELECT COUNT(*) FROM vehicle_images WHERE vehicle_id = vehicles.id)) as avg_images
FROM vehicles
WHERE discovery_url LIKE '%bringatrailer.com%';
```

### Phase 4: Fix Failures

```sql
-- Find vehicles that didn't extract properly
SELECT id, discovery_url
FROM vehicles
WHERE discovery_url LIKE '%bringatrailer.com%'
  AND (
    (SELECT COUNT(*) FROM vehicle_images WHERE vehicle_id = vehicles.id) = 0
    OR mileage IS NULL
  );
```

Re-run extraction on failures.

## Fix The Queue Processor (REQUIRED for scale)

Update `supabase/functions/process-bat-extraction-queue/index.ts`:

```typescript
// OLD (line 74-82):
const { data: extractionResult, error: extractionError } = await supabase.functions.invoke(
  'comprehensive-bat-extraction',
  { body: { batUrl: item.bat_url, vehicleId: item.vehicle_id } }
);

// NEW (replace with):
// Step 1: Core data
const coreResp = await fetch(`${SUPABASE_URL}/functions/v1/extract-premium-auction`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ url: item.bat_url, max_vehicles: 1 })
});
const coreResult = await coreResp.json();
const vehicleId = coreResult.created_vehicle_ids?.[0] || coreResult.updated_vehicle_ids?.[0] || item.vehicle_id;

// Step 2: Comments/bids
if (vehicleId) {
  await fetch(`${SUPABASE_URL}/functions/v1/extract-auction-comments`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ auction_url: item.bat_url, vehicle_id: vehicleId })
  });
}
```

## Automation (For Scale)

Set up cron job:
```sql
-- Run every 5 minutes, process 10 vehicles
SELECT cron.schedule(
  'process-bat-queue',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url:='https://qkgaybvrernstplzjaam.supabase.co/functions/v1/process-bat-extraction-queue',
    headers:='{"Authorization": "Bearer SERVICE_ROLE_KEY"}'::jsonb,
    body:='{"batchSize": 10}'::jsonb
  );
  $$
);
```

**Result**: 10 vehicles every 5 minutes = 120 vehicles/hour = 2,880 vehicles/day

---

**TL;DR**:
- One vehicle: `./scripts/extract-bat-vehicle.sh "URL"`
- Many vehicles: Loop the script OR fix queue processor + use cron
- Verify: Check VIN, mileage, color, images, comments with SQL
- Don't use old functions (they're broken)

