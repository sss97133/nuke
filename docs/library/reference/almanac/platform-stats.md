# ALMANAC: Platform Statistics

**Snapshot date:** 2026-03-29 (evening)
**Methodology:** Direct database queries against production (`pg_stat_user_tables` for estimates, exact counts for core tables)
**Previous snapshot:** 2026-03-29 (morning)

---

## Core Entity Counts

| Entity | Count | Method | Change vs morning |
|--------|------:|--------|-------------------|
| Vehicles (all rows) | 828,379 | exact count | +1,778 |
| Vehicles (public, `is_public=true`) | 504,336 | exact count | +56 |
| Vehicle images | ~36,271,576 | `pg_stat_user_tables` | +296K |
| Vehicle observations | 5,668,076 | exact count | +357K |
| Auction comments | ~12,772,719 | `pg_stat_user_tables` | +159K |
| Timeline events | 987,249 | exact count | NEW |
| Comment discoveries | 126,408 | exact count | NEW |
| Description discoveries | 31,394 | exact count | NEW |
| Listing page snapshots | ~514,295 | `pg_stat_user_tables` | +8.7K |

---

## Data Density (All Vehicles)

12 fields measured: mileage, engine_type, transmission, drivetrain, body_style, vin, color, interior_color, fuel_type, sale_price, description, location.

| Density | Count | % of All | Definition |
|---------|------:|---------|------------|
| Sparse (0-4 fields) | 523,902 | 63.2% | Skeleton records — identity only |
| Moderate (5-9 fields) | 119,447 | 14.4% | Partial spec coverage |
| Dense (10-12 fields) | 185,031 | 22.3% | Near-complete specification |

**Interpretation:** Roughly 1 in 5 vehicles has dense field coverage. The sparse majority reflects bulk-imported records (ConceptCarz archived, Mecum without descriptions, FB Marketplace stubs) that have identity but little spec data. The enrichment pipeline targets this gap.

---

## Data Completeness (Public Vehicles)

Based on exact query against `vehicles WHERE is_public = true` (504,336 total):

| Field | Count | % Coverage | Gap |
|-------|------:|----------:|-----|
| Description (`IS NOT NULL`) | 273,327 | 54.2% | 231,009 missing |
| Sale price (`IS NOT NULL`) | 297,245 | 58.9% | 207,091 missing |
| VIN (length >= 11) | 197,095 | 39.1% | 307,241 missing |
| Nuke estimate (`IS NOT NULL`) | ~282K (est.) | ~56% | Post-quarantine |

### Coverage Trajectory

| Metric | 2026-03-20 | 2026-03-28 | 2026-03-29 | Direction |
|--------|----------:|----------:|----------:|-----------|
| Vehicle count (public) | ~304,754 | 735,124 | 504,336 | Quarantine removed dead weight |
| Description coverage | ~91% of 292K | 37.2% of 735K | 54.2% of 504K | Recovery (quarantine) |
| VIN coverage | ~76% of 292K | 26.6% of 735K | 39.1% of 504K | Recovery (quarantine) |
| Price coverage | -- | 41.5% | 58.9% | Recovery (quarantine) |

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

## Pipeline Activity (2026-03-29)

| Metric | Value |
|--------|-------|
| Comment discoveries (AI-analyzed comments) | 126,408 |
| Description discoveries (AI-extracted fields) | 31,394 |
| Vehicle observations (unified event store) | 5,668,076 |
| Timeline events (lifecycle events) | 987,249 |
| Vehicle location observations (geocoded) | ~358,947 |
| VLOs at city/gps/address precision | ~340,722 (94.9%) |
| Counties with data | 2,174 |

---

## Data Quality Indicators

| Indicator | Value | Health |
|-----------|-------|--------|
| Public vehicles with description | 54.2% | Moderate (post-quarantine) |
| Public vehicles with sale price | 58.9% | Moderate (post-quarantine) |
| Public vehicles with VIN (11+ chars) | 39.1% | Sparse (post-quarantine) |
| Public vehicles with nuke_estimate | ~56% | Moderate (244K tainted estimates cleared) |
| Unknown platform_source | ~5.4% (27K) | Improved from ~30% (quarantine removed bulk) |
| Dense field coverage (10+/12 fields) | 22.3% | Moderate (all vehicles) |

---

## Infrastructure Stats

| Metric | Value |
|--------|-------|
| Edge functions (active) | ~50 (down from 464 pre-triage) |
| Database tables | ~1,013 (483 empty) |
| Active cron jobs | ~25 |
| Migrations applied | 810+ |
| Database size | ~156 GB |

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
