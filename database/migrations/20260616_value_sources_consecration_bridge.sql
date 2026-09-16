-- ============================================================
-- PHASE 1 KEYSTONE — BRIDGE THE TWO TRUST GRAPHS, VALUATION READS CONSECRATION
--
-- Doctrine: docs/library/intellectual/contemplations/habitus-and-the-exchange.md (Law 2)
--
-- vehicle_value_sources was a trust graph DISJOINT from observation_sources:
-- it stored source_type (text) but had no FK to the source registry, so the
-- valuation engine could never read consecration. This migration:
--   1a. Adds source_id FK (nullable) and backfills by slug match.
--   1b. Rewrites calculate_vehicle_value_from_sources() to RANK by consecration
--       (the field's licensed authority to confer worth), falling back to a
--       normalized source_type ladder only where source_id is unresolved.
--
-- The hardcoded type_priority CASE stops being doxa: it survives ONLY as the
-- fallback for un-bridged rows. Additive + idempotent.
-- ============================================================

-- 1a. Bridge --------------------------------------------------------------
ALTER TABLE vehicle_value_sources
  ADD COLUMN IF NOT EXISTS source_id UUID REFERENCES observation_sources(id);

UPDATE vehicle_value_sources vvs
SET source_id = os.id
FROM observation_sources os
WHERE vvs.source_id IS NULL
  AND lower(vvs.source_key) = lower(os.slug);

CREATE INDEX IF NOT EXISTS idx_vehicle_value_sources_source_id
  ON vehicle_value_sources(source_id);

COMMENT ON COLUMN vehicle_value_sources.source_id IS
  'FK to observation_sources — bridges the valuation trust graph to the source registry so valuation can read consecration. Doctrine: habitus-and-the-exchange.md Law 2.';

-- 1b. Valuation ranks by consecration ------------------------------------
CREATE OR REPLACE FUNCTION calculate_vehicle_value_from_sources(p_vehicle_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result jsonb;
  v_computed_value numeric;
  v_confidence numeric;
  v_method text;
  v_source_count integer;
BEGIN
  WITH source_data AS (
    SELECT
      vvs.source_key,
      vvs.source_type,
      vvs.value_amount,
      vvs.confidence,
      vvs.fetched_at,
      -- Consecration: the field's authority to CONFER worth. Read the registry
      -- when bridged; otherwise fall back to a normalized source_type ladder
      -- (the legacy doxa, now demoted to a fallback for un-bridged rows only).
      COALESCE(os.consecration, CASE vvs.source_type
        WHEN 'sale'           THEN 0.90  -- the hammer: the field's supreme consecratory act
        WHEN 'auction_result' THEN 0.85
        WHEN 'appraisal'      THEN 0.70
        WHEN 'valuation'      THEN 0.50
        WHEN 'listing'        THEN 0.25  -- a listing is an ASK, not a consecration
        ELSE 0.20
      END) AS consecration
    FROM vehicle_value_sources vvs
    LEFT JOIN observation_sources os ON os.id = vvs.source_id
    WHERE vvs.vehicle_id = p_vehicle_id
      AND vvs.value_amount IS NOT NULL
      AND vvs.value_amount > 0
    ORDER BY consecration DESC, vvs.confidence DESC, vvs.fetched_at DESC
  ),
  best_source AS (
    SELECT * FROM source_data LIMIT 1
  ),
  weighted_calc AS (
    SELECT
      SUM(value_amount * confidence) / NULLIF(SUM(confidence), 0) as weighted_avg,
      AVG(confidence) as avg_confidence,
      COUNT(*) as source_count
    FROM source_data
  )
  SELECT
    COALESCE(bs.value_amount, wc.weighted_avg),
    CASE
      WHEN bs.source_type IN ('sale', 'auction_result') THEN bs.confidence
      ELSE LEAST(0.95, wc.avg_confidence + (wc.source_count * 0.02))
    END,
    CASE
      WHEN bs.source_type = 'sale' THEN 'sale_record'
      WHEN bs.source_type = 'auction_result' THEN 'auction_result'
      WHEN wc.source_count > 1 THEN 'weighted_average'
      ELSE 'single_source'
    END,
    wc.source_count
  INTO v_computed_value, v_confidence, v_method, v_source_count
  FROM weighted_calc wc
  LEFT JOIN best_source bs ON true;

  IF v_computed_value IS NOT NULL AND v_computed_value > 0 THEN
    UPDATE vehicles
    SET
      computed_value = v_computed_value,
      value_confidence = v_confidence,
      value_method = v_method,
      value_source_count = v_source_count,
      value_enriched_at = NOW(),
      updated_at = NOW()
    WHERE id = p_vehicle_id;
  END IF;

  SELECT jsonb_build_object(
    'vehicle_id', p_vehicle_id,
    'computed_value', v_computed_value,
    'confidence', v_confidence,
    'method', v_method,
    'source_count', v_source_count,
    'calculated_at', NOW()
  ) INTO result;

  RETURN result;
END;
$$;
