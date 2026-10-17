-- Describe build_threads: the 29 columns with no COMMENT ON COLUMN (2 of 31 described before, catalog count on prod,
-- 2026-10-14). Comments only; the table comment and the 2 existing column comments are unchanged.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself"). Companion of 20261008021000_describe_build_posts.sql.
--
-- METHOD (read 2026-10-14 08:33-08:35 UTC):
--   Columns, types, defaults, constraints (3 foreign keys, all validated; CHECK on extraction_status), policies and
--   pg_stat_user_tables from the catalog; fill from pg_stats null_frac and exact grouped counts over all 2,247 rows;
--   jsonb key counts over metadata and vehicle_hints.
--   Writers, from code at origin/main d7b418b20 and git history:
--     discover-build-threads (edge function, added 9f1578f4e 2026-01-30, deleted 53e40d55d 2026-04-06; read at
--       9871ee4fb^): upserts on thread_url with forum_source_id, thread_url, thread_url_normalized, thread_title,
--       author_handle, author_profile_url, vehicle_hints, vehicle_match_confidence, reply_count, view_count,
--       last_activity_date, extraction_status = discovered, metadata, updated_at.
--     extract-build-posts (edge function, same add, deleted 9871ee4fb 2026-03-31): sets extracting at start; on a
--       thread it had no row for, upserts title, author_handle, vehicle_hints, first_post_date; at the end sets
--       complete, posts_extracted, images_extracted, last_extracted_at, last_activity_date, extraction_cursor,
--       post_count and image_count_estimate.
--     scripts/extract-vehicle-identifiers.js, match-forum-vehicles.js, cross-reference-vins.js (vehicle_id only);
--       structure-build-timeline.js and batch-structure-threads-ollama.js (vehicle_id and vehicle_hints; the latter
--       also sets extraction_status = 'structured', which the CHECK rejects, so its update cannot land).
--   No cron job names the table; pg_stat_user_tables counts 0 inserts, updates and deletes since the statistics
--   were reset. Live SQL readers: get_threads_to_extract and backfill_org_vehicles_from_build_threads.
-- LIMITS:
--   The writers are deleted, so their behavior is read from their last committed version; whether that exact version
--   produced every row is Unknown. Quoted values are codes and counts: no handles, URLs or titles.

BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

-- ── Identity and source ───────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.build_threads.id IS
'Surrogate key of one forum build thread. Unit: none (uuid). Source: gen_random_uuid() default. Referenced by build_posts.build_thread_id (ON DELETE CASCADE). Grain: one thread. Clock: n/a.';
COMMENT ON COLUMN public.build_threads.forum_source_id IS
'Forum the thread lives on, foreign key to forum_sources.id (ON DELETE CASCADE, validated), NOT NULL. 42 distinct forums over 2,247 rows (2026-10-14). Source: both writers, from the forum_sources row they crawled. Unit: none (uuid). Grain: one thread. Clock: n/a.';
COMMENT ON COLUMN public.build_threads.thread_url IS
'URL of the thread as found on the forum section page, NOT NULL and UNIQUE; the upsert key of both writers (onConflict thread_url), so one row per distinct URL string. Unit: URL text. Source: discover-build-threads (list pages) or extract-build-posts (direct URL). Grain: one thread. Clock: n/a.';
COMMENT ON COLUMN public.build_threads.thread_url_normalized IS
'thread_url passed through the writers'' normalizeForumUrl, for matching the same thread reached by different URL forms; not constrained unique, so two raw URLs of one thread can still make two rows. Filled on all 2,247 rows; equal to thread_url on 380 (2026-10-14). Unit: URL text. Source: both writers. Grain: one thread. Clock: n/a.';
COMMENT ON COLUMN public.build_threads.thread_id_external IS
'The forum''s own thread id. Unit: text. Empty on all 2,247 rows (2026-10-14): no writer sets it. Grain: one thread. Clock: n/a.';
COMMENT ON COLUMN public.build_threads.thread_title IS
'Thread title as shown on the forum, verbatim. Filled on all 2,247 rows (2026-10-14). Unit: text. Source: discover-build-threads from the section list, or extract-build-posts from the thread page. A forum member''s words, not a vehicle fact; vehicle_hints is parsed from it. Grain: one thread. Clock: n/a.';

-- ── Author ────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.build_threads.author_handle IS
'Forum handle of the thread starter, verbatim (public on the forum; personal). Filled on about 56% of rows (pg_stats null_frac 0.44, 2026-10-14). Unit: text. Source: discover-build-threads from the list row, or extract-build-posts from the first post. Grain: one thread. Clock: n/a.';
COMMENT ON COLUMN public.build_threads.author_profile_url IS
'URL of the thread starter''s forum profile. Filled on about 56% of rows, alongside author_handle (pg_stats null_frac 0.44, 2026-10-14). Unit: URL text. Source: discover-build-threads. Grain: one thread. Clock: n/a.';
COMMENT ON COLUMN public.build_threads.author_external_identity_id IS
'Resolved identity of the thread starter, foreign key to external_identities.id (validated). Empty on all 2,247 rows (2026-10-14): no writer resolves it. Unit: none (uuid). Grain: one thread. Clock: n/a.';

-- ── Vehicle link ──────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.build_threads.vehicle_id IS
'Vehicle the thread is taken to be about, foreign key to vehicles.id (ON DELETE CASCADE, validated). Filled on 763 of 2,247 rows, 568 distinct vehicles; 47 rows hold an id absent from vehicles despite the validated key (2026-10-14; Unknown how, presumably a delete that skipped the foreign-key triggers). Set after discovery by the scripts extract-vehicle-identifiers.js, match-forum-vehicles.js, cross-reference-vins.js (VIN or year/make/model match) and structure-build-timeline.js (creates a vehicle from an LLM reading). A machine match, not a confirmed identity; no column records which script or evidence set it. Unit: none (uuid). Grain: one thread. Clock: n/a.';
COMMENT ON COLUMN public.build_threads.vehicle_match_confidence IS
'Despite its name, the discovery score that the thread is a build thread, not a vehicle-match confidence: discover-build-threads writes its build_confidence here (title keyword score, plus 0.15 if a year was parsed and 0.10 if a make was parsed, clamped to 0..1); the same value is in metadata.discovery_confidence. No vehicle-matching script writes it. Unit: fraction 0 to 1, numeric(3,2). 12 distinct values; 0.30 on 931 rows (2026-10-14). Grain: one thread. Clock: n/a.';

-- ── Thread counts (as read by the writers) ────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.build_threads.post_count IS
'Posts read by extract-build-posts (prior posts_extracted plus the posts parsed in the last run), not the forum''s own post count. Filled on 1,077 rows, every complete thread plus 94 others (2026-10-14). Unit: posts. Source: extract-build-posts at completion. Grain: one thread. Clock: as of last_extracted_at.';
COMMENT ON COLUMN public.build_threads.image_count_estimate IS
'Images found in the posts read by extract-build-posts; the writer sets it to the same running total as images_extracted, so it is not an independent estimate. Filled where post_count is (about 47% of rows, 2026-10-14). Unit: images. Source: extract-build-posts. Grain: one thread. Clock: as of last_extracted_at.';
COMMENT ON COLUMN public.build_threads.view_count IS
'View counter shown on the forum section list. Filled on about 35% of rows (pg_stats null_frac 0.65, 2026-10-14). Unit: views. Source: discover-build-threads, parsed from the list row when the forum''s DOM map has a view_count selector. Grain: one thread. Clock: as of the discovery crawl (metadata.discovered_at), not current.';
COMMENT ON COLUMN public.build_threads.reply_count IS
'Reply counter shown on the forum section list. Filled on about 40% of rows (pg_stats null_frac 0.60, 2026-10-14). Unit: replies. Source: discover-build-threads, parsed from the list row when the DOM map has a reply_count selector. Grain: one thread. Clock: as of the discovery crawl (metadata.discovered_at), not current.';

-- ── Thread dates ──────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.build_threads.first_post_date IS
'Date of the thread''s first post. Empty on all 2,247 rows (2026-10-14): only the extract-build-posts upsert for a thread with no prior row sets it, and every extracted thread already had one. Use min(build_posts.posted_at) instead. Unit: timestamptz. Grain: one thread. Clock: event time on the forum.';
COMMENT ON COLUMN public.build_threads.last_post_date IS
'Date of the thread''s last post. Empty on all 2,247 rows (2026-10-14): no writer sets it (last_activity_date carries that value). Unit: timestamptz. Grain: one thread. Clock: event time on the forum.';
COMMENT ON COLUMN public.build_threads.last_activity_date IS
'Latest post date known for the thread: the last-post date on the forum list at discovery, overwritten by the posted_at of the last post read when extract-build-posts completes. Filled on 57% of rows, from 2004-04-03 to 2026-01-30 (2026-10-14). Unit: timestamptz (parsed from forum text; time zone Unknown). Source: both writers. Grain: one thread. Clock: event time on the forum, as of the last crawl.';

-- ── Extraction state ──────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.build_threads.extraction_status IS
'Where the thread stands in post extraction. Unit: code, CHECK in (discovered, queued, extracting, complete, failed, stale); default discovered. On 2026-10-14: discovered 1,041, complete 983, extracting 223 (stuck since 2026-01-30; extract-build-posts sets extracting at start and complete only at the end). queued would be set by the SQL function queue_thread_extraction. Source: both writers. Grain: one thread. Clock: current state only; no per-state timestamp.';
COMMENT ON COLUMN public.build_threads.posts_extracted IS
'Running total of posts stored in build_posts by extract-build-posts across runs; the next resumed run starts numbering at posts_extracted + 1 (the cause of the duplicate rows described on build_posts). Default 0. Unit: posts. Source: extract-build-posts. Grain: one thread. Clock: as of last_extracted_at.';
COMMENT ON COLUMN public.build_threads.images_extracted IS
'Running total of images found by extract-build-posts across runs. Default 0. Unit: images. Source: extract-build-posts. Grain: one thread. Clock: as of last_extracted_at.';
COMMENT ON COLUMN public.build_threads.last_extracted_at IS
'When extract-build-posts last completed a run on the thread. Filled on 1,077 rows; latest 2026-01-30 14:02Z (2026-10-14). Unit: timestamptz. Source: extract-build-posts (its own clock). Grain: one thread. Clock: ingest time of the last extraction.';

-- ── Flags and dedup (never set) ───────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.build_threads.is_featured IS
'Meant to record that the forum marks the thread as featured. false (the default) on all 2,247 rows (2026-10-14): no writer sets it; stickiness is in metadata.is_sticky instead. Unit: boolean. Grain: one thread. Clock: n/a.';
COMMENT ON COLUMN public.build_threads.is_complete IS
'Meant to record that the build itself is finished (not that extraction is; see extraction_status). false (the default) on all 2,247 rows (2026-10-14): no writer sets it. Unit: boolean. Grain: one thread. Clock: n/a.';
COMMENT ON COLUMN public.build_threads.has_sale_mention IS
'Meant to flag a thread that mentions selling or a sale. false (the default) on all 2,247 rows (2026-10-14): no writer sets it, so false here does not mean no sale was mentioned. Unit: boolean. Grain: one thread. Clock: n/a.';
COMMENT ON COLUMN public.build_threads.content_hash IS
'Meant to hold a hash of the first post for deduplication (creating migration). Empty on all 2,247 rows (2026-10-14): no writer sets it. Unit: hash text. Grain: one thread. Clock: n/a.';

-- ── Envelope and clocks ───────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.build_threads.metadata IS
'Discovery envelope written by discover-build-threads: keys is_sticky (sticky on the forum list), discovery_confidence (same value as vehicle_match_confidence) and discovered_at (ISO timestamp of the discovery run), each on all 2,247 rows (2026-10-14). Unit: jsonb object, default {}. Grain: one thread. Clock: discovered_at is the ingest time of discovery.';
COMMENT ON COLUMN public.build_threads.created_at IS
'When the row was inserted. Default now(). 2026-01-29 to 2026-01-30 on all 2,247 rows (2026-10-14). Unit: timestamptz. Grain: one thread. Clock: ingest time, not the thread''s date on the forum.';
COMMENT ON COLUMN public.build_threads.updated_at IS
'When a writer last changed the row; set explicitly by the writers (there is no trigger). Default now(). Latest 2026-01-30 (2026-10-14): nothing has written since. Unit: timestamptz. Grain: one thread. Clock: ingest time of the last write.';

COMMIT;
