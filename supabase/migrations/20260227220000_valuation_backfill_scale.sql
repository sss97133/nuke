-- ============================================================================
-- MIGRATION: valuation_backfill_scale
-- Goal: Lift valuation coverage from 44% → 70%+
--       489,957 viable vehicles have year+make+model+sale_price but no nuke_estimate
--
-- Strategy:
--   - Current job 314 runs every 10 min with batch_size=50 → ~300/hr → 68 days to clear
--   - Replace with 5 sharded workers running every 2 min with batch_size=100
--   - Sharding by HASHTEXT(id) ensures no duplicate work across workers
--   - Quality-sorted: best data_quality_score vehicles get valuated first
--   - Expected throughput: 5 workers × 100 vehicles × 30/hr = 15,000/hr → ~33h to clear
-- ============================================================================

-- ============================================================================
-- 1. SHARDED QUALITY-SORTED BACKFILL FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION run_valuation_batch_by_quality(
  p_shard_id    INT DEFAULT 0,
  p_total_shards INT DEFAULT 5,
  p_batch_size  INT DEFAULT 100
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_vehicle_ids JSONB;
BEGIN
  -- Select candidates ordered by data_quality_score DESC
  -- Filtered to this worker's shard to prevent duplicate work across workers
  SELECT jsonb_agg(id) INTO v_vehicle_ids
  FROM (
    SELECT id
    FROM vehicles
    WHERE status = 'active'
      AND year IS NOT NULL
      AND make IS NOT NULL
      AND nuke_estimate IS NULL
      AND (ABS(HASHTEXT(id::text)) % p_total_shards) = p_shard_id
    ORDER BY COALESCE(data_quality_score, 0) DESC, id ASC
    LIMIT p_batch_size
  ) q;

  -- Nothing left in this shard — no-op
  IF v_vehicle_ids IS NULL THEN
    RETURN;
  END IF;

  -- Fire async HTTP request to the valuation edge function
  PERFORM net.http_post(
    url     := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/compute-vehicle-valuation',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || get_service_role_key_for_cron()
    ),
    body    := jsonb_build_object('vehicle_ids', v_vehicle_ids)
  );
END;
$$;

-- ============================================================================
-- 2. REPLACE OLD SLOW JOB 314 WITH NEW SHARDED WORKERS
-- ============================================================================

-- Remove the old 10-min batch_size=50 job
SELECT cron.unschedule('compute-vehicle-valuation-backfill');

-- 5 parallel workers, every 2 minutes, each owns a distinct shard
-- Shard 0 — fires at :00, :02, :04 ...
SELECT cron.schedule(
  'valuation-backfill-worker-0',
  '*/2 * * * *',
  $$SELECT run_valuation_batch_by_quality(0, 5, 100)$$
);

-- Shard 1 — fires at :00, :02, :04 ... (same schedule, different shard → no overlap)
SELECT cron.schedule(
  'valuation-backfill-worker-1',
  '*/2 * * * *',
  $$SELECT run_valuation_batch_by_quality(1, 5, 100)$$
);

-- Shard 2
SELECT cron.schedule(
  'valuation-backfill-worker-2',
  '*/2 * * * *',
  $$SELECT run_valuation_batch_by_quality(2, 5, 100)$$
);

-- Shard 3
SELECT cron.schedule(
  'valuation-backfill-worker-3',
  '*/2 * * * *',
  $$SELECT run_valuation_batch_by_quality(3, 5, 100)$$
);

-- Shard 4
SELECT cron.schedule(
  'valuation-backfill-worker-4',
  '*/2 * * * *',
  $$SELECT run_valuation_batch_by_quality(4, 5, 100)$$
);

-- ============================================================================
-- 3. VALIDATION VIEW — compare nuke_estimate vs actual sale_price
-- ============================================================================

-- This view lets us spot-check accuracy at any time:
-- SELECT * FROM v_valuation_accuracy LIMIT 20;
CREATE OR REPLACE VIEW v_valuation_accuracy AS
SELECT
  v.id,
  v.year,
  v.make,
  v.model,
  v.sale_price,
  v.nuke_estimate,
  v.nuke_estimate_confidence,
  ROUND(v.nuke_estimate - v.sale_price, 0)                     AS estimate_vs_sale,
  ROUND((v.nuke_estimate - v.sale_price) / v.sale_price * 100, 1) AS estimate_error_pct,
  ABS(ROUND((v.nuke_estimate - v.sale_price) / v.sale_price * 100, 1)) AS abs_error_pct,
  v.valuation_calculated_at
FROM vehicles v
WHERE v.nuke_estimate IS NOT NULL
  AND v.sale_price IS NOT NULL
  AND v.sale_price > 0
  AND v.status = 'active';

COMMENT ON VIEW v_valuation_accuracy IS
  'Spot-check valuation accuracy: compare nuke_estimate vs actual sale_price. '
  'abs_error_pct < 20% = good. Check after backfill completes.';
