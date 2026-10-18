-- Index the BaT lot slug on the two evidence tables, vehicle_events and bat_listings.
--
-- create_missing_bat_auction_events (PR #687) checks, before it creates a lot, every evidence row for the same lot:
-- other vehicles that name it, rows that disagree about it, and whether vehicle_events holds it. Review of #687 (lead,
-- 2026-10-06): those checks must match on the lower-cased slug, as idx_auction_events_bat_lot_slug and the has_lot test do,
-- not on the exact URL or URL||'/'. The two tables' only URL indexes are exact (vehicle_events.source_url,
-- bat_listings.bat_listing_url), and their BaT URLs vary for one lot. From read-only exports, 2026-10-06:
--   vehicle_events (281,168 BaT rows): 280,230 canonical; 766 with a junk path after the slug (/contact, /N/A, ...);
--     170 with upper case; 2 with another scheme or host.
--   bat_listings (174,518 rows): 173,363 canonical; 979 junk path; 174 upper case; 2 scheme or host.
-- Key: lower(substring(url FROM 'bringatrailer\.com/listing/([^/?#]+)')), the slug of idx_auction_events_bat_lot_slug.
-- vehicle_events is partial on source_platform = 'bat' (the writer's predicate).
--
-- CONCURRENTLY, no BEGIN (psql -f autocommit). Both tables are written continuously (extract-bat-core, the live pull,
-- bat-closed-lots-sync), and CONCURRENTLY waits on the virtual xids of every transaction that started before it; #686 failed
-- on that wait at lock_timeout 5 s. Here lock_timeout bounds waiting for other transactions to finish; it is not a lock on
-- writers. Heaps: vehicle_events 191 MB, bat_listings 133 MB (each read twice). Bounded timeouts, never 0.
SET statement_timeout = '30min';
SET lock_timeout = '10min';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vehicle_events_bat_lot_slug
  ON public.vehicle_events ((lower(substring(source_url FROM 'bringatrailer\.com/listing/([^/?#]+)'))))
  WHERE source_platform = 'bat';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bat_listings_lot_slug
  ON public.bat_listings ((lower(substring(bat_listing_url FROM 'bringatrailer\.com/listing/([^/?#]+)'))));

COMMENT ON INDEX public.idx_vehicle_events_bat_lot_slug IS
'BaT vehicle_events rows by the lower-cased listing slug of source_url, so every row naming one lot is found whatever its URL spelling (case, trailing path, scheme). Used by create_missing_bat_auction_events. Built CONCURRENTLY 2026-10-06.';
COMMENT ON INDEX public.idx_bat_listings_lot_slug IS
'bat_listings rows by the lower-cased listing slug of bat_listing_url, so every row naming one lot is found whatever its URL spelling. Used by create_missing_bat_auction_events. Built CONCURRENTLY 2026-10-06.';
