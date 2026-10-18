-- =============================================================================
-- Fix update_market_nav() — avoid slow market_segment_stats lateral join
-- 2026-02-26
--
-- Problem: update_market_nav() called market_segment_stats(segment_id) which
--          does LATERAL JOINs to vehicle_price_history per vehicle → timeout.
--
-- Fix: Inline a faster query that computes current segment market cap directly
--      (no lateral joins). Store baseline cap in market_funds.metadata on first
--      run. NAV = $10 * (current_cap / baseline_cap) — moves with real data.
-- =============================================================================

CREATE OR REPLACE FUNCTION update_market_nav()
RETURNS TABLE (
  fund_symbol   TEXT,
  old_nav       NUMERIC,
  new_nav       NUMERIC,
  change_pct    NUMERIC,
  vehicle_count BIGINT,
  market_cap    NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_fund        RECORD;
  v_seg         RECORD;
  v_new_nav     NUMERIC;
  v_vehicle_cnt BIGINT;
  v_cap         NUMERIC;
  v_baseline    NUMERIC;
  v_initial_nav NUMERIC := 10.0;
BEGIN
  FOR v_fund IN
    SELECT id, symbol, nav_share_price, segment_id, metadata
    FROM market_funds
    WHERE status = 'active'
  LOOP
    -- Get segment filter criteria
    SELECT * INTO v_seg FROM market_segments WHERE id = v_fund.segment_id;

    IF v_seg IS NULL THEN
      CONTINUE;
    END IF;

    -- Compute current segment market cap directly
    -- (avoids slow lateral joins in market_segment_stats RPC)
    SELECT
      COUNT(*)::BIGINT,
      COALESCE(SUM(v.current_value), 0)::NUMERIC
    INTO v_vehicle_cnt, v_cap
    FROM vehicles v
    WHERE COALESCE(v.is_public, true) = true
      AND v.current_value IS NOT NULL
      AND v.current_value > 0
      AND (v_seg.year_min IS NULL OR v.year >= v_seg.year_min)
      AND (v_seg.year_max IS NULL OR v.year <= v_seg.year_max)
      AND (v_seg.makes IS NULL OR v.make = ANY(v_seg.makes))
      AND (
        v_seg.model_keywords IS NULL
        OR EXISTS (
          SELECT 1 FROM unnest(v_seg.model_keywords) kw
          WHERE v.model ILIKE ('%' || kw || '%')
        )
      );

    -- Skip funds with no matching vehicles
    IF v_vehicle_cnt = 0 OR v_cap <= 0 THEN
      CONTINUE;
    END IF;

    -- First run: set baseline cap, leave NAV at current (no change)
    v_baseline := (v_fund.metadata->>'segment_baseline_cap')::NUMERIC;

    IF v_baseline IS NULL OR v_baseline <= 0 THEN
      -- Seed baseline — NAV stays put, just record the cap
      UPDATE market_funds
      SET
        metadata   = v_fund.metadata || jsonb_build_object(
                       'segment_baseline_cap', v_cap,
                       'segment_baseline_date', NOW()::TEXT
                     ),
        updated_at = NOW()
      WHERE id = v_fund.id;

      RETURN QUERY SELECT
        v_fund.symbol,
        v_fund.nav_share_price,
        v_fund.nav_share_price,
        0.0::NUMERIC,
        v_vehicle_cnt,
        v_cap;
      CONTINUE;
    END IF;

    -- Compute new NAV: proportional to market cap change since baseline
    v_new_nav := ROUND(v_initial_nav * (v_cap / v_baseline), 4);

    -- Floor at $0.01
    IF v_new_nav < 0.01 THEN v_new_nav := 0.01; END IF;

    -- Update fund
    UPDATE market_funds
    SET
      nav_share_price         = v_new_nav,
      total_aum_usd           = v_new_nav * total_shares_outstanding,
      updated_at              = NOW()
    WHERE id = v_fund.id;

    RETURN QUERY SELECT
      v_fund.symbol,
      v_fund.nav_share_price,
      v_new_nav,
      ROUND(((v_new_nav - v_fund.nav_share_price) / NULLIF(v_fund.nav_share_price, 0)) * 100, 4),
      v_vehicle_cnt,
      v_cap;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION update_market_nav() TO service_role;
