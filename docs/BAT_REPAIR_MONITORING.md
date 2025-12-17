# BaT Repair Loop Monitoring Guide

**Quick Start**: Run `./scripts/monitor-bat-repair.sh` for instant status

---

## Quick Monitoring

### Command-Line Script

```bash
# Simple monitoring (auto-detects DB connection)
./scripts/monitor-bat-repair.sh

# With explicit database URL
SUPABASE_DB_URL="postgresql://user:pass@host:port/db" ./scripts/monitor-bat-repair.sh
```

**Output**:
- Quick health check (success/failed counts)
- Recent repair attempts (last 10)
- Incomplete vehicles count (repair candidates)
- Image ordering status
- Last 24 hours activity timeline

---

## Detailed SQL Queries

**File**: `database/queries/MONITOR_BAT_REPAIR_LOOP.sql`

### Query 1: Recent Repair Attempts

Shows vehicles that have been processed with their last attempt status, timing, and results.

```sql
SELECT 
  v.id,
  v.year, v.make, v.model,
  (v.origin_metadata->'bat_repair'->>'last_attempt_at')::timestamp as last_repair_attempt,
  (v.origin_metadata->'bat_repair'->>'last_ok')::boolean as last_repair_success,
  (v.origin_metadata->'bat_repair'->>'last_error')::text as last_repair_error,
  -- Current completeness status
  (SELECT COUNT(*) FROM vehicle_images vi WHERE vi.vehicle_id = v.id) as image_count,
  LENGTH(COALESCE(v.description, '')) as description_length
FROM vehicles v
WHERE v.origin_metadata->'bat_repair' IS NOT NULL
ORDER BY (v.origin_metadata->'bat_repair'->>'last_attempt_at')::timestamp DESC
LIMIT 100;
```

### Query 2: Repair Success Rate Summary

Overall statistics on repair attempts and success rates.

```sql
SELECT 
  COUNT(*) FILTER (WHERE (v.origin_metadata->'bat_repair'->>'last_ok')::boolean = true) as successful_repairs,
  COUNT(*) FILTER (WHERE (v.origin_metadata->'bat_repair'->>'last_ok')::boolean = false) as failed_repairs,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE (v.origin_metadata->'bat_repair'->>'last_ok')::boolean = true) / 
    NULLIF(COUNT(*) FILTER (WHERE v.origin_metadata->'bat_repair'->>'last_ok' IS NOT NULL), 0),
    2
  ) as success_rate_pct
FROM vehicles v
WHERE v.origin_metadata->'bat_repair' IS NOT NULL;
```

### Query 3: Currently Incomplete Vehicles (Repair Candidates)

Vehicles that need repair based on the same criteria used by the orchestrator.

```sql
SELECT 
  v.id,
  v.year, v.make, v.model,
  (SELECT COUNT(*) FROM vehicle_images vi WHERE vi.vehicle_id = v.id) as image_count,
  LENGTH(COALESCE(v.description, '')) as description_length,
  CASE WHEN v.listing_location IS NULL OR v.listing_location = '' THEN false ELSE true END as has_location,
  (SELECT COUNT(*) FROM auction_comments ac WHERE ac.vehicle_id = v.id) as comment_count,
  CASE 
    WHEN (v.origin_metadata->'bat_repair'->>'last_attempt_at')::timestamp IS NULL THEN true
    WHEN EXTRACT(EPOCH FROM (NOW() - (v.origin_metadata->'bat_repair'->>'last_attempt_at')::timestamp)) / 3600 >= 6 THEN true
    ELSE false
  END as can_repair_now
FROM vehicles v
WHERE 
  (v.profile_origin = 'bat_import' OR v.listing_url ILIKE '%bringatrailer.com/listing/%')
  AND v.updated_at <= NOW() - INTERVAL '6 hours'
HAVING 
  (SELECT COUNT(*) FROM vehicle_images vi WHERE vi.vehicle_id = v.id) = 0
  OR LENGTH(COALESCE(v.description, '')) < 80
  OR v.listing_location IS NULL
  OR v.listing_location = ''
  OR (SELECT COUNT(*) FROM auction_comments ac WHERE ac.vehicle_id = v.id) = 0
ORDER BY v.updated_at ASC
LIMIT 100;
```

### Query 4: Repair Failures (Needs Attention)

Vehicles where the last repair attempt failed with error messages.

```sql
SELECT 
  v.id,
  v.year, v.make, v.model,
  v.listing_url,
  (v.origin_metadata->'bat_repair'->>'last_attempt_at')::timestamp as last_attempt,
  (v.origin_metadata->'bat_repair'->>'last_error')::text as error_message
FROM vehicles v
WHERE 
  v.origin_metadata->'bat_repair'->>'last_ok' = 'false'
  AND (v.origin_metadata->'bat_repair'->>'last_error')::text IS NOT NULL
ORDER BY (v.origin_metadata->'bat_repair'->>'last_attempt_at')::timestamp DESC
LIMIT 50;
```

### Query 5: Image Ordering Status

Check if images have position fields set correctly.

```sql
SELECT 
  v.id,
  COUNT(vi.id) as total_images,
  COUNT(vi.position) as positioned_images,
  COUNT(vi.id) - COUNT(vi.position) as unpositioned_images,
  CASE 
    WHEN COUNT(vi.id) = 0 THEN 'no_images'
    WHEN COUNT(vi.position) = COUNT(vi.id) THEN 'fully_positioned'
    WHEN COUNT(vi.position) > 0 THEN 'partially_positioned'
    ELSE 'not_positioned'
  END as positioning_status
FROM vehicles v
LEFT JOIN vehicle_images vi ON vi.vehicle_id = v.id
WHERE (v.profile_origin = 'bat_import' OR v.discovery_source = 'bat_import')
  AND EXISTS (SELECT 1 FROM vehicle_images vi2 WHERE vi2.vehicle_id = v.id)
GROUP BY v.id
ORDER BY unpositioned_images DESC
LIMIT 50;
```

### Query 6: Repair Activity Timeline

Shows repair attempts over time (useful for monitoring scheduled runs).

```sql
SELECT 
  DATE_TRUNC('hour', (v.origin_metadata->'bat_repair'->>'last_attempt_at')::timestamp) as repair_hour,
  COUNT(*) as vehicles_repaired,
  COUNT(*) FILTER (WHERE (v.origin_metadata->'bat_repair'->>'last_ok')::boolean = true) as successful,
  COUNT(*) FILTER (WHERE (v.origin_metadata->'bat_repair'->>'last_ok')::boolean = false) as failed,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE (v.origin_metadata->'bat_repair'->>'last_ok')::boolean = true) / 
    NULLIF(COUNT(*), 0),
    2
  ) as success_rate_pct
FROM vehicles v
WHERE 
  v.origin_metadata->'bat_repair'->>'last_attempt_at' IS NOT NULL
  AND (v.origin_metadata->'bat_repair'->>'last_attempt_at')::timestamp >= NOW() - INTERVAL '7 days'
GROUP BY DATE_TRUNC('hour', (v.origin_metadata->'bat_repair'->>'last_attempt_at')::timestamp)
ORDER BY repair_hour DESC;
```

---

## Admin UI Monitoring

**Location**: `/admin/mission-control`

When you manually trigger a repair run, the Admin UI shows:
- **Scanned**: Total vehicles scanned in this batch
- **Candidates**: Vehicles that met the "incomplete" criteria
- **Repaired**: Successfully repaired vehicles
- **Failed**: Failed repair attempts (with error details in console)

The results are also stored in `batRepairLastResult` state, viewable in browser DevTools.

---

## Interpreting Results

### Healthy System Indicators

✅ **Success Rate > 80%**: Most repairs succeed  
✅ **Image Ordering > 90% positioned**: Images are properly ordered  
✅ **Candidates decreasing over time**: Repair loop is catching up  
✅ **No repeated failures**: Errors are transient, not systematic  

### Warning Signs

⚠️ **Success Rate < 70%**: Check error messages in Query 4  
⚠️ **Many unpositioned images**: Backfill might not be running correctly  
⚠️ **Candidates increasing**: Repair loop may not be running or batch size too small  
⚠️ **Same errors repeating**: Underlying issue (e.g., BaT site changes, network issues)  

### Action Items Based on Results

**If success rate is low**:
1. Check Query 4 (Repair Failures) for common error patterns
2. Check BaT site availability / bot protection
3. Verify Edge Functions are deployed and accessible
4. Check Edge Function logs: `supabase functions logs bat-make-profiles-correct-runner`

**If candidates are increasing**:
1. Verify scheduled runs are executing (check GitHub Actions)
2. Consider increasing batch size (max 50)
3. Check rate limiting isn't too aggressive (6-hour cooldown)

**If images aren't positioning**:
1. Verify `backfill-images` function writes `position` field
2. Check Query 5 to see which vehicles are affected
3. Re-run backfill for specific vehicles if needed

---

## Integration with Other Monitoring

### GitHub Actions

Check scheduled run results:
1. Go to GitHub → Actions → "BaT Make Profiles Correct"
2. View most recent workflow run
3. Download artifact `bat-make-profiles-correct-result.json` for full details

### Supabase Edge Function Logs

```bash
# View recent logs
supabase functions logs bat-make-profiles-correct-runner --limit 100

# Follow logs in real-time
supabase functions logs bat-make-profiles-correct-runner --follow
```

### Database Performance

Monitor query performance if monitoring queries are slow:
```sql
-- Check if indexes are being used
EXPLAIN ANALYZE SELECT ... FROM vehicles WHERE origin_metadata->'bat_repair' IS NOT NULL;
```

---

## Troubleshooting

### "No vehicles found" in candidates query

- Check: Are there any BaT vehicles in the database?
- Check: Are vehicles old enough (`updated_at <= NOW() - 6 hours`)?
- Check: Do vehicles have BaT URLs in `listing_url`, `discovery_url`, or `bat_auction_url`?

### "All repairs failing" 

- Check: Are Edge Functions deployed?
- Check: Is `import-bat-listing` function working?
- Check: BaT site accessibility / bot protection
- Check: Service role key is valid

### "Images not positioning"

- Check: Is `backfill-images` function writing `position`?
- Check: Query 5 to see affected vehicles
- Check: `vehicle_images` table has `position` column (should be INTEGER)

---

## Next Steps

1. **Set up alerts**: Configure alerts for success rate < 70%
2. **Dashboards**: Create a Grafana/DataDog dashboard using these queries
3. **Automated reports**: Schedule daily email reports of Query 2 (Success Rate Summary)
4. **Performance tuning**: Monitor query execution times and add indexes if needed

