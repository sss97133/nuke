-- Index unkeyed auction comments by the BaT lot they name (listing slug), so a lot can be found from its comments.
--
-- Lead's ruling 2026-10-06 (lane M): a BaT lot that only a bat-closed-lots-sync feed row records (no vehicle) may be
-- created with the vehicle its comment rows carry, when every comment row on that URL carries one vehicle_id (at least
-- one comment, no dissent). The lander set those vehicle_ids from the same URL match. 2,231 of the 3,361 feed-only
-- lots qualify (147,427 comments, 0 with dissent, 1,130 lots with no comments; lane L's exact pass, 08:26Z).
-- create_missing_bat_auction_events (20261006131500) checks that rule per lot at write time. auction_comments
-- (11 GB, 1,502,188 blocks, 19,975,180 rows; 2026-10-06) has no index on source_url, so the check needs this one.
--
-- Partial on auction_event_id IS NULL: a comment on a lot that no vehicle has a lot row for cannot carry a lot key
-- (every writer keys a comment to a lot row of the same URL, and the key is a validated FK), so the unkeyed rows are all
-- the rows of such a lot. The index holds only unkeyed rows (2,355,074 at 08:26Z, shrinking as key_auction_comment_lots
-- keys them); a row leaves it when it is keyed. Key: the same slug expression as idx_auction_events_bat_lot_slug
-- (20261006130000); NULL for non-BaT URLs.
--
-- CONCURRENTLY, no BEGIN (psql -f autocommit; precedent 20261006120000). The build reads the 11 GB heap twice, the
-- same cost as #680: schedule it when the I/O is free (after lane L's walk keys its 905,733 rows, the index is smaller).
-- statement_timeout bounded, never 0. A killed build leaves an INVALID index; dropping it is the owner's call.
-- lock_timeout 10min, not 5s: CONCURRENTLY waits on the virtual xids of every transaction that started before it, and
-- comments are written continuously (intake, the keying backfills). #686 failed on that wait at 5 s (deploy run
-- 37462471749; rebuilt by #691). Here lock_timeout bounds waiting for other transactions to finish; it is not a lock on
-- writers.
SET statement_timeout = '30min';
SET lock_timeout = '10min';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_auction_comments_unkeyed_lot_slug
  ON public.auction_comments ((lower(substring(source_url FROM 'bringatrailer\.com/listing/([^/?#]+)'))))
  WHERE auction_event_id IS NULL;

COMMENT ON INDEX public.idx_auction_comments_unkeyed_lot_slug IS
'Unkeyed comments (auction_event_id IS NULL) by the lower-cased BaT listing slug of source_url. Answers which vehicles the comment rows of a lot with no lot row carry. Used by create_missing_bat_auction_events (p_source bat_listings_comment_vehicle). Built CONCURRENTLY 2026-10-06.';
