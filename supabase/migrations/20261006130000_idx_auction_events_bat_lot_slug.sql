-- Index the BaT lot identity on auction_events: the listing slug, whatever vehicle row holds the lot.
--
-- auction_events is the canonical lot (lane L, 2026-10-06; L-LOT-ENTITY.md). Its only URL index is the unique
-- (vehicle_id, source_url), so "does any vehicle already have a lot row for this BaT listing" is a sequential scan of
-- the 287 MB heap (351,145 rows, 2026-10-06). The lot writer for BaT lots never written to auction_events
-- (create_missing_bat_auction_events, next migration) asks that question once per evidence row, so it needs this
-- index. Without it, a same-vehicle check alone would create 1,080 lot rows whose BaT lot already sits on a duplicate
-- vehicle (647 from vehicle_events, 433 from bat_listings; read-only export, 2026-10-06 ~10:45Z), and a probe
-- through the URL indexes of vehicle_events and bat_listings misses 64 of them.
--
-- Key: lower(substring(source_url FROM 'bringatrailer\.com/listing/([^/?#]+)')), the slug lane L used to count
-- BaT lots (L-queries/lot-overlap.sql: 254,825 distinct lots, 235,699 in auction_events). NULL for non-BaT rows.
-- Lower-cased because 183 BaT lot rows carry an upper-case URL; trailing slash, query and fragment fall outside the
-- capture group.
--
-- CONCURRENTLY: no BEGIN in this file on purpose (the deploy applies each file with psql -f in autocommit;
-- precedent 20261006120000_idx_auction_comments_external_identity.sql). The deploy role carries
-- statement_timeout=10s; the build reads the 287 MB heap twice, so the session override is bounded, never 0.
-- A killed build leaves an INVALID index; dropping it is the owner's call.
SET statement_timeout = '30min';
SET lock_timeout = '5s';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_auction_events_bat_lot_slug
  ON public.auction_events ((lower(substring(source_url FROM 'bringatrailer\.com/listing/([^/?#]+)'))));

COMMENT ON INDEX public.idx_auction_events_bat_lot_slug IS
'BaT lot identity: lower-cased listing slug of source_url (NULL for non-BaT rows), across vehicles. Answers whether any vehicle row already holds a lot row for a BaT listing. Used by create_missing_bat_auction_events before it creates a lot from retained evidence. Built CONCURRENTLY 2026-10-06.';
