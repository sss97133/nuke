-- Rebuild idx_auction_events_bat_lot_slug (20261006130000, PR #686), whose CONCURRENTLY build failed on deploy.
--
-- Failure (supabase-deploy run 37462471749, 2026-10-06 12:20:22Z):
--   psql:supabase/migrations/20261006130000_idx_auction_events_bat_lot_slug.sql:24: ERROR:  canceling statement due to lock timeout
-- 12 s into the build. It left the index INVALID (12 MB, holding no usable data).
--
-- Why: CREATE INDEX CONCURRENTLY waits, in two phases, for every transaction that started before it and could write
-- the table to finish (it waits on their virtual transaction ids). auction_events is written every minute by the live
-- pull (ingest_bat_live_events) and by extract-bat-core, so such a transaction is almost always open. lock_timeout applies
-- to that wait, and 5 s was too short. Here lock_timeout is a bound on waiting for other transactions to finish, not a
-- lock this build holds on writers: CONCURRENTLY never blocks inserts or updates to auction_events.
-- The deploy sets PGOPTIONS statement_timeout=120s; the SETs below override it for this session (bounded, never 0).
--
-- Steps: drop the invalid artefact of the failed build (CONCURRENTLY, IF EXISTS; it holds no data), then the same
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS and COMMENT as 20261006130000. No BEGIN: the deploy applies this file with
-- psql -f in autocommit, and neither statement can run inside a transaction block.
SET statement_timeout = '30min';
SET lock_timeout = '10min';

DROP INDEX CONCURRENTLY IF EXISTS public.idx_auction_events_bat_lot_slug;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_auction_events_bat_lot_slug
  ON public.auction_events ((lower(substring(source_url FROM 'bringatrailer\.com/listing/([^/?#]+)'))));

COMMENT ON INDEX public.idx_auction_events_bat_lot_slug IS
'BaT lot identity: lower-cased listing slug of source_url (NULL for non-BaT rows), across vehicles. Answers whether any vehicle row already holds a lot row for a BaT listing. Used by create_missing_bat_auction_events before it creates a lot from retained evidence. Built CONCURRENTLY 2026-10-06 (rebuilt by 20261006133000 after the first build hit lock_timeout).';
