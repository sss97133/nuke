# BaT Extraction Scale Plan

## Target: Extract All BaT Vehicles

### Current State
- **Working system**: ✅ extract-premium-auction + extract-auction-comments
- **Proven on**: 5 vehicles (1 C10 + 4 new extractions)
- **Success rate**: 80% (4/5 succeeded, 1 failed)

### Capacity
- **Speed**: 45s/vehicle (30s core + 15s comments)
- **Max rate**: 80 vehicles/hour (with safety margin)
- **Daily capacity**: ~2,000 vehicles/day

---

## Execution Plan

### Step 1: Count Target Vehicles
```sql
SELECT COUNT(*) FROM vehicles 
WHERE discovery_url LIKE '%bringatrailer.com%'
  AND (vin IS NULL OR mileage IS NULL OR 
       (SELECT COUNT(*) FROM vehicle_images WHERE vehicle_id = vehicles.id) = 0);
```

### Step 2: Fix Queue Processor
Update `process-bat-extraction-queue` to call new functions (see LLM_INSTRUCTIONS_SIMPLE.md)

### Step 3: Queue All Vehicles
```sql
INSERT INTO bat_extraction_queue (vehicle_id, bat_auction_url, status, priority)
SELECT 
  id,
  discovery_url,
  'pending',
  CASE 
    WHEN vin IS NULL THEN 1  -- High priority: missing VIN
    WHEN mileage IS NULL THEN 2  -- Medium: missing mileage
    ELSE 3  -- Low: just re-extraction
  END
FROM vehicles
WHERE discovery_url LIKE '%bringatrailer.com%'
  AND id NOT IN (SELECT vehicle_id FROM bat_extraction_queue WHERE status = 'complete');
```

### Step 4: Run Queue Processor
```bash
# Manual trigger (for testing)
curl -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/process-bat-extraction-queue" \
  -H "Authorization: Bearer SERVICE_KEY" \
  -d '{"batchSize": 10}'
```

### Step 5: Automate with Cron
```sql
SELECT cron.schedule(
  'process-bat-queue',
  '*/5 * * * *',  -- Every 5 minutes
  $$
  SELECT net.http_post(
    url:='https://qkgaybvrernstplzjaam.supabase.co/functions/v1/process-bat-extraction-queue',
    headers:='{"Authorization": "Bearer SERVICE_KEY"}'::jsonb,
    body:='{"batchSize": 10}'::jsonb
  );
  $$
);
```

### Step 6: Monitor Progress
```sql
-- Queue status
SELECT status, COUNT(*) 
FROM bat_extraction_queue 
GROUP BY status;

-- Data completeness
SELECT 
  COUNT(*) as total,
  COUNT(CASE WHEN vin IS NOT NULL THEN 1 END) as have_vin,
  COUNT(CASE WHEN mileage IS NOT NULL THEN 1 END) as have_mileage,
  AVG((SELECT COUNT(*) FROM vehicle_images WHERE vehicle_id = vehicles.id)) as avg_images
FROM vehicles
WHERE discovery_url LIKE '%bringatrailer.com%';
```

---

## Timeline Estimates

| Vehicles | Time (serial) | Time (cron, batch=10) | Time (parallel, 5 workers) |
|----------|---------------|----------------------|---------------------------|
| 100 | 1.25 hours | 25 minutes | 15 minutes |
| 500 | 6.25 hours | 2 hours | 1.25 hours |
| 1,000 | 12.5 hours | 4 hours | 2.5 hours |
| 5,000 | 62.5 hours | 20 hours | 12.5 hours |

**Recommended**: Use cron with batch=10 for hands-off automation

---

## Risk Mitigation

1. **Rate Limiting**: Sleep 5s between extractions
2. **Failures**: Non-critical, can retry individually
3. **Costs**: Firecrawl API costs ~$0.01-0.02 per vehicle
4. **Timeouts**: Functions timeout at 150s; 45s average is safe

---

**Next Action**: Fix `process-bat-extraction-queue` then enable cron

