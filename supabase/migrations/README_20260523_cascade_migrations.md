# Cascade Infrastructure Migrations — 2026-05-23

These 5 migrations together build the substrate for the worth-proving engine + butterfly cascade described in:
- `docs/library/working/working-papers/2026-05-23_worth-proving-engine-retrospective.md`
- `docs/library/reference/encyclopedia/05-image-as-butterfly-node.md`
- `docs/library/technical/engineering-manual/17-daily-receipt-processor.md`

## Migration order (must apply in this sequence)

1. **`20260523080000_compute_inferred_value_rpc.sql`** — the worth-proving engine's core function. Takes `(vehicle_id, date)`, returns `{value, confidence, methodology, comparables_used}`. Multi-factor equation: `labor_value = (minutes/60) × shop_rate × tier × quality × specialty + parts`. Confidence bounded by data density. Includes companion `compute_inferred_value_range()`.

2. **`20260523080100_technicians_table.sql`** — `technicians` + `technician_work_evidence` tables. Tier + hourly_rate are INFERRED from photo cascade, not claimed. Delta = worth-proof at person level.

3. **`20260523080200_equipment_and_depreciation.sql`** — `equipment` + `equipment_usage_evidence` + `consumables` tables. `equipment.current_value_computed` is a generated column from depreciation. Tools depreciate via photo evidence.

4. **`20260523080300_vehicle_market_estimates_timeseries.sql`** — `vehicle_market_estimates` table + `latest_market_estimate()` + `market_value_delta()` functions. Vehicle value becomes a time series, not a stored scalar. Enables enablement_value computation in build-day.mjs.

5. **`20260523080400_shop_overheads.sql`** — `shop_overheads` line-item table + `shop_current_monthly_overhead()` + `shop_overhead_floor_per_hour()` functions. Decomposes labor rate into overhead floor + technician compensation.

## Deployment

When network to Supabase is reachable:

```bash
cd /Users/skylar/nuke
# Either via supabase CLI:
dotenvx run -- supabase db push

# Or via MCP one-by-one (apply_migration takes a name + query):
# Apply each in order. The compute_inferred_value RPC depends on no other migration.
# Subsequent table migrations are independent of each other.
```

After deployment, smoke test:

```bash
# Test the inferred-value RPC against a known day with data
dotenvx run -- bash -c 'curl -s "$VITE_SUPABASE_URL/rest/v1/rpc/compute_inferred_value" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"p_vehicle_id\":\"eeb9fa61-01e8-49a6-8eab-a7cc0e23d30f\",\"p_date\":\"2026-04-14\"}"' | jq

# Expected output shape:
# {
#   "vehicle_id": "eeb9fa61-...",
#   "vehicle": {"year": 1966, "make": "Ford", "model": "Mustang"},
#   "date": "2026-04-14",
#   "inferred_value": <number>,
#   "labor_value": <number>,
#   "parts_cost": 0,
#   "confidence": "low_n_under_3",  -- because there are only 3 BC orgs with labor_rate set
#   "methodology": { ... full breakdown ... }
# }
```

## What these migrations enable

| Question the user might ask | Without migrations | With migrations |
|---|---|---|
| "What was the Mustang worth on Apr 14 vs May 21?" | scalar `estimated_value` (likely null) | time-series `vehicle_market_estimates` with delta function |
| "What's my equivalent shop labor rate based on the work I do?" | not computable | `compute_inferred_value` returns inferred value per day, aggregate across days = inferred rate |
| "How much of my $85/hr is just covering rent?" | unknown | `shop_overhead_floor_per_hour(skylar_shop_id)` returns the floor |
| "Am I a master mechanic by evidence?" | claimed only | `technicians.tier_inferred` populated from `technician_work_evidence` accumulator |
| "When does my 10K-hour lift need replacing?" | unknown | `equipment.current_value_computed` depreciates live; status → 'broken' when value crosses $0 |
| "How does my rate compare to Boulder City shops?" | "no data" hallucinated | `compute_inferred_value` returns N comparables = N (currently 3); confidence: `low_n_under_3`; as more shop data arrives, confidence rises |

## What they do NOT do

- They do not populate themselves. Atoms must be written by the cascade-aware writer (still to build — see encyclopedia chapter 05, build-out item #2: "Multi-atom per-photo writer").
- They do not modify `vehicles.estimated_value`. That column should be deprecated; consumers should query `latest_market_estimate(vehicle_id)` instead.
- They do not break existing pipelines. `get_daily_work_receipt(vehicle_id, date)` continues to work unchanged. `compute_inferred_value` is additive.

## Rollback

Each migration is independent for rollback purposes. To roll back:

```sql
DROP FUNCTION IF EXISTS public.compute_inferred_value(UUID, DATE);
DROP FUNCTION IF EXISTS public.compute_inferred_value_range(UUID, DATE, DATE);
DROP TABLE IF EXISTS public.technician_work_evidence CASCADE;
DROP TABLE IF EXISTS public.technicians CASCADE;
DROP TABLE IF EXISTS public.equipment_usage_evidence CASCADE;
DROP TABLE IF EXISTS public.equipment CASCADE;
DROP TABLE IF EXISTS public.consumables CASCADE;
DROP TABLE IF EXISTS public.vehicle_market_estimates CASCADE;
DROP FUNCTION IF EXISTS public.latest_market_estimate(UUID);
DROP FUNCTION IF EXISTS public.market_value_delta(UUID, DATE, DATE);
DROP TABLE IF EXISTS public.shop_overheads CASCADE;
DROP FUNCTION IF EXISTS public.shop_current_monthly_overhead(UUID);
DROP FUNCTION IF EXISTS public.shop_overhead_floor_per_hour(UUID, NUMERIC);
```

## Next agent: what to do after deployment

1. Smoke-test `compute_inferred_value` with the Mustang (vehicle_id `eeb9fa61-01e8-49a6-8eab-a7cc0e23d30f`) on a populated day like 2026-04-14. Verify confidence reflects the actual `n_comparables` from `organizations`.

2. Backfill the Boulder City competitor shops from `/tmp/boulder_city_shops_enrichment_2026-05-23.md` into `organizations` rows. Use the cited data quality grade per row. This grows `n_comparables` from 3 → 15+ and tightens confidence.

3. Create Skylar's physical shop as an `organizations` row at 707 Yucca St, Boulder City, NV. Populate `has_lift=true`, `has_fabrication=true`, `bay_count`, `sq_footage` from his testimony.

4. Wire `build-day.mjs` to call `compute_inferred_value` instead of computing labor_value from CLI flags. The CLI flags become FALLBACKS for when the RPC returns insufficient confidence.

5. Begin populating `shop_overheads` for Skylar's shop — rent, insurance, license, utilities, internet. Each line item from a real bill/invoice (source_doc_url field for the substrate).

6. Build the multi-atom-per-photo writer (encyclopedia chapter 05, item #2). For each photo `process-photo.mjs` ingests, emit a cascade of atoms: vehicle_observation (already) + technician_work_evidence + equipment_usage_evidence + parts visible + etc.

The substrate for the worth-proof becomes self-populating. The user's worth becomes computable. The snake-tail loop closes.
