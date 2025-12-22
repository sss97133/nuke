# Micro-Scrape Bandaid - Setup Complete ✅

## Status

✅ **Function Deployed:** `micro-scrape-bandaid` (v2)  
✅ **Database Migration Applied:** `micro_scrape_system`  
✅ **Monitoring View Created:** `vehicles_needing_micro_scrape`  
✅ **Test Run Successful:** Found 5 vehicles with gaps in dry run

## Current State

**8,207 vehicles** need improvement:
- 6,982 missing VIN
- 7,591 missing price
- 1,147 need image downloads
- All below quality threshold (85/100)

## How to Run

### Manual Test (Dry Run)
```bash
curl -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/micro-scrape-bandaid" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"dry_run": true, "batch_size": 10}'
```

### Manual Run (Real)
```bash
curl -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/micro-scrape-bandaid" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"batch_size": 20, "max_runtime_ms": 30000}'
```

### Automated Schedule

**Option 1: Supabase Dashboard (Recommended)**
1. Go to Supabase Dashboard → Database → Cron Jobs
2. Create new cron job:
   - **Schedule:** `*/5 * * * *` (every 5 minutes)
   - **Function:** `micro-scrape-bandaid`
   - **Payload:**
     ```json
     {
       "batch_size": 20,
       "max_runtime_ms": 25000
     }
     ```

**Option 2: pg_cron (if extension enabled)**
The migration `20250122000001_micro_scrape_cron.sql` will set this up automatically.

## Monitoring

### Check Vehicles Needing Improvement
```sql
SELECT * FROM vehicles_needing_micro_scrape LIMIT 20;
```

### View Recent Runs
```sql
SELECT 
  started_at,
  vehicles_analyzed,
  vehicles_improved,
  vehicles_marked_complete,
  actions_executed,
  actions_succeeded,
  runtime_ms
FROM micro_scrape_runs
ORDER BY started_at DESC
LIMIT 10;
```

### Success Rate (Last 7 Days)
```sql
SELECT 
  DATE(started_at) as date,
  COUNT(*) as runs,
  SUM(vehicles_improved) as improved,
  SUM(vehicles_marked_complete) as completed,
  ROUND(100.0 * SUM(actions_succeeded) / NULLIF(SUM(actions_executed), 0), 1) as success_rate
FROM micro_scrape_runs
WHERE status = 'completed'
  AND started_at >= NOW() - INTERVAL '7 days'
GROUP BY DATE(started_at)
ORDER BY date DESC;
```

## What It Does

1. **Finds vehicles** with `discovery_url` but gaps in data
2. **Analyzes gaps** (VIN, price, images, description)
3. **Executes actions** to fill gaps:
   - `retry-image-backfill` - Downloads stored image URLs
   - `extract-vin-from-vehicle` - Extracts VIN from images/text
   - `comprehensive-bat-extraction` - Re-extracts BaT data
   - `generate-vehicle-description` - Creates descriptions
4. **Recalculates quality** score after improvements
5. **Marks complete** when score ≥ 85/100

## Performance

- **Runtime:** ~30 seconds per batch (20 vehicles)
- **Throughput:** ~40 vehicles/minute
- **At 5-minute intervals:** ~200 vehicles/hour
- **Time to process all 8,207:** ~41 hours (continuous)

## Next Steps

1. ✅ Test run completed
2. ⏳ Set up automated cron (via Dashboard)
3. ⏳ Monitor first few runs
4. ⏳ Adjust batch_size if needed
5. ⏳ Review success rates after 24 hours

## Notes

- Function is **idempotent** - safe to run multiple times
- Skips vehicles already marked `micro_scrape_complete: true`
- Prioritizes lowest quality scores first
- Non-blocking actions (won't timeout on slow extractions)

