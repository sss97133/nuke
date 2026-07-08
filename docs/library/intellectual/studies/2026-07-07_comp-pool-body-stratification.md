# Comp Pool Body-Style Pollution — Finding and Fix

**Status**: Empirically validated, fix deployed 2026-07-07
**Author**: Nuke Research
**Dependencies**: valuation-methodology.md (Part II §2.2 Stage 2 similarity)
**Change**: `compute-vehicle-valuation` — Stage-2-lite similarity (body stratification + year proximity)

## Finding

The v1 comp engine matched comps on `make + model ilike + year ±5` with no body-style
dimension. For models sold in multiple bodies at very different money (first-gen Mustang,
C2/C3 Corvette, early Camaro), the pool blends across bodies and the weighted median
lands on nobody's market.

Measured on the 1966 Mustang coupe (VIN 6F07C219593), 2026-07-07:

| Pool | n | Median |
|---|---|---|
| All first-gen Mustangs (engine's v1 pool) | 7,040 | $42,120 |
| Coupe-only slice | 1,311 | $24,200 |
| Coupe-only, consummated sales | 1,253 | $24,250 |
| Live BaT '66 coupes, trailing 12 mo (fresh scrape) | 48 sold | $18,500 |

The v1 estimate ($45,454, confidence 93) was the polluted-pool median. 34% of the pool
was explicitly fastback/convertible/Shelby by model string alone. The same defect cuts
both ways: '67 fastbacks were estimated at $34-47K (dragged down by coupes) and now
price at $66-67K against their own body class.

## Fix (Stage-2-lite, per the valuation paper)

In `getBasePrice`, after each comp-tier fetch:
- Subject body class from `canonical_body_style` → `body_style`/`model`/`trim` tokens.
- Comps enriched with body class (batched `vehicles` lookup + model-token fallback).
- Hard mismatch → comp dropped. Unknown body → kept at 0.5 weight. Match → 1.0.
- Year proximity weights per the paper (±1 → 0.8, ±2 → 0.5, ±5 → 0.2) applied in
  `recencyWeightedMedian` alongside recency and consecration weights.
- Thin-market guard: if stratification leaves <3 comps, fall back unstratified (§2.5).
- `comp_method` gains a `_bodied` suffix when stratification held, so estimates are
  auditable for which path priced them.

Result on the subject: $25,974 ($22.9K–$29.1K, conf 84, `canonical_bodied`, 85 comps).
Sits above the stock-coupe live median because the pool retains documented builds —
consistent with the class-aware anchor doctrine (comps don't price builds).

## Open (not fixed tonight)

1. **Fleet staleness**: every pre-2026-07-07 estimate for multi-body models was computed
   on polluted pools. Needs a targeted re-mark-stale + burndown pass (valuation-driver
   does ~645/hr; full fleet is days of churn — decide scope before firing).
2. **Comp freshness**: `clean_vehicle_prices` reads `vehicles` only. The 10.6K fresh
   `bat_listings` rows (2026-07-07 keep-fresh backfill) don't flow as comps until they
   materialize as vehicles (bat-url-parse path) or the view unions `bat_listings`.
3. **Trim/engine similarity** (paper weights 0.15/0.12): GT/K-code vs C-code still
   blends within a body class. Next similarity dimension if estimates still read hot.
