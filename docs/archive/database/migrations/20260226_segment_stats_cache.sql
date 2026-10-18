-- =============================================================================
-- Market Segment Stats Cache + Fast NAV Update
-- 2026-02-26
--
-- Problem: market_segment_stats() and even raw segment queries on vehicles
--          take 1-2+ minutes (full table scan on 1.25M rows).
--
-- Solution:
--   1. market_segment_stats_cache table — stores pre-computed stats
--   2. refresh_segment_stats_cache() — slow computation, run via pg_cron
--   3. Rewrite update_market_nav() to read from cache (fast!)
--   4. pg_cron: refresh cache every 4 hours
-- =============================================================================

-- ─── 1. Cache table ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS market_segment_stats_cache (
  segment_id          UUID PRIMARY KEY REFERENCES market_segments(id),
  vehicle_count       BIGINT NOT NULL DEFAULT 0,
  market_cap_usd      NUMERIC(20,2) NOT NULL DEFAULT 0,
  avg_vehicle_price   NUMERIC(15,2),
  change_7d_pct       NUMERIC(10,4),
  change_30d_pct      NUMERIC(10,4),
  refreshed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source              TEXT DEFAULT 'clean_vehicle_prices'
);

-- Allow service role to read/write
GRANT SELECT, INSERT, UPDATE ON market_segment_stats_cache TO service_role;
GRANT SELECT ON market_segment_stats_cache TO anon, authenticated;

-- ─── 2. refresh_segment_stats_cache() ────────────────────────────────────────
-- Slow function — runs via pg_cron every 4h, NOT called from REST API.
-- Uses clean_vehicle_prices (indexed on lower(make), year) for speed.
CREATE OR REPLACE FUNCTION refresh_segment_stats_cache()
RETURNS TABLE (
  segment_name  TEXT,
  vehicle_count BIGINT,
  market_cap    NUMERIC,
  elapsed_ms    NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_seg     RECORD;
  v_cnt     BIGINT;
  v_cap     NUMERIC;
  v_avg     NUMERIC;
  v_start   TIMESTAMPTZ;
BEGIN
  FOR v_seg IN
    SELECT DISTINCT ms.*
    FROM market_segments ms
    JOIN market_funds mf ON mf.segment_id = ms.id
    WHERE mf.status = 'active'
  LOOP
    v_start := clock_timestamp();

    -- Query clean_vehicle_prices — has indexes on lower(make), year
    -- Uses sale price data from all historical vehicles
    SELECT
      COUNT(*)::BIGINT,
      COALESCE(SUM(cvp.best_price), 0)::NUMERIC(20,2),
      AVG(cvp.best_price)::NUMERIC(15,2)
    INTO v_cnt, v_cap, v_avg
    FROM clean_vehicle_prices cvp
    WHERE (v_seg.year_min IS NULL OR cvp.year >= v_seg.year_min)
      AND (v_seg.year_max IS NULL OR cvp.year <= v_seg.year_max)
      AND (v_seg.makes IS NULL OR lower(cvp.make) = ANY(
        SELECT lower(m) FROM unnest(v_seg.makes) m
      ))
      AND (
        v_seg.model_keywords IS NULL
        OR EXISTS (
          SELECT 1 FROM unnest(v_seg.model_keywords) kw
          WHERE lower(cvp.model) ILIKE ('%' || lower(kw) || '%')
        )
      );

    -- Upsert into cache
    INSERT INTO market_segment_stats_cache (
      segment_id, vehicle_count, market_cap_usd, avg_vehicle_price, refreshed_at
    ) VALUES (
      v_seg.id, v_cnt, v_cap, v_avg, NOW()
    )
    ON CONFLICT (segment_id) DO UPDATE SET
      vehicle_count     = EXCLUDED.vehicle_count,
      market_cap_usd    = EXCLUDED.market_cap_usd,
      avg_vehicle_price = EXCLUDED.avg_vehicle_price,
      refreshed_at      = NOW();

    RETURN QUERY SELECT
      v_seg.name,
      v_cnt,
      v_cap,
      EXTRACT(MILLISECONDS FROM (clock_timestamp() - v_start))::NUMERIC;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION refresh_segment_stats_cache() TO service_role;

-- ─── 3. Seed cache with quick nuke_estimate data (fast approximation) ─────────
-- For bootstrapping: use vehicles with nuke_estimate from vehicle_offerings
-- This gives immediate data while the full refresh runs in background
INSERT INTO market_segment_stats_cache (segment_id, vehicle_count, market_cap_usd, avg_vehicle_price, source, refreshed_at)
SELECT
  s.id AS segment_id,
  COUNT(vo.id)::BIGINT AS vehicle_count,
  COALESCE(SUM(vo.current_share_price * vo.total_shares), 0)::NUMERIC AS market_cap_usd,
  AVG(vo.current_share_price * vo.total_shares)::NUMERIC AS avg_vehicle_price,
  'vehicle_offerings' AS source,
  NOW() AS refreshed_at
FROM market_segments s
JOIN market_funds mf ON mf.segment_id = s.id AND mf.status = 'active'
LEFT JOIN vehicle_offerings vo ON vo.status = 'trading'
  AND EXISTS (
    SELECT 1 FROM vehicles v
    WHERE v.id = vo.vehicle_id
      AND (s.year_min IS NULL OR v.year >= s.year_min)
      AND (s.year_max IS NULL OR v.year <= s.year_max)
      AND (s.makes IS NULL OR v.make = ANY(s.makes))
  )
GROUP BY s.id
ON CONFLICT (segment_id) DO UPDATE SET
  vehicle_count     = EXCLUDED.vehicle_count,
  market_cap_usd    = EXCLUDED.market_cap_usd,
  avg_vehicle_price = EXCLUDED.avg_vehicle_price,
  source            = EXCLUDED.source,
  refreshed_at      = EXCLUDED.refreshed_at;

-- ─── 4. Rewrite update_market_nav() to use cache ────────────────────────────
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
  v_cache       RECORD;
  v_new_nav     NUMERIC;
  v_baseline    NUMERIC;
  v_initial_nav NUMERIC := 10.0;
  v_meta        JSONB;
BEGIN
  FOR v_fund IN
    SELECT id, symbol, nav_share_price, segment_id, metadata
    FROM market_funds
    WHERE status = 'active'
  LOOP
    -- Read from cache (instant — no table scan)
    SELECT * INTO v_cache
    FROM market_segment_stats_cache
    WHERE segment_id = v_fund.segment_id;

    IF v_cache IS NULL OR v_cache.market_cap_usd <= 0 THEN
      CONTINUE;
    END IF;

    v_baseline := (v_fund.metadata->>'segment_baseline_cap')::NUMERIC;

    -- Merge stats into metadata for API fast-reads
    v_meta := COALESCE(v_fund.metadata, '{}'::JSONB) || jsonb_build_object(
      'vehicle_count',    v_cache.vehicle_count,
      'market_cap_usd',   v_cache.market_cap_usd,
      'stats_updated_at', v_cache.refreshed_at::TEXT,
      'stats_source',     v_cache.source
    );

    IF v_baseline IS NULL OR v_baseline <= 0 THEN
      -- First run: seed baseline
      v_meta := v_meta || jsonb_build_object(
        'segment_baseline_cap',  v_cache.market_cap_usd,
        'segment_baseline_date', NOW()::TEXT
      );

      UPDATE market_funds
      SET metadata = v_meta, updated_at = NOW()
      WHERE id = v_fund.id;

      RETURN QUERY SELECT
        v_fund.symbol, v_fund.nav_share_price, v_fund.nav_share_price,
        0.0::NUMERIC, v_cache.vehicle_count, v_cache.market_cap_usd;
      CONTINUE;
    END IF;

    -- Compute NAV proportional to market cap change since baseline
    v_new_nav := ROUND(v_initial_nav * (v_cache.market_cap_usd / v_baseline), 4);
    IF v_new_nav < 0.01 THEN v_new_nav := 0.01; END IF;

    UPDATE market_funds
    SET
      nav_share_price = v_new_nav,
      total_aum_usd   = v_new_nav * total_shares_outstanding,
      metadata        = v_meta,
      updated_at      = NOW()
    WHERE id = v_fund.id;

    RETURN QUERY SELECT
      v_fund.symbol, v_fund.nav_share_price, v_new_nav,
      ROUND(((v_new_nav - v_fund.nav_share_price) / NULLIF(v_fund.nav_share_price, 0)) * 100, 4),
      v_cache.vehicle_count, v_cache.market_cap_usd;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION update_market_nav() TO service_role;

-- ─── 5. pg_cron: refresh cache every 4 hours ─────────────────────────────────
SELECT cron.schedule(
  'exchange-segment-stats-refresh',
  '0 */4 * * *',
  $$SELECT refresh_segment_stats_cache();$$
);
