# P07: Valuation Comp Method Audit & Recomputation

## Context
Read these before executing:
- `docs/library/intellectual/theoreticals/valuation-methodology.md` — the 6-multiplier valuation model
- `docs/library/intellectual/papers/trust-scoring-methodology.md` — source trust hierarchy, temporal decay
- `docs/library/intellectual/papers/market-intelligence-patterns.md` — presentation drives price, comments predict price, 4x4 premium
- `supabase/functions/compute-vehicle-valuation/index.ts` — the deployed valuation function (just fixed in P1)

## Problem
43,502 existing nuke_estimates are circular (`is_circular = true`) — the "estimate" is just the vehicle's own sale price reflected back. These estimates carry confidence scores and deal scores that are meaningless. They pollute every aggregate that includes them: org GMV comparisons, market trend charts, deal score distributions.

Additionally, the `comp_method` column was just added but only populated for circular estimates. The remaining 618K estimates have `comp_method = NULL`. We don't know how any estimate was derived.

The valuation methodology paper defines six multipliers, but the current `getBasePrice` function has an undocumented comp selection cascade. We need to audit what it actually does, document the comp methods, and recompute stale estimates.

## Scope
One audit script. One recomputation script. Documentation updates. No schema changes. No new functions.

## Steps

1. Audit the existing comp method distribution:
```sql
-- What comp methods are being used?
SELECT comp_method, is_circular, count(*),
       avg(confidence_score) as avg_confidence,
       avg(estimated_value) as avg_value
FROM nuke_estimates
GROUP BY comp_method, is_circular
ORDER BY count DESC;

-- How many estimates have the vehicle's own sale_price within 5%?
SELECT count(*) FROM nuke_estimates ne
JOIN vehicles v ON ne.vehicle_id = v.id
WHERE v.sale_price > 0
  AND ABS(ne.estimated_value - v.sale_price) / v.sale_price < 0.05;
```

2. Read the `getBasePrice` function in `compute-vehicle-valuation/index.ts` and document every comp selection path:
```bash
grep -A 30 "async function getBasePrice" supabase/functions/compute-vehicle-valuation/index.ts
```

Map each path to a `comp_method` value. Expected methods (from the code):
- `exact` — VIN or canonical match in comp tables
- `canonical` — make/model/year exact match
- `normalized` — make/model fuzzy match
- `core_model` — model-family level comps
- `make_fallback` — make-only level comps (wide, low confidence)
- `self_price_fallback` — vehicle's own price (NOW BLOCKED for sold vehicles)

3. Create `scripts/audit-valuation-quality.mjs`:
- For each comp_method, sample 20 estimates
- Compare estimate vs. actual sale_price (where known)
- Calculate MAE (mean absolute error) per method
- Report which methods are reliable and which produce garbage

4. Create `scripts/recompute-stale-estimates.mjs`:
- Select vehicles where `nuke_estimates.is_circular = true` OR `comp_method IS NULL`
- Batch 50 vehicles per call to `compute-vehicle-valuation` edge function
- Respect rate limits: `pg_sleep(1)` between batches
- Log: vehicle_id, old_value, new_value, old_method, new_method, confidence_delta

5. Track recomputation progress:
```sql
-- Before recomputation
SELECT
  count(*) as total,
  count(*) FILTER (WHERE comp_method IS NOT NULL) as has_method,
  count(*) FILTER (WHERE is_circular = true) as circular,
  avg(confidence_score) as avg_confidence
FROM nuke_estimates;

-- After each batch
SELECT comp_method, count(*), avg(confidence_score)
FROM nuke_estimates
WHERE comp_method IS NOT NULL
GROUP BY comp_method;
```

6. Add to package.json:
```json
"audit:valuation-quality": "dotenvx run -- node scripts/audit-valuation-quality.mjs",
"recompute:stale-estimates": "dotenvx run -- node scripts/recompute-stale-estimates.mjs"
```

## Verify
```sql
-- After recomputation: circular estimates should be nulled or updated
SELECT count(*) FROM nuke_estimates WHERE is_circular = true AND comp_method = 'self_price_fallback';
-- Should decrease (vehicles that now find comps get real estimates; vehicles without comps get NULL)

-- Confidence distribution should shift
SELECT
  CASE WHEN confidence_score >= 70 THEN 'high'
       WHEN confidence_score >= 40 THEN 'medium'
       ELSE 'low' END as tier,
  count(*)
FROM nuke_estimates
GROUP BY 1;

-- No new circular estimates
SELECT count(*) FROM nuke_estimates
WHERE comp_method = 'self_price_fallback'
  AND calculated_at > now() - interval '1 hour';
-- Should be 0 (blocked by P1 fix)
```

## Anti-Patterns
- Do NOT recompute all 660K estimates at once. Start with circular ones (43K). Then stale ones (no method). The rest can wait.
- Do NOT call the edge function faster than 50/min. It does 8 parallel signal lookups per vehicle.
- Do NOT delete circular estimates. Set `is_stale = true` and let recomputation replace them. If no comps exist, the estimate becomes NULL (which is honest).
- Do NOT change the multiplier weights. The methodology paper defines them. Any change requires a new model version.
- Do NOT report MAE as a single number. Break it by comp_method, price_tier, and vehicle segment.

## Library Contribution
After completing:
- Add comp method audit results to `docs/library/intellectual/studies/` as a new study
- Update `docs/library/reference/almanac/` with estimate accuracy statistics
- Update `docs/library/intellectual/theoreticals/valuation-methodology.md` — add Section "Empirical Validation" with MAE by method
