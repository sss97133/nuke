-- Batched executor for the P2 price-contamination heal (staged 20260616_clean_price_contamination.sql).
-- The original DO-loop form runs unbounded wall-clock and exceeds short statement timeouts, so this
-- wraps ONE batch of each pass in a callable function; the driver (agent/cron/psql) loops until both
-- return 0. WHERE clauses are faithful to the staged migration. These are projection fields
-- (asking_price / nuke_estimate / nuke_estimate_confidence / deal_score — owned by the valuation
-- pipeline, not testimony): nulling is allowed. NO deletes, NO testimony tables touched.
--
-- Pass 1: financing-artifact asking prices (sub-$1k, or 2015+ vehicle under $3k) → NULL + reason tag.
-- Pass 2: circular estimates (old self_price_fallback ≈ asking×1.8 per nuke_estimates.comp_method)
--         → NULL estimate/confidence/deal_score so the relit engine re-prices from real comps.

CREATE OR REPLACE FUNCTION public.clean_price_contamination_batch(batch_size int DEFAULT 1000)
RETURNS TABLE(pass1 int, pass2 int)
LANGUAGE plpgsql
AS $$
DECLARE
  n1 int;
  n2 int;
BEGIN
  -- ── Pass 1: financing-artifact asking prices ─────────────────────────────
  UPDATE vehicles
     SET asking_price = NULL,
         price_outlier_reason = COALESCE(price_outlier_reason, 'financing_artifact_cleanup_20260616')
   WHERE id IN (
     SELECT id FROM vehicles
      WHERE asking_price IS NOT NULL
        AND (asking_price < 1000 OR (year >= 2015 AND asking_price < 3000))
      LIMIT batch_size
   );
  GET DIAGNOSTICS n1 = ROW_COUNT;

  -- ── Pass 2: circular self_price_fallback estimates ───────────────────────
  UPDATE vehicles v
     SET nuke_estimate = NULL,
         nuke_estimate_confidence = NULL,
         deal_score = NULL
   WHERE v.id IN (
     SELECT ne.vehicle_id
       FROM nuke_estimates ne
       JOIN vehicles vx ON vx.id = ne.vehicle_id
      WHERE ne.comp_method = 'self_price_fallback'
        AND vx.nuke_estimate IS NOT NULL
      LIMIT batch_size
   );
  GET DIAGNOSTICS n2 = ROW_COUNT;

  RETURN QUERY SELECT n1, n2;
END;
$$;

COMMENT ON FUNCTION public.clean_price_contamination_batch(int) IS
  'One batch of the P2 price-contamination heal (financing-artifact asking prices + circular self_price_fallback estimates). Loop until (0,0). Projection fields only — no testimony.';

-- Maintenance function — not for the public REST surface.
REVOKE ALL ON FUNCTION public.clean_price_contamination_batch(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clean_price_contamination_batch(int) TO service_role;
