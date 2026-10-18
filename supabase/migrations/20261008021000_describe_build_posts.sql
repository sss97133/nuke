-- Describe build_posts: all 27 columns (2 of 27 had a COMMENT ON COLUMN before, post_number and observation_id; catalog
-- count on prod, 2026-10-07) and an extended table comment. Comments only.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself"). Read-only table in the atlas: 57,564 rows on 2026-10-07 14:01Z by exact count (the
-- atlas estimate of 58,988 is a stale pg_class.reltuples), no write since the statistics counters began; the newest row
-- is from 2026-01-30 14:02Z.
--
-- METHOD (read 2026-10-07 14:00-14:08Z UTC):
--   Columns, types, defaults, constraints (with convalidated), indexes, triggers, policies (with their role lists),
--   grants (has_table_privilege for anon and authenticated) and existing comments from pg_attribute, pg_attrdef,
--   pg_constraint, pg_indexes, pg_trigger, pg_policy and pg_description; the foreign key that points at the table from
--   pg_constraint. Fill, post_type, creation-hour and posted-year counts, per-forum counts (through build_threads and
--   forum_sources), handle, post-id, date-precision, image, video and hash shapes (URL hosts only), text lengths, the
--   repeated external post ids and texts within a thread, post-number continuity, org_mentions counts, the thread links
--   to vehicles and the observation links (primary-key probes into vehicle_observations) are exact counts over the whole
--   table (68 MB heap, 109 MB in all, read only). The word_count check and the share of posts whose content_html carries
--   a link or a quote come from a 5% block sample (TABLESAMPLE SYSTEM (5) REPEATABLE (20261007), 2,819 rows). What anon
--   can read comes from a count under SET LOCAL ROLE anon in a read-only transaction. "Filled" means non-NULL.
--   Writers and readers from code at origin/main 87eb9a517 (supabase/functions, supabase/migrations, scripts,
--   nuke_frontend/src, mcp-server, apps; also git history with -S and docs/archive): the creating migration in the repo
--   supabase/migrations/20260130_forum_extraction_tables.sql, whose build_posts differs from prod, and the archived
--   docs/archive/database/migrations/20260129_forum_extraction_tables.sql and 20260129_org_mention_queue.sql, which
--   match prod (the source of the 2 existing comments); the former writer supabase/functions/extract-build-posts
--   (added by 9f1578f4e, 2026-01-30; deleted by 200581de7, 2026-03-31; read at 200581de7^; not in the deployed function
--   list read through the management API, 328 functions, 2026-10-07) and the scripts that called it
--   (forum-auto-extract.js, forum-auto-run.js, forum-extraction-pipeline.js, forum-nuke-run.js); the later writer
--   scripts/map-observations.js (observation_id) and the would-be writer scripts/link-forum-identities.js
--   (external_identity_id, never landed); the reader scripts listed in the table comment; pg_proc (no function body names
--   the table); cron.job (no command names the table, forum extraction or the writer); pg_depend (no view); pg_trigger
--   (no trigger); write_receipts (no rows); pg_stat_user_tables; pipeline_registry (no row; none is added here);
--   supabase_migrations.schema_migrations (no logged migration names the table).
-- LIMITS:
--   Which script invocation wrote which row is not recorded. The duplicate count keys on the external post id and the
--   text; posts of the 2 forums without a post id (gm-trucks, hybridz) are not counted in it. The link and quote shares
--   come from a block sample. pg_stat_user_tables counters began at the last server start (2026-09-29 09:20Z). The rows
--   hold public forum handles, profile URLs and post text, readable by anyone: quoted values are forum slugs, URL hosts,
--   post_type codes, column and function names and counts only; no handle, URL path, post text or organisation name.
-- CHANGED EXISTING COMMENTS:
--   Table: it said "Individual posts extracted from build threads." That stays as the opening; the new comment adds the
--   grain, the one-run writer, the duplicates, the forums, the vehicle reach through threads, the never-filled fields,
--   the readers, the drift from the repo migration, the access and the clocks.
--   Column post_number: it said "1-indexed post position in thread (1 = original post)." That opens the new comment
--   unchanged; it adds that duplicates took new numbers.
--   Column observation_id: it said "Link to vehicle_observations for unified data model." That opens the new comment
--   unchanged; it adds the writer, the fill and the 408 links to observations that no longer exist.

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

COMMENT ON TABLE public.build_posts IS
'Individual posts extracted from build threads: one row per post as read from a page of a public forum build thread (grain: one stored post read; a post read twice is stored twice, see content_hash). 57,564 rows on 2026-10-07 (the atlas estimate of 58,988 is a stale reltuples) in 1,079 build_threads of 21 forum sources (forum_sources.slug): 355nation 9,759, thetruckstop 6,660, gm-trucks 6,116, gmt400 5,934, nastyz28 5,739, moparts 3,558, overlandbound 3,537, civicx 2,704, audi-sport 2,556, camaros 2,418, ultimateaircooled 2,247, mazdas247 1,872, camaros-net 1,608, allpar 1,011 and 7 smaller; 5,547 distinct author_handle values; posted 1998-09 .. 2026-01-30. Written in one run, 2026-01-29 14:21Z .. 2026-01-30 14:02Z, by the edge function extract-build-posts (added by commit 9f1578f4e; deleted from the repo by 200581de7, 2026-03-31; not deployed), which scripts/forum-auto-extract.js (per thread) and forum-auto-run.js, forum-extraction-pipeline.js and forum-nuke-run.js call; it upserted 50 posts at a time on content_hash. One later writer: scripts/map-observations.js set observation_id on 7,915 rows. Nothing has written since: no cron job, trigger, SQL function or edge function names the table, and pg_stat_user_tables counts 0 inserts, updates and deletes, 2 sequential and 2 index scans since the server last started (2026-09-29 09:20Z; read 14:00Z). Duplicates: 6,065 external post ids recur within one thread with identical text, so 12,079 rows (21.0%) repeat a post already stored under another post_number, in 418 threads; this matches the resume path of the extractor, which restarted at extraction_cursor (the last page already read) and numbered from posts_extracted + 1, while content_hash includes the page URL and the post number, so the upsert did not merge the copies. Count distinct posts by (build_thread_id, post_id_external) and text, not by row. Thread coverage: of 2,247 build_threads, 983 are complete, 223 stuck in extracting since 2026-01-29 (81 of them with posts) and 1,041 discovered (15 with posts). The vehicle comes only through the thread: 41,379 posts (71.9%) sit in a thread linked to one of 498 vehicles (build_threads.vehicle_id), 2,863 of them to a vehicle that no longer exists. Never filled by the writer: post_url, external_identity_id and quoted_post_ids (NULL), like_count and reply_count (0), quoted_handles and external_links (empty arrays, although in a 5% block sample 14.6% of posts carry an absolute link and 22.6% a quote in content_html), metadata ({}). Readers: scripts of 2026-01-30 only (link-forum-identities.js, extract-vehicle-identifiers.js, batch-structure-threads-ollama.js, structure-build-timeline.js, cross-reference-vins.js, assess-scope.js, forum-pipeline-report.js, forum-auto-extract.js, test-vin-extract.js); no view, SQL function, edge function or frontend page reads it. Foreign key in: org_mention_queue.source_post_id (ON DELETE CASCADE; 0 of its 5,522 rows use it). Prod differs from the creating migration in the repo, supabase/migrations/20260130_forum_extraction_tables.sql (its build_posts has page_number, videos, quoted_post_numbers, parts_mentioned and other columns prod lacks, and lacks post_type, content_hash and others); prod matches the archived docs/archive/database/migrations/20260129_forum_extraction_tables.sql plus org_mentions from 20260129_org_mention_queue.sql there, except that its index on posted_at is absent; neither file is in the prod migration log. Access: RLS is on. Public read build posts (SELECT, USING true, every role) lets anyone read all 57,564 rows (counted under SET LOCAL ROLE anon, 2026-10-07), forum handles, profile URLs and full post text included. Service role manages build posts (ALL, every role) checks auth.jwt() role = service_role, so anon and authenticated, which hold SELECT, INSERT, UPDATE, DELETE and TRUNCATE, cannot write rows through it. No pipeline_registry row and no write receipts. Clocks: posted_at is the event time on the forum as parsed; created_at is the insert time; the table has no update clock, so when observation_id was set is recorded only as the ingested_at of the observation.';

-- ── Identity and position ──────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.build_posts.id IS
'Surrogate key of the post row, uuid, gen_random_uuid() default, the PRIMARY KEY. 57,564 values (2026-10-07). Referenced by org_mention_queue.source_post_id (ON DELETE CASCADE), which no row uses. Unit: none (uuid). Source: column default. Grain: one stored post read. Clock: n/a.';
COMMENT ON COLUMN public.build_posts.build_thread_id IS
'Thread the post belongs to: a build_threads.id, NOT NULL, foreign key ON DELETE CASCADE (validated), indexed (idx_build_posts_thread, and idx_build_posts_images where image_count > 0); with post_number the UNIQUE key unique_thread_post. 1,079 distinct values (2026-10-07) of the 2,247 build_threads; a thread holds a median of 22 rows, at most 410. The thread carries the forum (forum_source_id), the URL and the vehicle (vehicle_id, set on 561 of these threads). Unit: none (uuid). Source: the extractor. Grain: one stored post read. Clock: n/a.';
COMMENT ON COLUMN public.build_posts.post_number IS
'1-indexed post position in thread (1 = original post). integer NOT NULL, UNIQUE with build_thread_id. Contiguous from 1 to the row count in every one of the 1,079 threads (2026-10-07), but it numbers rows as read, not posts: the extractor counted on across pages and, on resume, from posts_extracted + 1, so a post read twice holds two numbers (12,079 repeated rows, see the table comment) and the number is not the position on the forum after the first repeat. post_number 1 is post_type original on all 1,079 threads. Unit: ordinal. Source: the extractor counter. Grain: one stored post read. Clock: n/a.';
COMMENT ON COLUMN public.build_posts.post_id_external IS
'Post id on the forum: the first run of digits of the post id attribute named by the forum DOM map, text, nullable. Filled on 51,432 rows (89.3%, 2026-10-07), digits only; NULL on every gm-trucks (6,116) and hybridz (16) row, whose pages yielded none. 38,967 distinct values: ids are per forum, and within one thread 6,179 ids recur (18,541 rows), 6,065 of them with identical text (the duplicates of the table comment). Unit: none (forum id). Source: the forum page HTML through the DOM map. Grain: one stored post read. Clock: n/a.';
COMMENT ON COLUMN public.build_posts.post_url IS
'Intended direct link to the post (archived creating migration: direct link to post if available), text, nullable. NULL on all 57,564 rows (2026-10-07); the extractor never set it. Unit: none (URL). Source: none (never written). Grain: one stored post read. Clock: n/a.';

-- ── Author ─────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.build_posts.author_handle IS
'Forum handle of the post author as the page showed it, text, nullable, filled on every row (2026-10-07); 5,547 distinct values. Unknown, the extractor placeholder when the author element had no text, on 2,771 rows: thetruckstop 1,808, nastyz28 872, camaros-net 87, broncozone 4 (each still has a profile URL). Part of content_hash. Public forum handles, readable by anyone; none is quoted here. Unit: none (text). Source: the forum page HTML. Grain: one stored post read. Clock: as of created_at.';
COMMENT ON COLUMN public.build_posts.author_profile_url IS
'Profile page of the author on the forum, resolved against the page URL, text, nullable. Filled on 57,508 rows (99.9%, 2026-10-07), on the host of the forum (www.355nation.net 9,759, www.thetruckstop.us 6,660, www.gm-trucks.com 6,116, www.gmt400.com 5,934, nastyz28.com 5,738, www.camaros.net 4,026, www.forabodiesonly.com 3,557 and others). Public profile pages; none is quoted here. Unit: none (URL). Source: the forum page HTML. Grain: one stored post read. Clock: as of created_at.';
COMMENT ON COLUMN public.build_posts.external_identity_id IS
'Identity of the author: an external_identities.id, nullable, foreign key without ON DELETE action (validated), indexed where filled (idx_build_posts_author). NULL on all 57,564 rows (2026-10-07): the extractor source of 9f1578f4e maps handles to identities, and scripts/link-forum-identities.js would set it, yet no row got one; why is not recorded. Join authors through author_handle and the forum instead. Unit: none (uuid). Source: none (never written). Grain: one stored post read. Clock: n/a.';

-- ── Content ────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.build_posts.posted_at IS
'When the post was made on the forum, as the extractor parsed the date element (parseDate), timestamptz, nullable. Filled on 57,563 rows (2026-10-07), 1998-09-08 .. 2026-01-30, never after created_at; by year the most in 2025 (6,074). Date-only on some forums: 3,261 values fall at 00:00:00 UTC (thetruckstop 1,868, nastyz28 1,187, camaros-net 200, broncozone 6), so their time of day is unknown. map-observations.js copied it to vehicle_observations.observed_at. The index on it from the archived creating migration is absent on prod. Unit: timestamptz. Source: the forum page HTML. Grain: one stored post read. Clock: event time on the forum as parsed.';
COMMENT ON COLUMN public.build_posts.content_text IS
'Text of the post (textContent of the content element), text, nullable, filled on every row (2026-10-07); the empty string on 511 rows whose post held only HTML such as images. Median 243 characters, longest 98,310. Includes quoted text of other posts where the forum inlines quotes. Part of content_hash. Public forum text, readable by anyone; none is quoted here. Unit: none (text). Source: the forum page HTML. Grain: one stored post read. Clock: as of created_at.';
COMMENT ON COLUMN public.build_posts.content_html IS
'HTML of the post content element as served (innerHTML), kept for re-parsing, text, nullable, filled on every row (2026-10-07); median 720 characters. It holds what the extractor did not parse out: in a 5% block sample 14.6% of rows carry an absolute link and 22.6% a quote block, while external_links and quoted_handles are empty on every row. Unit: none (HTML). Source: the forum page HTML. Grain: one stored post read. Clock: as of created_at.';
COMMENT ON COLUMN public.build_posts.word_count IS
'Words in content_text (whitespace-separated tokens, counted by the extractor), integer, nullable, default 0. Filled on every row (2026-10-07): median 42, at most 16,813, 0 on the 511 rows with empty text. Equal to a Postgres whitespace split on 2,640 of 2,819 rows of a 5% block sample; 169 of the 179 that differ contain a Unicode space such as the no-break space, which the two splitters treat differently. Unit: words. Source: the extractor. Grain: one stored post read. Clock: as of created_at.';
COMMENT ON COLUMN public.build_posts.post_type IS
'Keyword class of the post, text, nullable, default update, CHECK in (original, update, question, answer, media_only, milestone, completion, sale). 7 occur (2026-10-07): update 38,229, question 11,858, media_only 3,356, sale 1,360, completion 1,160, original 1,079, milestone 522; answer never. Rule of the extractor (classifyPostType), first match wins: post 1 is original; text containing for sale, sold, selling or asking price is sale (a substring test, so soldering counts); finished, finally done, build complete or project complete is completion; first drive, first start, fired up, on the road or passed inspection is milestone; any question mark is question; images with fewer than 20 words is media_only; else update. A heuristic, not a reading of the post. Unit: none (text code). Source: classifyPostType in the extractor. Grain: one stored post read. Clock: as of created_at.';

-- ── Media ──────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.build_posts.images IS
'Image URLs found in the post content, resolved against the page URL, text[], nullable. Filled on every row (2026-10-07), non-empty on 16,686 (29.0%); 55,785 entries, at most 78 in one post. Hosts: the forum own hosts (www.overlandbound.com 3,881, www.camaros.net 3,590, cdn.civicx.com 3,491, www.forabodiesonly.com 3,233 and others), i.imgur.com 3,197, uploads.tapatalk-cdn.com 1,924, cdn.jsdelivr.net 926; 3,007 entries are inline data:image/gif placeholders, not photos. Unit: none (URL array). Source: the forum page HTML. Grain: one stored post read. Clock: as of created_at.';
COMMENT ON COLUMN public.build_posts.image_count IS
'Number of entries in images, integer, nullable, default 0. Equal to cardinality(images) on every row (2026-10-07); above 0 on 16,686 rows, 55,785 in all, inline placeholders included (3,007), so it overstates photos. Indexed through idx_build_posts_images (where image_count > 0). Unit: images. Source: the extractor. Grain: one stored post read. Clock: as of created_at.';
COMMENT ON COLUMN public.build_posts.has_video IS
'Whether the post embeds a video (video_urls not empty), boolean, nullable, default false. true on 193 rows (2026-10-07). Unit: none (boolean). Source: the extractor. Grain: one stored post read. Clock: as of created_at.';
COMMENT ON COLUMN public.build_posts.video_urls IS
'Embedded video URLs (iframe and video sources), text[], nullable. Filled on every row, non-empty on 193 (2026-10-07); hosts www.youtube.com 223, cdn.civicx.com 12, mazdas247.com 6. Unit: none (URL array). Source: the forum page HTML. Grain: one stored post read. Clock: as of created_at.';

-- ── References (never filled) ──────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.build_posts.quoted_handles IS
'Handles of authors this post quotes (archived creating migration: users quoted in this post), text[], nullable. The empty array on all 57,564 rows (2026-10-07): the extractor never found a quote author, although in a 5% block sample 22.6% of posts carry a quote block in content_html. Unit: none (text array). Source: the extractor (no values). Grain: one stored post read. Clock: n/a.';
COMMENT ON COLUMN public.build_posts.quoted_post_ids IS
'Ids of the posts this post quotes (archived creating migration), text[], nullable. NULL on all 57,564 rows (2026-10-07); the extractor never set it. Unit: none (text array). Source: none (never written). Grain: one stored post read. Clock: n/a.';
COMMENT ON COLUMN public.build_posts.external_links IS
'Links in the post to other hosts (archived creating migration: links to parts, shops, etc.), text[], nullable. The empty array on all 57,564 rows (2026-10-07), although in a 5% block sample 14.6% of posts carry an absolute link in content_html; why the extractor kept none is not recorded. Unit: none (URL array). Source: the extractor (no values). Grain: one stored post read. Clock: n/a.';
COMMENT ON COLUMN public.build_posts.org_mentions IS
'Shop and organisation names the extractor found in content_text (extractOrgMentions; the mention texts only), text[], nullable; added after the table (archived 20260129_org_mention_queue.sql). Filled on 57,535 rows, non-empty on 4,107 (2026-10-07): 5,195 mentions, 655 distinct ignoring case; NULL on the 29 rows of the first insert (2026-01-29 14:21Z). The same mentions went to org_mention_queue keyed by thread (5,522 rows, source_post_id unused). Names from public posts; none is quoted here. Unit: none (text array). Source: extractOrgMentions in the extractor. Grain: one stored post read. Clock: as of created_at.';

-- ── Links into the observation system ──────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.build_posts.observation_id IS
'Link to vehicle_observations for unified data model. uuid, nullable, foreign key without ON DELETE action (validated), indexed where filled (idx_build_posts_observation). Filled on 7,915 rows (13.7%, 2026-10-07) in 128 threads, by scripts/map-observations.js, which inserted one vehicle_observations row (kind comment, the thread URL and post-N as identifier, observed_at from posted_at) per post of a thread with a vehicle and wrote its id back here; those observations were ingested 2026-01-29 19:59Z .. 21:44Z. 408 values (6 nastyz28 threads whose 2 vehicles no longer exist) point at observations that are not in vehicle_observations, despite the validated key; how they were removed is not recorded. The other 7,507 exist, are not superseded and carry the vehicle of the thread. 33,464 posts in threads with a vehicle have no observation. Unit: none (uuid). Source: scripts/map-observations.js. Grain: one stored post read. Clock: n/a (the observation ingested_at is when the link was made).';

-- ── Signals (never filled) ─────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.build_posts.like_count IS
'Likes or thanks the forum showed for the post, integer, nullable, default 0. 0 on all 57,564 rows (2026-10-07): no forum DOM map yielded a like count, so 0 means not read, not no likes. Unit: likes. Source: the extractor (no values). Grain: one stored post read. Clock: n/a.';
COMMENT ON COLUMN public.build_posts.reply_count IS
'Intended count of direct replies to the post (archived creating migration), integer, nullable, default 0. 0 on all 57,564 rows (2026-10-07); the extractor never set it, so 0 means not read. Unit: replies. Source: column default. Grain: one stored post read. Clock: n/a.';

-- ── Dedupe key, extras and clock ───────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.build_posts.content_hash IS
'Dedupe key of the extractor: SHA-256 hex of page URL, post_number, author_handle and content_text joined by |, text, nullable, UNIQUE (build_posts_content_hash_key), the conflict target of its upsert. 64 lower-case hex characters on all 57,564 rows (2026-10-07). Because it includes the page URL and post_number, the same post read again under a new number gets a new hash, and the upsert stored 12,079 repeats (see the table comment); it does not identify a post. Unit: none (hex digest). Source: sha256Hex in the extractor. Grain: one stored post read. Clock: n/a.';
COMMENT ON COLUMN public.build_posts.metadata IS
'Extras of the post, jsonb, nullable, default {}. {} on all 57,564 rows (2026-10-07); no writer set it. Unit: none (jsonb). Source: column default. Grain: one stored post read. Clock: n/a.';
COMMENT ON COLUMN public.build_posts.created_at IS
'When the row was inserted: default now(), the transaction clock of the insert (the extractor does not send it). Filled on every row (2026-10-07): 2026-01-29 14:21Z .. 2026-01-30 14:02Z, in 17 clock hours (the largest 2026-01-29 15h, 18,433 rows). An upsert that hit an existing hash did not change it. The only row clock: there is no updated_at. Unit: timestamptz. Source: column default. Grain: one stored post read. Clock: ingest time.';

DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(a.attname, ', ' ORDER BY a.attnum) INTO missing
  FROM pg_attribute a
  WHERE a.attrelid = 'public.build_posts'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND col_description(a.attrelid, a.attnum) IS NULL;
  IF missing IS NULL THEN
    RAISE NOTICE 'build_posts: every column has a comment';
  ELSE
    RAISE NOTICE 'build_posts columns still without a comment: %', missing;
  END IF;
END
$$;

COMMIT;
