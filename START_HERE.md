# START HERE - For Any LLM

## Extract ONE BaT Vehicle

```bash
./scripts/extract-bat-vehicle.sh "https://bringatrailer.com/listing/1969-chevrolet-c10-pickup-193/"
```

## Extract MANY BaT Vehicles

```bash
# Edit this list, then run
URLS=(
  "https://bringatrailer.com/listing/url-1/"
  "https://bringatrailer.com/listing/url-2/"
  "https://bringatrailer.com/listing/url-3/"
)

for URL in "${URLS[@]}"; do
  ./scripts/extract-bat-vehicle.sh "$URL"
  sleep 5
done
```

## Verify It Worked

```sql
SELECT v.vin, v.mileage, v.color,
  (SELECT COUNT(*) FROM vehicle_images WHERE vehicle_id = v.id) as imgs,
  (SELECT COUNT(*) FROM auction_comments WHERE vehicle_id = v.id) as comments
FROM vehicles v 
WHERE v.discovery_url = 'YOUR_BAT_URL';
```

Expect: VIN, mileage, color, imgs > 0, comments > 0

## Scale to 1000s of Vehicles

1. **Queue processor**: ✅ FIXED - Now uses `extract-premium-auction` + `extract-auction-comments`

2. **Queue all vehicles**:
   ```sql
   INSERT INTO bat_extraction_queue (vehicle_id, bat_auction_url, status)
   SELECT id, discovery_url, 'pending'
   FROM vehicles
   WHERE discovery_url LIKE '%bringatrailer.com%';
   ```

3. **Enable cron** (processes 10 every 5 minutes):
   ```sql
   SELECT cron.schedule(
     'process-bat-queue', '*/5 * * * *',
     $$SELECT net.http_post(
       url:='https://qkgaybvrernstplzjaam.supabase.co/functions/v1/process-bat-extraction-queue',
       headers:='{"Authorization": "Bearer SERVICE_KEY"}'::jsonb,
       body:='{"batchSize": 10}'::jsonb
     );$$
   );
   ```

**Result**: 2,000+ vehicles/day automated

## Documentation

- `docs/LLM_INSTRUCTIONS_SIMPLE.md` - Simple instructions
- `docs/SCALE_PLAN.md` - Scale plan
- `docs/architecture/BAT_EXTRACTION_SYSTEM_LOCKED.md` - Full system spec
- `docs/architecture/FUNCTION_RETIREMENT_PLAN.md` - What to delete

## Don't Use These (They're Broken)

- `bat-extract-complete-v2`
- `bat-extract-complete-v3`
- `comprehensive-bat-extraction`
- `bat-simple-extract`

## Use These (They Work)

- `extract-premium-auction`
- `extract-auction-comments`
- OR: `./scripts/extract-bat-vehicle.sh`

---

**TL;DR**: Run the script. Check with SQL. Scale with queue + cron. Don't use old functions.

