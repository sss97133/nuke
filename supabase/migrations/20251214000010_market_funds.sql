-- =====================================================
-- MARKET FUNDS (SEGMENT ETFs) - MVP
-- =====================================================
-- Users invest into "market segments" (Squarebody, Porsche, etc.) via a fund share model.
-- This is intentionally simple: shares are issued at current NAV and tracked per user.
-- NAV updates can be automated later (cron) using segment price intelligence.
--
-- Idempotent + safe for db reset.
-- Date: 2025-12-14

BEGIN;

-- ==========================
-- 1) MARKET SEGMENTS
-- ==========================

CREATE TABLE IF NOT EXISTS market_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,

  -- Simple segment rules for MVP (expand later: geo, tags, VIN clusters, etc.)
  year_min INTEGER,
  year_max INTEGER,
  makes TEXT[] NULL,
  model_keywords TEXT[] NULL, -- substring match against model/trim

  manager_type TEXT NOT NULL DEFAULT 'ai' CHECK (manager_type IN ('ai', 'human')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'draft', 'archived')),

  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT market_segments_slug_unique UNIQUE (slug)
);

CREATE INDEX IF NOT EXISTS idx_market_segments_status ON market_segments(status);

-- ==========================
-- 2) MARKET FUNDS
-- ==========================

CREATE TABLE IF NOT EXISTS market_funds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  segment_id UUID NOT NULL REFERENCES market_segments(id) ON DELETE CASCADE,

  symbol TEXT NOT NULL, -- e.g. SQBD, PORSCH
  fund_type TEXT NOT NULL DEFAULT 'etf' CHECK (fund_type IN ('etf', 'fund')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'closed')),

  -- NAV per share in USD (numeric, not cents)
  nav_share_price NUMERIC(12,4) NOT NULL DEFAULT 10.0000,

  -- Supply metrics
  total_shares_outstanding NUMERIC(20,6) NOT NULL DEFAULT 0,
  total_aum_usd NUMERIC(15,2) NOT NULL DEFAULT 0,

  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT market_funds_symbol_unique UNIQUE (symbol)
);

CREATE INDEX IF NOT EXISTS idx_market_funds_segment ON market_funds(segment_id);
CREATE INDEX IF NOT EXISTS idx_market_funds_status ON market_funds(status) WHERE status = 'active';

-- ==========================
-- 3) FUND HOLDINGS
-- ==========================

CREATE TABLE IF NOT EXISTS market_fund_holdings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fund_id UUID NOT NULL REFERENCES market_funds(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  shares_owned NUMERIC(20,6) NOT NULL DEFAULT 0,
  entry_nav NUMERIC(12,4) NOT NULL DEFAULT 0,
  current_nav NUMERIC(12,4) NOT NULL DEFAULT 0,
  unrealized_gain_loss_usd NUMERIC(15,2) NOT NULL DEFAULT 0,
  unrealized_gain_loss_pct NUMERIC(8,2) NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT market_fund_holdings_unique UNIQUE (fund_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_market_fund_holdings_user ON market_fund_holdings(user_id);
CREATE INDEX IF NOT EXISTS idx_market_fund_holdings_fund ON market_fund_holdings(fund_id);

-- ==========================
-- 4) STATS FUNCTION (segment trend)
-- ==========================
-- Uses vehicle_price_history when present; falls back gracefully if missing.

CREATE OR REPLACE FUNCTION public.market_segment_stats(p_segment_id UUID)
RETURNS TABLE (
  vehicle_count BIGINT,
  market_cap_usd NUMERIC(15,2),
  change_7d_pct NUMERIC(8,2),
  change_30d_pct NUMERIC(8,2)
) AS $$
DECLARE
  v_has_vph BOOLEAN;
BEGIN
  SELECT (to_regclass('public.vehicle_price_history') IS NOT NULL) INTO v_has_vph;

  RETURN QUERY
  WITH seg AS (
    SELECT * FROM market_segments WHERE id = p_segment_id
  ),
  veh AS (
    SELECT v.id, v.current_value::numeric AS current_value
    FROM vehicles v
    CROSS JOIN seg s
    WHERE COALESCE(v.is_public, true) = true
      AND (s.year_min IS NULL OR v.year >= s.year_min)
      AND (s.year_max IS NULL OR v.year <= s.year_max)
      AND (s.makes IS NULL OR v.make = ANY(s.makes))
      AND (
        s.model_keywords IS NULL OR EXISTS (
          SELECT 1
          FROM unnest(s.model_keywords) kw
          WHERE v.model ILIKE ('%' || kw || '%')
             OR COALESCE(v.trim, '') ILIKE ('%' || kw || '%')
        )
      )
  ),
  base AS (
    SELECT
      COUNT(*)::bigint AS vehicle_count,
      COALESCE(SUM(COALESCE(current_value, 0)), 0)::numeric(15,2) AS market_cap_usd
    FROM veh
  ),
  v7 AS (
    SELECT
      AVG(v.current_value)::numeric AS avg_now,
      AVG(v.old_value)::numeric AS avg_then
    FROM (
      SELECT
        veh.current_value,
        CASE WHEN v_has_vph THEN (
          SELECT vph.value::numeric
          FROM public.vehicle_price_history vph
          WHERE vph.vehicle_id = veh.id
            AND vph.as_of <= NOW() - INTERVAL '7 days'
          ORDER BY vph.as_of DESC
          LIMIT 1
        ) ELSE NULL END AS old_value
      FROM veh
    ) v
    WHERE v.old_value IS NOT NULL
  ),
  v30 AS (
    SELECT
      AVG(v.current_value)::numeric AS avg_now,
      AVG(v.old_value)::numeric AS avg_then
    FROM (
      SELECT
        veh.current_value,
        CASE WHEN v_has_vph THEN (
          SELECT vph.value::numeric
          FROM public.vehicle_price_history vph
          WHERE vph.vehicle_id = veh.id
            AND vph.as_of <= NOW() - INTERVAL '30 days'
          ORDER BY vph.as_of DESC
          LIMIT 1
        ) ELSE NULL END AS old_value
      FROM veh
    ) v
    WHERE v.old_value IS NOT NULL
  )
  SELECT
    b.vehicle_count,
    b.market_cap_usd,
    CASE WHEN v7.avg_then IS NULL OR v7.avg_then <= 0 THEN NULL
         ELSE ROUND(((v7.avg_now - v7.avg_then) / v7.avg_then * 100)::numeric, 2)
    END AS change_7d_pct,
    CASE WHEN v30.avg_then IS NULL OR v30.avg_then <= 0 THEN NULL
         ELSE ROUND(((v30.avg_now - v30.avg_then) / v30.avg_then * 100)::numeric, 2)
    END AS change_30d_pct
  FROM base b
  LEFT JOIN v7 ON true
  LEFT JOIN v30 ON true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==========================
-- 5) BUY FUNCTION (invest into fund)
-- ==========================

CREATE OR REPLACE FUNCTION public.market_fund_buy(
  p_fund_id UUID,
  p_amount_cents BIGINT
)
RETURNS TABLE (
  fund_id UUID,
  user_id UUID,
  amount_cents BIGINT,
  nav_share_price NUMERIC(12,4),
  shares_issued NUMERIC(20,6),
  shares_owned NUMERIC(20,6)
) AS $$
DECLARE
  v_user_id UUID;
  v_nav NUMERIC(12,4);
  v_amount_usd NUMERIC(15,2);
  v_shares NUMERIC(20,6);
  v_prev_shares NUMERIC(20,6);
  v_prev_entry NUMERIC(12,4);
  v_new_entry NUMERIC(12,4);
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  SELECT nav_share_price INTO v_nav
  FROM market_funds
  WHERE id = p_fund_id
    AND status = 'active';

  IF v_nav IS NULL OR v_nav <= 0 THEN
    RAISE EXCEPTION 'Fund not active or NAV invalid';
  END IF;

  v_amount_usd := (p_amount_cents::numeric / 100.0)::numeric(15,2);
  v_shares := ROUND((v_amount_usd / v_nav)::numeric, 6);

  IF v_shares <= 0 THEN
    RAISE EXCEPTION 'Amount too small to issue shares';
  END IF;

  -- Deduct cash (uses existing cash ledger)
  PERFORM public.deduct_cash_from_user(
    v_user_id,
    p_amount_cents,
    'trade_buy',
    p_fund_id,
    NULL,
    jsonb_build_object(
      'product', 'market_fund',
      'fund_id', p_fund_id,
      'shares', v_shares,
      'nav', v_nav
    )
  );

  -- Upsert holding, maintain weighted avg entry nav
  SELECT COALESCE(shares_owned, 0), COALESCE(entry_nav, 0)
    INTO v_prev_shares, v_prev_entry
  FROM market_fund_holdings
  WHERE fund_id = p_fund_id AND user_id = v_user_id;

  IF v_prev_shares IS NULL THEN
    v_prev_shares := 0;
    v_prev_entry := 0;
  END IF;

  IF (v_prev_shares + v_shares) > 0 THEN
    v_new_entry := CASE
      WHEN v_prev_shares = 0 THEN v_nav
      ELSE ROUND(((v_prev_shares * v_prev_entry) + (v_shares * v_nav)) / (v_prev_shares + v_shares), 4)
    END;
  ELSE
    v_new_entry := v_nav;
  END IF;

  INSERT INTO market_fund_holdings (
    fund_id, user_id, shares_owned, entry_nav, current_nav,
    unrealized_gain_loss_usd, unrealized_gain_loss_pct,
    created_at, updated_at
  )
  VALUES (
    p_fund_id, v_user_id, v_prev_shares + v_shares, v_new_entry, v_nav,
    0, 0,
    NOW(), NOW()
  )
  ON CONFLICT (fund_id, user_id)
  DO UPDATE SET
    shares_owned = EXCLUDED.shares_owned,
    entry_nav = EXCLUDED.entry_nav,
    current_nav = EXCLUDED.current_nav,
    updated_at = NOW();

  -- Update fund AUM + shares outstanding
  UPDATE market_funds
  SET
    total_shares_outstanding = total_shares_outstanding + v_shares,
    total_aum_usd = total_aum_usd + v_amount_usd,
    updated_at = NOW()
  WHERE id = p_fund_id;

  RETURN QUERY
  SELECT
    p_fund_id,
    v_user_id,
    p_amount_cents,
    v_nav,
    v_shares,
    (SELECT shares_owned FROM market_fund_holdings WHERE fund_id = p_fund_id AND user_id = v_user_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==========================
-- 6) RLS
-- ==========================

ALTER TABLE market_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_funds ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_fund_holdings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- market_segments: readable by authenticated users
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='market_segments' AND policyname='market_segments_select') THEN
    EXECUTE 'DROP POLICY market_segments_select ON public.market_segments';
  END IF;
  EXECUTE 'CREATE POLICY market_segments_select ON public.market_segments FOR SELECT USING (auth.role() IN (''authenticated'', ''authenticated_user''))';

  -- market_funds: readable by authenticated users
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='market_funds' AND policyname='market_funds_select') THEN
    EXECUTE 'DROP POLICY market_funds_select ON public.market_funds';
  END IF;
  EXECUTE 'CREATE POLICY market_funds_select ON public.market_funds FOR SELECT USING (auth.role() IN (''authenticated'', ''authenticated_user''))';

  -- market_fund_holdings: user reads own holdings
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='market_fund_holdings' AND policyname='market_fund_holdings_select_own') THEN
    EXECUTE 'DROP POLICY market_fund_holdings_select_own ON public.market_fund_holdings';
  END IF;
  EXECUTE 'CREATE POLICY market_fund_holdings_select_own ON public.market_fund_holdings FOR SELECT USING (user_id = auth.uid())';
END $$;

-- ==========================
-- 7) DEFAULT SEGMENTS + FUNDS (idempotent seed)
-- ==========================

-- Squarebody (1973-1987 GM trucks/SUVs)
INSERT INTO market_segments (slug, name, description, year_min, year_max, makes, model_keywords, manager_type, status)
SELECT
  'squarebody',
  'Squarebody Market',
  '1973-1987 GM C/K trucks and related platforms.',
  1973,
  1987,
  ARRAY['Chevrolet','GMC'],
  ARRAY['C10','K10','C20','K20','C30','K30','Suburban','Blazer','Jimmy','Sierra','Silverado'],
  'ai',
  'active'
WHERE NOT EXISTS (SELECT 1 FROM market_segments WHERE slug = 'squarebody');

-- Porsche (all years)
INSERT INTO market_segments (slug, name, description, year_min, year_max, makes, model_keywords, manager_type, status)
SELECT
  'porsche',
  'Porsche Market',
  'Porsche vehicles across all models.',
  NULL,
  NULL,
  ARRAY['Porsche'],
  NULL,
  'ai',
  'active'
WHERE NOT EXISTS (SELECT 1 FROM market_segments WHERE slug = 'porsche');

-- Trucks (broad)
INSERT INTO market_segments (slug, name, description, year_min, year_max, makes, model_keywords, manager_type, status)
SELECT
  'trucks',
  'Truck Market',
  'Broad truck market (pickup focused).',
  NULL,
  NULL,
  NULL,
  ARRAY['Truck','Pickup','F-150','F150','Silverado','Sierra','Ram','Tacoma','Tundra'],
  'ai',
  'active'
WHERE NOT EXISTS (SELECT 1 FROM market_segments WHERE slug = 'trucks');

-- All 1979 vehicles
INSERT INTO market_segments (slug, name, description, year_min, year_max, makes, model_keywords, manager_type, status)
SELECT
  'all-1979',
  'All 1979 Vehicles',
  'Every vehicle with model year 1979.',
  1979,
  1979,
  NULL,
  NULL,
  'ai',
  'active'
WHERE NOT EXISTS (SELECT 1 FROM market_segments WHERE slug = 'all-1979');

-- Funds
INSERT INTO market_funds (segment_id, symbol, fund_type, status, nav_share_price, metadata)
SELECT s.id, 'SQBD', 'etf', 'active', 10.0000, jsonb_build_object('segment_slug', s.slug)
FROM market_segments s
WHERE s.slug = 'squarebody'
  AND NOT EXISTS (SELECT 1 FROM market_funds WHERE symbol = 'SQBD');

INSERT INTO market_funds (segment_id, symbol, fund_type, status, nav_share_price, metadata)
SELECT s.id, 'PORS', 'etf', 'active', 10.0000, jsonb_build_object('segment_slug', s.slug)
FROM market_segments s
WHERE s.slug = 'porsche'
  AND NOT EXISTS (SELECT 1 FROM market_funds WHERE symbol = 'PORS');

INSERT INTO market_funds (segment_id, symbol, fund_type, status, nav_share_price, metadata)
SELECT s.id, 'TRUK', 'etf', 'active', 10.0000, jsonb_build_object('segment_slug', s.slug)
FROM market_segments s
WHERE s.slug = 'trucks'
  AND NOT EXISTS (SELECT 1 FROM market_funds WHERE symbol = 'TRUK');

INSERT INTO market_funds (segment_id, symbol, fund_type, status, nav_share_price, metadata)
SELECT s.id, 'Y79', 'etf', 'active', 10.0000, jsonb_build_object('segment_slug', s.slug)
FROM market_segments s
WHERE s.slug = 'all-1979'
  AND NOT EXISTS (SELECT 1 FROM market_funds WHERE symbol = 'Y79');

COMMIT;







