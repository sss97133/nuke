-- Describe marketplace_listings: the 45 columns with no COMMENT ON COLUMN (4 of 49 described before, catalog count on
-- prod, 2026-10-07), one corrected column comment (priority) and an extended table comment. Comments only.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself"). The atlas calls the table written; in practice it is dormant: 115,743 rows on
-- 2026-10-07 02:34Z by exact count (the atlas estimate of 114,946 is a stale pg_class.reltuples), 1 insert since the
-- statistics counters began, last created_at 2026-10-01.
--
-- METHOD (read 2026-10-07 UTC):
--   Columns, types, defaults, generated columns, constraints, indexes, policies, grants and existing comments from
--   pg_attribute, pg_constraint, pg_indexes, pg_policy, information_schema and pg_description. Fill, values and date
--   windows are exact counts over the whole table (235 MB heap, read only). The keys of raw_scrape_data come from a 10%
--   block sample (TABLESAMPLE SYSTEM (10) REPEATABLE (20261007), 10,791 rows with the sweep-scraper shape); the keys of
--   contact_info from all 537 rows. What anon and authenticated can read comes from counts taken under SET LOCAL ROLE in
--   a read-only transaction. "Filled" means non-NULL and, for text, non-blank; arrays count non-null.
--   Writers come from code at origin/main aa56c1ff2 (supabase/functions, supabase/migrations, scripts, nuke_frontend/src,
--   mcp-servers, apps), the bodies of the 7 live public SQL functions that name the table (5 write it), the 2 triggers on
--   the table, the 5 pg_cron jobs that call its writers (all inactive), the launchd definitions on the owner machine (none
--   loaded), write_receipts (no rows for this table), pg_stat_user_tables and pipeline_registry (4 column rows: taste_score,
--   taste_scored_at and enrichment_priority owned by trigger_compute_taste_score, user_saved by trigger_mark_user_saved; no
--   table-level row). No pipeline_registry row is added here: the table has several independent writers and none scheduled,
--   so naming one owner is a decision for the owner-gap lane (declare_table_owners), not for a description.
-- LIMITS:
--   The sweep scraper, the monitor and the manual imports are attributed by their stamps (search_query, priority, the key
--   shape of raw_scrape_data, the notes of reviewed rows), not by a run log; the scraper upsert rewrites scraped_at and
--   last_seen_at on every sighting, so those clocks show the latest sighting. pg_stats for this table are undated, so
--   distinct counts quoted from ANALYZE are marked as such. Personal data (seller names, Facebook user ids, emails, phone
--   numbers) is described by column and key, never by value.
--   Quoted values are categorical codes, writer stamps, key names and function names only: no names, handles, contacts, ids
--   or amounts; URL shapes are templates.
-- CHANGED EXISTING COMMENTS:
--   priority: listed only classic, modern and unknown; those come from the 2026-02-02 .. 02-03 monitor on 1,667 rows, while
--   the default normal sits on 98.0% of rows and manual_import on 607.
--   Table comment: its writer list omitted the sweep scraper (about 98% of rows) and named three writers that have left no
--   stamp; it now states the dormancy, the columns the repo code uses that prod does not have, the clocks and the access.
--   Unchanged and checked: taste_score (1 .. 98 on every row), user_saved (true on 451 rows) and enrichment_priority.

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

COMMENT ON TABLE public.marketplace_listings IS
'Facebook Marketplace listings as the project scraped or was handed them: one row per Facebook listing (grain: one listing; UNIQUE facebook_id), with title, price, city, a parsed year, make and model, the seller where known, a link to a vehicles row and review and sweep state. 115,743 rows on 2026-10-07 (the atlas estimate of 114,946 is a stale reltuples), created 2026-02-02 .. 2026-10-01 and dormant since June: 5,007 rows in 2026-02, 36,364 in 03, 26,843 in 04, 40,094 in 05, 7,335 in 06, then 78, 12, 9 and 1. Writers: the local sweep scraper scripts/fb-marketplace-local-scraper.mjs wrote about 98% of the rows (search_query vintage-vehicles-<city>, 58 cities, 2026-02-05 .. 2026-06-12); it runs only when launched, its launchd jobs (com.nuke.fb-sweep-g1 .. g4, daily from 03:00) are not loaded on 2026-10-07, and all 5 pg_cron jobs that call this table (fb-marketplace-monitor, fb-marketplace-import, fb-marketplace-refine, enrich-fb-marketplace-derive, enrich-fb-marketplace-mine-desc) are inactive. Others: the original monitor scripts/marketplace-monitor/monitor.ts (1,667 rows, 2026-02-02 .. 02-03), user and agent submissions through the edge functions extract-facebook-marketplace (370 rows, raw_scrape_data.mode direct) and ingest (24 rows, search_query nuke-ingest, the live path, last 2026-10-01), scripts/fb-import-urls.ts and scripts/fb-scrape-saved.ts (607 manual_import rows), refine-fb-listing and the enrich scripts (refined_at on 63,924 rows, last 2026-07-19), import-fb-marketplace (creates the vehicle, sets vehicle_id, status blocked 429 or duplicate 75), and the triggers trigger_compute_taste_score (on this table), trg_mark_user_saved (on fb_saved_items) and trg_increment_submission_count (on fb_listing_sightings). detect_disappeared_listings(), handle_listing_reappearance() and the sold-marking of fb-marketplace-orchestrator are named as writers but have left no stamp: no row has removal_reason disappeared or a sold_price_source. The repo code also uses columns prod does not have (sold_at, sold_price, sold_to_type, contributed_by), so report-marketplace-sale and process_marketplace_sale_reports() cannot run, and the tables of migration 20260201000001 (marketplace_price_changes, marketplace_watchlist, marketplace_sale_reports) do not exist; the live columns come from scripts/marketplace-monitor/setup.sql and later ALTERs. vehicle_id has no foreign key. Event time is not stored: first_seen_at, last_seen_at and scraped_at are our observation times, created_at is ingest time, and the Facebook listing age is only listed_days_ago (1,175 rows). No price history: price is overwritten and fb_listing_sightings holds 5 rows. RLS is on with no policy, so anon and authenticated see 0 rows (counted under SET ROLE, 2026-10-07); only service_role and the owner read it. Personal data sits in seller_name (536 rows), contact_info (537) and seller_profile_url (148).';

-- ── Identity ────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.marketplace_listings.id IS
'Surrogate key of the listing row. Unit: none (uuid). Source: gen_random_uuid() default. Referenced by foreign keys from fb_listing_sightings.listing_id and fb_listing_disappearances.listing_id (both ON DELETE CASCADE: 4,224 disappearance rows, 5 sighting rows on 2026-10-07) and user_vehicle_discoveries.marketplace_listing_id. The working key is facebook_id. Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.marketplace_listings.facebook_id IS
'Facebook Marketplace item id as text, NOT NULL and UNIQUE; the upsert key of every writer (onConflict facebook_id). 115,722 rows hold digits only; 21 hold test or hand-pasted keys: paste_<hash> 18 (created 2026-02-25, with a Facebook search page as url), healthcheck 1, bat:<id> 1 and 1 other. The listing address is built from it. Unit: none (text). Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.marketplace_listings.url IS
'Listing page address, NOT NULL and not unique. 114,669 rows hold exactly https://www.facebook.com/marketplace/item/<facebook_id>, 1,053 the same with a trailing slash (the extract-facebook-marketplace form), 2 other forms, 18 a Facebook search page (the paste_ rows) and 1 a Bring a Trailer page (platform bring_a_trailer). The page needs a Facebook login from outside the residential scraper (code comments in refine-fb-listing and extract-facebook-marketplace: cloud IPs and Firecrawl are redirected to login), so the address is a pointer, not a fetchable source. Unit: none (text, URL). Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.marketplace_listings.platform IS
'Marketplace the listing came from, default facebook_marketplace, no CHECK. facebook_marketplace on 115,742 rows and bring_a_trailer on 1 (a hand-submitted BaT lot, status blocked, created 2026-07-09); detect_disappeared_listings() filters on the first value. Unit: none (text). Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.marketplace_listings.vehicle_id IS
'The vehicles row linked to the listing: the sweep scraper (v3.0), the monitor and import-fb-marketplace create one vehicle per listing and write its id here; extract-facebook-marketplace matches by VIN. Filled on 111,553 rows (96.4%, 2026-10-07); NULL on 4,190 (blocked or never imported). No foreign key on prod, and 5,315 filled values (4.8%) point at a vehicles row that no longer exists. The repo migration 20260201000001_facebook_marketplace_import.sql declares one (ON DELETE SET NULL) but defines a different column set than prod holds. Partial index idx_marketplace_listings_vehicle_id. Unit: none (uuid). Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.marketplace_listings.suggested_vehicle_id IS
'A vehicle the listing may be, a soft link: extract-facebook-marketplace writes it when no VIN matched but year, make, model and state match one vehicle. No foreign key; index idx_marketplace_listings_suggested_vid. Filled on 44 rows (0.04%, 2026-10-07; created 2026-03-26 .. 2026-08-02): 9 equal vehicle_id, 21 differ from it and 14 have no vehicle_id. It is a candidate, never a verified match. Unit: none (uuid). Grain: one listing. Clock: as of the write.';
COMMENT ON COLUMN public.marketplace_listings.fb_seller_id IS
'The seller profile row, foreign key to fb_marketplace_sellers.id (no ON DELETE action). Filled on 148 rows (0.13%, 2026-10-07; 144 distinct sellers, created 2026-02-25 .. 2026-03-06), the same rows that hold seller_profile_url and seller_name. The sweep scraper tries to write it for every listing, but the logged-out GraphQL it uses does not reveal the seller (seller_id and seller_name are null in raw_scrape_data on every sampled scraper row), so the link exists only where a saved-item scrape supplied the seller (scripts/fb-scrape-saved.ts upserts the seller and writes the id); fb_marketplace_sellers holds 144 rows. Read by scripts/monitor-supplier-inventory.mjs and the view marketplace_seller_leaderboard. Unit: none (uuid). Grain: one listing. Clock: as of the write.';

-- ── Listing content ─────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.marketplace_listings.title IS
'Listing title as the seller wrote it (scraper and monitor rows), or the parsed year, make and model joined (the 24 ingest rows). Filled on 115,740 of 115,743 rows (2026-10-07). Seller wording, often with price or place mixed in; parsed_year, parsed_make and parsed_model are read from it, and trg_taste_score_on_update recomputes taste_score when it changes. Unit: none (text). Grain: one listing. Clock: as of the last write that changed it.';
COMMENT ON COLUMN public.marketplace_listings.price IS
'Asking price in whole US dollars, as the writer last saw it: the sweep scraper writes the rounded listing price, extract-facebook-marketplace and scripts/fb-import-urls.ts the submitted price, the orchestrator the sweep price. Filled on 115,448 rows (99.7%, 2026-10-07). 1,496 rows hold a value under 100 (691 hold exactly 1) and 134 hold 1,000,000 or more, so the extremes are placeholders or mis-parsed titles, not asking prices; 12,347 hold 100 .. 999. Mirrors current_price (4 rows differ). Overwritten on every re-sighting, and no history exists: fb_listing_sightings holds 5 rows, none with a price. Unit: USD by name (integer, no currency column). Grain: one listing. Clock: as of the last write.';
COMMENT ON COLUMN public.marketplace_listings.current_price IS
'Latest asking price, numeric, the same value as price in unrounded form; written together with price by the scraper, ingest, the orchestrator and the submission functions. Filled on 115,686 rows (99.95%, 2026-10-07); differs from price on 4 rows. The creating migration 20260201000001 meant it to track price drops against a first_price column, which prod does not have. detect_disappeared_listings() and handle_listing_reappearance() read and write it. Unit: USD by name (numeric, no currency column). Grain: one listing. Clock: as of the last write.';
COMMENT ON COLUMN public.marketplace_listings.location IS
'Where the seller placed the listing, free text: City, ST from the scraper (city and state joined), or the text a submission supplied. Filled on 115,069 rows (99.4%, 2026-10-07; 5,445 distinct values). A city-level place, not an address; the scraper keeps approximate coordinates only inside raw_scrape_data (listing_lat and listing_lng on 22.6% of the sampled scraper rows). trg_taste_score_on_update recomputes taste_score when it changes. Unit: none (text). Grain: one listing. Clock: as of the last write.';
COMMENT ON COLUMN public.marketplace_listings.image_url IS
'Primary photo address on Facebook CDN hosts: 115,394 of the 115,418 filled rows are fbcdn.net hosts and 17 are lookaside.fbsbx.com (2026-10-07). These are signed links that expire (the code comment in import-fb-marketplace says CDN URLs expire), so the column points at what Facebook served at scrape time and is not a stored copy; the sweep scraper v3.0 copies photos into storage and vehicle_images separately. Filled on 99.7% of rows. Unit: none (text, URL). Grain: one listing. Clock: as of the last scrape.';
COMMENT ON COLUMN public.marketplace_listings.all_images IS
'Every photo address found for the listing, a text array of expiring CDN links. Filled on 23,127 rows (20.0%, 2026-10-07; created 2026-02-02 .. 2026-06-12), 0 to 39 addresses and 9.8 on average. The sweep scraper keeps the same list in raw_scrape_data.all_image_urls, so this column is filled by the monitor and enrich scripts and by refine-fb-listing, not by the scraper itself; import-fb-marketplace reads it to pick a valid image. Unit: none (text array of URLs). Grain: one listing. Clock: as of the last write.';
COMMENT ON COLUMN public.marketplace_listings.description IS
'Seller text of the listing. Filled on 9,170 rows (7.9%, 2026-10-07). The logged-out GraphQL the sweep scraper uses returns none (the key is null on every sampled scraper row), so it is filled only where a later pass read the page or a person submitted it: the monitor and enrich scripts (scripts/marketplace-monitor, scripts/fb-desc-enrich.mjs, scripts/fb-desc-enrich-playwright.mjs, scripts/fb-enrich-with-cookies.mjs), extract-facebook-marketplace, ingest (notes) and saved-item scrapes. refine-fb-listing processes listings that have one first (its phase 1). Free text from private sellers that can hold names and phone numbers, so values are not quoted. Unit: none (text). Grain: one listing. Clock: as of the last write.';
COMMENT ON COLUMN public.marketplace_listings.search_query IS
'Which sweep or path produced the row, a writer stamp and not a user search: vintage-vehicles-<city> 112,970 rows (58 city slugs, 2026-02-05 .. 2026-06-12, the sweep scraper), a Facebook search page address 1,667 (2026-02-02 .. 02-03, the monitor), nuke-ingest 24 (2026-02-28 .. 2026-10-01, ingest), a direct-ask stamp 2 (2026-07-09), and NULL on 1,080 (manual imports and submissions). 158 distinct values; filled on 114,663 rows (99.1%, 2026-10-07). Unit: none (text). Grain: one listing. Clock: as of the insert; the scraper upsert rewrites it.';
COMMENT ON COLUMN public.marketplace_listings.seller_name IS
'Display name of the seller, a private individual. Filled on 536 rows (0.46%, 2026-10-07; 509 distinct): the logged-out sweep scraper cannot see the seller (the key is null in raw_scrape_data on every sampled scraper row), so names come from the monitor, from ingest and from saved-item scrapes. Personal data: values are not quoted, and RLS (on, no policy) keeps the table closed to anon and authenticated (0 rows visible, 2026-10-07). Unit: none (text). Grain: one listing. Clock: as of the last write.';
COMMENT ON COLUMN public.marketplace_listings.seller_profile_url IS
'Address of the seller Facebook profile. Filled on 148 rows (0.13%, 2026-10-07; created 2026-02-25 .. 2026-03-06), the same rows that hold fb_seller_id, seller_name and contact_info.seller_profile_url (144 distinct sellers): one saved-items batch. The profile link read from a listing page is written by scripts/fb-marketplace-full-collector.ts and scripts/fb-extract-with-playwright.ts; scripts/fb-scrape-saved.ts keeps it inside contact_info. Personal data about a private individual, not quoted. Unit: none (text, URL). Grain: one listing. Clock: as of the write.';
COMMENT ON COLUMN public.marketplace_listings.contact_info IS
'Contact facts extracted from the listing, a JSON object, filled on 537 rows (0.46%, 2026-10-07; created 2026-02-03 .. 2026-04-05). Keys: seller_fb_user_id 513 rows (the seller Facebook user id), joined_year 148 (when the seller joined Facebook), seller_profile_url 148, emails 24 and phones 24 (arrays). Written by scripts/fb-scrape-saved.ts, scripts/fb-enrich-with-cookies.mjs and the monitor. Personal data about private individuals: only key names are recorded here. GIN index declared by migration 20260203041116 is not among the indexes on prod. Unit: none (jsonb). Grain: one listing. Clock: as of the write.';
COMMENT ON COLUMN public.marketplace_listings.comments IS
'Listing comments, a JSON array, declared by migration 20260203041116_add_fb_contact_fields.sql. NULL on every row (2026-10-07); no writer in the repo sets it. Unit: none (jsonb). Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.marketplace_listings.raw_scrape_data IS
'What the writer kept of the source payload, a JSON object. Filled on 111,980 rows (96.7%, 2026-10-07) in two shapes. The sweep scraper shape (99.6% of sampled rows) has the keys id, title, price, location, is_sold, is_pending, description, creation_time, seller_id, seller_name, custom_title, category_type, all_image_urls, listing_lat and listing_lng; in the sample title, price, location, is_sold and all_image_urls are always filled, custom_title on 95.5% and the coordinates on 22.6%, while description, creation_time, seller_id, seller_name and category_type are null on every row (the logged-out endpoint does not return them). The submission shape (370 rows, 2026-03-15 .. 2026-09-24) has mode direct, agent_context and submitted_at. Read by refine-fb-listing (title-only refinement) and by import-fb-marketplace (session_type facebook_saved). Unit: none (jsonb). Grain: one listing. Clock: as of the last write.';

-- ── Parsed vehicle fields ───────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.marketplace_listings.parsed_year IS
'Model year read from the title (the monitor and scraper parse it; refine-fb-listing and import-fb-marketplace rewrite it). Filled on 115,550 rows (99.8%, 2026-10-07), 1909 .. 2027. Drives year_tier and trigger_compute_taste_score. A parse, not a verified year. Unit: calendar year (integer). Grain: one listing. Clock: as of the last write.';
COMMENT ON COLUMN public.marketplace_listings.extracted_year IS
'Model year as the fb-marketplace-orchestrator and extract-facebook-marketplace write it, next to parsed_year. Filled on 2,113 rows (1.8%, 2026-10-07; 1909 .. 2027) and equal to parsed_year on all but 1 of them, so it adds nothing; the repo migration 20260201000001 declares an extracted_year with extracted_make and extracted_model, which prod does not have. Index idx_marketplace_extracted_year. Unit: calendar year (integer). Grain: one listing. Clock: as of the write.';
COMMENT ON COLUMN public.marketplace_listings.parsed_make IS
'Make read from the title, lowercase from most writers. Filled on 115,273 rows (99.6%, 2026-10-07) with 6,967 distinct values, so it holds title words as well as makes; join through vehicles.make for a clean value. Unit: none (text). Grain: one listing. Clock: as of the last write.';
COMMENT ON COLUMN public.marketplace_listings.parsed_model IS
'Model read from the title, lowercase from most writers. Filled on 114,652 rows (99.1%, 2026-10-07) with 26,666 distinct values: free title text rather than a model list. Unit: none (text). Grain: one listing. Clock: as of the last write.';
COMMENT ON COLUMN public.marketplace_listings.year_tier IS
'Era bucket of parsed_year, a stored generated column (GENERATED ALWAYS AS, STORED; not writable): pre-55, 55-63, 64-72, 73-87, 88-00, 01-07, 08-13, modern (2014 and later), NULL when parsed_year is NULL. Stored (2026-10-07): 01-07 49,682, 88-00 40,405, 73-87 16,430, 64-72 4,919, pre-55 1,692, 55-63 1,537, modern 576, 08-13 309, NULL 193. The buckets match the sweep tiers of scripts/fb-marketplace-collector.ts. Unit: none (text). Grain: one listing. Clock: as of parsed_year.';
COMMENT ON COLUMN public.marketplace_listings.mileage IS
'Odometer reading in miles from the listing attributes or the description. Filled on 1,359 rows (1.2%, 2026-10-07); 12 values exceed 1,000,000 and 146 are under 100, so the extremes are parse errors. Written by the monitor and enrich scripts, extract-facebook-marketplace (direct mode), scripts/fb-import-urls.ts and refine-fb-listing. Unit: miles (integer). Grain: one listing. Clock: as of the write.';
COMMENT ON COLUMN public.marketplace_listings.transmission IS
'Transmission as the listing states it, free text with no CHECK or normalization. Filled on 1,276 rows (1.1%, 2026-10-07): Automatic 843, Manual 238, automatic 158, manual 16, and 13 other spellings on 21 rows (a speed count or a gearbox code). Group case-insensitively. Unit: none (text). Grain: one listing. Clock: as of the write.';
COMMENT ON COLUMN public.marketplace_listings.exterior_color IS
'Exterior color as the listing states it, free text. Filled on 1,374 rows (1.2%, 2026-10-07; 22 distinct values by ANALYZE statistics, undated); Black, White, Grey, Blue, Red and Silver lead. Unit: none (text). Grain: one listing. Clock: as of the write.';
COMMENT ON COLUMN public.marketplace_listings.interior_color IS
'Interior color as the listing states it, free text. Filled on 1,244 rows (1.1%, 2026-10-07; 19 distinct values by ANALYZE statistics, undated). Unit: none (text). Grain: one listing. Clock: as of the write.';
COMMENT ON COLUMN public.marketplace_listings.fuel_type IS
'Fuel as the listing states it, free text. Filled on 900 rows (0.78%, 2026-10-07): Gasoline 761, Diesel 75, Other 17, Petrol 15, Hybrid 13, Flex 11, Electric 6, Plug 2; Gasoline and Petrol name the same fuel. Written by the monitor and enrich scripts. Unit: none (text). Grain: one listing. Clock: as of the write.';
COMMENT ON COLUMN public.marketplace_listings.listed_days_ago IS
'How many days before the scrape the seller listed the item, as Facebook displays it. Filled on 1,175 rows (1.0%, 2026-10-07), 0 .. 364. The only trace of the Facebook listing time in the table, and relative: listing date = scraped_at minus this value, as of that scrape. Written by the monitor, scripts/fb-scrape-saved.ts and the bulk extract scripts. Unit: days (integer). Grain: one listing. Clock: event time (listing age at scraped_at).';

-- ── Review, outreach and the priority stamp ─────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.marketplace_listings.priority IS
'Writer stamp that looks like an era field but is not one for 98% of rows (2026-10-07). normal is the default and sits on 113,449 rows (the sweep scraper, orchestrator and ingest); manual_import on 607 (scripts/fb-import-urls.ts and scripts/fb-scrape-saved.ts, 2026-02-25 .. 2026-03-06); classic (year 1991 or earlier) 325, modern (1992 or later) 1,325 and unknown (no year parsed) 37 come only from scripts/marketplace-monitor/monitor.ts on 2026-02-02 .. 2026-02-03. Use year_tier or parsed_year for the era. No CHECK. Unit: none (text). Grain: one listing. Clock: as of the insert.';
COMMENT ON COLUMN public.marketplace_listings.reviewed IS
'Whether a person or script reviewed the row, default false, from the first table definition (scripts/marketplace-monitor/setup.sql, a manual review queue). True on 431 rows (0.37%, 2026-10-07; set 2026-02-03 .. 2026-07-09), nearly all by scripts/fb-marketplace-to-vehicles.mjs marking rows the vehicle import could not use (see review_notes), so it is a stamp of failed imports, not a quality verdict. Unit: boolean. Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.marketplace_listings.review_notes IS
'Reason a row was marked reviewed. Filled on 432 rows (0.37%, 2026-10-07): the stamps empty_stub_no_data (299 rows) and title_parse_failed (131) from scripts/fb-marketplace-to-vehicles.mjs, plus 2 hand-written notes (one a long analyst note, 2026-07-09). Free text, so values beyond the two stamps are not quoted. Unit: none (text). Grain: one listing. Clock: as of the review.';
COMMENT ON COLUMN public.marketplace_listings.messaged_at IS
'When the seller was messaged about the listing. NULL on every row (2026-10-07). The only writer is scripts/marketplace-monitor/messenger.ts, which selects rows where it is NULL and sets it after sending; no row holds a value. Unit: timestamptz. Grain: one listing. Clock: event time (our outreach).';

-- ── Sweep state: status, sightings and removal ──────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.marketplace_listings.status IS
'State of the listing as the last writer saw it, default active, no CHECK (the creating migration 20260201000001 declared one with other values). Stored (2026-10-07): active 111,670, removed 3,237, blocked 429, sold 320, duplicate 75, pending 12. removed comes from the sweep scraper (not seen in a sweep) and the enrich scripts (page gone); blocked and duplicate from the quality gates of import-fb-marketplace (no year, no make, garbage model, non-car type, no valid image once refined; duplicate of an existing vehicle); sold (320) from page text read by scripts/fb-scrape-saved.ts (272 rows of the 2026-02-25 saved-items batch, which have no raw_scrape_data) and from direct submissions (48); pending 12 the same way. The scraper upsert sets the status again on a re-sighting, so a removed row can return (540 active rows still carry removed_at). Unit: none (text). Grain: one listing. Clock: state as of last_seen_at or the last status write.';
COMMENT ON COLUMN public.marketplace_listings.first_seen_at IS
'When the project first saw the listing: default now() at insert, not overwritten by the scraper upsert (ingest rewrites it on a repeat). Filled on every row, 2026-02-05 .. 2026-10-01. 1,687 rows created 2026-02-02 .. 02-03 all carry the same instant (2026-02-05 05:53:10, the moment the column was added), so for those rows it is not an observation time. The client-supplied writers (ingest, the orchestrator, fb-import-urls) pass their own clock. Our observation time, not the Facebook listing time. Unit: timestamptz. Grain: one listing. Clock: ingest time (first sighting).';
COMMENT ON COLUMN public.marketplace_listings.last_seen_at IS
'When the project last saw the listing: the scraper passes its own client clock on every sighting, and submissions refresh it. 2026-02-05 .. 2026-10-01 (by month: 2026-02 3,459; 03 29,714; 04 30,767; 05 43,244; 06 8,459; 07 78; 08 12; 09 9; 10 1, 2026-10-07). It is earlier than first_seen_at on 73,210 rows (63%): by under a second on most (client clock against the database default), by more than a minute on 379 and up to 3 hours, so compare the two with a tolerance. 39,400 rows were seen again more than an hour after first_seen_at. Unit: timestamptz. Grain: one listing. Clock: ingest time (latest sighting).';
COMMENT ON COLUMN public.marketplace_listings.scraped_at IS
'When the writer fetched or received the listing: the client clock the scraper passes on every upsert (default now() when omitted). Filled on every row, 2026-02-03 .. 2026-10-01. Equals created_at on only 471 rows because the upsert rewrites it on each sighting (38,957 rows were scraped again more than an hour after first_seen_at), so it is the latest scrape, not the first. Used by compute_enrichment_priority() for freshness decay. Our observation time, not the Facebook listing time. Unit: timestamptz. Grain: one listing. Clock: ingest time (latest scrape).';
COMMENT ON COLUMN public.marketplace_listings.created_at IS
'When the row was inserted: default now(), set by the database and never changed by a re-sighting. 2026-02-02 .. 2026-10-01 (2026-10-07): 2026-02 5,007; 03 36,364; 04 26,843; 05 40,094; 06 7,335; 07 78; 08 12; 09 9; 10 1. Ingest time of the first sighting. Not the Facebook listing time. Unit: timestamptz. Grain: one listing. Clock: ingest time.';
COMMENT ON COLUMN public.marketplace_listings.removed_at IS
'When the listing was judged gone: the sweep scraper writes its run time for listings not seen in a sweep; scripts/fb-scrape-saved.ts writes it when a saved item is removed; handle_listing_reappearance() clears it. Filled on 3,777 rows (3.3%, 2026-10-07): 3,235 with status removed, 540 with status active (re-sighted after removal; the scraper does not clear it), 2 removed without a reason. Latest 2026-06-11. A sweep inference, not the sale or delisting time. Unit: timestamptz. Grain: one listing. Clock: ingest time (our sweep).';
COMMENT ON COLUMN public.marketplace_listings.removal_reason IS
'Why the listing was marked gone, free text. not_seen_in_sweep on all 3,775 filled rows (3.3%, 2026-10-07), written by scripts/fb-marketplace-local-scraper.mjs; detect_disappeared_listings() and the orchestrator would write disappeared, which no row holds. NULL on 111,968 rows. Unit: none (text). Grain: one listing. Clock: as of removed_at.';
COMMENT ON COLUMN public.marketplace_listings.sold_price_source IS
'How a sold price was known (inferred, community_reported or owner_reported by the code that sets it). NULL on every row (2026-10-07), and prod has no sold_price column to qualify, so no sale outcome is stored: detect_disappeared_listings() would set inferred, process_marketplace_sale_reports() and report-marketplace-sale the others, and none has left a value. The 320 rows with status sold carry no sale price. Unit: none (text). Grain: one listing. Clock: n/a.';
COMMENT ON COLUMN public.marketplace_listings.submission_count IS
'How many times the listing was submitted by a person or agent, default 1. 1 on 115,536 rows, 2 on 54, up to 49 (2026-10-07). Raised by extract-facebook-marketplace on each repeat submission and by trg_increment_submission_count when a fb_listing_sightings row arrives with source user_submission; sweep re-sightings do not raise it. Read as a demand signal for a listing, not a count of sightings. Unit: count (integer). Grain: one listing. Clock: as of the last submission.';
COMMENT ON COLUMN public.marketplace_listings.refined_at IS
'When refine-fb-listing last processed the row (a title-only pass also stamps it), or when an enrich script found the page gone. Filled on 63,924 rows (55.2%, 2026-10-07): 2026-02 10, 03 39,544, 04 22,696, 05 1,384, 06 288, 07 2; latest 2026-07-19. NULL means never refined, not unrefinable. Unit: timestamptz. Grain: one listing. Clock: ingest time (the refine pass).';
COMMENT ON COLUMN public.marketplace_listings.taste_scored_at IS
'When taste_score was computed: trigger_compute_taste_score sets it to now() on every insert and whenever title, parsed_year, parsed_make, parsed_model or location changes; pipeline_registry owner trigger_compute_taste_score. Filled on every row; latest 2026-10-01. Unit: timestamptz. Grain: one listing. Clock: ingest time (the scoring).';

DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(a.attname, ', ' ORDER BY a.attnum) INTO missing
  FROM pg_attribute a
  WHERE a.attrelid = 'public.marketplace_listings'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND col_description(a.attrelid, a.attnum) IS NULL;
  IF missing IS NULL THEN
    RAISE NOTICE 'marketplace_listings: every column has a comment';
  ELSE
    RAISE NOTICE 'marketplace_listings columns still without a comment: %', missing;
  END IF;
END
$$;

COMMIT;
