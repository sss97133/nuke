-- ============================================================================
-- SEARCH ILIKE TRIGRAM INDEXES
-- Filed: 2026-06-10
--
-- universal-search measured live at 9.8–20s warm. Anatomy of the 20s:
--   1. count_vehicles_search RPC: 5.2s AND returns 0 (broken) — removed from
--      the function's critical path in the same commit.
--   2. The ILIKE fallback (and the offset>0 pagination path) runs 6-clause
--      `make/model/color ILIKE '%term%'` ORs against 1.26M rows with NO
--      usable index — the existing trigram indexes are expression indexes on
--      lower(make)/lower(model) (built for find_bat_comps, which calls
--      lower() explicitly). PostgREST .ilike emits `make ILIKE '%x%'`, which
--      cannot use a lower() expression index → sequential scan, ~13s.
--      The function's own comment admits "scans 30K+ rows and takes 15+
--      seconds" for broad terms.
--
-- Fix: raw-column GIN trigram indexes. pg_trgm supports ILIKE directly
-- (case-insensitive) on plain column indexes. make/model/color are short
-- strings; index size and write overhead are modest.
--
-- Expected: ILIKE fallback ~13s → sub-second (trigram bitmap scan + sort of
-- matched rows). Whole search response ~20s → ~3s; remaining time is
-- search_vehicles_fts (1.7s) and search_vehicles_deep (2.9s), next pass.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_vehicles_make_trgm_raw
  ON vehicles USING GIN (make gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_vehicles_model_trgm_raw
  ON vehicles USING GIN (model gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_vehicles_color_trgm_raw
  ON vehicles USING GIN (color gin_trgm_ops);
