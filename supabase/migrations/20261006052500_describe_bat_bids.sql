-- Describe bat_bids: table purpose with its structural break, its two clocks, and all 16 columns
-- (1 of 16 described before; the bat_listing_id comment is rewritten with measurements).
-- Lane C (cartographer), night shift 2026-10-05. Comments only.
--
-- EVIDENCE (read 2026-10-06 UTC):
--   Created by 20250130_create_bat_bids_table.sql with bat_listing_id UUID NOT NULL REFERENCES bat_listings(id)
--   ON DELETE CASCADE (default name bat_bids_bat_listing_id_fkey). Live pg_constraint has no such FK; no
--   migration in the repo drops it (drift: dropped on prod directly). The column stays NOT NULL.
--   Writers: extract-bat-core (v4.1+, bids from the lot page comments JSON; writes only when a bat_listings row
--   exists for the lot URL; metadata.extractor set), extract-auction-comments (keys bat_listing_id to its
--   vehicle_events row; no rows from it in the last 30 d), sync-live-auctions recordBidSnapshots (source
--   'bid_history', bat_username 'bid_snapshot', bid_timestamp = poll time; retired 2026-09-29 in #447, last row
--   2026-07-22). is_winning_bid / is_final_bid: one batch backfill (20260215500000_bid_analytics_foundation.sql
--   templates); writers insert false.
--   Live profile (tablesample 1%, n=49,877): bat_user_id 0, bat_comment_id 0, external_identity_id 82%,
--   auction_event_id 74%; extract-bat-core rows: external_identity_id 559 of 3,665, flags all false.
--   bat_listing_id target (tablesample 0.5%, n=24,833): bat_listings 22,731, vehicle_events 2,102, neither 0;
--   last 30 d 1,545 of 1,545 to bat_listings. auction_event_id resolves to auction_events 11,807 of 11,807.
--   migration 20260930000000_bat_live_pull.sql: live lots have no bat_listings row (0 of 1,213 on 2026-09-29),
--   so during the auction their bids exist only as auction_comments rows (comment_type 'bid').

SET statement_timeout = '60s';
SET lock_timeout = '10s';

BEGIN;

COMMENT ON TABLE public.bat_bids IS
'Bids on Bring a Trailer lots: one row per bid (grain: one bid by one bidder at one amount and moment on one lot). Event time = bid_timestamp (BaT comment time of the bid; poll time for source bid_history). Ingest time = created_at. Idempotency key: (bat_listing_id, bat_username, bid_amount, bid_timestamp). STRUCTURAL BREAK: bat_listing_id is NOT NULL but its FK bat_bids_bat_listing_id_fkey (to bat_listings, from 20250130_create_bat_bids_table) no longer exists on prod; 91.5% of rows point at bat_listings.id and 8.5% at vehicle_events.id (2026-10-06 sample). The live lander extract-bat-core writes a bid only when the lot already has a bat_listings row, which live lots never have (bat-closed-lots-sync creates it after close), so live bids exist only in auction_comments (comment_type bid) until settlement. auction_events, which extract-bat-core does write for every lot, is the lot record; auction_event_id keys to it on 74% of rows.';

COMMENT ON COLUMN public.bat_bids.id IS
'Surrogate key of the bid row. Unit: none (uuid). Source: gen_random_uuid() default. Grain: one bid. Clock: n/a.';
COMMENT ON COLUMN public.bat_bids.bat_listing_id IS
'Lot the bid was placed on, with no foreign key (the FK to bat_listings was dropped on prod outside migrations). Points at bat_listings.id (extract-bat-core, every row of the last 30 d) or at vehicle_events.id (extract-auction-comments and the retired sync-live-auctions snapshot path); sample 2026-10-06: 22,731 bat_listings, 2,102 vehicle_events, 0 orphans of 24,833. NOT NULL, so a lot without a bat_listings row gets no bid rows. Unit: none. Grain: one bid. Clock: n/a.';
COMMENT ON COLUMN public.bat_bids.vehicle_id IS
'Vehicle the lot offered, FK to vehicles.id (ON DELETE CASCADE). Unit: none. Source: the writer of the bid (extract-bat-core, extract-auction-comments). Filled on every sampled row. Grain: one bid. Clock: n/a.';
COMMENT ON COLUMN public.bat_bids.bat_user_id IS
'Bidder as FK to bat_users.id. Unit: none. Source: every writer sends NULL; NULL on all 49,877 sampled rows (2026-10-06). Use external_identity_id. Grain: one bid. Clock: n/a.';
COMMENT ON COLUMN public.bat_bids.bat_username IS
'Bidder BaT handle as text, as shown on the bid comment; names an external_identities row (platform bat). The value bid_snapshot marks a sync-live-auctions price snapshot, not a person. Unit: none. Source: comment author_username from extract-bat-core / extract-auction-comments. Grain: one bid. Clock: n/a.';
COMMENT ON COLUMN public.bat_bids.external_identity_id IS
'Bidder as FK to external_identities.id. Unit: none. Source: extract-auction-comments sets it from the comment identity link; extract-bat-core does not send it, so its rows keep a value only where an earlier writer of the same bid set one (559 of 3,665 sampled). 82% filled overall (2026-10-06 sample). Grain: one bid. Clock: n/a.';
COMMENT ON COLUMN public.bat_bids.bid_amount IS
'Bid amount. Unit: USD (numeric 12,2; BaT bids are whole dollars). Source: the bid comment amount parsed by extract-bat-core / extract-auction-comments; for source bid_history the lot current bid at poll time. Grain: one bid. Clock: n/a (value at bid_timestamp).';
COMMENT ON COLUMN public.bat_bids.bid_timestamp IS
'When the bid was placed. Unit: timestamptz (UTC). Source: the bid comment posted_at (BaT time) for source comment; for source bid_history it is the sync-live-auctions poll time, not the bid time. Range 2014-08-21 .. 2026-10-03 (2026-10-06 sample). Grain: one bid. Clock: event (BaT comment time).';
COMMENT ON COLUMN public.bat_bids.is_winning_bid IS
'True on the last bid of a lot whose vehicle sale_status was sold, as of the one-time backfill of 2026-02-15 (20260215500000_bid_analytics_foundation). Writers insert false and nothing maintains it: false on every extract-bat-core row. Unit: boolean. Grain: one bid. Clock: derived (as of 2026-02-15).';
COMMENT ON COLUMN public.bat_bids.is_final_bid IS
'True on the latest bid of each bat_listing_id, as of the one-time backfill of 2026-02-15 (20260215500000_bid_analytics_foundation). Writers insert false and nothing maintains it. Unit: boolean. Grain: one bid. Clock: derived (as of 2026-02-15).';
COMMENT ON COLUMN public.bat_bids.source IS
'How the bid was captured: comment (a bid comment in the lot thread; extract-bat-core, extract-auction-comments), bid_history (sync-live-auctions current-bid snapshot, 2026-02-19 .. 2026-07-22, retired #447) or manual (CHECK; none sampled). Unit: none. Grain: one bid. Clock: n/a.';
COMMENT ON COLUMN public.bat_bids.bat_comment_id IS
'Intended link to the bid comment row (uuid). Unit: none. Source: writers send NULL (extract-auction-comments notes the BaT integer comment id lives in auction_comments.bat_comment_id); NULL on every sampled row (2026-10-06). Join to auction_comments by metadata.comment_content_hash instead. Grain: one bid. Clock: n/a.';
COMMENT ON COLUMN public.bat_bids.auction_event_id IS
'Lot record, auction_events.id (no FK constraint; 11,807 of 11,807 sampled values resolve). Unit: none. Source: extract-bat-core and extract-auction-comments set it to the auction_events row they wrote. Filled on 74% of rows (2026-10-06 sample). Grain: one bid. Clock: n/a.';
COMMENT ON COLUMN public.bat_bids.metadata IS
'Writer context as JSON: source_url, comment_content_hash (joins to auction_comments.content_hash), sequence_number (position in the thread), extractor (extract-bat-core version), or source sync_live_auctions on snapshot rows. Unit: none. Grain: one bid. Clock: n/a.';
COMMENT ON COLUMN public.bat_bids.created_at IS
'When the bid row was inserted. Unit: timestamptz (UTC). Source: default now(). Earliest value 2026-01-09 (bulk load); bids older than that carry the load date. Grain: one bid. Clock: ingest.';
COMMENT ON COLUMN public.bat_bids.updated_at IS
'When the bid row was last upserted. Unit: timestamptz (UTC). Source: writers set now() on every upsert. Grain: one bid. Clock: ingest.';

COMMIT;
