-- ============================================================
-- DATA QUALITY SCRUTINY INFRASTRUCTURE
-- 2026-02-26
--
-- 1. Fix vehicles.data_quality_score — compute from actual fields
-- 2. DB trigger to keep score current on writes
-- 3. source_quality_snapshots — per-source quality over time
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. DB FUNCTION: compute_vehicle_quality_score
-- Returns 0.0–1.0 based on field completeness and validity.
-- Weights: YMM identity (0.6), enrichment (0.3), price (0.1)
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION compute_vehicle_quality_score(v vehicles)
RETURNS DECIMAL(4,3) AS $$
DECLARE
  score DECIMAL(4,3) := 0;
  yr    INT;
BEGIN
  -- Identity: year (0.2)
  IF v.year IS NOT NULL THEN
    yr := v.year::INT;
    IF yr >= 1885 AND yr <= EXTRACT(YEAR FROM NOW())::INT + 2 THEN
      score := score + 0.20;
    END IF;
  END IF;

  -- Identity: make (0.20)
  IF v.make IS NOT NULL AND trim(v.make) <> '' AND length(trim(v.make)) <= 50 THEN
    score := score + 0.20;
  END IF;

  -- Identity: model (0.20) — penalise if stuffed with full title (>80 chars)
  IF v.model IS NOT NULL AND trim(v.model) <> '' THEN
    IF length(trim(v.model)) <= 80 THEN
      score := score + 0.20;
    ELSE
      score := score + 0.05; -- partial — data exists but is polluted
    END IF;
  END IF;

  -- Enrichment: VIN (0.10) — only for 1981+ vehicles
  IF v.vin IS NOT NULL AND trim(v.vin) <> '' THEN
    IF v.year IS NULL OR v.year < 1981 THEN
      score := score + 0.10; -- any chassis number is valuable for classics
    ELSIF length(trim(v.vin)) = 17 THEN
      score := score + 0.10;
    ELSE
      score := score + 0.02; -- VIN present but wrong length
    END IF;
  END IF;

  -- Enrichment: description (0.10)
  IF v.description IS NOT NULL AND length(trim(v.description)) > 30 THEN
    score := score + 0.10;
  END IF;

  -- Enrichment: mileage (0.05)
  IF v.mileage IS NOT NULL AND v.mileage >= 0 AND v.mileage < 2000000 THEN
    score := score + 0.05;
  END IF;

  -- Enrichment: images (0.05) — proxy via discovery_url being set
  IF v.listing_url IS NOT NULL AND trim(v.listing_url) <> '' THEN
    score := score + 0.05;
  END IF;

  -- Price: sale_price (0.10)
  IF v.sale_price IS NOT NULL AND v.sale_price >= 100 THEN
    score := score + 0.10;
  END IF;

  RETURN LEAST(1.000, GREATEST(0.000, score));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ────────────────────────────────────────────────────────────
-- 2. TRIGGER: keep data_quality_score current
-- Only fires on writes that change identity/enrichment fields
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_update_vehicle_quality_score()
RETURNS TRIGGER AS $$
BEGIN
  NEW.data_quality_score := compute_vehicle_quality_score(NEW);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_vehicle_quality_score ON vehicles;
CREATE TRIGGER trg_vehicle_quality_score
  BEFORE INSERT OR UPDATE OF year, make, model, vin, description, mileage, sale_price, listing_url
  ON vehicles
  FOR EACH ROW EXECUTE FUNCTION trg_update_vehicle_quality_score();

-- ────────────────────────────────────────────────────────────
-- 3. BACKFILL: populate existing records in batches
-- Run via: SELECT backfill_vehicle_quality_scores();
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION backfill_vehicle_quality_scores(batch_limit INT DEFAULT 50000)
RETURNS INT AS $$
DECLARE
  updated_count INT;
BEGIN
  UPDATE vehicles v
  SET data_quality_score = compute_vehicle_quality_score(v)
  WHERE v.id IN (
    SELECT id FROM vehicles
    WHERE data_quality_score IS NULL OR data_quality_score < 0.001
    LIMIT batch_limit
  );
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$ LANGUAGE plpgsql;

-- ────────────────────────────────────────────────────────────
-- 4. SOURCE QUALITY SNAPSHOTS TABLE
-- Written by data-quality-monitor edge function (cron)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS source_quality_snapshots (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source_name           TEXT NOT NULL,
  total_vehicles        INTEGER NOT NULL,
  ymm_coverage_pct      DECIMAL(5,2),   -- % with year+make+model
  vin_valid_pct         DECIMAL(5,2),   -- % with correctly formatted VIN
  price_valid_pct       DECIMAL(5,2),   -- % with sale_price >= 100
  avg_quality_score     DECIMAL(4,3),   -- avg data_quality_score (0-1)
  null_year_count       INTEGER,
  null_make_count       INTEGER,
  null_model_count      INTEGER,
  model_polluted_count  INTEGER,        -- model > 80 chars
  junk_price_count      INTEGER,        -- sale_price < 100 but not null
  bad_vin_count         INTEGER,        -- wrong length VIN on 1981+ vehicles
  quality_grade         CHAR(1),        -- A/B/C/D/F
  alerts                JSONB,          -- [{type, message, count}]
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_source_quality_snapshots_source_at
  ON source_quality_snapshots(source_name, snapshot_at DESC);

CREATE INDEX IF NOT EXISTS idx_source_quality_snapshots_at
  ON source_quality_snapshots(snapshot_at DESC);

-- ────────────────────────────────────────────────────────────
-- 5. QUICK QUALITY VIEW — current per-source quality at a glance
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW source_quality_current AS
SELECT
  discovery_source AS source,
  COUNT(*) AS total,
  ROUND(100.0 * COUNT(*) FILTER (WHERE year IS NOT NULL AND year >= 1885 AND year <= 2027
    AND make IS NOT NULL AND make <> ''
    AND model IS NOT NULL AND model <> '' AND length(model) <= 80) / COUNT(*), 1) AS ymm_pct,
  ROUND(100.0 * COUNT(*) FILTER (WHERE vin IS NOT NULL AND length(vin) = 17 AND year >= 1981)
    / NULLIF(COUNT(*) FILTER (WHERE year >= 1981), 0), 1) AS vin_valid_pct,
  ROUND(100.0 * COUNT(*) FILTER (WHERE sale_price IS NOT NULL AND sale_price >= 100) / COUNT(*), 1) AS price_pct,
  ROUND(AVG(data_quality_score)::NUMERIC, 3) AS avg_score,
  COUNT(*) FILTER (WHERE year IS NULL) AS null_year,
  COUNT(*) FILTER (WHERE make IS NULL OR make = '') AS null_make,
  COUNT(*) FILTER (WHERE model IS NULL OR model = '' OR length(model) > 80) AS null_or_bad_model,
  COUNT(*) FILTER (WHERE sale_price IS NOT NULL AND sale_price < 100) AS junk_price,
  COUNT(*) FILTER (WHERE vin IS NOT NULL AND length(vin) != 17 AND year >= 1981) AS bad_vin
FROM vehicles
WHERE status != 'deleted'
GROUP BY discovery_source
HAVING COUNT(*) > 50
ORDER BY total DESC;

COMMENT ON VIEW source_quality_current IS
  'Live per-source data quality metrics. Query this to spot degrading extractors.';
