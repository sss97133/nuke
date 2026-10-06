-- Describe vehicle_events: table purpose (corrected), its clocks, and all 31 columns (0 of 31 described before).
-- Lane C (cartographer), night shift 2026-10-05. Comments only.
--
-- EVIDENCE (read 2026-10-06 UTC):
--   The old table comment said it "replaces bat_listings and external_listings". bat_listings is still written
--   (bat-closed-lots-sync, 1,690 rows since 2026-09-27), so the two coexist; the comment is rewritten.
--   Rows are updated in place (extract-bat-core manual upsert keyed on vehicle_id + source_platform +
--   source_listing_id; ingest_bat_live_events in 20261004182500 updates prices/counts/status from live frames;
--   trigger preserve_bat_live_projection guards metadata.live_stream). It is a per-listing state row, not a log.
--   Writers seen (5% sample by writer marker): extract-bat-core 2026-01-11 .. 2026-10-06; extract-auction-comments
--   2026-01-09 .. 2026-03-07; orphan-backfill-v1 2025-09-08 .. 2026-03-20; import_queue_drain, fb-saved-connector,
--   cab_backfill_v4 and others once each. 21 edge functions write it in code (extract-mecum, extract-barrett-jackson,
--   extract-gooding, extract-bonhams, import-pcarmarket-listing, process-cl-queue, ...).
--   Last 30 d: 56,239 rows created; a 20% sample of them is bat (11,146) and pcarmarket (2) only.
--   extract-auction-comments upserts ON CONFLICT (source_url), and prod has no unique index on source_url alone.
--   Full-table fill (471,391 rows): started_at 0, starting_price 1, buy_now_price 1, reserve_price 20,
--   extractor_version 1, buyer_external_identity_id 0, seller_external_identity_id 35,745, source_organization_id
--   50,361, ended_at 190,438, sold_at 273,100, final_price 350,490. FK in: vehicle_observations.source_vehicle_event_id;
--   bat_bids.bat_listing_id points here on 8.5% of bids without a FK.

SET statement_timeout = '60s';
SET lock_timeout = '10s';

BEGIN;

COMMENT ON TABLE public.vehicle_events IS
'One row per appearance of a vehicle on a listing platform (grain: vehicle x platform x listing), holding that listing''s current state; rows are updated in place, so this is a state table, not an append-only log. Event time = ended_at and sold_at (source close and sale; started_at is never filled). Ingest time = created_at (first landing) and extracted_at. Covers every platform (bat 281K of 471K rows, mecum, barrettjackson, cars_and_bids, facebook_marketplace, ...). Live writers (last 30 d): extract-bat-core for BaT lots and ingest_bat_live_events for live BaT frames. It did not replace bat_listings: bat-closed-lots-sync still writes that catalog. auction_events holds the per-lot result row that comments and bids key to.';

COMMENT ON COLUMN public.vehicle_events.id IS
'Surrogate key of the listing row. Unit: none (uuid). Source: gen_random_uuid() default. Referenced by vehicle_observations.source_vehicle_event_id (FK) and, without a FK, by 8.5% of bat_bids.bat_listing_id. Grain: one vehicle listing. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_events.vehicle_id IS
'Vehicle listed, FK to vehicles.id (NOT VALID, ON DELETE RESTRICT). NOT NULL. Unit: none. Source: the extractor that resolved the vehicle. Grain: one vehicle listing. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_events.source_organization_id IS
'Organization that listed or sold the vehicle, FK to organizations.id. Unit: none. Source: extract-bat-core seller-to-organization resolution (sets it where NULL); other extractors. Filled on 50,361 of 471,391 rows (2026-10-06). Grain: one vehicle listing. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_events.source_platform IS
'Platform the listing is on, as a free-text slug: bat, mecum, barrettjackson, cars_and_bids, facebook_marketplace, craigslist, pcarmarket, ...; some rows hold a dealer name instead (Beverly Hills Car Club). Not keyed to a platform table. Unit: none. Source: the writing extractor. Grain: one vehicle listing. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_events.source_url IS
'Listing page URL. Unit: none. Source: the writing extractor (extract-bat-core writes the canonical BaT lot URL). Not unique on its own; unique per (vehicle_id, source_platform, source_url) when source_listing_id is NULL. Grain: one vehicle listing. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_events.source_listing_id IS
'Listing identity on the platform: a numeric BaT lot id on older rows, a normalized URL key (normalizeListingUrlKey) from extract-bat-core, else the lot number. Unique per (vehicle_id, source_platform, source_listing_id). Unit: none. Source: the writing extractor. Grain: one vehicle listing. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_events.event_type IS
'Kind of listing: auction (default) or listing (fixed-price). No CHECK constraint. Unit: none. Source: the writing extractor. Grain: one vehicle listing. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_events.event_status IS
'Current state of the listing: sold, ended, active, unsold, bid-goes-on, listed, pending (no CHECK). extract-bat-core: sold when a sale price exists, active while the end time is ahead, else ended; ingest_bat_live_events keeps it current during a live BaT lot. Unit: none. Grain: one vehicle listing. Clock: n/a (state as of updated_at).';
COMMENT ON COLUMN public.vehicle_events.started_at IS
'When the listing opened. Unit: timestamptz. Source: none; NULL on every row (2026-10-06). Grain: one vehicle listing. Clock: event (would be source open time).';
COMMENT ON COLUMN public.vehicle_events.ended_at IS
'When the listing closed or is scheduled to close. Unit: timestamptz (UTC). Source: extract-bat-core writes the BaT end time, or midnight UTC of the end date when only the date is known; ingest_bat_live_events moves it with live extensions. Grain: one vehicle listing. Clock: event (source close).';
COMMENT ON COLUMN public.vehicle_events.sold_at IS
'When the vehicle sold through this listing; NULL if not sold. Unit: timestamptz (UTC). Source: extract-bat-core sets it to ended_at when a sale price exists; ingest_bat_live_events sets the frame sale time. Grain: one vehicle listing. Clock: event (source sale).';
COMMENT ON COLUMN public.vehicle_events.starting_price IS
'Opening bid or opening ask. Unit: listing currency. Source: none current; 1 of 471,391 rows (2026-10-06). Grain: one vehicle listing. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_events.current_price IS
'Latest price on the listing: the sale price when sold, else the high bid or ask. Unit: listing currency as published (USD for BaT; no currency column). Source: extract-bat-core; ingest_bat_live_events from metadata-updated frames. Grain: one vehicle listing. Clock: derived (as of updated_at).';
COMMENT ON COLUMN public.vehicle_events.final_price IS
'Sale price when the listing sold; NULL otherwise. Unit: listing currency (USD for BaT), buyer fee excluded on BaT. Source: extract-bat-core, ingest_bat_live_events, other extractors. Grain: one vehicle listing. Clock: event (value at sale).';
COMMENT ON COLUMN public.vehicle_events.reserve_price IS
'Reserve amount. Unit: listing currency. Source: none current; 20 of 471,391 rows (2026-10-06). Grain: one vehicle listing. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_events.buy_now_price IS
'Buy-it-now price. Unit: listing currency. Source: none current; 1 of 471,391 rows (2026-10-06). Grain: one vehicle listing. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_events.bid_count IS
'Number of bids on the listing as last read. Unit: count. Source: extract-bat-core (page bid count), ingest_bat_live_events (live frame), other extractors. Default 0, so 0 can mean not read. Grain: one vehicle listing. Clock: derived (as of updated_at).';
COMMENT ON COLUMN public.vehicle_events.comment_count IS
'Number of comments on the listing as last counted. Unit: count. Source: extract-auction-comments (through 2026-03-07) and other extractors; extract-bat-core keeps its count in metadata->>comment_count instead. Default 0, so 0 can mean not counted. Grain: one vehicle listing. Clock: derived (as of updated_at).';
COMMENT ON COLUMN public.vehicle_events.view_count IS
'Page views of the listing as last read. Unit: count. Source: extract-bat-core, ingest_bat_live_events (stats frames). Default 0. Grain: one vehicle listing. Clock: derived (as of updated_at).';
COMMENT ON COLUMN public.vehicle_events.watcher_count IS
'Watchers of the listing as last read. Unit: count. Source: extract-bat-core, ingest_bat_live_events (stats frames). Default 0. Grain: one vehicle listing. Clock: derived (as of updated_at).';
COMMENT ON COLUMN public.vehicle_events.seller_identifier IS
'Seller handle or name as text; mostly an empty string on BaT rows (6,689 empty vs 219 non-empty in a 5% sample, 2026-10-06). Not keyed. Unit: none. Source: historical loaders; no current edge function writes it (extract-bat-core puts the seller in metadata->>seller_username). Grain: one vehicle listing. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_events.buyer_identifier IS
'Buyer handle or name as text (BaT: winning bidder handle); empty string on many rows. Not keyed. Unit: none. Source: historical loaders; no current edge function writes it (extract-bat-core puts the buyer in metadata->>buyer_username). Grain: one vehicle listing. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_events.seller_external_identity_id IS
'Seller as FK-less link to external_identities.id. Unit: none. Source: extract-bat-core seller-to-organization resolution. Filled on 35,745 of 471,391 rows (2026-10-06). Grain: one vehicle listing. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_events.buyer_external_identity_id IS
'Buyer as link to external_identities.id. Unit: none. Source: none; NULL on every row (2026-10-06). Grain: one vehicle listing. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_events.metadata IS
'Writer payload as JSON. metadata->>source names the writer (extract-bat-core, extract-auction-comments, cab_backfill_v4, ...). extract-bat-core adds source_read {at, basis}, lot_number, seller_username, buyer_username, reserve_status, comment_count and image URLs. metadata->live_stream is the live BaT projection that trigger preserve_bat_live_projection protects from stale reads. Unit: none. Grain: one vehicle listing. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_events.extracted_at IS
'When an extractor last extracted the listing. Unit: timestamptz (UTC). Source: default now() at insert; extract-auction-comments refreshed it on each pass. Grain: one vehicle listing. Clock: ingest.';
COMMENT ON COLUMN public.vehicle_events.extraction_method IS
'Bulk path that created the row: orphan-backfill-v1, import_queue_drain, fb-saved-connector, ...; NULL for most extractor writes. Unit: none. Source: the backfill or connector named. Grain: one vehicle listing. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_events.extraction_source IS
'Function that extracted the row; extract-auction-comments is the only value seen (2026-10-06 sample); NULL otherwise. Unit: none. Grain: one vehicle listing. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_events.extractor_version IS
'Extractor version string. Unit: none. Source: none current; 1 of 471,391 rows (bonhams-v3-manual-fix). Use metadata->>source. Grain: one vehicle listing. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_events.created_at IS
'When the row was inserted. Unit: timestamptz (UTC). Source: default now(). Earliest 2025-09-08. Grain: one vehicle listing. Clock: ingest.';
COMMENT ON COLUMN public.vehicle_events.updated_at IS
'When the row was last written. Unit: timestamptz (UTC). Source: writers set now() (extract-bat-core on every read). Grain: one vehicle listing. Clock: ingest.';

COMMIT;
