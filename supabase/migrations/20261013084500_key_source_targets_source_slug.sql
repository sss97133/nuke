-- source_targets: key source_slug to the source registry (key gap, repair loop; data-machine-cases.md section 12).
-- No row is written; no column is added.
--
-- WHY. public.v_residual tags source_targets {describe,key}, rank_mrows 1.6 (read 2026-10-13 08:35-08:43Z): it has no
-- foreign key in or out (fk_in + fk_out = 0). Higher-ranked gaps of an allowed kind had no repair to make tonight:
-- vehicle_images and auction_comments (owner) carry only undeclared write receipts from before their writers sent
-- headers; vehicle_observations (owner) has open PRs #909 and #986; write_receipts (key) keys by table name and
-- transaction id, which no foreign key can reference. source_slug names the source of each discovered listing URL and
-- nothing in the catalog says which source registry it belongs to.
--
-- EVIDENCE (read-only, prod, 2026-10-13 08:35-08:43Z through scripts/data/q.sh):
--   785,126 rows on 10 distinct source_slug values, NOT NULL, all 10 present in observation_sources.slug, which is
--   UNIQUE (observation_sources_slug_key): mecum, bat, bonhams, barnfinds, hemmings, barrett-jackson, pcarmarket,
--   collecting-cars, gooding, broad-arrow. No orphan row, so the key is added validated.
--   Writer: scripts/ingest-source-targets.sh (bulk_load; ON CONFLICT (listing_url) DO UPDATE SET last_seen_at). All 14
--   slugs it can write (the 10 above plus rm-sothebys, cars-and-bids, classic-com and autohunter) are registered in
--   observation_sources, so the key refuses nothing the writer sends. pg_stat_user_tables: 0 inserts, updates and
--   deletes on source_targets since the statistics reset. Reader: supabase/functions/db-stats (intakeStatus.ts,
--   index.ts), unchanged by a key.
--   Validation cost: the anti-join that VALIDATE runs (source_targets left join observation_sources on slug, where
--   unmatched) took 410 ms (EXPLAIN ANALYZE, parallel index-only scan on idx_source_targets_slug).
--
-- WHAT. One foreign key, validated: source_targets.source_slug -> observation_sources(slug). ON DELETE and ON UPDATE
-- NO ACTION: a source that still has discovered targets can be neither deleted nor have its slug changed silently.
-- ADD CONSTRAINT holds SHARE ROW EXCLUSIVE on both tables for the validation scan; reads continue, writes wait.
-- Guarded by NOT EXISTS so a re-apply is a no-op.
--
-- CONTRACT: supabase/sql/test_source_targets_source_key.sql (PostgreSQL 17, synthetic rows, CI job
-- metric-fold-health-contract in .github/workflows/frontend-tests.yml). It ran only in CI: there is no local Postgres
-- run in the session that wrote it.
-- MEASURED BEFORE: v_residual source_targets gaps {describe,key}, rank_mrows 1.6 (2026-10-13 08:35-08:43Z).
-- EXPECTED AFTER: gaps {describe}, rank_mrows 0.8.

BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.source_targets'::regclass
      AND conname = 'source_targets_source_slug_fkey'
  ) THEN
    ALTER TABLE public.source_targets
      ADD CONSTRAINT source_targets_source_slug_fkey
      FOREIGN KEY (source_slug) REFERENCES public.observation_sources(slug);
  END IF;
END $$;

COMMENT ON CONSTRAINT source_targets_source_slug_fkey ON public.source_targets IS
'The source whose sitemap or search listed the URL, keyed to the source registry. Validated 2026-10-13: all 785,126 rows on 10 slugs matched. ON DELETE and ON UPDATE NO ACTION: a source with discovered targets cannot be deleted or renamed without moving them first.';

COMMENT ON COLUMN public.source_targets.source_slug IS
'The source whose sitemap or search API listed the URL (for example mecum, bat, bonhams). Unit: none (text, foreign key to observation_sources.slug). Source: scripts/ingest-source-targets.sh, the slug passed to bulk_load. Grain: one source x listing URL. Clock: n/a.';

COMMIT;
