-- ============================================================================
-- BROWSE_STATS LOWER(MAKE) INDEX
-- Filed: 2026-06-10
--
-- Measured live: browse_stats('Porsche') = statement timeout (57014) after
-- 15s, HTTP 500, reproducible. The search page fired it on every make query
-- and (until the same-day frontend fix) blocked results on it via
-- Promise.all — so make searches ate a guaranteed ~15s + error.
--
-- Cause: browse_stats (20260302030000_search_rpc_browse.sql) runs four
-- separate aggregate passes over vehicles WHERE is_public = true AND
-- lower(make) = lower(p_make). No btree index exists on lower(make) — the
-- existing lower(make) index is GIN trigram (for LIKE), which equality
-- doesn't use. Four sequential scans over 1.26M rows = timeout.
--
-- Fix: partial btree expression index matching the function's exact
-- predicate. Scopes each aggregate to the make's rows (~tens of thousands).
-- Also benefits search_vehicles_browse make filtering.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_vehicles_lower_make_public
  ON vehicles (lower(make))
  WHERE is_public = true;
