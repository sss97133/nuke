# Micro Scrape Bandaid System

## Overview

**Automated, continuous gap-filling** for vehicle profiles. Runs lightweight checks on any vehicle with a source URL, identifies data gaps, and automatically fills them until quality threshold is met.

**Goal:** Reduce latency from days to minutes by continuously improving data quality in the background.

## How It Works

### 1. **Gap Detection**
- Analyzes vehicles with `discovery_url` (source URL)
- Checks for missing critical/important fields
- Compares against quality score threshold (85/100)
- Identifies specific gaps (VIN, price, images, description, etc.)

### 2. **Action Execution**
- Automatically executes recommended actions:
  - `retry-image-backfill` - If image URLs stored but not downloaded
  - `extract-vin-from-vehicle` - If VIN missing
  - `comprehensive-bat-extraction` - If BaT data incomplete
  - `extract-images` - If no images extracted yet
  - `generate-vehicle-description` - If description missing

### 3. **Quality Threshold**
- **Complete:** Quality score ≥ 85/100
- **Critical fields:** year, make, model (must have)
- **Important fields:** VIN, sale_price, description (should have)
- **Nice-to-have:** mileage, color, engine, transmission (bonus)

### 4. **Completion Marking**
- When threshold met, marks vehicle as `micro_scrape_complete: true`
- Stops checking that vehicle (unless manually triggered)
- Logs completion timestamp

## Usage

### Manual Run

```bash
# Run on specific vehicles
curl -X POST https://your-project.supabase.co/functions/v1/micro-scrape-bandaid \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "vehicle_ids": ["uuid1", "uuid2"],
    "batch_size": 20,
    "max_runtime_ms": 30000
  }'

# Run on all vehicles needing improvement (default)
curl -X POST https://your-project.supabase.co/functions/v1/micro-scrape-bandaid \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "batch_size": 20
  }'

# Dry run (see what would happen)
curl -X POST https://your-project.supabase.co/functions/v1/micro-scrape-bandaid \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "dry_run": true,
    "batch_size": 50
  }'
```

### Automated Schedule

Runs every 5 minutes via cron job (see migration `20250122000001_micro_scrape_cron.sql`).

## Monitoring

### View Vehicles Needing Improvement

```sql
SELECT * FROM vehicles_needing_micro_scrape
LIMIT 50;
```

### Check Recent Runs

```sql
SELECT 
  started_at,
  vehicles_analyzed,
  vehicles_improved,
  vehicles_marked_complete,
  actions_executed,
  actions_succeeded,
  actions_failed,
  runtime_ms,
  status
FROM micro_scrape_runs
ORDER BY started_at DESC
LIMIT 20;
```

### Success Rate

```sql
SELECT 
  DATE(started_at) as date,
  COUNT(*) as runs,
  SUM(vehicles_improved) as vehicles_improved,
  SUM(vehicles_marked_complete) as vehicles_completed,
  ROUND(AVG(runtime_ms), 0) as avg_runtime_ms,
  ROUND(100.0 * SUM(actions_succeeded) / NULLIF(SUM(actions_executed), 0), 1) as success_rate
FROM micro_scrape_runs
WHERE status = 'completed'
  AND started_at >= NOW() - INTERVAL '7 days'
GROUP BY DATE(started_at)
ORDER BY date DESC;
```

## Architecture

```
┌─────────────────────────────────┐
│  Cron (every 5 min)             │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│  micro-scrape-bandaid           │
│  (Main orchestrator)            │
└──────────────┬──────────────────┘
               │
       ┌───────┴────────┐
       │                │
       ▼                ▼
┌──────────────┐  ┌──────────────┐
│ Gap Analysis │  │ Quality      │
│ (identify)   │  │ Check        │
└──────┬───────┘  └──────┬───────┘
       │                 │
       └────────┬────────┘
                │
                ▼
       ┌────────────────┐
       │ Execute Actions │
       │ (fill gaps)     │
       └────────┬────────┘
                │
       ┌────────┴────────┐
       │                 │
       ▼                 ▼
┌──────────────┐  ┌──────────────┐
│ Recalculate  │  │ Mark         │
│ Quality      │  │ Complete     │
└──────────────┘  └──────────────┘
```

## Key Features

### ✅ Fast Execution
- 30-second runtime limit per batch
- Processes 20 vehicles per run
- Non-blocking actions (fire-and-forget where appropriate)

### ✅ Intelligent Prioritization
- Lowest quality scores first
- Recent vehicles prioritized
- Skips already-complete vehicles

### ✅ Idempotent
- Safe to run multiple times
- Won't duplicate data
- Tracks completion state

### ✅ Observable
- Logs all runs to `micro_scrape_runs` table
- Tracks success/failure rates
- Records runtime performance

## Quality Threshold Logic

```typescript
const QUALITY_THRESHOLD = {
  min_score: 85, // Must reach 85/100 to be "complete"
  critical_fields: ['year', 'make', 'model'], // Must have
  important_fields: ['vin', 'sale_price', 'description'], // Should have
  nice_to_have_fields: ['mileage', 'color', 'engine', 'transmission'], // Bonus
};
```

**Scoring:**
- Critical fields: 30 points (10 each)
- Important fields: 45 points (15 each)
- Images: 15 points
- Nice-to-have: 10 points (bonus)

**Complete when:** Score ≥ 85 AND all critical fields present

## Integration with Existing Systems

### Works With:
- `vehicle_quality_scores` - Uses existing quality calculation
- `retry-image-backfill` - Reuses existing retry logic
- `comprehensive-bat-extraction` - Uses existing BaT extraction
- `extract-vin-from-vehicle` - Uses existing VIN extraction

### Extends:
- `backfill_queue` - Can queue vehicles for deeper extraction
- `scraping_health` - Can track extraction success rates

## Future Enhancements

### 1. **Adaptive Learning**
- Track which extraction methods work best per source
- Automatically improve extraction patterns
- Learn from successful extractions

### 2. **Extraction Map Auto-Generation**
- Analyze successful extractions
- Generate extraction patterns automatically
- Reduce manual mapping time from days to minutes

### 3. **Source-Specific Strategies**
- Different strategies for BaT vs Craigslist vs dealers
- Optimize per-source extraction methods
- Learn optimal retry strategies

### 4. **Confidence Scoring**
- Track extraction confidence levels
- Only mark complete when high confidence
- Flag low-confidence data for review

## Troubleshooting

### Vehicles Not Improving

```sql
-- Check if vehicle is being processed
SELECT 
  v.id,
  v.discovery_url,
  qs.overall_score,
  v.origin_metadata->>'micro_scrape_complete' as marked_complete
FROM vehicles v
LEFT JOIN vehicle_quality_scores qs ON qs.vehicle_id = v.id
WHERE v.id = 'your-vehicle-id';
```

### Actions Failing

Check function logs:
```bash
supabase functions logs micro-scrape-bandaid
supabase functions logs retry-image-backfill
supabase functions logs extract-vin-from-vehicle
```

### Performance Issues

- Reduce `batch_size` if runtime exceeds limit
- Increase `max_runtime_ms` if needed
- Check for rate limiting on external APIs

## Summary

✅ **Automated** - Runs every 5 minutes
✅ **Fast** - 30 seconds per batch, 20 vehicles
✅ **Intelligent** - Prioritizes by quality score
✅ **Observable** - Full logging and monitoring
✅ **Idempotent** - Safe to run repeatedly
✅ **Complete** - Marks vehicles when threshold met

**Result:** Data quality improves continuously in the background, reducing manual intervention from days to minutes.

