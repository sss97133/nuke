-- Describe vehicle_live_metrics: the 13 columns without a comment (4 of 17 had one: observation_count, comment_count,
-- last_observation_at and updated_at, kept unchanged; catalog count on prod, 2026-10-07) and a corrected table comment.
-- Comments only.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself"). Written table in the atlas: 333,696 rows on 2026-10-07 18:03Z by exact count (the
-- atlas estimate of 331,364 is a stale pg_class.reltuples); 2,127 rows were refolded and 834 created in the 24 hours to
-- 18:05Z.
--
-- METHOD (read 2026-10-07 18:02-18:10Z UTC):
--   Columns, types, defaults, constraints, indexes, triggers, policies, RLS, grants (has_table_privilege and relacl for
--   anon and authenticated), the realtime publication and existing comments from pg_attribute, pg_attrdef,
--   pg_constraint, pg_indexes, pg_trigger, pg_policy, pg_class, pg_publication_tables and pg_description; views from
--   pg_depend (none). Exact over the whole table (40 MB heap, read only): the fills and ranges of every column, the counts
--   by created and updated month, the rows refolded and created in the last day and week. On a 10% sample (TABLESAMPLE
--   SYSTEM (10) REPEATABLE (20261007), 32,026 rows): the rows whose vehicle_id has no vehicles row. The queue
--   vehicle_metric_recompute_queue and sentiment_update_queue by exact counts; v_job_health for jobid 500.
--   Writers and readers from code at origin/main 8d58d4693 (supabase/functions, supabase/migrations, scripts,
--   nuke_frontend/src, mcp-server, apps; git history): the creating migration, archived as
--   docs/archive/database/migrations/20260124_vehicle_live_metrics_triggers.sql (commit 4ec7ea478, 2026-01-24; not in prod
--   migration history); 20260927010000_drain_vehicle_derived_queues.sql; 20261004031800_listing_observation_consensus_reader.sql
--   (the current trigger and drain); 20261004040221_vehicle_metric_fold_health_assay.sql; 20261007003007_declare_table_owners_2.sql;
--   the edge function update-live-sentiment. Bodies read with pg_get_functiondef: the 4 live functions whose body names the
--   table (drain_vehicle_metric_queue, assay_vehicle_metric_fold, queue_sentiment_update, mark_active_auctions), the
--   trigger function update_vehicle_live_metrics and drain_vehicle_derived_queues, with their EXECUTE grants and triggers;
--   cron.job (drain-vehicle-derived-queues, jobid 500); write_receipts (no rows); pg_stat_user_tables; pipeline_registry
--   (4 column rows; none is added or changed here).
-- LIMITS:
--   When the first trigger stopped writing bid_count, last_comment_text and last_bid_amount is not recorded: the repo shows
--   the January trigger and then the queue version of 2026-10-04, while the queue already existed on prod by 2026-09-27.
--   Who added sentiment_label, unique_commenters, questions_count and seller_responses is not recorded. The orphan share
--   comes from the 10% sample. pg_stat_user_tables counters began at the last server start (2026-09-29 09:20Z), and the
--   reads of this session added sequential scans to them after 18:02Z. last_comment_text holds comment text from public
--   listings: quoted values are column and function names, codes and counts only.
-- CHANGED EXISTING COMMENTS:
--   Table: it said "Per-vehicle current observation activity, keyed by vehicle_id. drain_vehicle_metric_queue maintains
--   observation_count, comment_count, last_observation_at and updated_at through the five-minute drain-vehicle-derived-queues
--   job. Sentiment/auction fields have separate contracts. Bounded operational source/output assay in v_job_health; not a
--   historical/PIT feature." The first, second and last sentences stay. Corrected: the sentiment and auction fields have no
--   live writer (one sentiment run on 4 rows on 2026-01-24; the auction marker has no caller and cannot run). Added: the
--   feed, freshness, the frozen and unused columns, the missing foreign key, readers and access.
--   Columns observation_count, comment_count, last_observation_at and updated_at: unchanged.

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

COMMENT ON TABLE public.vehicle_live_metrics IS
'Per-vehicle current observation activity, keyed by vehicle_id. drain_vehicle_metric_queue maintains observation_count, comment_count, last_observation_at and updated_at through the five-minute drain-vehicle-derived-queues job. Bounded operational source/output assay in v_job_health; not a historical/PIT feature. One row per vehicle (PRIMARY KEY vehicle_id; grain: one vehicle). 333,696 rows on 2026-10-07 18:03Z (exact). Feed: the row trigger trg_update_live_metrics on vehicle_observations (AFTER INSERT, DELETE, or UPDATE OF vehicle_id, is_superseded, observed_at, ingested_at, structured_data, kind, subject_type, source_id or confidence_score; function update_vehicle_live_metrics) marks every touched vehicle that still exists as dirty in vehicle_metric_recompute_queue. Writer: drain_vehicle_metric_queue, called by drain_vehicle_derived_queues from cron job drain-vehicle-derived-queues (jobid 500, every 5 minutes, active; chunks of 10 vehicles, at most 500 a run), recounts all observations of each dequeued vehicle, upserts the four fold columns and runs detect_field_conflicts; a failed vehicle goes back to the queue with its error. Freshness: at 18:04Z the queue held 40 vehicles, the oldest queued 4 minutes earlier, none retried; the job ran 288 times in the 24 hours to 18:00Z with 1 failure (a statement timeout); its assay (assay_vehicle_metric_fold, 15-minute grace) passed (2026-10-07). pg_stat_user_tables counts 27,002 inserts, 21,980 updates (20,036 HOT) and 0 deletes since the server last started (2026-09-29 09:20Z; read 18:02Z). The other 13 columns have no live writer: bid_count, last_comment_text and last_bid_amount keep values from an earlier writer (the first trigger of 2026-01-24, archived at docs/archive/database/migrations/20260124_vehicle_live_metrics_triggers.sql, wrote them per observation); sentiment_score and sentiment_updated_at were written once, on 4 rows on 2026-01-24, by the edge function update-live-sentiment, which no job calls (sentiment_update_queue holds 18,885 vehicles never processed); is_active_auction and auction_ends_at would come from mark_active_auctions(), which no job calls and which reads auction_events.ends_at, a column that does not exist; sentiment_label, unique_commenters, questions_count and seller_responses have no writer. Readers: assay_vehicle_metric_fold (v_job_health) and the trigger queue_sentiment_update on vehicle_observations, which reads is_active_auction to set a sentiment priority; no web page, view, edge function or export reads the counts. No foreign key: the creating migration declared vehicle_id REFERENCES vehicles(id), prod has none, and 1,377 of 32,026 sampled rows (4.3%, 10% sample, 2026-10-07) point at a vehicle that no longer exists; the drain never deletes a row. pipeline_registry holds 4 column rows (owner drain_vehicle_metric_queue, do_not_write_directly true) for the fold columns and no table row. The table is in the supabase_realtime publication. Access: RLS is on with no policy, and anon and authenticated hold no privilege, so only the service role reads or writes it. Clocks: last_observation_at is the source event-time watermark; updated_at is the fold time; created_at is when the vehicle first got a row.';

-- ── Key ────────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicle_live_metrics.vehicle_id IS
'Vehicle the metrics describe, uuid NOT NULL, the PRIMARY KEY, so one row per vehicle. No foreign key on prod (the creating migration declared REFERENCES vehicles(id)); in a 10% sample 1,377 of 32,026 rows (4.3%, 2026-10-07) point at a vehicles row that no longer exists, because the drain never deletes a row. The queue trigger enqueues only vehicles that exist. Unit: none (uuid). Source: drain_vehicle_metric_queue (the dequeued vehicle). Grain: one vehicle. Clock: n/a.';

-- ── Columns without a live writer ──────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicle_live_metrics.bid_count IS
'Number of bid observations, integer, nullable, default 0. No current writer: the drain recounts only observation_count and comment_count. Above 0 on 8,420 rows (at most 108), 0 on the rest (2026-10-07); the values come from an earlier writer, such as the first trigger of 2026-01-24 (archived), which added 1 per bid observation, and are not kept current. Unit: count of bid observations (stale). Source: an earlier writer (none current). Grain: one vehicle. Clock: n/a (frozen at its last write).';
COMMENT ON COLUMN public.vehicle_live_metrics.last_comment_text IS
'Text of the latest comment observation as an earlier writer saw it, text, nullable. Filled on 18,409 rows, up to 5,176 characters (2026-10-07). No current writer: the first trigger of 2026-01-24 (archived) copied content_text of a comment observation newer than the watermark; the drain does not touch it, so it is not the latest comment now. Comment text from public listings; none is quoted here. Unit: none (text). Source: an earlier writer (none current). Grain: one vehicle. Clock: n/a (frozen at its last write).';
COMMENT ON COLUMN public.vehicle_live_metrics.last_bid_amount IS
'Highest bid amount seen in bid observations by an earlier writer, numeric(12,2), nullable. Filled on 4,199 rows (2026-10-07). No current writer: the first trigger of 2026-01-24 (archived) kept the greater of the stored value and structured_data bid_amount of each bid observation. Currency not recorded. Unit: currency amount (stale; currency unknown). Source: an earlier writer (none current). Grain: one vehicle. Clock: n/a (frozen at its last write).';
COMMENT ON COLUMN public.vehicle_live_metrics.sentiment_score IS
'Sentiment of the latest observations, numeric(4,3), nullable, on the scale the prompt of update-live-sentiment asks for (-1.0 very negative to 1.0 very positive). Filled on 4 rows, all written on 2026-01-24 12:27Z by that edge function, which read the 20 latest observations of the vehicle with a language model; no job calls it since, and sentiment_update_queue holds 18,885 vehicles it never processed (2026-10-07). Unit: score (-1 to 1). Source: update-live-sentiment (one run). Grain: one vehicle. Clock: as of sentiment_updated_at.';
COMMENT ON COLUMN public.vehicle_live_metrics.sentiment_label IS
'Intended label for sentiment_score, text, nullable. NULL on every row (2026-10-07): no writer in the repo or in SQL sets it, update-live-sentiment included. Unit: none (text). Source: none (never written). Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_live_metrics.sentiment_updated_at IS
'When sentiment_score was written, timestamptz, nullable: the clock of update-live-sentiment. Filled on the same 4 rows, 2026-01-24 12:27Z (2026-10-07). Unit: timestamptz. Source: update-live-sentiment. Grain: one vehicle. Clock: write time (the sentiment run).';
COMMENT ON COLUMN public.vehicle_live_metrics.unique_commenters IS
'Intended number of distinct commenters, integer, nullable, default 0. 0 on every row (2026-10-07): no writer in the repo or in SQL. Unit: count of commenters (never computed). Source: column default. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_live_metrics.questions_count IS
'Intended number of question comments, integer, nullable, default 0. 0 on every row (2026-10-07): no writer in the repo or in SQL. Unit: count of comments (never computed). Source: column default. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_live_metrics.seller_responses IS
'Intended number of seller replies, integer, nullable, default 0. 0 on every row (2026-10-07): no writer in the repo or in SQL. Unit: count of comments (never computed). Source: column default. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_live_metrics.is_active_auction IS
'Whether the vehicle has an auction ending within 7 days, boolean, nullable, default false; indexed for true rows (idx_live_metrics_active). false on every row (2026-10-07). Its only writer, mark_active_auctions(), has no caller and would fail if called, because it reads auction_events.ends_at, which does not exist (the column is auction_end_date). queue_sentiment_update reads it to raise the sentiment priority to 10, so no vehicle gets that priority. Unit: none (boolean). Source: mark_active_auctions (never runs). Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_live_metrics.auction_ends_at IS
'Intended scheduled end of the active auction, timestamptz, nullable. NULL on every row (2026-10-07): its only writer is mark_active_auctions(), which has no caller and reads a column auction_events does not have. Unit: timestamptz. Source: mark_active_auctions (never runs). Grain: one vehicle. Clock: n/a (never set).';

-- ── Clock ──────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicle_live_metrics.created_at IS
'When the vehicle first got a row, timestamptz, nullable, default now() (database clock; the drain inserts without it). 2026-01-24 12:25Z to now; by month (2026-10-07): 2026-01 13,174, 02 34,747, 03 153,151, 04 22,648, 05 786, 06 6,211, 07 37,396, 08 1,293, 09 59,852, 10 4,438; 834 in the 24 hours to 18:05Z. Never changed by an update. Unit: timestamptz. Source: column default. Grain: one vehicle. Clock: ingest time (first fold of the vehicle).';

DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(a.attname, ', ' ORDER BY a.attnum) INTO missing
  FROM pg_attribute a
  WHERE a.attrelid = 'public.vehicle_live_metrics'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND col_description(a.attrelid, a.attnum) IS NULL;
  IF missing IS NULL THEN
    RAISE NOTICE 'vehicle_live_metrics: every column has a comment';
  ELSE
    RAISE NOTICE 'vehicle_live_metrics columns still without a comment: %', missing;
  END IF;
END
$$;

COMMIT;
