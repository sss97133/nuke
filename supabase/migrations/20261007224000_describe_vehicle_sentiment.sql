-- Describe vehicle_sentiment: all 24 columns, none had a COMMENT ON COLUMN (0 of 24 described before, catalog count on
-- prod, 2026-10-07), and an extended table comment. Comments only.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself"). Read-only table in the atlas: 126,543 rows on 2026-10-07 12:00Z by exact count (the
-- atlas estimate of 127,348 is a stale pg_class.reltuples), no write since the statistics counters began; every row was
-- written 2026-02-06 15:34Z .. 2026-02-07 10:17Z.
--
-- METHOD (read 2026-10-07 11:59-12:40Z UTC):
--   Columns, types, defaults, constraints, indexes, triggers, policies, grants (has_table_privilege for anon and
--   authenticated) and existing comments from pg_attribute, pg_attrdef, pg_constraint, pg_indexes, pg_trigger, pg_policy,
--   information_schema and pg_description. Fill (non-NULL), labels, scores, the clocks and the anti-joins to vehicles and
--   comment_discoveries are exact counts over the whole table (193 MB heap). Content inside arrays and jsonb (non-empty
--   counts, element and key shapes, raw_extraction keys) and the comparison with comment_discoveries come from a 1% block
--   sample (TABLESAMPLE SYSTEM (1) REPEATABLE (20261007), 1,081 rows), because those values sit in 553 MB of TOAST and an
--   exact pass exceeded the 10 s timeout. What anon can read comes from a count under SET LOCAL ROLE anon in a read-only
--   transaction. "Filled" means non-NULL; "non-empty" is stated where used.
--   Writers and readers from code at origin/main 838a2a28b (supabase/functions, supabase/migrations, scripts,
--   nuke_frontend/src, mcp-servers, apps, docs) and from git history: the writer aggregate-sentiment, added by commit
--   0ac0ecd5f (2026-02-06) and deleted by commit 9871ee4fb (2026-03-31), read at 9871ee4fb^; the producers of the copied
--   analyses, supabase/functions/analyze-comments-fast (model_used programmatic-v1) and the January 2026 edge function
--   discover-comment-data (read at 5f88eb5f9; it called claude-3-haiku-20240307 and is deleted); the creating SQL
--   docs/archive/database/migrations/20260124_expand_intelligence_schema.sql (archived by #732; not in supabase/migrations
--   and not in the prod migration log); the two dependent views (pg_depend, pg_get_viewdef); scripts/check-progress.sh and
--   scripts/run-orchestrator.sh; docs/ledger/CAPABILITY_MAP.md; the prod migration log (no logged migration names the
--   table); pg_proc bodies (none names it); cron.job (only the inactive job 83 observation-discovery mentions sentiment,
--   not this table); write_receipts (no rows); pg_stat_user_tables; pipeline_registry (no row; none is added here).
-- LIMITS:
--   Content shapes come from a 1% block sample. Which caller made the 25,414 index scans is not recorded. The table quotes
--   public auction comments and carries prices and production figures inside free text: quoted values here are labels,
--   key names, model names, column and function names and counts only; no comment text, sentence, price or name.
-- CHANGED EXISTING COMMENTS:
--   Table comment only: it said "Community sentiment and market signals extracted from auction comments". That stays as
--   the opening; the new comment adds the grain, the writer and its defects, the producers, the freshness, the readers,
--   the access and the clocks. There were no column comments.

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

COMMENT ON TABLE public.vehicle_sentiment IS
'Community sentiment and market signals extracted from auction comments: one row per vehicle (grain: one vehicle; UNIQUE vehicle_id, upserted), a flattened copy of that vehicle comment_discoveries analysis made by the edge function aggregate-sentiment. 126,543 rows on 2026-10-07 (the atlas estimate of 127,348 is a stale reltuples), all written in one run between 2026-02-06 15:34Z and 2026-02-07 10:17Z (110,544 of them on 2026-02-07 07:00Z .. 10:17Z). Writer: aggregate-sentiment (added 2026-02-06 by commit 0ac0ecd5f, deleted 2026-03-31 by commit 9871ee4fb; its code is in git history) copied the latest comment_discoveries row of each vehicle and upserted it here on vehicle_id. The analyses came from analyze-comments-fast (extraction_version programmatic-v1, 123,762 rows: keyword dictionaries and regular expressions, no language model) and from an earlier language-model pass (claude-3-haiku, 2,781 rows). Defects of the copy (2026-10-07): comment_count is 0 on every row, because its count query returned nothing usable; mood_keywords and emotional_themes are empty on every sampled row, because the writer read them from the wrong path of raw_extraction; sentiment_score is the discovery score alone, because the planned 40% blend with comment scores came from the same failed query; and comparable_sales holds prices parsed from comment text, not verified sales. market_demand, market_rarity and price_trend use the producer words (moderate, declining) rather than those of the creating SQL (medium, falling), plus free sentences on 100 claude-3-haiku rows; price_trend is unknown on 77.2% of rows. Freshness: comment_discoveries was refreshed until 2026-02-15, so 1,196 discoveries are newer than their copy here, 149 rows here no longer have a discovery and 14 discoveries have no row here; nothing has written since. 8,954 rows (7.1%) point at a vehicle that no longer exists although vehicle_id has a validated ON DELETE CASCADE foreign key. The creating SQL is docs/archive/database/migrations/20260124_expand_intelligence_schema.sql (in no supabase migration and not in the prod migration log); its indexes on overall_sentiment, sentiment_score and market_demand are absent on prod. Readers: the views v_vehicle_intelligence_full (vehicles with vehicle_intelligence and five columns of this table) and v_sentiment_by_make (per-make averages), neither security_invoker and both selectable by anon, and the progress scripts scripts/check-progress.sh and scripts/run-orchestrator.sh; no edge function, frontend file, SQL function or cron.job command reads it. pg_stat_user_tables shows 0 writes, 5 sequential and 25,414 index scans since its counters began (read 11:59Z, before this work scanned it); the caller of those scans is not in the repo. docs/ledger/CAPABILITY_MAP.md names this table the sentiment store to reuse rather than mint another. Access: RLS is on; the policy vehicle_sentiment_select (SELECT, USING true, all roles) lets anon read every row (126,543 counted under SET LOCAL ROLE anon, 2026-10-07), including verbatim quotes of public auction comments; vehicle_sentiment_service (ALL, USING auth.role() = service_role) limits writes to the service role. No pipeline_registry row, no write receipts. Clocks: analyzed_at and updated_at are the writer clock of the copy and created_at the database insert time (10 to 26 ms later on sampled rows); when the comments were analyzed is comment_discoveries.discovered_at.';

-- ── Identity ────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicle_sentiment.id IS
'Surrogate key of the row, uuid, gen_random_uuid() default, the PRIMARY KEY; nothing references it. 126,543 rows (2026-10-07). Unit: none (uuid). Source: column default. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_sentiment.vehicle_id IS
'Vehicle whose auction comments were analyzed: a vehicles.id, NOT NULL, UNIQUE (vehicle_sentiment_vehicle_id_key; the writer upserts on it), foreign key ON DELETE CASCADE (validated). 8,954 rows (7.1%, 2026-10-07) point at a vehicle that no longer exists although the cascade is validated; the same unexplained delete left orphans in vehicle_status_metadata, ai_scan_sessions and image_camera_position. 149 rows have no comment_discoveries row for their vehicle any more. Unit: none (uuid). Source: aggregate-sentiment (the vehicle of the comment_discoveries row). Grain: one vehicle. Clock: n/a.';

-- ── Run metadata ────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicle_sentiment.analyzed_at IS
'When aggregate-sentiment built the row, from the edge function clock (new Date()); default now(). Filled on all 126,543 rows (2026-10-07), 2026-02-06 15:34Z .. 2026-02-07 10:17Z; equal to updated_at on all but 1,491 rows, which differ by milliseconds (two clock reads). It is the copy time, not the analysis time: that is comment_discoveries.discovered_at, which is later than this copy on 10 of 1,078 sampled rows (refreshed after the copy). Unit: timestamptz. Source: aggregate-sentiment. Grain: one vehicle. Clock: writer time of the copy.';
COMMENT ON COLUMN public.vehicle_sentiment.comment_count IS
'Intended number of comments behind the row, integer NOT NULL (creating SQL). 0 on all 126,543 rows (2026-10-07): aggregate-sentiment counted bat_comments through the execute_sql RPC and stored 0 whenever that call returned no usable row, which was every time. The real count of the analysis is comment_discoveries.comment_count (median 71 on the 1% sample). Do not use this column. Unit: count. Source: aggregate-sentiment (failed count). Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_sentiment.extraction_version IS
'Producer of the copied analysis, copied from comment_discoveries.model_used; default v1.0, which occurs on no row. 2 values (2026-10-07): programmatic-v1 on 123,762 rows (analyze-comments-fast, keyword dictionaries and regular expressions with no language model, which its header says were calibrated against 2,787 earlier AI analyses) and claude-3-haiku on 2,781 (an earlier language-model pass; the January 2026 edge function discover-comment-data called claude-3-haiku-20240307 and is deleted). Equal to the discovery model_used on every sampled row that has one. Unit: none (text). Source: comment_discoveries.model_used via aggregate-sentiment. Grain: one vehicle. Clock: n/a.';

-- ── Sentiment ───────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicle_sentiment.overall_sentiment IS
'Overall tone of the comments, text, no CHECK (creating SQL: positive, negative, mixed, neutral). Filled on every row (2026-10-07): positive 116,288, mixed 8,738, neutral 1,041, negative 418, unknown 50, very positive 6, excited 2; unknown, very positive and excited occur only on claude-3-haiku rows, and unknown is the writer label for a missing score. Copied from comment_discoveries.overall_sentiment (equal on 1,077 of 1,078 sampled rows). Read by both views. Unit: none (text label). Source: comment_discoveries via aggregate-sentiment. Grain: one vehicle. Clock: as of analyzed_at.';
COMMENT ON COLUMN public.vehicle_sentiment.sentiment_score IS
'Sentiment of the comments from -1 to 1 (creating SQL), numeric(3,2), no CHECK. Filled on 126,456 rows (99.9%, 2026-10-07): mean 0.79, median 0.84; 116,321 at 0.5 or more and 740 below 0; NULL on 87 (the 50 unknown rows and 37 programmatic-v1 negative rows). The writer meant to blend 60% of the discovery score with 40% of the mean comment score, but that mean came from the same failed execute_sql call as comment_count, so the value is the discovery score rounded to 2 places: equal on 1,068 of 1,078 sampled rows, and the 10 that differ are exactly the ones refreshed after the copy. Producers place labels on different ranges (programmatic-v1: positive 0.50 .. 1.00, mixed 0.10 .. 0.59). Read by both views. Unit: score, -1 .. 1. Source: comment_discoveries.sentiment_score via aggregate-sentiment. Grain: one vehicle. Clock: as of analyzed_at.';
COMMENT ON COLUMN public.vehicle_sentiment.mood_keywords IS
'Intended mood words of the comments, text array, default empty. Empty on every row of the 1% block sample (1,081 rows, 2026-10-07): aggregate-sentiment read raw_extraction.mood_keywords, but both producers nest the list at raw_extraction.sentiment.mood_keywords, where it is non-empty on 1,079 of the 1,081 sampled rows. A dead copy; read the nested path. Unit: none (text array). Source: aggregate-sentiment (wrong path). Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_sentiment.emotional_themes IS
'Intended emotional themes of the comments, text array, default empty. Empty on every row of the 1% block sample (2026-10-07) for the same reason as mood_keywords: the list sits at raw_extraction.sentiment.emotional_themes (non-empty on 1,079 of 1,081 sampled rows). A dead copy; read the nested path. Unit: none (text array). Source: aggregate-sentiment (wrong path). Grain: one vehicle. Clock: n/a.';

-- ── Market signals ──────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicle_sentiment.market_demand IS
'Demand the comments signal, text, no CHECK (creating SQL: high, medium, low), copied from raw_extraction.market_signals.demand. Filled on 123,926 rows (97.9%, 2026-10-07): moderate 98,510, low 23,245, high 2,145; 26 claude-3-haiku rows hold 15 other values, some of them free sentences; NULL on 2,617. medium occurs once. Read by v_vehicle_intelligence_full. Unit: none (text label). Source: comment_discoveries.raw_extraction via aggregate-sentiment. Grain: one vehicle. Clock: as of analyzed_at.';
COMMENT ON COLUMN public.vehicle_sentiment.market_rarity IS
'Rarity the comments signal, text, no CHECK, copied from raw_extraction.market_signals.rarity. Filled on 123,810 rows (97.8%, 2026-10-07): common 70,363, rare 51,361, uncommon 2,039; 47 claude-3-haiku rows hold 21 other values (true on 4 of them, and free sentences that cite production figures); NULL on 2,733. Unit: none (text label). Source: comment_discoveries.raw_extraction via aggregate-sentiment. Grain: one vehicle. Clock: as of analyzed_at.';
COMMENT ON COLUMN public.vehicle_sentiment.price_trend IS
'Price direction the comments signal, text, no CHECK (creating SQL: rising, stable, falling), copied from raw_extraction.market_signals.price_trend. Filled on 125,627 rows (99.3%, 2026-10-07): unknown 97,668 (77.2% of all rows), rising 25,134, declining 2,409, stable 335, increasing 45; 36 claude-3-haiku rows hold 25 other values, some free sentences that quote prices; NULL on 916. falling occurs on no row (the producers write declining). Read by v_vehicle_intelligence_full. Unit: none (text label). Source: comment_discoveries.raw_extraction via aggregate-sentiment. Grain: one vehicle. Clock: as of analyzed_at.';
COMMENT ON COLUMN public.vehicle_sentiment.price_sentiment IS
'How the comments judge the price, a JSON object copied from raw_extraction.price_sentiment, no default. Filled on 126,479 rows (2026-10-07). programmatic-v1 rows carry community_view and reasoning (community_view in the 1% sample: unknown 377, bargain 339, fair 225, high 122 of 1,063); claude-3-haiku rows carry those keys or free ones (price_expectations, key_points, overall_confidence and others). Unit: none (jsonb). Source: comment_discoveries.raw_extraction via aggregate-sentiment. Grain: one vehicle. Clock: as of analyzed_at.';

-- ── Community content ───────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicle_sentiment.expert_insights IS
'Comments that show expertise, a JSON array copied from raw_extraction.expert_insights, default [] (the writer passed NULL when the extraction had none). Filled on 126,493 rows (2026-10-07); non-empty on 422 of 1,081 sampled rows (programmatic-v1 406 of 1,063, claude-3-haiku 16 of 18). programmatic-v1 elements are objects with insight and expertise_level; claude-3-haiku elements are strings or such objects. The text paraphrases or quotes public auction comments; none is quoted here. Unit: none (jsonb array). Source: comment_discoveries.raw_extraction via aggregate-sentiment. Grain: one vehicle. Clock: as of analyzed_at.';
COMMENT ON COLUMN public.vehicle_sentiment.seller_disclosures IS
'Facts the seller stated in the comments, a JSON array of strings copied from raw_extraction.seller_disclosures, default [] (NULL when the extraction had none). Filled on 126,487 rows (2026-10-07); non-empty on 1,060 of 1,081 sampled rows. Unit: none (jsonb array of text). Source: comment_discoveries.raw_extraction via aggregate-sentiment. Grain: one vehicle. Clock: as of analyzed_at.';
COMMENT ON COLUMN public.vehicle_sentiment.community_concerns IS
'Concerns commenters raised, a JSON array of strings copied from raw_extraction.community_concerns, default [] (NULL when the extraction had none). Filled on 126,491 rows (2026-10-07); non-empty on 806 of 1,081 sampled rows. Unit: none (jsonb array of text). Source: comment_discoveries.raw_extraction via aggregate-sentiment. Grain: one vehicle. Clock: as of analyzed_at.';
COMMENT ON COLUMN public.vehicle_sentiment.key_quotes IS
'Comment sentences the producer picked, text array, default empty, copied from raw_extraction.key_quotes. Filled on every row (2026-10-07); non-empty on 937 of 1,081 sampled rows. Verbatim text of public auction comments, readable by anon; none is quoted here. Unit: none (text array). Source: comment_discoveries.raw_extraction via aggregate-sentiment. Grain: one vehicle. Clock: as of analyzed_at.';
COMMENT ON COLUMN public.vehicle_sentiment.comparable_sales IS
'Other sales commenters mentioned, a JSON array copied from raw_extraction.comparable_sales, default [] (NULL when the extraction had none). Filled on 125,342 rows (2026-10-07); non-empty on 84 of 1,081 sampled rows. programmatic-v1 elements are objects with description and price, a figure parsed from comment text, not a verified sale; claude-3-haiku elements are strings or such objects. Not a comparable-sales source. Unit: none (jsonb array). Source: comment_discoveries.raw_extraction via aggregate-sentiment. Grain: one vehicle. Clock: as of analyzed_at.';

-- ── Discussion ──────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicle_sentiment.discussion_themes IS
'Topics of the discussion, text array, default empty, copied from raw_extraction.discussion_themes. Filled on every row (2026-10-07); non-empty on 1,079 of 1,081 sampled rows. programmatic-v1 picks from a fixed list (in the sample: Price and value discussion on every programmatic row, Driving experience 871, Originality and authenticity 658, Technical discussion 618, Color and appearance 549 and others). Read by v_vehicle_intelligence_full. Unit: none (text array). Source: comment_discoveries.raw_extraction via aggregate-sentiment. Grain: one vehicle. Clock: as of analyzed_at.';
COMMENT ON COLUMN public.vehicle_sentiment.notable_discussions IS
'Notable comment threads, a JSON array copied from raw_extraction.notable_discussions, default []. Filled on only 984 rows (0.8%, 2026-10-07): programmatic-v1 never produces it (0 of 1,063 sampled), and the writer passed NULL then, which overrides the default; claude-3-haiku produced it on 6 of 18 sampled rows. Unit: none (jsonb array). Source: comment_discoveries.raw_extraction via aggregate-sentiment. Grain: one vehicle. Clock: as of analyzed_at.';
COMMENT ON COLUMN public.vehicle_sentiment.authenticity_discussion IS
'Discussion of originality and authenticity, a JSON object copied from raw_extraction.authenticity_discussion, no default. Filled on 126,475 rows (2026-10-07). programmatic-v1 objects carry concerns_raised and details; claude-3-haiku objects vary (concerns_raised, details, key_points and others). Unit: none (jsonb). Source: comment_discoveries.raw_extraction via aggregate-sentiment. Grain: one vehicle. Clock: as of analyzed_at.';
COMMENT ON COLUMN public.vehicle_sentiment.raw_extraction IS
'The whole analysis the row was copied from: comment_discoveries.raw_extraction at copy time, a JSON object, filled on every row (2026-10-07) and the bulk of the 553 MB of TOAST. Keys on programmatic-v1 rows: sentiment (with overall, score, mood_keywords and emotional_themes), condition_signals, market_signals, expert_insights, seller_disclosures, community_concerns, comparable_sales, authenticity_discussion, price_sentiment, discussion_themes, key_quotes and meta_analysis; claude-3-haiku rows carry most of these, and parse_failed with raw_response where the model output did not parse (2 of 18 sampled). Equal to the current comment_discoveries.raw_extraction on 1,068 of 1,078 sampled rows. The flattened columns above are copies of its keys. Unit: none (jsonb). Source: comment_discoveries.raw_extraction via aggregate-sentiment. Grain: one vehicle. Clock: as of analyzed_at.';

-- ── Row clocks ──────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicle_sentiment.created_at IS
'When the row was inserted: default now(), the database clock. Filled on all 126,543 rows (2026-10-07), 2026-02-06 15:34Z .. 2026-02-07 10:17Z: 15,999 rows from 2026-02-06 15:00Z to 2026-02-07 07:00Z and 110,544 from 07:00Z to 10:17Z on 2026-02-07. It trails updated_at and analyzed_at by 10 to 26 ms on sampled rows, the gap between the writer clock and the database clock. Unit: timestamptz. Source: column default. Grain: one vehicle. Clock: ingest time.';
COMMENT ON COLUMN public.vehicle_sentiment.updated_at IS
'Set by aggregate-sentiment from the edge function clock (new Date()) on each upsert; default now(), no trigger. Equal to analyzed_at on all but 1,491 rows (milliseconds apart), same window as created_at (2026-10-07). The writer batch mode compared it with comment_discoveries.discovered_at to pick vehicles to refresh. Unit: timestamptz. Source: aggregate-sentiment. Grain: one vehicle. Clock: writer time of the copy.';

DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(a.attname, ', ' ORDER BY a.attnum) INTO missing
  FROM pg_attribute a
  WHERE a.attrelid = 'public.vehicle_sentiment'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND col_description(a.attrelid, a.attnum) IS NULL;
  IF missing IS NULL THEN
    RAISE NOTICE 'vehicle_sentiment: every column has a comment';
  ELSE
    RAISE NOTICE 'vehicle_sentiment columns still without a comment: %', missing;
  END IF;
END
$$;

COMMIT;
