-- Held per sale year, counted from the house's own enumeration (owner-lead 2026-10-15). Our event dates cannot do it: BaT vehicle_events has
-- 78,626 of 283,007 episodes with no ended_at and no sold_at. Each enumerated target gets its sale date from the house's own record:
-- sale_at (timestamptz) and sale_at_source naming where it came from (mecum_algolia_run_date, bat_archive_end_ts,
-- bonhams_typesense_hammertime, broad_arrow_sale_code_year; the last is year precision, 1 January UTC). NULL = the target is outside the
-- by-year universe or has no date (Mecum Road Art, targets the index does not list). The data is written in gated batches by a script,
-- not by this migration. The expression index lets those batches (and the by-year matview) find a target by the same key the landed join
-- uses, public.source_target_key(listing_url). No BEGIN: CREATE INDEX CONCURRENTLY cannot run in a transaction block.
SET statement_timeout = '300s';
SET lock_timeout = '10s';
ALTER TABLE public.source_targets ADD COLUMN IF NOT EXISTS sale_at timestamptz;
ALTER TABLE public.source_targets ADD COLUMN IF NOT EXISTS sale_at_source text;
COMMENT ON COLUMN public.source_targets.sale_at IS 'Sale date of the target from the house''s own record (sale_at_source says which); NULL when outside the by-year universe or undated. Year precision sources store 1 January UTC.';
COMMENT ON COLUMN public.source_targets.sale_at_source IS 'Where sale_at came from: mecum_algolia_run_date, bat_archive_end_ts, bonhams_typesense_hammertime or broad_arrow_sale_code_year.';
CREATE INDEX CONCURRENTLY IF NOT EXISTS source_targets_slug_key_idx ON public.source_targets (source_slug, (public.source_target_key(listing_url)));
