-- Index the canonical comment author key.
--
-- auction_comments.external_identity_id is the canonical author key (pipeline_registry owner
-- key_auction_comment_authors, PR #664). Migration 20251216000003 declared a partial index on it, but prod
-- never had one (verified 2026-10-06 05:5xZ: pg_indexes lists author-side indexes only on the retired twin
-- author_external_identity_id). Two frontend profile readers still filter on the twin for that reason.
-- The 2026-10-06 backfill (ag.nuke.key-comment-authors) raised the fill from ~75% to ~99% of BaT comments;
-- this index lets readers move to the canonical column.
--
-- CONCURRENTLY: no BEGIN in this file on purpose (the deploy applies each file with psql -f in autocommit;
-- precedent 20260227040000_bat_snapshot_parser_index_fix.sql). Merge only after the keying job has unloaded,
-- so the build does not race 20K-row UPDATE batches. Partial, like the 2025-12-16 declaration.
-- The deploy role (postgres) carries statement_timeout=10s in rolconfig (read 2026-10-06 10:00Z); a 20M-row build needs
-- a bounded session override or it is killed at 10 s and left INVALID. Bounded, never 0.
SET statement_timeout = '30min';
SET lock_timeout = '5s';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_auction_comments_external_identity
  ON public.auction_comments (external_identity_id)
  WHERE external_identity_id IS NOT NULL;

COMMENT ON INDEX public.idx_auction_comments_external_identity IS
'Partial btree on the canonical comment author key (rows with a key). Built CONCURRENTLY 2026-10-06 after the author-key backfill. Readers of a BaT member''s comments use this; the twin index on author_external_identity_id is retired with its column.';
