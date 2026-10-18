-- Describe external_identities: table purpose with its clocks, and the 13 undescribed columns (1 of 14 described
-- before: claimed_by_user_id, left as it is).
-- Lane C (cartographer), night shift 2026-10-05. Comments only.
--
-- EVIDENCE (read 2026-10-06 UTC):
--   Writers (code): linkAuctionCommentIdentities in _shared/batAuctionRecord.ts (insert platform, handle, profile_url;
--   on conflict do nothing) used by extract-bat-core and load_archive_comments.ts; ingest_bat_live_events (same insert,
--   20261004182500); extract-auction-comments (upsert sets last_seen_at = read time); import-pcarmarket-listing,
--   extract-cars-and-bids-comments, extract-hagerty-listing, extract-bat-profile-vehicles, ingest-external-profile,
--   process-profile-queue, mcp-connector; SQL: request/approve_external_identity_claim, verify_identity_by_code,
--   refresh_identity_claim_stats, queue_user_profile_from_listing. Triggers: trigger_queue_profile_from_identity,
--   trg_upgrade_transfers_on_identity_claim.
--   Full-table profile (617,078 rows): bat 611,177 (22,987 created in the last 30 d), pcarmarket 4,315,
--   cars_and_bids 818, carsandbids 387 (same platform, two spellings), hagerty 375, others 1-2. display_name equals
--   handle on 524,564 of 524,565 filled bat rows. claim_confidence 0 on 617,075 rows. claimed_by_user_id 2 rows,
--   user_id 1 row. metadata non-empty on 44,357 rows (listing_urls/listings_found/extracted_at on 35,367).
--   20 tables key to it (v_schema_atlas fk_in).

SET statement_timeout = '60s';
SET lock_timeout = '10s';

BEGIN;

COMMENT ON TABLE public.external_identities IS
'The identity entity for people seen on outside platforms: one row per platform handle (grain: platform x handle, UNIQUE). 20 tables key to it (comment authors, bidders, sellers, buyers). Not an event table: first_seen_at and last_seen_at are ingest clocks (when our writers first and last saw the handle), not when the person first acted on the platform; for that use min(auction_comments.posted_at) by identity. Writers insert on conflict (platform, handle) do nothing, so a handle is never reset. platform spellings are not normalized (cars_and_bids and carsandbids both occur). claimed_by_user_id links a handle to a Nuke account after a claim.';

COMMENT ON COLUMN public.external_identities.id IS
'Surrogate key of the identity. Unit: none (uuid). Source: gen_random_uuid() default. Grain: one platform handle. Clock: n/a.';
COMMENT ON COLUMN public.external_identities.platform IS
'Platform the handle belongs to: bat (611,177 rows), pcarmarket, cars_and_bids, carsandbids (same platform, older spelling), hagerty, instagram, sbxcars, classic_com, x. Free text. Unit: none. Source: the writing extractor. Grain: one platform handle. Clock: n/a.';
COMMENT ON COLUMN public.external_identities.handle IS
'Username exactly as the platform shows it (BaT: the comment author name with (The Seller) stripped); case is kept, matching is exact. With platform the natural key. Unit: none. Source: comment and listing extractors. Grain: one platform handle. Clock: n/a.';
COMMENT ON COLUMN public.external_identities.profile_url IS
'Profile page URL on the platform (BaT: https://bringatrailer.com/member/<handle>/). Setting it queues a profile fetch (trigger_queue_profile_from_identity). Unit: none. Source: comment extractors build it from the handle. Filled on 597,541 of 617,078 rows. Grain: one platform handle. Clock: n/a.';
COMMENT ON COLUMN public.external_identities.display_name IS
'Display name; on BaT it equals handle on 524,564 of 524,565 filled rows (2026-10-06), so it adds no information there. Unit: none. Source: profile and listing extractors (ingest-external-profile, process-profile-queue). Grain: one platform handle. Clock: n/a.';
COMMENT ON COLUMN public.external_identities.claimed_at IS
'When a Nuke user claim on this handle was recorded. Unit: timestamptz (UTC). Source: approve_external_identity_claim / verify_identity_by_code. 3 rows (2026-10-06). Grain: one platform handle. Clock: ingest (claim time in Nuke).';
COMMENT ON COLUMN public.external_identities.claim_confidence IS
'Confidence that claimed_by_user_id is the person behind the handle. Unit: percent (0..100, CHECK). Source: claim and verification functions; 0 (default, unclaimed) on 617,075 rows. Grain: one platform handle. Clock: n/a.';
COMMENT ON COLUMN public.external_identities.first_seen_at IS
'When a Nuke writer first recorded the handle. Unit: timestamptz (UTC). Source: default now() at insert. Not the person first activity on the platform. Grain: one platform handle. Clock: ingest.';
COMMENT ON COLUMN public.external_identities.last_seen_at IS
'When a Nuke writer last saw the handle in a read. Unit: timestamptz (UTC). Source: default now() at insert; extract-auction-comments sets it to its read time on every upsert; the insert-only writers (batAuctionRecord.ts, ingest_bat_live_events) do not move it. Grain: one platform handle. Clock: ingest.';
COMMENT ON COLUMN public.external_identities.metadata IS
'Writer context as JSON; empty on most rows. Keys seen: listing_urls, listings_found, extracted_at (extract-bat-profile-vehicles, 35,367 rows), source, first_seen_listing, is_seller, is_buyer, comment_count, bid_count, total_activity, city/state/country with location_source (566 rows), seller_id, slug, is_specialist (hagerty). Counts in it are lifetime numbers as of the write, not point-in-time. Unit: none. Grain: one platform handle. Clock: n/a.';
COMMENT ON COLUMN public.external_identities.created_at IS
'When the identity row was inserted. Unit: timestamptz (UTC). Source: default now(). Earliest 2025-12-15. Grain: one platform handle. Clock: ingest.';
COMMENT ON COLUMN public.external_identities.updated_at IS
'When the identity row was last written. Unit: timestamptz (UTC). Source: writers that update (extract-auction-comments sets it with last_seen_at; claim functions). Grain: one platform handle. Clock: ingest.';
COMMENT ON COLUMN public.external_identities.user_id IS
'Nuke account (auth.users.id) linked to the handle; a second account link beside claimed_by_user_id, set on 1 row (2026-10-06). Which of the two is canonical is not documented. Unit: none. Source: UNKNOWN writer. Grain: one platform handle. Clock: n/a.';

COMMIT;
