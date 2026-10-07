-- Describe publication_pages: all 24 columns, none had a COMMENT ON COLUMN (0 of 24 described before, catalog count on
-- prod, 2026-10-07), and an extended table comment. Comments only.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself"). Read-only table in the atlas: 48,284 rows on 2026-10-07 14:09Z by exact count (equal
-- to the atlas estimate), no write since the statistics counters began; the newest row is from 2026-07-22 05:32Z and
-- the newest write an update at 2026-07-27 18:13Z.
--
-- METHOD (read 2026-10-07 14:09-14:18Z UTC):
--   Columns, types, defaults, constraints (with convalidated), indexes, triggers, policies (with their role lists),
--   grants (has_table_privilege for anon and authenticated) and existing comments from pg_attribute, pg_attrdef,
--   pg_constraint, pg_indexes, pg_trigger, pg_policy and pg_description; the views and materialized views that read the
--   table from pg_depend, with their anon grants. Fill, page_type, status, model, creation-day, scan-month and
--   update-month counts, image_url hosts and storage path prefixes, the key sets of spatial_tags, ai_scan_metadata and
--   metadata (key names only), error-message shapes (numbers and ids masked), confidence, cost, page-number and
--   text-length ranges, perceptual-hash sharing, the joins to publications (platform, type, source, publisher count) and
--   from publication_features, are exact counts over the whole table (34 MB heap, 80 MB in all, read only). What anon
--   can read comes from a count under SET LOCAL ROLE anon in a read-only transaction. "Filled" means non-NULL.
--   Writers and readers from code at origin/main 87eb9a517 (supabase/functions, supabase/migrations, scripts,
--   nuke_frontend/src, mcp-server, apps; also git history): the creating migration 20260302070000_publications_system.sql
--   (table, indexes, the updated_at trigger, the three policies); 20260302080000_publications_pipeline_registry.sql;
--   20260302100000_stale_locks_publication_pages.sql; scripts/stbarth/index-publication-pages.mjs (the indexer),
--   analyze-publication-pages.mjs and analyze-publication-pages-local.mjs (the analyzers), analysis-progress.mjs and
--   compare-vision-models.mjs; docs/publishing/STATUS_2026-04-09.md; commit 3949d4711 (the guidebook pages and
--   concierge-ground). The July writers named in write_receipts are scripts of the separate lofficiel-concierge
--   repository (analyze_pages_v2.mjs writes as vision-v2, classify_image_class.mjs as image-class-v1, bulk_ingest.py
--   created the bulk_upload pages, nightly_audit.sh). The bodies, read with pg_get_functiondef, of the 26 live functions
--   whose body names the table (8 of them update it) and their EXECUTE grants; cron.job (mag-brand-facts-refresh, jobid
--   498, refreshes mag_brand_page_facts; release-stale-locks, jobid 188, calls release_stale_locks_fast, which does not
--   touch this table); pg_depend (3 views, 2 materialized views); pg_trigger (4 triggers); write_receipts (8,544 receipts,
--   summarised by writer, operation and client); pg_stat_user_tables; pipeline_registry (9 rows; none is added or
--   changed here); supabase_migrations.schema_migrations (20 logged migrations name the table, most not in the repo);
--   the deployed function list read through the management API (328 functions, 2026-10-07).
-- LIMITS:
--   Writes before the receipt triggers (2026-07-21 03:14Z) are not attributed beyond the created_at and updated_at
--   clocks. Whether a shared perceptual hash is a repeated advertisement or the same issue uploaded twice is not recorded.
--   pg_stat_user_tables counters began at the last server start (2026-09-29 09:20Z). The rows hold magazine page images,
--   page text and, in spatial_tags, names of people printed on the pages, all readable by anyone: quoted values are
--   page_type, status, model, source and writer codes, URL hosts, key names, column and function names and counts only;
--   no page text, person name, publisher name or URL path.
-- CHANGED EXISTING COMMENTS:
--   Table comment only: it said "One row per printed page: mirrored image + verbatim OCR text. The evidence terminal
--   beneath publication_features — every menu price drills to the page it was printed on." (set by the logged
--   migration 20260702174950 publication_pages, not in the repo). That stays as the opening; the new comment adds that
--   41,592 pages are not mirrored and 31,355 have no text, the sources, the writers and their receipts, the readers, the
--   anon write path, the registry gap and the clocks. There were no column comments.

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

COMMENT ON TABLE public.publication_pages IS
'One row per printed page: mirrored image + verbatim OCR text. The evidence terminal beneath publication_features — every menu price drills to the page it was printed on. In fact (grain: one page position of one publication, UNIQUE (publication_id, page_number)): 48,284 rows on 2026-10-07 for 623 of the 1,080 publications (457 have no pages), 19 publisher slugs, a median of 68 pages per publication and at most 330. Three sources: (1) 41,592 Issuu pages of 578 publications, created 2026-03-01 by scripts/stbarth/index-publication-pages.mjs with image_url pointing at the Issuu CDN (image.isu.pub), not mirrored, so not all of them still resolve (429 rows carry Image fetch failed); (2) 6,362 self-hosted pages of 44 publications mirrored to Supabase storage: 5,316 bulk_upload pages on 2026-07-12 (bulk_ingest.py of the lofficiel-concierge repository), 554 pages on 2026-07-14 and 492 pages minted from camera frames on 2026-07-22 (metadata.source camera_shot; receipt writer night-shift-publication-pages-mint); (3) 330 pages of 1 anyflip guidebook on 2026-07-02 (source guestbook_extraction, commit 3949d4711). Vision analysis: completed 16,438, pending 31,355 (31,335 of them March Issuu pages never analyzed), failed 491; models modal/qwen2.5vl:7b 16,094 (scripts/stbarth/analyze-publication-pages-local.mjs on a Modal GPU), claude_vision_verbatim_ocr 330 (the guidebook), ollama/qwen2.5vl:7b 14, claude-haiku-4-5-20251001 2 (analyze-publication-pages.mjs). So the verbatim text exists on 14,617 rows (30.3%), not on every page. Later writes, attributed by the receipt triggers since 2026-07-21 03:14Z (8,544 statement receipts through 2026-07-27 18:13Z): UPDATE by vision-v2 2,784 rows, image-class-v1 1,201, junk-name-invariant-v2 812, night-shift-phash 492, mag-invariants caption-echo pass 6, nightly-audit 4, undeclared 6,080 (PostgREST and the management API), and INSERT of 492 rows in 6 statements (night-shift-publication-pages-mint); vision-v2, image-class-v1 and nightly-audit are scripts of the separate lofficiel-concierge repository, the other named passes are in neither local checkout, and none is a declared owner. Nothing has written since 2026-07-27 18:13Z: pg_stat_user_tables counts 0 inserts, updates and deletes, 0 sequential and 528 index scans since the server last started (2026-09-29 09:20Z; read 14:09Z). pipeline_registry declares the table owner process-publication-pages, which exists as no script, function or edge function (the indexer is index-publication-pages.mjs), and 8 field owners analyze-publication-pages (do_not_write_directly true on 7), which the July writers bypass. Readers: publication_features joins on (publication_id, page = page_number), and all 3,002 features resolve to a page (129 publications); the views v_mag_brand_landable, v_mag_brand_category and queue_lock_health and the materialized views mag_brand_page_facts (refreshed daily at 04:15 UTC by cron job mag-brand-facts-refresh, jobid 498) and mag_spine_page_kinds, all but queue_lock_health readable by anon; 25 mag_ SQL functions of the L''Officiel magazine lane name the table, 18 of them with EXECUTE granted to anon and authenticated (mag_find, mag_magazine_overview, mag_people_index, mag_brand_network and others); the edge function concierge-ground (deployed 2026-07-22, source not on main); and the stbarth scripts. Access: RLS is on and all three policies apply to every role: pub_pages_read (SELECT, USING true) lets anyone read all 48,284 rows (counted under SET LOCAL ROLE anon, 2026-10-07), people named in spatial_tags included; pub_pages_insert (INSERT, WITH CHECK true) and pub_pages_update (UPDATE, USING true, no WITH CHECK) let anyone with the public API key insert pages and overwrite any column of any page through the REST API; there is no DELETE policy. anon and authenticated hold SELECT, INSERT, UPDATE, DELETE and TRUNCATE. Three functions with EXECUTE granted to anon and authenticated rewrite spatial_tags across many pages and run with the rights of the caller, whom that update policy lets update: mag_remediate_coverstar_text, mag_flag_caption_echoes and mag_unland_brand_evidence (the last strips every brand that mag_land_brand_evidence added). The other writer functions (mag_remediate_coverstar_span, mag_remediate_invariants, mag_land_brand_evidence, mag_demotion_review, release_stale_locks) are not executable by anon or authenticated. Prod differs from the creating migration: phash with idx_pubpages_phash, the trigram index publication_pages_text_trgm (logged 20260721234246), the receipt triggers (logged 20260721031417 write_receipts_observability) and this comment (logged 20260702174950) are not in the repo, and its indexes on page_type and spatial_tags are absent. Clocks: created_at is the insert time, ai_last_scanned the analyzer clock of the last vision pass, updated_at the database clock of the last update (trigger); the print date of the page is publications.publication_date; nothing records when the image was fetched.';

-- ── Identity ───────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.publication_pages.id IS
'Surrogate key of the page row, uuid, gen_random_uuid() default, the PRIMARY KEY. 48,284 values (2026-10-07). No foreign key points at it; publication_features reaches a page by (publication_id, page_number) instead. Read by mag_brand_page_facts and mag_spine_page_kinds. Unit: none (uuid). Source: column default. Grain: one page of one publication. Clock: n/a.';
COMMENT ON COLUMN public.publication_pages.publication_id IS
'Publication the page belongs to: a publications.id, nullable, foreign key ON DELETE CASCADE (validated), indexed (idx_pub_pages_publication) and, with page_number, the UNIQUE key. Filled on every row (2026-10-07): 623 distinct publications, 578 Issuu (41,592 pages), 44 self-hosted (6,362) and 1 anyflip (330); the publication carries the publisher, title, date and page_count. publication_features joins on it with page = page_number. Unit: none (uuid). Source: the writer that created the page. Grain: one page of one publication. Clock: n/a.';
COMMENT ON COLUMN public.publication_pages.page_number IS
'Position of the page in the publication as the source sequences it (Issuu page index, upload order, flipbook page), integer NOT NULL, from 1, never above publications.page_count (2026-10-07); range 1 .. 389. Not the number printed on the page: the guidebook rows keep that in metadata.printed_page, and publication_features.printed_page holds it for features. Unit: ordinal. Source: the writer (index-publication-pages.mjs loops 1 .. page_count). Grain: one page of one publication. Clock: n/a.';
COMMENT ON COLUMN public.publication_pages.page_type IS
'Kind of page as the vision pass classified it, text, nullable, no CHECK (the analyzer prompt allows cover, editorial, advertisement, property_listing, artwork, photo_spread, directory, credits, table_of_contents, other). Filled on 16,110 rows (33.4%, 2026-10-07): editorial 6,864, advertisement 3,578, property_listing 1,906, cover 1,686, photo_spread 1,191, directory 353, table_of_contents 278, credits 120, artwork 110, other 24; NULL on every page not analyzed and on the 330 guidebook pages. Later passes adjudicated it: spatial_tags.page_type_adjudicated, page_type_decided_by and page_type_raw_vision_claim on 1,569 rows, ai_scan_metadata.vision_page_type_overridden on 429; equal to spatial_tags.page_type on 15,019 rows. The index on it from the creating migration is absent on prod. Unit: none (text code). Source: the vision model, adjusted by later passes. Grain: one page of one publication. Clock: as of ai_last_scanned.';

-- ── Image ──────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.publication_pages.image_url IS
'Where the page image is served, text, nullable, filled on every row (2026-10-07). On the 41,592 Issuu pages a URL on the Issuu CDN host image.isu.pub built from the publication cdn_hash and the page number (index-publication-pages.mjs), not a mirrored copy, so the existing table comment does not hold for them; 429 rows carry Image fetch failed. On the 6,692 pages of 2026-07 a public URL in Supabase storage (the concierge-media mirror). Unit: none (URL). Source: the writer that created the page. Grain: one page of one publication. Clock: as of created_at.';
COMMENT ON COLUMN public.publication_pages.storage_image_path IS
'Path of the mirrored page image in Supabase storage, text, nullable. Filled on 6,138 rows (12.7%, 2026-10-07): the 5,316 bulk_upload pages, the 330 guidebook pages and the 492 camera-shot pages, under 41 issue-slug prefixes (shape issue-slug/page-n.jpg on 5,808, issue-slug/n/pn.webp on the guidebook pages); NULL on every Issuu page and on 554 self-hosted pages of 2026-07-14, whose image_url points into storage directly. Unit: none (storage path). Source: the July writers. Grain: one page of one publication. Clock: as of created_at.';
COMMENT ON COLUMN public.publication_pages.thumbnail_url IS
'Intended URL of a small page image (creating migration), text, nullable. NULL on all 48,284 rows (2026-10-07); no writer sets it. Unit: none (URL). Source: none (never written). Grain: one page of one publication. Clock: n/a.';
COMMENT ON COLUMN public.publication_pages.phash IS
'Perceptual hash of the page image, 16 hex characters, text, nullable, indexed (idx_pubpages_phash); added outside the repo migrations. Filled on 6,362 rows (2026-10-07), every self-hosted page and no Issuu or guidebook page; the receipt writer night-shift-phash set 492 of them on 2026-07-22; the earlier writes predate the receipts (compute_phash.py of the lofficiel-concierge repository is a phash writer). 2,594 distinct values: 1,444 are shared by 5,212 rows, 5,203 of those across different publications, at most 10 rows per hash, which a repeated advertisement or an issue uploaded twice would both produce. The magazine metrics key distinct visual pages on it (mag_spine_page_kinds; logged migration 20260713184108 mag_dedup_by_phash_and_canon_issue). Unit: none (hex hash). Source: the phash writer. Grain: one page of one publication. Clock: n/a.';

-- ── Text ───────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.publication_pages.extracted_text IS
'Text read off the page by the vision pass (the raw_text of its answer), text, nullable; registry owner analyze-publication-pages, do_not_write_directly. Filled on 14,617 rows (30.3%, 2026-10-07), never the empty string; median 186 characters, longest 9,082; equal to spatial_tags.raw_text on 14,273 rows. NULL on the 31,844 pages never analyzed and on 1,823 completed pages, 1,012 of them because a later pass found the text was the prompt placeholder echoed back, moved it to metadata.superseded_extraction and recorded Empty read in error_message (2026-07-19 .. 07-27). Indexed for substring search (publication_pages_text_trgm). Read by v_mag_brand_landable and the mag_ functions. Magazine text, readable by anyone; none is quoted here. Unit: none (text). Source: the vision model (qwen2.5vl:7b on Modal for most rows). Grain: one page of one publication. Clock: as of ai_last_scanned.';
COMMENT ON COLUMN public.publication_pages.extraction_confidence IS
'Confidence the vision model reported for its reading of the page (the confidence of its answer), double precision, nullable. Filled on 15,717 rows (2026-10-07): 22 distinct values from 0.6 to 1, median 0.95; equal to spatial_tags.confidence on 15,387 rows. A self-report, not a measured accuracy. Unit: score, 0 .. 1. Source: the vision model. Grain: one page of one publication. Clock: as of ai_last_scanned.';

-- ── Vision analysis ────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.publication_pages.spatial_tags IS
'Structured answer of the vision pass, jsonb, nullable, default []; registry owner analyze-publication-pages, do_not_write_directly. The default empty array on 32,149 rows (2026-10-07), never analyzed; an object on 16,135 rows with brands (16,135), raw_text and page_type (16,110), confidence, people_mentioned, locations and creative_credits (about 16,050), artworks, businesses and properties (about 15,250), people_in_image (5,581) and garments_visible (4,063) from the people and garments pass (vision-v2), page_type_adjudicated, page_type_decided_by and page_type_raw_vision_claim (1,569), image_class and image_class_detail (1,201, image-class-v1) and demoted_people (572); entries flagged by the mag_ remediation functions carry suspect and suspect_basis. The only coordinates are per-entry boxes: 6,324 people_in_image entries carry a bbox (and 1,483 a crop_path). Names of people printed on the pages are in it and readable by anyone; none is quoted here. Read by mag_brand_page_facts, v_mag_brand_category, v_mag_brand_landable and the mag_ functions. Unit: none (jsonb). Source: the vision model, then the July passes and the mag_ functions. Grain: one page of one publication. Clock: as of ai_last_scanned (later edits are stamped only in updated_at).';
COMMENT ON COLUMN public.publication_pages.ai_scan_metadata IS
'Run metadata of the vision passes, jsonb, nullable, default {}; registry owner analyze-publication-pages, do_not_write_directly. Not {} on 16,135 rows (2026-10-07): model, duration_ms and cost_usd on 16,110, local (16,108) and cloud_gpu (16,094) from the local analyzer; v2_people_garments 5,794 (vision-v2), page_type_source 1,541, image_class_v1 1,122 (image-class-v1 provenance), vision_page_type_overridden 429, exact_duplicate_sweep 314, degenerate_collapsed 5, input_tokens and output_tokens 2 (the Claude analyzer), garments_restore_reverted 1. Unit: none (jsonb). Source: the analyzer scripts and the July passes. Grain: one page of one publication. Clock: as of ai_last_scanned.';
COMMENT ON COLUMN public.publication_pages.ai_last_scanned IS
'When a vision pass last finished on the page, timestamptz, nullable, the analyzer clock (new Date() in the script). Filled on 16,465 rows (2026-10-07): 9,773 in 2026-03 (from 2026-03-02 00:03Z) and 6,692 in 2026-07 (until 2026-07-27 05:20Z); 27 of them are on rows no longer completed. Unit: timestamptz. Source: the analyzer scripts. Grain: one page of one publication. Clock: writer time of the last vision pass.';
COMMENT ON COLUMN public.publication_pages.ai_processing_status IS
'State of the page in the vision queue, text, nullable, default pending, CHECK in (pending, processing, completed, failed, skipped), indexed (idx_pub_pages_ai_status); registry owner analyze-publication-pages. 3 occur (2026-10-07): pending 31,355 (31,335 Issuu pages of 2026-03 never analyzed and 20 bulk_upload pages), completed 16,438, failed 491 (486 Issuu pages, 5 self-hosted; set after 3 attempts); processing and skipped never. The analyzer claims pending rows with locked_by NULL and attempts below 3. Read by queue_lock_health. Unit: none (text code). Source: the analyzer scripts. Grain: one page of one publication. Clock: as of updated_at.';
COMMENT ON COLUMN public.publication_pages.analysis_model IS
'Model of the last vision pass that completed the page, text, nullable; registry owner analyze-publication-pages (its description, haiku or sonnet, predates the local models). Filled on 16,440 rows (2026-10-07): modal/qwen2.5vl:7b 16,094, claude_vision_verbatim_ocr 330 (the guidebook), ollama/qwen2.5vl:7b 14, claude-haiku-4-5-20251001 2. The July passes record their own models in ai_scan_metadata, not here. Unit: none (text code). Source: the analyzer scripts. Grain: one page of one publication. Clock: as of ai_last_scanned.';
COMMENT ON COLUMN public.publication_pages.analysis_cost IS
'Model cost of the vision pass, numeric, nullable; registry owner analyze-publication-pages (cost in US dollars). Filled on 16,110 rows (2026-10-07): 0 on 16,108 (the local and Modal runs record 0, so GPU time is not counted) and above 0 on the 2 claude-haiku rows (under 0.01 each). Not a measure of what the analysis cost. Unit: US dollars of model API spend. Source: the analyzer scripts. Grain: one page of one publication. Clock: as of ai_last_scanned.';

-- ── Queue state ────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.publication_pages.locked_by IS
'Worker that claimed the page for analysis, text, nullable, indexed where filled (idx_pub_pages_locked); registry owner analyze-publication-pages. NULL on all 48,284 rows (2026-10-07): no claim is open. release_stale_locks would return stale processing rows to pending, but no cron job calls it (release-stale-locks calls release_stale_locks_fast, which does not touch this table). Unit: none (worker name). Source: the analyzer scripts. Grain: one page of one publication. Clock: n/a.';
COMMENT ON COLUMN public.publication_pages.locked_at IS
'When the worker claimed the page, timestamptz, nullable. NULL on all 48,284 rows (2026-10-07). Read by queue_lock_health. Unit: timestamptz. Source: the analyzer scripts. Grain: one page of one publication. Clock: writer time of the claim.';
COMMENT ON COLUMN public.publication_pages.attempts IS
'Failed analysis attempts, integer NOT NULL, default 0; the analyzer adds 1 per failure and marks the page failed at 3. Above 0 on 812 rows (2026-10-07): all 491 failed rows (3 each), 212 completed and 109 pending rows; at most 3. Unit: attempts. Source: the analyzer scripts. Grain: one page of one publication. Clock: as of updated_at.';
COMMENT ON COLUMN public.publication_pages.max_attempts IS
'Attempt limit per page, integer NOT NULL, default 3. 3 on all 48,284 rows (2026-10-07). Read by the SQL claim of analyze-publication-pages.mjs (attempts < max_attempts); its REST claim and the local analyzer use the constant 3 instead. Unit: attempts. Source: column default. Grain: one page of one publication. Clock: n/a.';
COMMENT ON COLUMN public.publication_pages.error_message IS
'Last error of an analysis pass, or a note of a later audit, text, nullable. Filled on 1,612 rows (2026-10-07), with shapes: Empty read (the text was the prompt placeholder echoed back; on 1,012 completed rows, written by a 2026-07 audit pass), Image fetch failed: 403 (429 rows, the image host refused the fetch: 377 failed, 52 pending), JSON parse failed (164) and errors of the Modal endpoint (7). A completed status does not clear it. Unit: none (text). Source: the analyzer scripts and the July audit passes. Grain: one page of one publication. Clock: as of updated_at.';

-- ── Extras and clocks ──────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.publication_pages.metadata IS
'Extras of the page, jsonb, nullable, default {}. Not {} on 7,838 rows (2026-10-07): source (bulk_upload 5,316, camera_shot 492), superseded_extraction 1,655 (an array of prior readings, each with extracted_text, method, observed_at, reason, source and trust, and on 639 also the prior ai_scan_metadata, extraction_confidence and page_type: superseded, not overwritten), people_reconciliation 1,144, reclassified_2026_07_19 747 and its pass2 61, requeue_2026_07_19 554, source_frame 492 (the camera frame a page was minted from), printed_page and source_url 330 (the guidebook). Unit: none (jsonb). Source: the July writers and audit passes. Grain: one page of one publication. Clock: as of updated_at.';
COMMENT ON COLUMN public.publication_pages.created_at IS
'When the row was inserted: default now(), the transaction clock of the insert. Filled on every row (2026-10-07): 2026-03-01 41,592 rows (the Issuu index), 2026-07-02 330, 2026-07-12 5,316, 2026-07-14 554, 2026-07-22 492 (05:32Z, the newest). It is the time the page entered the table, not the print date (publications.publication_date) nor the time the image was fetched. Unit: timestamptz. Source: column default. Grain: one page of one publication. Clock: ingest time.';
COMMENT ON COLUMN public.publication_pages.updated_at IS
'When the row was last updated: set to now() by the BEFORE UPDATE trigger publication_pages_updated_at, so every update moves it, the July spatial_tags edits included. Later than created_at on 17,038 rows (2026-10-07): 8,418 last updated in 2026-03 and 8,620 in 2026-07, the newest 2026-07-27 18:13Z. Unit: timestamptz. Source: trigger update_publication_pages_updated_at. Grain: one page of one publication. Clock: database time of the last write.';

DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(a.attname, ', ' ORDER BY a.attnum) INTO missing
  FROM pg_attribute a
  WHERE a.attrelid = 'public.publication_pages'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND col_description(a.attrelid, a.attnum) IS NULL;
  IF missing IS NULL THEN
    RAISE NOTICE 'publication_pages: every column has a comment';
  ELSE
    RAISE NOTICE 'publication_pages columns still without a comment: %', missing;
  END IF;
END
$$;

COMMIT;
