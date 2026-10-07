-- =============================================================================
-- Fix mark_to_market() — resolve ambiguous column name 'old_mark'
-- 2026-02-26
-- PL/pgSQL confuses the RETURNING alias 'old_mark' with the output column.
-- Fix: use unambiguous aliases in RETURNING clauses.
-- =============================================================================

CREATE OR REPLACE FUNCTION mark_to_market()
RETURNS TABLE (
  holding_type  TEXT,
  holding_id    UUID,
  old_mark      NUMERIC,
  new_mark      NUMERIC,
  unrealized    NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- 4a. Vehicle fractional holdings (share_holdings → vehicle_offerings)
  RETURN QUERY
  WITH upd AS (
    UPDATE share_holdings sh
    SET
      current_mark             = vo.current_share_price,
      unrealized_gain_loss     = ROUND((vo.current_share_price - sh.entry_price) * sh.shares_owned, 2),
      unrealized_gain_loss_pct = ROUND(
        ((vo.current_share_price - sh.entry_price) / NULLIF(sh.entry_price, 0)) * 100, 2
      ),
      updated_at = NOW()
    FROM vehicle_offerings vo
    WHERE sh.offering_id = vo.id
      AND vo.status = 'trading'
      AND vo.current_share_price IS DISTINCT FROM sh.current_mark
    RETURNING
      sh.id                                                                AS upd_id,
      sh.current_mark                                                      AS prev_mark,
      vo.current_share_price                                               AS curr_mark,
      ROUND((vo.current_share_price - sh.entry_price) * sh.shares_owned, 2) AS upd_unrealized
  )
  SELECT
    'vehicle_holding'::TEXT,
    upd_id,
    prev_mark,
    curr_mark,
    upd_unrealized
  FROM upd;

  -- 4b. Fund holdings (market_fund_holdings → market_funds)
  RETURN QUERY
  WITH upd AS (
    UPDATE market_fund_holdings mfh
    SET
      current_nav               = mf.nav_share_price,
      unrealized_gain_loss_usd  = ROUND((mf.nav_share_price - mfh.entry_nav) * mfh.shares_owned, 2),
      unrealized_gain_loss_pct  = ROUND(
        ((mf.nav_share_price - mfh.entry_nav) / NULLIF(mfh.entry_nav, 0)) * 100, 2
      ),
      updated_at = NOW()
    FROM market_funds mf
    WHERE mfh.fund_id = mf.id
      AND mf.status = 'active'
      AND mf.nav_share_price IS DISTINCT FROM mfh.current_nav
    RETURNING
      mfh.id                                                                   AS upd_id,
      mfh.current_nav                                                          AS prev_nav,
      mf.nav_share_price                                                       AS curr_nav,
      ROUND((mf.nav_share_price - mfh.entry_nav) * mfh.shares_owned, 2)       AS upd_unrealized
  )
  SELECT
    'fund_holding'::TEXT,
    upd_id,
    prev_nav,
    curr_nav,
    upd_unrealized
  FROM upd;
END;
$$;

GRANT EXECUTE ON FUNCTION mark_to_market() TO service_role;
