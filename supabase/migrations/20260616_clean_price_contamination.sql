-- P2 of the data-trust fix: heal existing price/estimate contamination on `vehicles`.
-- Context: P1 (deployed 2026-06-16) stopped NEW contamination at ingestion + killed the circular
-- self_price_fallback in compute-vehicle-valuation. This nulls the EXISTING bad values so the deal
-- machine stops surfacing fake deals. These are projection fields (not testimony): null/recompute
-- is allowed. NO row deletes. NO testimony tables touched. Batched 1k-row chunks per db-safety
-- (Feb-2026 mass-UPDATE outage prevention). Test on LIMIT 10 before running the full loop.
--
-- The relit valuation engine re-prices comp-backed estimates over time; the circular ones it now
-- skips (returns no_independent_comps), so they must be nulled here explicitly.

-- ── 1) Financing-artifact asking prices (sub-$1k, or 2015+ vehicle under $3k) ──────────────────
DO $$
DECLARE n INT;
BEGIN
  LOOP
    UPDATE vehicles
       SET asking_price = NULL,
           price_outlier_reason = COALESCE(price_outlier_reason, 'financing_artifact_cleanup_20260616')
     WHERE id IN (
       SELECT id FROM vehicles
        WHERE asking_price IS NOT NULL
          AND (asking_price < 1000 OR (year >= 2015 AND asking_price < 3000))
        LIMIT 1000
     );
    GET DIAGNOSTICS n = ROW_COUNT;
    EXIT WHEN n = 0;
    PERFORM pg_sleep(0.1);
  END LOOP;
END $$;

-- ── 2) Circular estimates (old self_price_fallback ≈ asking×1.8): null estimate + deal_score ────
DO $$
DECLARE n INT;
BEGIN
  LOOP
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
        LIMIT 1000
     );
    GET DIAGNOSTICS n = ROW_COUNT;
    EXIT WHEN n = 0;
    PERFORM pg_sleep(0.1);
  END LOOP;
END $$;
