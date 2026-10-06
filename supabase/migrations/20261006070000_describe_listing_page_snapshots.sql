-- Describe listing_page_snapshots: table purpose with its clocks, and the 14 undescribed columns (2 of 16
-- described before: html_storage_path, markdown_storage_path; left as they are).
-- Lane C (cartographer), night shift 2026-10-05. Comments only. No HTML was read: probes used IS NULL tests only.
--
-- EVIDENCE (read 2026-10-06 UTC):
--   Writer: _shared/archiveFetch.ts (insert one row per fetch, duplicate (platform, listing_url, html_sha256) is
--   23505 and skipped; metadata gets caller and cost_cents), used by extract-bat-core, extract-auction-comments,
--   extract-gooding, extract-cars-and-bids-core, extract-hagerty-listing, ingest and others. Readers re-use a
--   successful snapshot instead of re-fetching (archiveFetch cache, readArchivedPage). scripts/migrate-snapshots.mjs
--   moves html/markdown to the storage bucket listing-snapshots and sets the two *_storage_path columns and NULLs the
--   inline copy. Parsers stamp metadata.parsed_at / parser_version (BaT) and bj_parsed_at (Barrett-Jackson).
--   Profile (tablesample 2%, n=16,459; table about 711K rows, 16.7 GB): html inline 21%, storage path 63%, markdown
--   inline 15%; success 93%; error_message 7%; created_at differs from fetched_at on 41%. fetched_at 2026-01-21 ..
--   2026-10-06; last 30 d: bat (direct), craigslist (direct), a few carsandbids (firecrawl) and classiccars.

SET statement_timeout = '60s';
SET lock_timeout = '10s';

BEGIN;

COMMENT ON TABLE public.listing_page_snapshots IS
'Fetch log of listing pages: one row per fetch of one listing URL that returned new content (grain: platform x URL x content hash; identical re-fetches are skipped by the unique index on platform, listing_url, html_sha256). Append-only by writer contract (_shared/archiveFetch.ts inserts, never updates content; scripts/migrate-snapshots.mjs only moves the body to storage). Event time = fetched_at (the moment the page state was observed). Ingest time = created_at. Extractors read a snapshot here before fetching the source again, so a parsed field is as of fetched_at, not as of the parse. The body is inline in html/markdown or in the storage bucket listing-snapshots at html_storage_path / markdown_storage_path.';

COMMENT ON COLUMN public.listing_page_snapshots.id IS
'Surrogate key of the snapshot. Extractors cite it as the source of what they parsed (e.g. description receipts). Unit: none (uuid). Source: gen_random_uuid() default. Grain: one page fetch. Clock: n/a.';
COMMENT ON COLUMN public.listing_page_snapshots.platform IS
'Platform slug the caller passed: bat, craigslist, mecum, barrett-jackson, carsandbids, classiccars, bonhams, gooding, jamesedition, pcarmarket, rmsothebys, ... Free text, not keyed. Unit: none. Source: archiveFetch options.platform. Grain: one page fetch. Clock: n/a.';
COMMENT ON COLUMN public.listing_page_snapshots.listing_url IS
'Listing page URL as normalized by archiveFetch before fetching. Names a listing that auction_events / vehicle_events hold by source_url; not keyed to them. Unit: none. Source: archiveFetch. Grain: one page fetch. Clock: n/a.';
COMMENT ON COLUMN public.listing_page_snapshots.fetched_at IS
'When the page was fetched: the moment its content was observed. Unit: timestamptz (UTC). Source: archiveFetch sets now() at fetch. Grain: one page fetch. Clock: event (observation time of the page state).';
COMMENT ON COLUMN public.listing_page_snapshots.fetch_method IS
'How the page was fetched: direct (plain HTTP) or firecrawl (paid rendering service). Unit: none. Source: archiveFetch (result.source). Grain: one page fetch. Clock: n/a.';
COMMENT ON COLUMN public.listing_page_snapshots.http_status IS
'HTTP status code of the fetch. Unit: HTTP status. Source: archiveFetch. Grain: one page fetch. Clock: n/a.';
COMMENT ON COLUMN public.listing_page_snapshots.success IS
'True when the fetch returned non-empty HTML that the garbage check (isGarbageHtml: block pages, empty shells) accepted. Readers use only success rows. Unit: boolean. Source: archiveFetch. Grain: one page fetch. Clock: n/a.';
COMMENT ON COLUMN public.listing_page_snapshots.error_message IS
'Fetch error text when the fetch failed; NULL otherwise. Unit: none. Source: archiveFetch (result.error). Grain: one page fetch. Clock: n/a.';
COMMENT ON COLUMN public.listing_page_snapshots.html IS
'Raw page HTML when kept inline; NULL after scripts/migrate-snapshots.mjs moved it to storage (then read html_storage_path). 21% of rows inline (2026-10-06 sample). Unit: none. Source: archiveFetch. Grain: one page fetch. Clock: n/a (content as of fetched_at).';
COMMENT ON COLUMN public.listing_page_snapshots.html_sha256 IS
'sha256 of the fetched HTML; with platform and listing_url unique, so an unchanged page is not stored twice. Unit: none (hex). Source: archiveFetch. Grain: one page fetch. Clock: n/a.';
COMMENT ON COLUMN public.listing_page_snapshots.content_length IS
'Length of the fetched HTML. Unit: characters (JavaScript string length, not bytes). Source: archiveFetch (0 when no HTML). Grain: one page fetch. Clock: n/a.';
COMMENT ON COLUMN public.listing_page_snapshots.metadata IS
'Fetch and parse context as JSON: caller (function that fetched), cost_cents (fetch cost), mode, extractor, user_agent, vehicle_id and auction_event_id (what the caller was reading for), vehicle_matched, parsed_at and parser_version (BaT parse stamp), bj_parsed_at / bj_parser_version (Barrett-Jackson), vin_valid, chassis, skip_reason. Unit: none. Grain: one page fetch. Clock: n/a.';
COMMENT ON COLUMN public.listing_page_snapshots.created_at IS
'When the snapshot row was inserted. Unit: timestamptz (UTC). Source: default now(); differs from fetched_at on 41% of rows (2026-10-06 sample), so use fetched_at for the page moment. Grain: one page fetch. Clock: ingest.';
COMMENT ON COLUMN public.listing_page_snapshots.markdown IS
'Page content as markdown when the fetch method returned it (firecrawl); NULL for direct fetches and after migration to storage. Unit: none. Source: archiveFetch. Grain: one page fetch. Clock: n/a (content as of fetched_at).';

COMMIT;
