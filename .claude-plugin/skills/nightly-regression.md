# /nuke-ops:nightly-regression

Nightly regression scan. Tests extraction quality, data integrity, and pipeline correctness against known baselines.

## Instructions

### 1. Known Vehicle Baselines

Test extraction against 3 vehicles with known-good data:

```sql
-- Pick 3 well-populated vehicles across different sources
SELECT id, year, make, model, source_platform, sale_price, vin,
  (SELECT count(*) FROM vehicle_images WHERE vehicle_id = v.id) as image_count,
  (SELECT count(*) FROM vehicle_events WHERE vehicle_id = v.id) as event_count
FROM vehicles v
WHERE status = 'active'
  AND sale_price IS NOT NULL
  AND vin IS NOT NULL
  AND year IS NOT NULL
ORDER BY
  (SELECT count(*) FROM vehicle_images WHERE vehicle_id = v.id) DESC
LIMIT 3;
```

For each: verify all critical fields are still populated (no null regression).

### 2. Data Integrity Checks

```sql
-- Orphaned images (vehicle_id points to deleted/nonexistent vehicle)
SELECT count(*) as orphaned_images
FROM vehicle_images vi
LEFT JOIN vehicles v ON v.id = vi.vehicle_id
WHERE v.id IS NULL;

-- Events without vehicles
SELECT count(*) as orphaned_events
FROM vehicle_events ve
LEFT JOIN vehicles v ON v.id = ve.vehicle_id
WHERE v.id IS NULL;

-- Vehicles with year outside valid range
SELECT count(*) as bad_years
FROM vehicles
WHERE year IS NOT NULL AND (year < 1885 OR year > 2027);

-- Duplicate VINs among active vehicles
SELECT vin, count(*) as dupes
FROM vehicles
WHERE status = 'active' AND vin IS NOT NULL AND length(vin) = 17
GROUP BY vin HAVING count(*) > 1
ORDER BY count DESC LIMIT 10;
```

### 3. Extraction Quality Drift

```sql
-- Compare field fill rates vs 7 days ago
-- Current fill rates
SELECT
  count(*) as total,
  round(100.0 * count(year) / count(*), 1) as pct_year,
  round(100.0 * count(make) / count(*), 1) as pct_make,
  round(100.0 * count(model) / count(*), 1) as pct_model,
  round(100.0 * count(vin) / count(*), 1) as pct_vin,
  round(100.0 * count(sale_price) / count(*), 1) as pct_price,
  round(100.0 * count(primary_image_url) / count(*), 1) as pct_image
FROM vehicles WHERE status = 'active';
```

### 4. Pipeline Flow Check

```sql
-- Are new vehicles still flowing in?
SELECT date_trunc('day', created_at) as day, count(*)
FROM vehicles
WHERE created_at > now() - interval '7 days'
GROUP BY 1 ORDER BY 1;

-- Are extractions still completing?
SELECT date_trunc('day', updated_at) as day, status, count(*)
FROM import_queue
WHERE updated_at > now() - interval '7 days'
GROUP BY 1, 2 ORDER BY 1, 2;
```

### 5. Report

```
## Nightly Regression — [date]

### Baseline Vehicles: PASS/FAIL
- Vehicle 1 [year make model]: all fields intact / [field] regressed to NULL
- Vehicle 2: ...
- Vehicle 3: ...

### Data Integrity
- Orphaned images: X (threshold: <100)
- Orphaned events: X (threshold: <50)
- Bad years: X (threshold: 0)
- Duplicate VINs: X (threshold: <5)

### Quality Drift (vs last week)
- Year fill: X% (delta: +/-Y%)
- Make fill: X%
- VIN fill: X%
- Price fill: X%

### Pipeline Flow
- New vehicles (7d): X (expected: >0)
- Completed extractions (7d): X

### Overall: GREEN / YELLOW / RED
```

Write to `.claude/NIGHTLY_REGRESSION.md` and append summary to HANDOFF.md.
