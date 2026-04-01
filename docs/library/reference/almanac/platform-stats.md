# ALMANAC: Platform Statistics

**Snapshot date:** 2026-03-30 (sprint W1 close)
**Methodology:** Direct database queries against production (`pg_stat_user_tables` for estimates, exact counts for core tables)
**Previous snapshot:** 2026-03-29 (evening)

---

## Core Entity Counts

| Entity | Count | Method | Change vs evening |
|--------|------:|--------|-------------------|
| Vehicles (all rows) | 828,790 | exact count | +411 |
| Vehicles (public, `is_public=true`) | 504,746 | exact count | +410 |
| Vehicle images | ~36,552,245 | `pg_stat_user_tables` | +281K |
| Vehicle observations | 5,841,887 | exact count | +174K |
| Field evidence rows | 3,290,472 | exact count | NEW (sprint W1) |
| Auction comments | ~12,904,273 | `pg_stat_user_tables` | +132K |
| Timeline events | 992,567 | `pg_stat_user_tables` | +5.3K |
| ARS scored vehicles | 324,063 | exact count | NEW (sprint W1) |
| Comment discoveries | 132,801 | `pg_stat_user_tables` | +6.4K |
| Description discoveries | 31,394 | `pg_stat_user_tables` | steady |
| Listing page snapshots | ~527,445 | `pg_stat_user_tables` | +13.2K |

---

## Data Density (All Vehicles)

12 fields measured: mileage, engine_type, transmission, drivetrain, body_style, vin, color, interior_color, fuel_type, sale_price, description, location.

| Density | Count | % of All | Definition | Change |
|---------|------:|---------|------------|--------|
| Sparse (0-4 fields) | 514,909 | 62.1% | Skeleton records — identity only | -1.1pp |
| Moderate (5-9 fields) | 127,753 | 15.4% | Partial spec coverage | +1.0pp |
| Dense (10-12 fields) | 186,128 | 22.5% | Near-complete specification | +0.2pp |

**Interpretation:** Roughly 1 in 5 vehicles has dense field coverage. The moderate tier grew by 1pp this sprint as ClassicCars.com enrichment and provenance backfill added partial spec data to previously sparse records. The sparse majority reflects bulk-imported records (ConceptCarz archived, Mecum without descriptions, FB Marketplace stubs) that have identity but little spec data. The enrichment pipeline targets this gap.

---

## Data Completeness (Public Vehicles)

Based on exact query against `vehicles WHERE is_public = true` (504,746 total):

| Field | Count | % Coverage | Gap | Sprint delta |
|-------|------:|----------:|-----|-------------|
| Description (`IS NOT NULL`) | 286,136 | 56.7% | 218,610 missing | +2.5pp |
| Sale price (`IS NOT NULL`) | 309,689 | 61.4% | 195,057 missing | +2.5pp |
| VIN (length >= 11) | 203,158 | 40.2% | 301,588 missing | +1.1pp |
| Nuke estimate (`IS NOT NULL`) | 305,851 | 60.6% | 198,895 missing | +4.6pp |

### Coverage Trajectory

| Metric | 2026-03-20 | 2026-03-29 | 2026-03-30 (W1 close) | Direction |
|--------|----------:|----------:|----------:|-----------|
| Vehicle count (public) | ~304,754 | 504,336 | 504,746 | Stable post-quarantine |
| Description coverage | ~91% of 292K | 54.2% | 56.7% | Climbing (+2.5pp this sprint) |
| VIN coverage | ~76% of 292K | 39.1% | 40.2% | Climbing (+1.1pp this sprint) |
| Price coverage | -- | 58.9% | 61.4% | Climbing (+2.5pp this sprint) |
| Valuation coverage | -- | ~56% | 60.6% | Climbing (+4.6pp this sprint) |

### ConceptCarz Quarantine (2026-03-29)

On 2026-03-29, **273,794 ConceptCarz records without VINs** (length < 11) were quarantined:
- Set `is_public = false`, `status = 'archived'`
- Cleared all `nuke_estimate`, `heat_score`, `nuke_estimate_confidence` values (244K tainted estimates from fabricated prices)
- **11,955 ConceptCarz records with real VINs remain public** as legitimate vehicles
- The quarantined records are preserved as reference data about ConceptCarz as an entity but excluded from the main corpus, search results, and all metric calculations
- All coverage percentages improved dramatically because the denominator shrank by ~231K records that were polluting metrics without contributing real data

---

## Platform Source Breakdown (Public Vehicles)

*Post-quarantine (2026-03-29). ConceptCarz dropped from 237K to 12K after VIN-less records archived.*

| Platform Source | Count | % of Public | Category |
|----------------|------:|----------:|----------|
| Bring a Trailer | 163,541 | 32.4% | Auction |
| Mecum | 76,326 | 15.1% | Auction |
| Classic Driver | 50,528 | 10.0% | Marketplace |
| Facebook Marketplace | 36,538 | 7.2% | Marketplace |
| ClassicCars.com | 34,627 | 6.9% | Marketplace |
| Cars & Bids | 34,036 | 6.7% | Auction |
| Unknown | 27,015 | 5.4% | Unattributed |
| ConceptCarz | 11,955 | 2.4% | Registry (VIN-bearing only) |
| Barrett-Jackson | 10,664 | 2.1% | Auction |
| User Submission | 9,206 | 1.8% | Direct |
| Bonhams | 9,197 | 1.8% | Auction |
| Craigslist | 8,359 | 1.7% | Marketplace |
| Gooding | 7,824 | 1.6% | Auction |
| PCarMarket | 5,546 | 1.1% | Auction |
| The Market (Bonhams) | 5,154 | 1.0% | Auction |

**Top 3 sources (BaT + Mecum + Classic Driver) account for 57.5% of all public vehicles.**

---

## Pipeline Activity (2026-03-30, sprint W1 close)

| Metric | Value | Sprint delta |
|--------|-------|-------------|
| Comment discoveries (AI-analyzed comments) | 132,801 | +6.4K |
| Description discoveries (AI-extracted fields) | 31,394 | steady |
| Vehicle observations (unified event store) | 5,841,887 | +174K |
| Observation sources (registered) | 160 | steady |
| Field evidence rows | 3,290,472 | NEW (sprint W1) |
| Vehicles with field evidence | 370,465 (44.7%) | NEW (sprint W1) |
| Avg evidence per vehicle (all) | 3.97 fields | NEW (was 0.21 pre-sprint, 19x) |
| Avg evidence per covered vehicle | 8.9 fields | NEW (sprint W1) |
| ARS scored vehicles | 324,063 (39.1% of all, 64.2% of public) | NEW (sprint W1) |
| ARS average composite score | 24.0 / 100 | NEW (sprint W1) |
| ARS user vehicles | 100% scored | NEW (K10: 69, K2500: 71) |
| Timeline events (lifecycle events) | 992,567 | +5.3K |
| Vehicle location observations (geocoded) | ~358,947 | steady |
| VLOs at city/gps/address precision | ~340,722 (94.9%) | steady |
| Counties with data | 2,174 | steady |

---

## Data Quality Indicators

| Indicator | Value | Health | Sprint delta |
|-----------|-------|--------|-------------|
| Public vehicles with description | 56.7% | Moderate | +2.5pp |
| Public vehicles with sale price | 61.4% | Moderate | +2.5pp |
| Public vehicles with VIN (11+ chars) | 40.2% | Sparse | +1.1pp |
| Public vehicles with nuke_estimate | 60.6% | Moderate | +4.6pp |
| Field evidence vehicle coverage | 44.7% | Moderate | NEW |
| Unknown platform_source | ~5.4% (27K) | Improved from ~30% | steady |
| Dense field coverage (10+/12 fields) | 22.5% | Moderate (all vehicles) | +0.2pp |

---

## Per-Source Enrichment Results (Sprint W1)

Sprint W1 ran targeted enrichment against two major sources. Description coverage measured as `description IS NOT NULL AND length > 50`.

| Source | Vehicle Count | Desc Coverage Pre | Desc Coverage Post | Delta |
|--------|-------------:|------------------:|-------------------:|-------|
| ClassicCars.com | 35,266 | ~0.5% | 23.8% | +23.3pp |
| Classic Driver | 50,521 | ~0.2% | 5.0% | +4.8pp |

ClassicCars.com enrichment is still in progress (target 34.7K). Classic Driver enrichment is complete.

---

## Infrastructure Stats

| Metric | Value | Sprint delta |
|--------|-------|-------------|
| Edge functions (on disk) | 298 | Down from 403 at sprint start |
| Database tables | 716 (113 empty) | Down from ~1,013 (483 empty) |
| Active cron jobs | 131 | steady |
| Database size | 89 GB | Down from ~156 GB (quarantine + cleanup) |

---

## How to Refresh This Snapshot

```sql
-- Core vehicle stats
SELECT
  count(*) as total_vehicles,
  count(*) FILTER (WHERE description IS NOT NULL) as with_description,
  count(*) FILTER (WHERE sale_price IS NOT NULL) as with_price,
  count(*) FILTER (WHERE vin IS NOT NULL AND length(vin) >= 11) as with_vin,
  count(*) FILTER (WHERE nuke_estimate IS NOT NULL) as with_estimate
FROM vehicles WHERE is_public = true;

-- Platform breakdown
SELECT platform_source, count(*)
FROM vehicles WHERE is_public = true AND platform_source IS NOT NULL
GROUP BY 1 ORDER BY 2 DESC;

-- Row estimates for large tables (fast, no seq scan)
SELECT relname, n_live_tup
FROM pg_stat_user_tables
WHERE schemaname = 'public'
AND relname IN ('vehicle_images', 'auction_comments', 'listing_page_snapshots', 'vehicle_observations', 'vehicles')
ORDER BY n_live_tup DESC;

-- Exact counts for key tables
SELECT count(*) FROM comment_discoveries;
SELECT count(*) FROM description_discoveries;
SELECT count(*) FROM vehicle_observations;
SELECT count(*) FROM timeline_events;

-- Data density (12 spec fields)
WITH field_counts AS (
  SELECT id,
    (CASE WHEN mileage IS NOT NULL THEN 1 ELSE 0 END +
     CASE WHEN engine_type IS NOT NULL AND engine_type != '' THEN 1 ELSE 0 END +
     CASE WHEN transmission IS NOT NULL AND transmission != '' THEN 1 ELSE 0 END +
     CASE WHEN drivetrain IS NOT NULL AND drivetrain != '' THEN 1 ELSE 0 END +
     CASE WHEN body_style IS NOT NULL AND body_style != '' THEN 1 ELSE 0 END +
     CASE WHEN vin IS NOT NULL AND vin != '' THEN 1 ELSE 0 END +
     CASE WHEN color IS NOT NULL AND color != '' THEN 1 ELSE 0 END +
     CASE WHEN interior_color IS NOT NULL AND interior_color != '' THEN 1 ELSE 0 END +
     CASE WHEN fuel_type IS NOT NULL AND fuel_type != '' THEN 1 ELSE 0 END +
     CASE WHEN sale_price IS NOT NULL THEN 1 ELSE 0 END +
     CASE WHEN description IS NOT NULL AND description != '' THEN 1 ELSE 0 END +
     CASE WHEN location IS NOT NULL AND location != '' THEN 1 ELSE 0 END) as filled
  FROM vehicles
)
SELECT
  CASE WHEN filled < 5 THEN 'sparse' WHEN filled BETWEEN 5 AND 9 THEN 'moderate' ELSE 'dense' END as density,
  count(*) as cnt,
  round(count(*)::numeric / (SELECT count(*) FROM vehicles) * 100, 1) as pct
FROM field_counts GROUP BY 1 ORDER BY 1;
```
