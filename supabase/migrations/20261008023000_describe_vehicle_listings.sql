-- Describe vehicle_listings: all 39 columns, none had a COMMENT ON COLUMN (0 of 39 described before, catalog count on
-- prod, 2026-10-07), and an extended table comment. Comments only.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself"). Read-only table in the atlas: 1,161 rows on 2026-10-07 14:19Z by exact count (equal
-- to the atlas estimate), no write since the statistics counters began; the newest row is from 2026-07-12 16:31Z and
-- the newest write an update at 2026-07-12 16:45Z.
--
-- METHOD (read 2026-10-07 14:19-14:23Z UTC):
--   Columns, types, defaults, constraints (with convalidated), indexes, triggers, policies (with their role lists),
--   grants (has_table_privilege for anon and authenticated) and existing comments from pg_attribute, pg_attrdef,
--   pg_constraint, pg_indexes, pg_trigger, pg_policy and pg_description. Fill, status, sale_type, schedule_strategy,
--   creation-day and update-day counts, metadata and readiness_last_result key sets, the metadata source, platform,
--   created_via and start_mode codes, URL hosts, end-time windows and the vehicle state behind the mirrored rows are
--   exact counts over the whole table (2 MB heap, read only). What anon can read comes from a count under SET LOCAL ROLE
--   anon in a read-only transaction. No price of a single listing is read out. "Filled" means non-NULL.
--   Writers and readers from code at origin/main bc1b0a4fb (supabase/functions, supabase/migrations, scripts,
--   nuke_frontend/src, mcp-server, apps; also git history): the creating migration 20251022000001_vehicle_listings.sql
--   (table and the owner policies); 20251021123500_complete_financial_products.sql (the policy Anyone can view listings);
--   20260113195900_native_auction_scheduler_and_readiness.sql, 20260113203000_allow_live_auction_sale_type.sql,
--   20260114121500_relax_vehicle_listings_unique_status_constraint.sql and the other 22 migrations that name the table;
--   supabase/functions/sync-live-auctions (the mirror into this table, removed by commit eefb93e94, 2026-09-27); the
--   frontend writers CreateAuctionListing.tsx, VehicleAuctionQuickStartCard.tsx and services/auctionService.ts and the 18
--   frontend select sites (AuctionMarketplace.tsx, LiveAuctionBanner.tsx, live/useLiveFloor.ts, OrganizationProfile.tsx,
--   VehicleComments.tsx, services/unifiedPricingService.ts and others); the bodies, read with pg_get_functiondef, of the
--   11 live functions whose body names the table (6 update it, upsert_live_auction_listings also inserts) and their
--   EXECUTE grants; cron.job (sync-live-auctions, jobid 488, active every 15 minutes, no longer writes the table; no job
--   calls the auction start or end functions); pg_depend (no view); pg_trigger (3 triggers); write_receipts (no rows);
--   pg_stat_user_tables; pipeline_registry (no row; none is added here); the deployed function list read through the
--   management API (328 functions, 2026-10-07).
-- LIMITS:
--   The table keeps the last write only. Why the 3 native active rows were never ended is inferred from the absence of a
--   caller of the end functions. The rows hold user ids (seller_id on 7 rows) and listing prices: quoted values are
--   status, type, source, platform and creation codes, URL hosts, column and function names and counts only; no user
--   id, vehicle id, listing URL, title or price.
-- CHANGED EXISTING COMMENTS:
--   Table comment only: it said "Vehicles listed for sale on the marketplace". That stays as the opening; the new comment
--   adds the grain, that 1,154 of the 1,161 rows are a stale mirror of Bring a Trailer lots rather than Nuke listings, the
--   7 native test auctions, the stale active status, the readers that misread it, the access and the clocks. There were
--   no column comments.

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

COMMENT ON TABLE public.vehicle_listings IS
'Vehicles listed for sale on the marketplace: meant as the native Nuke listing, one row per listing of one vehicle by its seller (grain: one listing; the partial unique indexes allow one active and one draft listing per vehicle). 1,161 rows on 2026-10-07 for 1,159 vehicles, in two groups. (1) 1,154 rows (99.4%) are not Nuke listings: they mirror live Bring a Trailer lots (metadata.source sync-live-auctions, platform bringatrailer, every listing URL on bringatrailer.com), written by the edge function sync-live-auctions through upsert_live_auction_listings(jsonb) between 2026-07-11 18:45Z and 2026-07-12 16:45Z (seller_id NULL, list_price_cents 0, sale_type auction, current_high_bid_cents from the scraped current bid). The mirror then failed (search_path errors, then 60 s timeouts) and was removed by commit eefb93e94 on 2026-09-27, because the readers treat these rows as Nuke auctions; the rows were left. Every one still says active, although all their auctions closed between 2026-07-12 17:00Z and 2026-07-22 17:05Z and all 1,154 vehicles now carry an ended, sold or not-sold state on vehicles. (2) 7 native rows, sale_type live_auction, created 2026-01-13 .. 01-15 by one seller account through the vehicle profile quick start (6, start now) or as a smoke test (1), with durations of 1 or 2 minutes: test auctions. 4 are expired; 3 still say active although they ended on 2026-01-14 and 01-15, because no cron job or edge function calls get_due_auction_ends or process_auction_end. No row was ever sold here: final_price_cents, buyer_id and sold_at are NULL everywhere and bid_count is never above 0. Nothing has written since 2026-07-12 16:45Z (no write receipts; pg_stat_user_tables since the server last started 2026-09-29 09:20Z: 0 inserts, updates and deletes, 8 sequential and 1,452 index scans by 14:19Z, so the readers are live). Writers in code: the frontend (CreateAuctionListing.tsx and VehicleAuctionQuickStartCard.tsx insert, services/auctionService.ts inserts and updates; owner policies apply), activate_auction_listing and purchase_auction_premium_timing (SECURITY DEFINER, EXECUTE granted to authenticated, both check that the caller is the seller), process_auction_end, place_auction_bid, accept_vehicle_offer and upsert_live_auction_listings (SECURITY DEFINER, not executable by anon or authenticated). Readers that misread the stale rows: nuke_frontend/src/live/useLiveFloor.ts overlays the July high bid of any active row without an end-time filter; OrganizationProfile.tsx treats ended rows as implied sold; and AuctionMarketplace.tsx and services/unifiedPricingService.ts select listing_url, which is not a column of this table (it is metadata->>listing_url), so PostgREST rejects those queries and they read nothing. VehicleComments.tsx and LiveAuctionBanner.tsx require a future end time and so skip them. Access: RLS is on. Anyone can view listings (SELECT, USING true, every role; from 20251021123500) makes the narrower view_active_listings and view_own_listings moot, so anon reads all 1,161 rows (counted under SET LOCAL ROLE anon, 2026-10-07), the 7 seller ids and the prices included. Writes are owner-scoped: create_own_listings (seller is the caller and owns the vehicle), update_own_listings and delete_own_listings (seller is the caller); the mirrored rows have no seller, so no signed-in account can change them. anon and authenticated hold SELECT, INSERT, UPDATE, DELETE and TRUNCATE. get_due_auction_starts, get_due_auction_ends and check_auction_readiness are SECURITY DEFINER readers with EXECUTE granted to anon and authenticated. Three triggers: update_vehicle_listings_updated_at (BEFORE UPDATE), trigger_apply_auction_listing_outcome_to_vehicle_timeline (AFTER UPDATE OF status) and trigger_notify_sale_completed (AFTER UPDATE). No pipeline_registry row. Clocks: auction_start_time, auction_end_time and sold_at are event times of the auction (for mirrored rows, as scraped); last_bid_time and metadata.observed_at are the mirror clock; created_at and updated_at are database times.';

-- ── Identity ───────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicle_listings.id IS
'Surrogate key of the listing, uuid, gen_random_uuid() default, the PRIMARY KEY. 1,161 values (2026-10-07). The id the auction RPCs take (p_listing_id) and the readiness result echoes (listing_id). Unit: none (uuid). Source: column default. Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_listings.vehicle_id IS
'Vehicle on offer: a vehicles.id, NOT NULL, foreign key ON DELETE CASCADE (validated), indexed (idx_vehicle_listings_vehicle) and the key of the partial unique indexes vehicle_listings_one_active_per_vehicle and vehicle_listings_one_draft_per_vehicle. 1,159 distinct values on 1,161 rows (2026-10-07); 2 vehicles hold 2 rows. For mirrored rows the writer matched vehicles.listing_url to the lot URL (the newest live vehicle with that URL). Unit: none (uuid). Source: the seller (native) or the URL match of upsert_live_auction_listings (mirror). Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_listings.seller_id IS
'Account that listed the vehicle: an auth.users id, nullable, foreign key without ON DELETE action (validated), indexed (idx_vehicle_listings_seller); every write policy keys on it (seller_id = auth.uid()). Filled on the 7 native rows, all one account (2026-10-07); NULL on the 1,154 mirrored rows, so no signed-in account can update or delete those. Readable by anon through Anyone can view listings; no id is quoted here. Unit: none (uuid). Source: the frontend writer (the signed-in user). Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_listings.sale_type IS
'How the listing sells, text, nullable, default auction, CHECK in (auction, live_auction, fixed_price, best_offer, hybrid), indexed. 2 occur (2026-10-07): auction 1,154 (every mirrored row, set by the mirror) and live_auction 7 (the native rows; allowed since 20260113203000). The frontend readers select auction and live_auction. Unit: none (text code). Source: the writer. Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_listings.status IS
'Lifecycle state of the listing, text, nullable, default active, CHECK in (draft, active, sold, cancelled, expired), indexed; partial unique indexes allow one active and one draft row per vehicle. 2 occur (2026-10-07): active 1,157, expired 4; draft, sold and cancelled never. Stale: every active row has an auction_end_time in the past (the 1,154 mirrored rows closed 2026-07-12 .. 07-22 and their vehicles are ended, sold or not sold; the 3 native rows ended 2026-01-14 .. 01-15), because the mirror is gone and nothing calls process_auction_end. A reader that trusts it alone (useLiveFloor.ts) sees closed auctions as live; AuctionMarketplace.tsx and unifiedPricingService.ts filter the same way but their queries fail (see the table comment). trigger_apply_auction_listing_outcome_to_vehicle_timeline fires when it changes. Unit: none (text code). Source: the writer, or process_auction_end. Grain: one listing. Clock: as of updated_at.';

-- ── Price ──────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicle_listings.list_price_cents IS
'Asking or starting price set by the seller, bigint NOT NULL. Above 0 on the 7 native rows; 0 on all 1,154 mirrored rows (2026-10-07), where the mirror wrote 0 because a Bring a Trailer lot has no list price, so 0 means none. Unit: US cents. Source: the seller (native); the mirror constant 0. Grain: one listing. Clock: as of updated_at.';
COMMENT ON COLUMN public.vehicle_listings.reserve_price_cents IS
'Reserve of the auction, bigint, nullable. NULL on all 1,161 rows (2026-10-07); the reserve state of mirrored lots is metadata.no_reserve. AuctionMarketplace.tsx selects it. Unit: US cents. Source: the seller (never set). Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_listings.accept_offers IS
'Whether the seller takes offers outside the auction, boolean, nullable, default true. true on 1,160 rows (2026-10-07), the 1,154 mirrored rows by default, so it says nothing about those lots; false on 1 native row. Unit: none (boolean). Source: the seller, else the column default. Grain: one listing. Clock: as of updated_at.';
COMMENT ON COLUMN public.vehicle_listings.current_high_bid_cents IS
'Highest bid when the row was last written, bigint, nullable. Filled on the 1,154 mirrored rows (2026-10-07), 0 on 12 of them: the current bid the sync-live-auctions scraper read (its sale_price field, times 100) at its last successful run on 2026-07-12, not the closing price. NULL on the 7 native rows (no bid was placed). Read as a live price by useLiveFloor.ts and unifiedPricingService.ts. Unit: US cents. Source: the scraper (mirror); place_auction_bid (native). Grain: one listing. Clock: as of last_bid_time or updated_at.';
COMMENT ON COLUMN public.vehicle_listings.bid_count IS
'Number of bids, integer, nullable, default 0. 0 on the 7 native rows and NULL on all 1,154 mirrored rows (2026-10-07): the mirror inserted the scraper bid count, which was always empty, over the default. Unit: bids. Source: place_auction_bid (native); the mirror (none). Grain: one listing. Clock: as of updated_at.';
COMMENT ON COLUMN public.vehicle_listings.final_price_cents IS
'Price the listing sold for, bigint, nullable. NULL on all 1,161 rows (2026-10-07): no listing here has sold. Unit: US cents. Source: process_auction_end or accept_vehicle_offer (never run to a sale). Grain: one listing. Clock: as of sold_at.';
COMMENT ON COLUMN public.vehicle_listings.buyer_id IS
'Account that bought the vehicle: an auth.users id, nullable, foreign key without ON DELETE action (validated). NULL on all 1,161 rows (2026-10-07). Unit: none (uuid). Source: the settlement functions (never run to a sale). Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_listings.sold_at IS
'When the listing sold, timestamptz, nullable. NULL on all 1,161 rows (2026-10-07). Unit: timestamptz. Source: the settlement functions (never run to a sale). Grain: one listing. Clock: event time of the sale (none recorded).';

-- ── Auction timing ─────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicle_listings.auction_start_time IS
'When the auction opened, timestamptz, nullable. Filled on the 7 native rows (2026-01-13 .. 01-15, set by activate_auction_listing); NULL on the mirrored rows (2026-10-07). Unit: timestamptz. Source: activate_auction_listing. Grain: one listing. Clock: event time (auction start, database clock of the activation).';
COMMENT ON COLUMN public.vehicle_listings.auction_end_time IS
'When the auction closes or closed, timestamptz, nullable. Filled on every row (2026-10-07), every value in the past: the 1,154 mirrored rows 2026-07-12 17:00Z .. 2026-07-22 17:05Z (the lot end as scraped), the 7 native rows 2026-01-13 .. 01-15 (set by activate_auction_listing). VehicleComments.tsx and LiveAuctionBanner.tsx require it in the future; OrganizationProfile.tsx reads rows past it as sold. Unit: timestamptz. Source: the scraper (mirror) or activate_auction_listing and the bid functions (native). Grain: one listing. Clock: event time on the auction platform.';
COMMENT ON COLUMN public.vehicle_listings.auction_duration_minutes IS
'Length of a native auction as the seller chose it, integer, nullable. Filled on the 7 native rows, 1 or 2 minutes (test auctions); NULL on the mirrored rows (2026-10-07). Unit: minutes. Source: the frontend writer. Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_listings.current_high_bidder_id IS
'Profile of the current high bidder: a profiles.id, nullable, foreign key without ON DELETE action (validated). NULL on all 1,161 rows (2026-10-07): no native bid was placed, and the mirror does not know bidders. Unit: none (uuid). Source: place_auction_bid (never run). Grain: one listing. Clock: as of last_bid_time.';
COMMENT ON COLUMN public.vehicle_listings.last_bid_time IS
'When the high bid last changed, timestamptz, nullable. Filled on 541 mirrored rows (2026-10-07), 2026-07-11 18:45Z .. 2026-07-12 16:31Z: the mirror stamped now() when a run saw a new current bid, so it is the observation time of the change, not the bid time on the platform. NULL on the native rows. Unit: timestamptz. Source: upsert_live_auction_listings (mirror); place_auction_bid (native). Grain: one listing. Clock: mirror observation time.';
COMMENT ON COLUMN public.vehicle_listings.sniping_extensions IS
'How many times a late bid extended the native auction, integer, nullable, default 0. 0 on all 1,161 rows (2026-10-07). Unit: extensions. Source: the bid functions (never triggered). Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_listings.sniping_protection_minutes IS
'Anti-sniping window of the native auction, integer, nullable, default 2. 2 on all 1,161 rows (2026-10-07), the default; meaningless on mirrored rows. Unit: minutes. Source: column default. Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_listings.soft_close_enabled IS
'Whether a late bid extends the native auction, boolean, nullable, default true. true on all 1,161 rows (2026-10-07), the default; meaningless on mirrored rows. Unit: none (boolean). Source: column default. Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_listings.soft_close_window_seconds IS
'Final window in which a bid triggers the soft close, integer, nullable, default 120. 120 on all 1,161 rows (2026-10-07), the default. Unit: seconds. Source: column default. Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_listings.soft_close_reset_seconds IS
'Time the soft close resets the clock to, integer, nullable, default 120 (20251215000008_auction_soft_close_reset.sql). 120 on all 1,161 rows (2026-10-07), the default. Unit: seconds. Source: column default. Grain: one listing. Clock: n/a.';

-- ── Scheduling and readiness (native auctions) ─────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicle_listings.schedule_strategy IS
'How a native auction starts, text, nullable, default manual, CHECK in (manual, auto, premium) (20260113195900). manual on 1,160 rows (the default on mirrored rows), auto on 1 (the smoke test) (2026-10-07). Unit: none (text code). Source: the frontend writer, else the default. Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_listings.auto_start_enabled IS
'Whether the scheduler may start the auction by itself, boolean, nullable, default false. false on all 1,161 rows (2026-10-07). Unit: none (boolean). Source: column default. Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_listings.auto_start_armed_at IS
'When automatic start was armed, timestamptz, nullable. Filled on 1 native row (the smoke test, 2026-01); NULL elsewhere (2026-10-07). Set by the frontend writers (CreateAuctionListing.tsx, and VehicleAuctionQuickStartCard.tsx when the start is scheduled). Unit: timestamptz. Source: the frontend writer (browser clock). Grain: one listing. Clock: writer time of arming.';
COMMENT ON COLUMN public.vehicle_listings.auto_start_last_attempt_at IS
'When activation was last attempted, timestamptz, nullable. Filled on the 7 native rows (2026-01-13 .. 01-15); NULL on the mirrored rows (2026-10-07). Unit: timestamptz. Source: activate_auction_listing. Grain: one listing. Clock: database time of the attempt.';
COMMENT ON COLUMN public.vehicle_listings.auto_start_last_error IS
'Error of the last activation attempt, text, nullable. NULL on all 1,161 rows (2026-10-07). Unit: none (text). Source: activate_auction_listing. Grain: one listing. Clock: as of auto_start_last_attempt_at.';
COMMENT ON COLUMN public.vehicle_listings.premium_status IS
'State of a paid premium start slot, text, nullable, default none, CHECK in (none, requested, pending_payment, paid, scheduled, consumed, refunded, cancelled). none on all 1,161 rows (2026-10-07): no premium was bought. Unit: none (text code). Source: purchase_auction_premium_timing (never run to a purchase). Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_listings.premium_budget_cents IS
'Budget the seller offered for a premium start slot, bigint, nullable. NULL on all 1,161 rows (2026-10-07). Unit: US cents. Source: purchase_auction_premium_timing (never run to a purchase). Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_listings.premium_paid_at IS
'When the premium slot was paid, timestamptz, nullable. NULL on all 1,161 rows (2026-10-07). Unit: timestamptz. Source: the premium functions (never run to a payment). Grain: one listing. Clock: payment time (none recorded).';
COMMENT ON COLUMN public.vehicle_listings.premium_priority IS
'Queue priority bought with a premium slot, integer, nullable, default 0. 0 on all 1,161 rows (2026-10-07). Unit: priority points. Source: column default. Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_listings.readiness_last_checked_at IS
'When the readiness check last ran for the listing, timestamptz, nullable. Filled on the 7 native rows (2026-01-13 .. 01-15); NULL on the mirrored rows (2026-10-07). Unit: timestamptz. Source: activate_auction_listing, which runs check_auction_readiness. Grain: one listing. Clock: database time of the check.';
COMMENT ON COLUMN public.vehicle_listings.readiness_last_result IS
'Result of the last readiness check, jsonb, nullable, default {}. Filled beyond {} on the 7 native rows (2026-10-07) with ready, issues, image_count, has_primary_image, listing_id and vehicle_id (the output of check_auction_readiness); {} on the mirrored rows. Unit: none (jsonb). Source: check_auction_readiness via activate_auction_listing. Grain: one listing. Clock: as of readiness_last_checked_at.';

-- ── Text and extras ────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicle_listings.description IS
'Seller description of the listing, text, nullable. Filled on the 7 native rows (2026-10-07); NULL on the mirrored rows, whose lot title is metadata.title. Unit: none (text). Source: the frontend writer. Grain: one listing. Clock: as of updated_at.';
COMMENT ON COLUMN public.vehicle_listings.terms_conditions IS
'Seller terms of sale, text, nullable. NULL on all 1,161 rows (2026-10-07). Unit: none (text). Source: the frontend writer (never set). Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_listings.metadata IS
'Extras of the listing, jsonb, nullable, default {}. Mirrored rows (1,154, 2026-10-07): source (sync-live-auctions), platform (bringatrailer), listing_url (the lot URL on bringatrailer.com, keyed by the unique index uq_vehicle_listings_external_listing_url, the conflict target of the mirror), external_id, title, thumbnail_url, no_reserve (true on 431) and observed_at (2026-07-12 16:45:57Z .. 16:45:59Z, the last mirror run). Native rows (7): created_via (vehicle_profile_quick_start 6, smoke_test 1) and start_mode (now, 6). Readers that want the lot URL must read metadata->>listing_url; there is no listing_url column. Unit: none (jsonb). Source: upsert_live_auction_listings (mirror) or the frontend writer. Grain: one listing. Clock: metadata.observed_at for mirrored rows.';

-- ── Row clocks ─────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicle_listings.created_at IS
'When the row was inserted: default now(), the transaction clock of the insert. Filled on every row (2026-10-07): 2026-01-13 .. 01-15 (the 7 native rows) and 2026-07-11 (1,126) and 2026-07-12 (28, the last 16:31Z) for the mirror. It is when the row entered the table, not when the lot opened on the platform. Unit: timestamptz. Source: column default. Grain: one listing. Clock: ingest time.';
COMMENT ON COLUMN public.vehicle_listings.updated_at IS
'When the row was last updated: the BEFORE UPDATE trigger update_vehicle_listings_updated_at sets now(), and the mirror also wrote now(). Later than created_at on all 1,161 rows (2026-10-07): 2026-07-12 16:45:57Z .. 16:45:59Z on the 1,154 mirrored rows (the last successful mirror run), 2026-01-13 .. 02-06 on the native rows. Unit: timestamptz. Source: trigger and writer clock. Grain: one listing. Clock: database time of the last write.';

DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(a.attname, ', ' ORDER BY a.attnum) INTO missing
  FROM pg_attribute a
  WHERE a.attrelid = 'public.vehicle_listings'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND col_description(a.attrelid, a.attnum) IS NULL;
  IF missing IS NULL THEN
    RAISE NOTICE 'vehicle_listings: every column has a comment';
  ELSE
    RAISE NOTICE 'vehicle_listings columns still without a comment: %', missing;
  END IF;
END
$$;

COMMIT;
