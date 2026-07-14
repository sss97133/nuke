-- v2 of clean_price_contamination_batch: same WHERE semantics, two operability fixes learned
-- from the first run (1,362 rows/pass healed under v1 before batches started timing out):
--
-- 1) Target scans are now index-driven. Both passes were re-seq-scanning 915k-row vehicles /
--    741k-row nuke_estimates per batch; after the trigger churn (trg_invalidate_estimates_on_price
--    stale-flips up to 500 nuke_estimates rows per healed vehicle) those scans blew past the
--    postgres role's ACTUAL statement_timeout (10s — the 120s in the room manual is stale).
--    Partial indexes created 2026-07-02 (recorded here for schema history):
CREATE INDEX IF NOT EXISTS idx_ne_self_price_fallback
  ON public.nuke_estimates (vehicle_id)
  WHERE comp_method = 'self_price_fallback';
CREATE INDEX IF NOT EXISTS idx_vehicles_financing_artifact_heal
  ON public.vehicles (id)
  WHERE asking_price IS NOT NULL AND (asking_price < 1000 OR (year >= 2015 AND asking_price < 3000));
--    Both are self-emptying: healed rows leave the predicate, so the final probe is instant and
--    the indexes end near-empty. Drop them after the heal if desired.
--
-- 2) FOR UPDATE SKIP LOCKED on the target selection so batches never queue behind the 2-minute
--    valuation-backfill workers' row locks (a skipped row is simply picked up by a later batch —
--    the loop runs until both passes return 0).

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
      FOR UPDATE SKIP LOCKED
   );
  GET DIAGNOSTICS n1 = ROW_COUNT;

  -- ── Pass 2: circular self_price_fallback estimates ───────────────────────
  UPDATE vehicles v
     SET nuke_estimate = NULL,
         nuke_estimate_confidence = NULL,
         deal_score = NULL
   WHERE v.id IN (
     SELECT vx.id
       FROM nuke_estimates ne
       JOIN vehicles vx ON vx.id = ne.vehicle_id
      WHERE ne.comp_method = 'self_price_fallback'
        AND vx.nuke_estimate IS NOT NULL
      LIMIT batch_size
      FOR UPDATE OF vx SKIP LOCKED
   );
  GET DIAGNOSTICS n2 = ROW_COUNT;

  RETURN QUERY SELECT n1, n2;
END;
$$;
