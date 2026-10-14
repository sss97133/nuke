-- Sweep of the INVALID indexes in production: drop the thirteen no live read needs, rebuild the one that one does.
--
-- What an invalid index is. A CREATE INDEX CONCURRENTLY that is cancelled (a statement or lock timeout, a killed session, a
-- failed deploy) leaves its index behind with indisvalid = false. The planner never reads an invalid index. When the build
-- got past its first pass the index is also indisready = true, so every INSERT and UPDATE of the table still maintains it:
-- a cost with no benefit. And a later CREATE INDEX IF NOT EXISTS of the same name finds the leftover and does nothing, so
-- nothing notices (the likely case for idx_vehicles_existence_tier: 20260611040200 declares it with IF NOT EXISTS over a
-- concurrent build of 2026-06-10).
--
-- Measured 2026-10-14 04:05Z, pg_index where not indisvalid: 16 indexes, all in public, 7 of them ready, none backing a
-- constraint or having a dependent object. This file takes 14. PR #1122 rebuilds idx_observations_vehicle_comment_bid and
-- the next file rebuilds idx_vehicle_observations_property (10 GB heap, its own deploy).
--
-- DROP (every one is guarded: it runs only while the index is still INVALID, so a valid index of the same name is never touched):
--  1 idx_ac_classified_vehicle (auction_comments, not ready, 0 bytes): its shape (vehicle_id, l1, l2) WHERE l1 IS NOT NULL fits
--    question_profile() and vehicle_question_preview(), but the frontend reads mv_question_by_make and question_profile_fast()
--    instead, pg_stat_statements shows no call of either, and no other reader exists.
--  2 idx_ac_question_l1 (auction_comments, ready, 49 MB): no reader filters on question_primary_l1 alone; the admin category
--    page filters l2 + has_question + l1 IS NOT NULL, which the valid idx_ac_question_l2_posted serves (20260927170400).
--  3 idx_ac_question_l2 (auction_comments, ready, 50 MB): the same valid idx_ac_question_l2_posted covers every l2 read.
--  4 idx_ac_unclassified_questions (auction_comments, ready, 86 MB): the queue index of the question classifier
--    (analyze-comments-fast mode question_classify; scripts/question-classify-bulk.mjs). Its cron job 468 was retired inactive
--    by 20260929001000, no statement reads question_classified_at IS NULL in pg_stat_statements since 2026-09-29, and the
--    classification times in the 2026-10-07 ANALYZE sample (pg_stats histogram) span only 2026-03-27 to 2026-04-14. To re-arm
--    the classifier build it again, reading the 11 GB heap twice:
--    CREATE INDEX CONCURRENTLY idx_ac_unclassified_questions ON public.auction_comments (id)
--      WHERE (has_question = true AND question_classified_at IS NULL);
--  5 idx_auction_comments_platform_author (auction_comments, ready, 266 MB): platform = 'bat' AND author_username = x already
--    plans on the valid idx_auction_comments_author_username_full (EXPLAIN 2026-10-14, platform as a filter); 99.8% of
--    comments are bat, so the predicate narrows nothing and almost every comment insert or update writes into it for no read.
--  6 idx_lps_bat_inline_id (listing_page_snapshots, ready, 4.5 MB): every reader of inline HTML (backfill_vin_find_candidates,
--    repopulate_snapshot_queue, the reparse scripts) looks snapshots up by listing_url, served by the valid idx_lps_url_fetched;
--    nothing scans bat snapshots by id.
--  7 idx_vehicle_images_dhash (vehicle_images, not ready, 0 bytes): no function or statement looks vehicle_images up by dhash
--    (find_image_duplicate_candidates and find_similar_vehicles read vehicle_hero_fingerprints); 0.008% of 52.5 M rows carry
--    a dhash (pg_stats null_frac 0.99992). A rebuild would read the 49 GB heap twice.
--  8 idx_vehicle_images_orphan_check (vehicle_images, not ready, 0 bytes): holds only NULL keys (vehicle_id WHERE vehicle_id
--    IS NULL). Orphan reads are per user and plan on the valid idx_vehicle_images_unorganized, which covers the same rows.
--  9 idx_vehicle_images_pending_review (vehicle_images, not ready, 0 bytes): the one per-vehicle pending read
--    (scripts/vision-gate-classify.mjs, vehicle_id = $1 AND vision_gate_status = 'pending') is served by the valid
--    idx_vehicle_images_created_at (vehicle_id, created_at DESC). 19% of rows are 'pending' (pg_stats), so a rebuild would be
--    a 10 M-entry index maintained on every image insert for no read.
-- 10 idx_vehicle_images_ssd_blast_dedup (vehicle_images, UNIQUE, not ready, 0 bytes): never enforced, because a not-ready index
--    is not maintained. No ON CONFLICT in the repo or in a production function names it, and no code in the repo writes
--    source = 'ssd_blast' (about 34 K rows by the pg_stats share of 0.064%). Building a unique index over the 49 GB heap fails
--    if one of those hashes repeats, and the 2026-06-11 receipts (docs/wiring/receipts) record its global uniqueness as the
--    reason copy-style reattribution could not move ssd_blast images.
-- 11 idx_vo_pending_owner_confirmation (vehicle_observations, not ready, 0 bytes): no SQL applies its predicate
--    (structured_data ->> 'needs_owner_confirmation') = 'true'; agent-chat filters the drafts in JavaScript after reading the
--    ledger, and no function, view or statement contains that text.
-- 12 idx_vehicles_auto_lower_make (vehicles, not ready, 0 bytes): made for search_vehicles_smart, search_autocomplete and
--    search_vehicles_browse, which already plan on the valid idx_vehicles_lower_make_public (EXPLAIN 2026-10-14) and show no
--    call in pg_stat_statements.
-- 13 idx_vehicles_existence_tier (vehicles, not ready, 0 bytes): existence_tier is filled on 0.09% of rows (pg_stats null_frac
--    0.999133; the backfill stopped after its first phase) and no function, view, policy, code path or statement reads it.
--
-- REBUILD:
-- 14 idx_bat_listings_seller_username (bat_listings, ready, 2.7 MB): UserBatTrackRecord reads bat_listings WHERE
--    seller_username = $1 OR seller_external_identity_id = ANY($2): 4 calls, mean 5,396 ms, max 6,212 ms, 51,901 blocks read
--    (pg_stat_statements since 2026-09-29). EXPLAIN is a Seq Scan of the 133 MB heap: an OR plans as a bitmap union only when
--    both arms have a usable index, and this arm's index is the invalid one (the other, idx_bat_listings_seller_external_identity,
--    is valid). The build reads the 133 MB heap twice, seconds.
--
-- Caveat on "no statement": pg_stat_statements has run since 2026-09-29 09:20Z and has evicted rarely-run entries 71 times, so
-- an absent statement rules out a frequent reader, not an occasional one. The repo search and the production function sources
-- (pg_proc.prosrc, pg_views, pg_policy) carry the rest of each claim.
--
-- Cost of the drops: none to reads (an invalid index is never read). They end the write work of 5 ready indexes (the 8 not-ready
-- ones were never written) and take the count of invalid indexes from 16 to 2: idx_observations_vehicle_comment_bid and
-- idx_vehicle_observations_property, each rebuilt by its own PR. DROP INDEX CONCURRENTLY scans no heap; it waits for the
-- transactions that hold the table.
--
-- Build bounds: lock_timeout covers that wait (see 20261006133000: 5 s was too short on a busy table). Both settings are for
-- this session only; the deploy's 120 s ceiling is otherwise untouched. A failed run is safe to repeat: every step is guarded
-- or IF EXISTS. No BEGIN: the deploy applies this file with psql -f in autocommit, and neither statement can run in a block.
SET statement_timeout = '900s';
SET lock_timeout = '180s';

-- 1
SELECT EXISTS (SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('public.idx_ac_classified_vehicle') AND NOT indisvalid) AS d01 \gset
\if :d01
DROP INDEX CONCURRENTLY IF EXISTS public.idx_ac_classified_vehicle;
\endif
-- 2
SELECT EXISTS (SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('public.idx_ac_question_l1') AND NOT indisvalid) AS d02 \gset
\if :d02
DROP INDEX CONCURRENTLY IF EXISTS public.idx_ac_question_l1;
\endif
-- 3
SELECT EXISTS (SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('public.idx_ac_question_l2') AND NOT indisvalid) AS d03 \gset
\if :d03
DROP INDEX CONCURRENTLY IF EXISTS public.idx_ac_question_l2;
\endif
-- 4
SELECT EXISTS (SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('public.idx_ac_unclassified_questions') AND NOT indisvalid) AS d04 \gset
\if :d04
DROP INDEX CONCURRENTLY IF EXISTS public.idx_ac_unclassified_questions;
\endif
-- 5
SELECT EXISTS (SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('public.idx_auction_comments_platform_author') AND NOT indisvalid) AS d05 \gset
\if :d05
DROP INDEX CONCURRENTLY IF EXISTS public.idx_auction_comments_platform_author;
\endif
-- 6
SELECT EXISTS (SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('public.idx_lps_bat_inline_id') AND NOT indisvalid) AS d06 \gset
\if :d06
DROP INDEX CONCURRENTLY IF EXISTS public.idx_lps_bat_inline_id;
\endif
-- 7
SELECT EXISTS (SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('public.idx_vehicle_images_dhash') AND NOT indisvalid) AS d07 \gset
\if :d07
DROP INDEX CONCURRENTLY IF EXISTS public.idx_vehicle_images_dhash;
\endif
-- 8
SELECT EXISTS (SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('public.idx_vehicle_images_orphan_check') AND NOT indisvalid) AS d08 \gset
\if :d08
DROP INDEX CONCURRENTLY IF EXISTS public.idx_vehicle_images_orphan_check;
\endif
-- 9
SELECT EXISTS (SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('public.idx_vehicle_images_pending_review') AND NOT indisvalid) AS d09 \gset
\if :d09
DROP INDEX CONCURRENTLY IF EXISTS public.idx_vehicle_images_pending_review;
\endif
-- 10
SELECT EXISTS (SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('public.idx_vehicle_images_ssd_blast_dedup') AND NOT indisvalid) AS d10 \gset
\if :d10
DROP INDEX CONCURRENTLY IF EXISTS public.idx_vehicle_images_ssd_blast_dedup;
\endif
-- 11
SELECT EXISTS (SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('public.idx_vo_pending_owner_confirmation') AND NOT indisvalid) AS d11 \gset
\if :d11
DROP INDEX CONCURRENTLY IF EXISTS public.idx_vo_pending_owner_confirmation;
\endif
-- 12
SELECT EXISTS (SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('public.idx_vehicles_auto_lower_make') AND NOT indisvalid) AS d12 \gset
\if :d12
DROP INDEX CONCURRENTLY IF EXISTS public.idx_vehicles_auto_lower_make;
\endif
-- 13
SELECT EXISTS (SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('public.idx_vehicles_existence_tier') AND NOT indisvalid) AS d13 \gset
\if :d13
DROP INDEX CONCURRENTLY IF EXISTS public.idx_vehicles_existence_tier;
\endif

-- 14: the same definition as before, pg_get_indexdef on 2026-10-14.
SELECT EXISTS (SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('public.idx_bat_listings_seller_username') AND NOT indisvalid) AS r14 \gset
\if :r14
DROP INDEX CONCURRENTLY IF EXISTS public.idx_bat_listings_seller_username;
\endif
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bat_listings_seller_username
  ON public.bat_listings (seller_username)
  WHERE (seller_username IS NOT NULL);

DO $assert$
DECLARE
  leftover text;
  def text;
BEGIN
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO leftover
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
   WHERE NOT i.indisvalid
     AND c.relnamespace = 'public'::regnamespace
     AND c.relname IN ('idx_ac_classified_vehicle', 'idx_ac_question_l1', 'idx_ac_question_l2', 'idx_ac_unclassified_questions',
                       'idx_auction_comments_platform_author', 'idx_lps_bat_inline_id', 'idx_vehicle_images_dhash',
                       'idx_vehicle_images_orphan_check', 'idx_vehicle_images_pending_review', 'idx_vehicle_images_ssd_blast_dedup',
                       'idx_vo_pending_owner_confirmation', 'idx_vehicles_auto_lower_make', 'idx_vehicles_existence_tier',
                       'idx_bat_listings_seller_username');
  IF leftover IS NOT NULL THEN
    RAISE EXCEPTION 'still INVALID after the sweep: %; DROP INDEX CONCURRENTLY each and re-run', leftover;
  END IF;
  IF NOT coalesce((SELECT indisvalid AND indisready FROM pg_index WHERE indexrelid = to_regclass('public.idx_bat_listings_seller_username')), false) THEN
    RAISE EXCEPTION 'idx_bat_listings_seller_username is missing or INVALID after the build; DROP INDEX CONCURRENTLY public.idx_bat_listings_seller_username and re-run';
  END IF;
  def := pg_get_indexdef(to_regclass('public.idx_bat_listings_seller_username'));
  IF def NOT LIKE '%USING btree (seller_username) WHERE (seller_username IS NOT NULL)' THEN
    RAISE EXCEPTION 'idx_bat_listings_seller_username exists with another definition: %', def;
  END IF;
END
$assert$;

-- Documentation that named a swept index: the is_superseded column comment listed idx_vo_pending_owner_confirmation.
SET lock_timeout = '5s';
DO $comment$
DECLARE
  old_text text;
  new_text text;
BEGIN
  SELECT col_description(a.attrelid, a.attnum) INTO old_text
    FROM pg_attribute a
   WHERE a.attrelid = 'public.vehicle_observations'::regclass AND a.attname = 'is_superseded';
  new_text := replace(old_text,
    'Partial indexes idx_vehicle_observations_property, idx_vo_pending_owner_confirmation and idx_vobs_specs_covering leave superseded rows out.',
    'Partial indexes idx_vehicle_observations_property and idx_vobs_specs_covering leave superseded rows out.');
  IF new_text IS DISTINCT FROM old_text THEN
    EXECUTE format('COMMENT ON COLUMN public.vehicle_observations.is_superseded IS %L', new_text);
  END IF;
END
$comment$;

COMMENT ON INDEX public.idx_bat_listings_seller_username IS
'BaT listings by seller handle (non-null). The track-record read matches seller_username OR seller_external_identity_id; an OR plans as a bitmap union only when both arms have a valid index, so while this one was INVALID the read scanned the whole table (mean 5.4 s). Found INVALID 2026-10-14 (an interrupted concurrent build); rebuilt CONCURRENTLY the same day.';
RESET lock_timeout;
RESET statement_timeout;
