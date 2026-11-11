-- source_walk_cursors: where a paged source walk stands, one row per (source, walk), written by the walk after a page lands.
--
-- extract-bonhams-typesense mode=land found its place by reading vehicle_events for the furthest metadata ts_pass/ts_page of
-- its landed lots: no index serves that order, so every run read every Bonhams typesense episode. Measured 2026-11-09
-- (pg_stat_statements since the 2026-11-08 21:06Z restart): 13.5 s and ~32,000 shared blocks per run, 704 s and 1.67M
-- blocks in 52 runs. The walk now reads this row (primary key) and falls back to the old read only when the row is missing.
-- The lots keep their ts_page/ts_pass stamps, so the row can always be rebuilt from the landed evidence.
--
-- Grain: one walk of one source, overwritten as the walk advances (pass, then page, only forward). Writer: the walk's edge
-- function with the service key. No anon or authenticated access.
SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS public.source_walk_cursors (
  source_slug text NOT NULL,
  walk        text NOT NULL,
  pass        integer NOT NULL DEFAULT 0 CHECK (pass >= 0),
  last_page   integer NOT NULL CHECK (last_page >= 1),
  total_pages integer CHECK (total_pages IS NULL OR total_pages >= 1),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_slug, walk)
);

COMMENT ON TABLE public.source_walk_cursors IS
  'Where a paged source walk stands: the last page landed in the current pass, one row per (source_slug, walk), overwritten forward only. '
  'Written by the walk''s edge function (extract-bonhams-typesense land: source_slug bonhams, walk typesense_land) after a page lands; '
  'the landed rows keep their own page stamps (vehicle_events.metadata ts_page/ts_pass), so the row is rebuildable. Created by 20261112150000.';

ALTER TABLE public.source_walk_cursors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.source_walk_cursors FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.source_walk_cursors TO service_role;
