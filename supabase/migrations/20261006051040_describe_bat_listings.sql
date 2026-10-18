-- Describe bat_listings: table purpose, its two clocks, and all 28 columns (0 of 28 described before).
-- Lane C (cartographer), night shift 2026-10-05. Comments only: no data, no DDL beyond COMMENT ON.
--
-- EVIDENCE (read 2026-10-06 UTC):
--   Writers in code: bat-closed-lots-sync (the only live writer; catalogRow() upserts on bat_listing_url, tags
--   raw_data.sync), and before 2026-03-07 extract-auction-comments (listingPayload, raw_data.source =
--   'extract-auction-comments'; commit 216f9c545 moved that writer to vehicle_events). Laptop scripts that also
--   write it: scripts/bat-keep-fresh.mjs (same row shape as catalogRow), scripts/bat-bid-backfill.mjs (fills
--   seller_username where null). Readers: extract-bat-core (finds the row by URL to key bat_bids),
--   bat-price-propagation, mcp-connector, published buyer profile record (20261004040743).
--   Triggers: sync_bat_listing_to_vehicle, trg_sync_bat_listing_to_org_vehicles, trigger_queue_profile_from_listing.
--   Live profile (full scan, 174,296 rows): created_at 2026-01-09 .. 2026-10-05; 1,690 rows from
--   bat-closed-lots-sync since 2026-09-27, all with vehicle_id, seller/buyer and lot number NULL;
--   auction_start_date, reserve_price, starting_bid, seller_bat_user_id, buyer_bat_user_id are NULL on every row;
--   buyer_external_identity_id 0 rows, seller_external_identity_id 4 rows; buyer_username is set on 41,224
--   rows whose listing_status is not 'sold'; sale_price is set on 2,640 rows whose status is not 'sold';
--   42,318 URLs end in '/', 131,978 do not.

SET statement_timeout = '60s';
SET lock_timeout = '10s';

BEGIN;

COMMENT ON TABLE public.bat_listings IS
'Catalog of Bring a Trailer lots: one row per BaT lot URL (grain: one lot). Event time = auction_end_date and sale_date (BaT close date, date only, from the listings-filter feed timestamp). Ingest time = created_at (first landing; rows before 2026-01-09 carry that load date) and scraped_at (last fetch). Live writer: bat-closed-lots-sync (closed lots from the BaT listings-filter feed, raw_data.sync tags the version); 2026-01..03 rows came from extract-auction-comments, which moved to vehicle_events on 2026-03-07. Rows written since 2026-09-27 carry no vehicle_id, seller, buyer or lot number. Live lots have no row until they close, so bat_bids for a live lot cannot key here (see bat_bids). auction_events is the per-lot record extract-bat-core writes.';

COMMENT ON COLUMN public.bat_listings.id IS
'Surrogate key of the lot row. Unit: none (uuid). Source: gen_random_uuid() default. Grain: one BaT lot. Clock: n/a. Referenced without a foreign key by bat_bids.bat_listing_id.';
COMMENT ON COLUMN public.bat_listings.vehicle_id IS
'Vehicle this lot sold or offered, FK to vehicles.id (NOT VALID, ON DELETE RESTRICT). Unit: none. Source: extract-auction-comments for 2026-01..03 rows; bat-closed-lots-sync never sets it (NULL on all 1,690 of its rows). Grain: one BaT lot. Clock: n/a.';
COMMENT ON COLUMN public.bat_listings.organization_id IS
'Organization (dealer/seller org) linked to the lot, FK to organizations.id. Unit: none. Source: UNKNOWN writer; set on 77 of 174,296 rows (2026-10-06); read by trigger trg_sync_bat_listing_to_org_vehicles. Grain: one BaT lot. Clock: n/a.';
COMMENT ON COLUMN public.bat_listings.bat_listing_url IS
'BaT lot page URL, the natural key (UNIQUE). Unit: none. Source: bat-closed-lots-sync writes https://bringatrailer.com/listing/<slug>/ lower-case with trailing slash; older rows have no trailing slash (131,978 of 174,296), so join on both forms. Grain: one BaT lot. Clock: n/a.';
COMMENT ON COLUMN public.bat_listings.bat_lot_number IS
'BaT listing id as text (numeric on 118,355 of 119,504 filled rows; some rows hold junk up to 304 chars). Unit: none. Source: extract-auction-comments (external_listings.listing_id) for 2026-01..03 rows; bat-closed-lots-sync does not set it (its value is in raw_data->>id). Grain: one BaT lot. Clock: n/a.';
COMMENT ON COLUMN public.bat_listings.bat_listing_title IS
'Lot title as BaT publishes it, HTML entities decoded. Unit: none. Source: bat-closed-lots-sync (feed item title); NULL on most older rows (18,715 of 174,296 filled). Grain: one BaT lot. Clock: n/a.';
COMMENT ON COLUMN public.bat_listings.auction_start_date IS
'Intended auction start date. Unit: date. Source: none; NULL on every row (2026-10-06). Migration 20251211150100 once derived it as end date minus 7 days. Grain: one BaT lot. Clock: event (would be the BaT start date).';
COMMENT ON COLUMN public.bat_listings.auction_end_date IS
'Date the BaT auction closed. Unit: date (UTC day of the feed timestamp, no time of day). Source: bat-closed-lots-sync from sold_text_timestamp or timestamp_end; extract-auction-comments inferred it for older rows. Grain: one BaT lot. Clock: event (BaT close).';
COMMENT ON COLUMN public.bat_listings.sale_date IS
'Date the lot sold; NULL when it did not sell. Unit: date. Source: bat-closed-lots-sync sets it to auction_end_date only when sold_text contains Sold for; extract-auction-comments set it when it inferred a final price. Grain: one BaT lot. Clock: event (BaT close of a sold lot).';
COMMENT ON COLUMN public.bat_listings.sale_price IS
'Hammer price of a sold lot. Unit: USD, whole dollars, buyer fee excluded. Source: bat-closed-lots-sync (feed current_bid when sold); extract-auction-comments for older rows. 2,640 rows have it while listing_status is not sold (2026-10-06), so read it with listing_status. Grain: one BaT lot. Clock: event (value at close).';
COMMENT ON COLUMN public.bat_listings.reserve_price IS
'Reserve amount. Unit: USD. Source: none; NULL on every row (BaT does not publish reserves). Grain: one BaT lot. Clock: n/a.';
COMMENT ON COLUMN public.bat_listings.starting_bid IS
'Opening bid. Unit: USD. Source: none; NULL on every row (2026-10-06). Grain: one BaT lot. Clock: n/a.';
COMMENT ON COLUMN public.bat_listings.final_bid IS
'Highest bid at close, sold or not. Unit: USD, whole dollars. Source: bat-closed-lots-sync (feed current_bid); extract-auction-comments (final price, else highest bid in the comment thread). Grain: one BaT lot. Clock: event (value at close).';
COMMENT ON COLUMN public.bat_listings.seller_username IS
'BaT handle of the seller as text; names an external_identities row (platform bat) but is not keyed to it. Unit: none. Source: extract-auction-comments for 2026-01..03 rows, scripts/bat-bid-backfill.mjs fills it where NULL; bat-closed-lots-sync never sets it. Copied to vehicles.bat_seller by trigger sync_bat_listing_to_vehicle. Grain: one BaT lot. Clock: n/a.';
COMMENT ON COLUMN public.bat_listings.buyer_username IS
'BaT handle of the winning bidder as text; not keyed to external_identities. Unit: none. Source: historical loaders (2026-01..03); no current writer in repo sets it, bat-closed-lots-sync never does. It is set on 41,224 rows whose listing_status is not sold (2026-10-06), where it is at most the high bidder, not a buyer. Copied to vehicles.bat_buyer by trigger sync_bat_listing_to_vehicle. Grain: one BaT lot. Clock: n/a.';
COMMENT ON COLUMN public.bat_listings.seller_bat_user_id IS
'Seller as FK to bat_users.id. Unit: none. Source: none; NULL on every row (2026-10-06). Grain: one BaT lot. Clock: n/a.';
COMMENT ON COLUMN public.bat_listings.buyer_bat_user_id IS
'Buyer as FK to bat_users.id. Unit: none. Source: none; NULL on every row (2026-10-06). Grain: one BaT lot. Clock: n/a.';
COMMENT ON COLUMN public.bat_listings.comment_count IS
'Number of comments counted on the lot when the row was last written. Unit: count. Source: extract-auction-comments (comments it parsed) for 2026-01..03 rows; bat-closed-lots-sync leaves the default 0 and keeps the feed count in raw_data->>comments. 0 means not counted, not no comments. Grain: one BaT lot. Clock: derived (as of last_updated_at).';
COMMENT ON COLUMN public.bat_listings.bid_count IS
'Number of bid comments counted on the lot when the row was last written. Unit: count. Source: extract-auction-comments for 2026-01..03 rows; bat-closed-lots-sync leaves the default 0. 0 means not counted. Grain: one BaT lot. Clock: derived (as of last_updated_at).';
COMMENT ON COLUMN public.bat_listings.view_count IS
'Page views of the lot. Unit: count. Source: UNKNOWN writer; > 0 on 1,380 of 174,296 rows (2026-10-06). bat-closed-lots-sync keeps the feed views in raw_data->>views instead. Grain: one BaT lot. Clock: derived (as of an unknown read).';
COMMENT ON COLUMN public.bat_listings.listing_status IS
'Lot outcome: active, ended, sold, no_sale or cancelled (CHECK). Unit: none. Source: bat-closed-lots-sync writes sold when the feed sold_text contains Sold for, else ended; extract-auction-comments inferred it for older rows. ended covers reserve not met and withdrawn. 444 rows still say active (2026-10-06). Grain: one BaT lot. Clock: n/a (state as of last_updated_at).';
COMMENT ON COLUMN public.bat_listings.scraped_at IS
'When the source was last read for this row. Unit: timestamptz (UTC). Source: bat-closed-lots-sync sets now() on every upsert; default now() on insert. Grain: one BaT lot. Clock: ingest.';
COMMENT ON COLUMN public.bat_listings.last_updated_at IS
'When a writer last changed the lot fields. Unit: timestamptz (UTC). Source: extract-auction-comments and scripts/bat-bid-backfill.mjs set now(); default now() on insert. Grain: one BaT lot. Clock: ingest.';
COMMENT ON COLUMN public.bat_listings.raw_data IS
'Source payload as JSON. bat-closed-lots-sync: the whole listings-filter feed item (id, title, current_bid, sold_text, timestamp_end, views, watchers, comments, lat, lon, country, noreserve) plus sync = writer version. extract-auction-comments: {source, auction_event_id, last_extracted_at}. Unit: none. Grain: one BaT lot. Clock: n/a.';
COMMENT ON COLUMN public.bat_listings.created_at IS
'When the row was inserted. Unit: timestamptz (UTC). Source: default now(). The earliest value is 2026-01-09: rows for lots first seen before then carry that load date. Grain: one BaT lot. Clock: ingest.';
COMMENT ON COLUMN public.bat_listings.updated_at IS
'When the row was last updated. Unit: timestamptz (UTC). Source: writers set now() (extract-auction-comments); default now() on insert. Grain: one BaT lot. Clock: ingest.';
COMMENT ON COLUMN public.bat_listings.seller_external_identity_id IS
'Seller as FK to external_identities.id. Unit: none. Source: migration 20250129_link_bat_listings_to_external_identities backfilled it once; no current writer; set on 4 of 174,296 rows (2026-10-06). Setting it fires trigger_queue_profile_from_listing. Grain: one BaT lot. Clock: n/a.';
COMMENT ON COLUMN public.bat_listings.buyer_external_identity_id IS
'Buyer as FK to external_identities.id. Unit: none. Source: no current writer; NULL on every row (2026-10-06). The buyer is only in buyer_username text. Grain: one BaT lot. Clock: n/a.';

COMMIT;
