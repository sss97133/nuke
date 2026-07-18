-- 20260623013000_auction_comments_unscored_index.sql
-- Applied to prod 2026-06-23 (additive, index-only — no data rewrite, no lock on writes).
--
-- ⚠️  MUST RUN OUTSIDE A TRANSACTION. `CREATE INDEX CONCURRENTLY` cannot run inside a
--     transaction block. Apply this file with a migration runner that executes each
--     statement in its own (auto-commit) connection, or run it by hand via psql:
--         psql "$DIRECT_DB_URL" -f supabase/migrations/20260623013000_auction_comments_unscored_index.sql
--     Do NOT wrap it in BEGIN/COMMIT and do NOT apply it through a transaction-pooled
--     connection (port 6543). Use a DIRECT session connection (port 5432).
--
-- Why: auction_comments (~13.9M rows) had NO index supporting the scored-vs-unscored
-- partition. The comment-intelligence scorer (community_stance_score is NULL = "not yet
-- scored") and any "how many comments still need scoring for cohort X" query were forced
-- into a full Parallel Seq Scan (planner cost ~1.17M) and TIMED OUT (57014: canceling
-- statement due to statement timeout). This was the blocker for scaling comment
-- intelligence. This partial index covers exactly the unscored, non-bid, real-comment
-- population so those queries become index scans instead of seq scans.
--
-- Predicate mirrors the scorer's "needs scoring" definition:
--   comment_type <> 'bid'              -- exclude bid rows (not scoreable prose)
--   AND bid_amount IS NULL             -- belt-and-suspenders: real comments carry no bid
--   AND community_stance_score IS NULL -- not yet scored (the partition that shrinks as work proceeds)
-- Indexed on posted_at DESC so the scorer can pull the newest-unscored first.
--
-- NOTE on statement_timeout: the build was run on a DIRECT superuser session with
-- statement_timeout=0 because a CONCURRENTLY build on a 13.9M-row table runs several
-- minutes and cannot be chunked. This is the standard one-shot maintenance exception to
-- db-safety.md's 120s cap (which governs query/write paths, not index builds). The build
-- takes NO AccessExclusive lock on the table — reads and writes continue throughout
-- (verified: 0 lock waiters during the build).
--
-- Idempotent: IF NOT EXISTS. Re-running is a no-op once the valid index exists. If a prior
-- run was interrupted, an INVALID index stub may remain; drop it first with
--   DROP INDEX CONCURRENTLY IF EXISTS public.idx_auction_comments_unscored;
-- then re-run this file.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_auction_comments_unscored
  ON public.auction_comments (posted_at DESC)
  WHERE comment_type <> 'bid'
    AND bid_amount IS NULL
    AND community_stance_score IS NULL;

COMMENT ON INDEX public.idx_auction_comments_unscored IS
  'Partial index over the unscored, non-bid comment population (comment_type<>''bid'' AND bid_amount IS NULL AND community_stance_score IS NULL), ordered posted_at DESC. Lets the comment-intelligence scorer and "comments still needing scoring" cohort counts run as index scans instead of full seq scans on the ~13.9M-row table. Created 2026-06-23.';
