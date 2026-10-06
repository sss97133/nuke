-- Describe auction_events: table purpose, its clocks, and the 44 undescribed columns (4 of 48 described before:
-- scraped_at, broadcast_timestamp_start, broadcast_timestamp_end, forensics_data; those four are left as they are).
-- Lane C (cartographer), night shift 2026-10-05. Comments only.
--
-- EVIDENCE (read 2026-10-06 UTC):
--   Writers: extract-bat-core (upsert ON CONFLICT (vehicle_id, source_url), payload at index.ts ~2611),
--   ingest_bat_live_events (20261004182500: inserts the 'live' row; sets high_bid, total_bids, outcome,
--   winning_bid, winning_bidder and raw_data.live_stream from live frames), extract-cars-and-bids-core /
--   extract-cab-bids (bid_history), the vehicle merge in 20260708133823 (merged_from_vehicle_id),
--   analyze-auction-comments (AI receipt columns; removed in 43b72deae), the broadcast feature (5a4b589da).
--   Triggers: auto_create_transfer_on_auction_close (writes ownership_transfers when outcome changes),
--   preserve_bat_live_projection.
--   Full-table profile (350,790 rows): source bat 244,306 (55,929 created in the last 30 d), barrett-jackson 78,336,
--   mecum 23,515, bonhams 2,772, others < 1,000; non-bat rows all created 2025-12 .. 2026-04. outcome: sold 289,230,
--   reserve_not_met 51,027, live 6,291, no_sale 2,245, bid_to 1,993, pending 4. Zero rows: auction_duration_hours,
--   reserve_price, reserve_disclosed true, buy_it_now_price, market_insights, price_vs_estimate_pct, reserve_gap_pct,
--   broadcast_clip_url, merged_from_vehicle_id. FK in: auction_comments.auction_event_id, auction_event_links (from/to).

SET statement_timeout = '60s';
SET lock_timeout = '10s';

BEGIN;

COMMENT ON TABLE public.auction_events IS
'One row per auction lot of a vehicle (grain: vehicle x lot URL; unique on vehicle_id, source_url), holding the lot''s result and counts. Rows are rewritten as the lot is re-read, so this is the lot state record, not an append-only log. Event time = auction_end_date (source close; auction_start_date rarely filled). Ingest time = created_at (first landing) and scraped_at (page fetch time of the read that last wrote the row). Live writers: extract-bat-core (every BaT lot read, live or closed) and ingest_bat_live_events (live frames). auction_comments.auction_event_id and bat_bids.auction_event_id key to it.';

COMMENT ON COLUMN public.auction_events.id IS
'Surrogate key of the lot row. Unit: none (uuid). Source: gen_random_uuid() default. Referenced by auction_comments.auction_event_id, auction_event_links and (no FK) bat_bids.auction_event_id. Grain: one lot. Clock: n/a.';
COMMENT ON COLUMN public.auction_events.vehicle_id IS
'Vehicle offered in the lot, FK to vehicles.id (NOT VALID, ON DELETE RESTRICT). Filled on every row. Unit: none. Source: the writing extractor. Grain: one lot. Clock: n/a.';
COMMENT ON COLUMN public.auction_events.source IS
'Auction platform slug: bat (244,306), barrett-jackson, mecum, bonhams, cars_and_bids, facebook_marketplace, bringatrailer (140 rows, same platform as bat), collecting-cars, pcarmarket, hagerty, Broad Arrow. Free text, not keyed. Unit: none. Source: the writing extractor. Grain: one lot. Clock: n/a.';
COMMENT ON COLUMN public.auction_events.source_url IS
'Lot page URL; with vehicle_id the natural key (unique index idx_auction_events_vehicle_source_url). Unit: none. Source: extract-bat-core writes the canonical BaT lot URL; ingest_bat_live_events the frame URL. Grain: one lot. Clock: n/a.';
COMMENT ON COLUMN public.auction_events.source_listing_id IS
'Platform listing id; extract-bat-core writes the BaT lot number here and in lot_number. Unit: none. Source: the writing extractor. Filled on 245,402 of 350,790 rows. Grain: one lot. Clock: n/a.';
COMMENT ON COLUMN public.auction_events.lot_number IS
'Lot number as the auction house publishes it (BaT lot number; Barrett-Jackson, Mecum, Bonhams lot numbers). Unit: none. Source: the writing extractor. Filled on 343,062 of 350,790 rows. Grain: one lot. Clock: n/a.';
COMMENT ON COLUMN public.auction_events.auction_start_date IS
'When the auction opened. Unit: timestamptz. Source: Mecum and Facebook Marketplace extractors only; 3,909 of 350,790 rows (2026-10-06). Grain: one lot. Clock: event (source open).';
COMMENT ON COLUMN public.auction_events.auction_end_date IS
'When the auction closed or is scheduled to close. Unit: timestamptz (UTC). Source: extract-bat-core writes the BaT end time, or midnight UTC of the end date when only the date is known; ingest_bat_live_events moves it with live extensions. Filled on 225,362 of 350,790 rows. Grain: one lot. Clock: event (source close).';
COMMENT ON COLUMN public.auction_events.auction_duration_hours IS
'Auction length. Unit: hours. Source: none; NULL on every row (2026-10-06); compute-org-seller-stats reads it. Grain: one lot. Clock: n/a.';
COMMENT ON COLUMN public.auction_events.outcome IS
'Lot result (CHECK): sold, reserve_not_met, no_sale, bid_to, cancelled, relisted, pending, live. extract-bat-core: sold when a sale price exists; live while the end time is ahead; reserve_not_met when the page says so; bid_to when there is a high bid but no sale; else no_sale. ingest_bat_live_events sets the frame outcome and never downgrades a sold. Changing it fires auto_create_transfer_on_auction_close. Unit: none. Grain: one lot. Clock: n/a (state as of updated_at).';
COMMENT ON COLUMN public.auction_events.starting_bid IS
'Opening bid. Unit: listing currency. Source: UNKNOWN writer (none in current code); 629 of 350,790 rows (2026-10-06). Grain: one lot. Clock: n/a.';
COMMENT ON COLUMN public.auction_events.reserve_price IS
'Reserve amount. Unit: listing currency. Source: none; NULL on every row (2026-10-06). Grain: one lot. Clock: n/a.';
COMMENT ON COLUMN public.auction_events.reserve_disclosed IS
'Whether the reserve amount was published. Unit: boolean. Source: none; false (default) on every row (2026-10-06). Grain: one lot. Clock: n/a.';
COMMENT ON COLUMN public.auction_events.high_bid IS
'Highest bid on the lot: the sale price when sold, else the latest high bid. Unit: listing currency (USD for BaT). Source: extract-bat-core; ingest_bat_live_events from metadata-updated frames during a live lot. Grain: one lot. Clock: derived (as of scraped_at or the last live frame).';
COMMENT ON COLUMN public.auction_events.winning_bid IS
'Hammer price of a sold lot; NULL otherwise. Unit: listing currency (USD for BaT), buyer fee excluded. Source: extract-bat-core (sale price); ingest_bat_live_events (frame sale amount). Grain: one lot. Clock: event (value at sale).';
COMMENT ON COLUMN public.auction_events.buy_it_now_price IS
'Buy-it-now price. Unit: listing currency. Source: none; NULL on every row (2026-10-06). Grain: one lot. Clock: n/a.';
COMMENT ON COLUMN public.auction_events.total_bids IS
'Number of bids on the lot as last read. Unit: count. Source: extract-bat-core (page bid count); ingest_bat_live_events (frame bid_count). Grain: one lot. Clock: derived (as of scraped_at or the last live frame).';
COMMENT ON COLUMN public.auction_events.unique_bidders IS
'Number of distinct bidder handles in the lot comment thread. Unit: count. Source: extract-bat-core (parsed comments, BaT only); 59,528 of 350,790 rows. Grain: one lot. Clock: derived (as of scraped_at).';
COMMENT ON COLUMN public.auction_events.bid_history IS
'Bid list as JSON from the platform. Unit: none. Source: extract-cars-and-bids-core / extract-cab-bids (Cars and Bids); 886 of 350,790 rows. BaT bids live in auction_comments and bat_bids instead. Grain: one lot. Clock: n/a.';
COMMENT ON COLUMN public.auction_events.high_bidder IS
'Handle of the current high bidder. Unit: none. Source: none current; 1 of 350,790 rows (2026-10-06). Grain: one lot. Clock: n/a.';
COMMENT ON COLUMN public.auction_events.winning_bidder IS
'Buyer handle as text when the lot sold (BaT username); names an external_identities row (platform bat) but is not keyed to it. Unit: none. Source: extract-bat-core (page buyer, sold lots only); ingest_bat_live_events (frame buyer). Grain: one lot. Clock: n/a.';
COMMENT ON COLUMN public.auction_events.seller_name IS
'Seller handle or name as text (BaT: seller username); not keyed to external_identities. Unit: none. Source: extract-bat-core (page seller); other extractors. Grain: one lot. Clock: n/a.';
COMMENT ON COLUMN public.auction_events.seller_type IS
'Seller category (dealer or private). Unit: none. Source: UNKNOWN writer (none in current code); 80 of 350,790 rows (2026-10-06). Grain: one lot. Clock: n/a.';
COMMENT ON COLUMN public.auction_events.seller_location IS
'Seller or vehicle location as free text (city, state). Not keyed to a geography table. Unit: none. Source: UNKNOWN writer in current code; 6,954 of 350,790 rows, mostly bat, mecum and facebook_marketplace (2026-10-06). Grain: one lot. Clock: n/a.';
COMMENT ON COLUMN public.auction_events.estimate_low IS
'Low end of the auction house presale estimate. Unit: listing currency. Source: Mecum extractors; 1,405 of 350,790 rows. Grain: one lot. Clock: n/a (published before the sale).';
COMMENT ON COLUMN public.auction_events.estimate_high IS
'High end of the auction house presale estimate. Unit: listing currency. Source: Mecum extractors; 1,407 of 350,790 rows. Grain: one lot. Clock: n/a (published before the sale).';
COMMENT ON COLUMN public.auction_events.page_views IS
'Lot page views as last read. Unit: count. Source: extract-bat-core (page views); live stats frames go to vehicle_events.view_count, not here. Grain: one lot. Clock: derived (as of scraped_at).';
COMMENT ON COLUMN public.auction_events.watchers IS
'Lot watchers as last read. Unit: count. Source: extract-bat-core (page watchers). Grain: one lot. Clock: derived (as of scraped_at).';
COMMENT ON COLUMN public.auction_events.comments_count IS
'Number of comments on the lot page as last read. Unit: count. Source: extract-bat-core (page comment count); compare with auction_comments rows for the lot to measure capture. Grain: one lot. Clock: derived (as of scraped_at).';
COMMENT ON COLUMN public.auction_events.market_insights IS
'Planned market-insight payload. Unit: none. Source: none; NULL on every row (2026-10-06). Grain: one lot. Clock: n/a.';
COMMENT ON COLUMN public.auction_events.price_vs_estimate_pct IS
'Planned hammer-versus-estimate percentage. Unit: percent. Source: none; NULL on every row (2026-10-06). Grain: one lot. Clock: n/a.';
COMMENT ON COLUMN public.auction_events.reserve_gap_pct IS
'Planned high-bid-versus-reserve percentage. Unit: percent. Source: none; NULL on every row (2026-10-06). Grain: one lot. Clock: n/a.';
COMMENT ON COLUMN public.auction_events.raw_data IS
'Writer payload as JSON. extract-bat-core: extractor, source_read (page read clock and basis), listing_url, listing_details {vin, mileage, drivetrain, transmission, engine, colors, body_style}. ingest_bat_live_events adds live_stream {observation_id, received_at, admitted_at, clock_basis}, protected by trigger preserve_bat_live_projection. Mecum and other extractors put their own payload and name. Unit: none. Grain: one lot. Clock: n/a.';
COMMENT ON COLUMN public.auction_events.created_at IS
'When the lot row was inserted. Unit: timestamptz (UTC). Source: default now(). Earliest 2025-12-03. Grain: one lot. Clock: ingest.';
COMMENT ON COLUMN public.auction_events.updated_at IS
'When the lot row was last written. Unit: timestamptz (UTC). Source: extract-bat-core sets now() on every read. Grain: one lot. Clock: ingest.';
COMMENT ON COLUMN public.auction_events.receipt_data IS
'AI auction receipt payload. Unit: none. Source: analyze-auction-comments, removed in the platform triage (43b72deae); 43 rows, 2025-12-03 .. 2026-02-27. Grain: one lot. Clock: derived (as of its run).';
COMMENT ON COLUMN public.auction_events.ai_summary IS
'AI-written summary of the lot and its comment thread. Unit: none. Source: analyze-auction-comments (removed, 43b72deae); 44 rows, last 2026-02-27. Grain: one lot. Clock: derived (as of its run).';
COMMENT ON COLUMN public.auction_events.sentiment_arc IS
'AI sentiment over the comment thread as JSON. Unit: none. Source: analyze-auction-comments (removed, 43b72deae); 43 rows. Grain: one lot. Clock: derived (as of its run).';
COMMENT ON COLUMN public.auction_events.key_moments IS
'AI-picked key moments in the auction as JSON. Unit: none. Source: analyze-auction-comments (removed, 43b72deae); 43 rows. Grain: one lot. Clock: derived (as of its run).';
COMMENT ON COLUMN public.auction_events.top_contributors IS
'AI-picked top commenters as JSON (handles as text, not keys). Unit: none. Source: analyze-auction-comments (removed, 43b72deae); 43 rows. Grain: one lot. Clock: derived (as of its run).';
COMMENT ON COLUMN public.auction_events.broadcast_video_id IS
'YouTube video id of the auction broadcast that shows this lot. Unit: none. Source: broadcast linking feature (5a4b589da, Watch the Moment); 9 of 350,790 rows. Grain: one lot. Clock: n/a.';
COMMENT ON COLUMN public.auction_events.broadcast_video_url IS
'URL of the auction broadcast video. Unit: none. Source: broadcast linking feature (5a4b589da); 10 of 350,790 rows. Grain: one lot. Clock: n/a.';
COMMENT ON COLUMN public.auction_events.broadcast_clip_url IS
'URL of a clip of this lot cut from the broadcast. Unit: none. Source: none; NULL on every row (2026-10-06). Grain: one lot. Clock: n/a.';
COMMENT ON COLUMN public.auction_events.merged_from_vehicle_id IS
'Duplicate vehicle this lot row was moved from when two vehicles were merged (vehicles.id, no FK). Unit: none. Source: the vehicle merge path (20260708133823_gate2_owner_merge_guard); NULL on every row (2026-10-06). Grain: one lot. Clock: n/a.';

COMMIT;
