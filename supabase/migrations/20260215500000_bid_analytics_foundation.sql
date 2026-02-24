-- Bid Analytics Foundation
-- Backfills is_winning_bid / is_final_bid columns, creates indexes,
-- summary tables, and materialized views for bid curve analysis.
--
-- NOTE: Due to 3.5M row table size vs 2min statement timeout on pooler,
-- mv_bid_vehicle_summary and mv_bidder_profiles are created as regular
-- tables (populated incrementally). mv_bid_market_trends and
-- mv_bid_treemap_by_make are materialized views (smaller aggregations).
-- Backfills were run in quarterly batches via /tmp/bid_backfill2.sh.

-- ═══════════════════════════════════════════════════════════════════════
-- 1. BACKFILL is_final_bid: the last bid per auction
--    (Run in quarterly batches due to timeout constraints)
-- ═══════════════════════════════════════════════════════════════════════

-- Template per batch:
-- WITH final_bids AS (
--   SELECT DISTINCT ON (bat_listing_id) id
--   FROM bat_bids WHERE bid_timestamp >= '2024-01-01' AND bid_timestamp < '2024-04-01'
--   ORDER BY bat_listing_id, bid_timestamp DESC
-- )
-- UPDATE bat_bids SET is_final_bid = true
-- WHERE id IN (SELECT id FROM final_bids) AND is_final_bid IS DISTINCT FROM true;

-- ═══════════════════════════════════════════════════════════════════════
-- 2. BACKFILL is_winning_bid: final bid where vehicle sold
--    (Run in quarterly batches due to timeout constraints)
-- ═══════════════════════════════════════════════════════════════════════

-- Template per batch:
-- WITH winning AS (
--   SELECT DISTINCT ON (b.bat_listing_id) b.id
--   FROM bat_bids b JOIN vehicles v ON v.id = b.vehicle_id
--   WHERE v.sale_status = 'sold'
--     AND b.bid_timestamp >= '2024-01-01' AND b.bid_timestamp < '2024-04-01'
--   ORDER BY b.bat_listing_id, b.bid_timestamp DESC
-- )
-- UPDATE bat_bids SET is_winning_bid = true
-- WHERE id IN (SELECT id FROM winning) AND is_winning_bid IS DISTINCT FROM true;

-- ═══════════════════════════════════════════════════════════════════════
-- 3. INDEXES
-- ═══════════════════════════════════════════════════════════════════════

-- Already existed: idx_bat_bids_vehicle, idx_bat_bids_listing (composite), idx_bat_bids_username, idx_bat_bids_timestamp
CREATE INDEX IF NOT EXISTS idx_bat_bids_winning ON bat_bids(is_winning_bid) WHERE is_winning_bid = true;

-- ═══════════════════════════════════════════════════════════════════════
-- 4. TABLE: mv_bid_vehicle_summary — per-vehicle bid stats
--    (Regular table, populated incrementally per year)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS mv_bid_vehicle_summary (
  vehicle_id uuid PRIMARY KEY,
  bid_count bigint,
  unique_bidders bigint,
  opening_bid numeric,
  final_bid numeric,
  bid_range numeric,
  appreciation_pct numeric,
  duration_hours double precision,
  bids_per_hour numeric,
  first_bid_at timestamptz,
  last_bid_at timestamptz
);

-- ═══════════════════════════════════════════════════════════════════════
-- 5. MV: mv_bid_market_trends — weekly aggregated market bid trends
-- ═══════════════════════════════════════════════════════════════════════

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_bid_market_trends AS
SELECT
  date_trunc('week', bid_timestamp)::date as week,
  count(*) as total_bids,
  count(DISTINCT bat_listing_id) as auctions,
  count(DISTINCT bat_username) as active_bidders,
  ROUND(avg(bid_amount)::numeric, 0) as avg_bid,
  ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY bid_amount)::numeric, 0) as median_bid
FROM bat_bids
WHERE bid_timestamp IS NOT NULL
GROUP BY date_trunc('week', bid_timestamp)
ORDER BY week;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_bid_market_trends_week ON mv_bid_market_trends(week);

-- ═══════════════════════════════════════════════════════════════════════
-- 6. TABLE: mv_bidder_profiles — top bidder intelligence
--    (Regular table, populated incrementally per year)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS mv_bidder_profiles (
  bat_username text PRIMARY KEY,
  total_bids bigint,
  auctions_entered bigint,
  wins bigint,
  win_rate numeric,
  avg_bid numeric,
  max_bid numeric,
  first_seen timestamptz,
  last_seen timestamptz
);

-- ═══════════════════════════════════════════════════════════════════════
-- 7. MV: mv_bid_treemap_by_make — bid volume by vehicle make
-- ═══════════════════════════════════════════════════════════════════════

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_bid_treemap_by_make AS
SELECT
  v.make,
  count(b.*) as bid_count,
  count(DISTINCT b.vehicle_id) as vehicles,
  ROUND(avg(b.bid_amount)::numeric, 0) as avg_bid,
  count(DISTINCT b.bat_username) as unique_bidders
FROM bat_bids b
JOIN vehicles v ON v.id = b.vehicle_id
WHERE v.make IS NOT NULL
GROUP BY v.make
HAVING count(*) >= 10;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_bid_treemap_make ON mv_bid_treemap_by_make(make);

-- ═══════════════════════════════════════════════════════════════════════
-- 8. CRON: refresh MVs every 4 hours
-- ═══════════════════════════════════════════════════════════════════════

SELECT cron.schedule('refresh-bid-analytics-mvs', '15 */4 * * *',
  $$ REFRESH MATERIALIZED VIEW CONCURRENTLY mv_bid_market_trends;
     REFRESH MATERIALIZED VIEW CONCURRENTLY mv_bid_treemap_by_make; $$
);

-- ═══════════════════════════════════════════════════════════════════════
-- 9. RLS policies: public read access for regular tables
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE mv_bid_vehicle_summary ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read access" ON mv_bid_vehicle_summary FOR SELECT TO public USING (true);

ALTER TABLE mv_bidder_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read access" ON mv_bidder_profiles FOR SELECT TO public USING (true);
