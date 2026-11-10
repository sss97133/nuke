-- Photo reading status: whether one person's photos are being read, and why not when they are not.
--
-- The stage ledger (20261113110000, switched on by 20261113130000) queues a library for the reader on the owner's Mac,
-- and the alarm assay_photo_reading_flow (20261113120000) tells the service role when reading stops. Nothing tells
-- the person whose photos they are. This file adds the reader the phone and the website both call:
--   * photo_reading_status(p_tz)               signed-in callers; answers for auth.uid() and takes no user id
--   * photo_reading_status_for(p_user_id, p_tz) internal (service role); the body
-- It returns one object: a state decided here (moving, stalled, idle, off) so the two clients cannot disagree, the
-- reasons for a stall in plain sentences, the caller's own counts, and the sentences ready to show.
--
-- Why a reader of its own. The capture ledger reader (get_capture_ledger, 20261111190000) is the other reader that
-- answers for auth.uid() alone, and a new key on it was the first design. It was not taken: production is reported to
-- hold hand-applied changes to the capture ledger functions that are not in this repo (reported to this change, not
-- read by it), and CREATE OR REPLACE from the repo body would put the repo's version over them. This file replaces
-- no existing object.
--
-- What it reads, for one poll:
--   * vehicle_images once: the caller's own entries in idx_vehicle_images_capture_ledger (user_id, capture time,
--     INCLUDE id, taken_at, created_at), kept for the rest of the statement. 20261111190000 gives about 32,000
--     entries for a person's rows. No other column of vehicle_images is read and no row is looked up by id.
--   * image_stage_receipts and image_stage_work, joined TO those ids, so every count is the caller's own.
--   * only when reading is on for the caller: the frame reader's heartbeat row (job_assay_readings) and the two rows
--     of image_stage_reconciler_state. Both are global, so a caller the reconciler does not serve never sees them.
-- What it never returns: another person's counts, the reconciler's user list or cursor, receipt detail, input
-- fingerprints, image URLs, or the heartbeat's by_type (its keys are text read off photographed pages).
--
-- Measured 2026-11-10 on a local PostgreSQL 16 with made-up rows (605,000 photos of which one person owns 31,842;
-- 22,000 receipts and 20,300 work items of theirs), custom and generic plan alike: Index Only Scan on
-- idx_vehicle_images_capture_ledger, 31,842 entries, Heap Fetches 0; hash joins to the two stage tables; 83 to 98 ms
-- a poll, warm (fourteen polls). A first version joined the caller's receipts to the caller's work items inside the
-- statement and took 17 s on the same rows (see "pos" in the body). Production's plan has NOT been read: run EXPLAIN
-- (ANALYZE, BUFFERS) on the statement there before a client polls it, and poll no faster than once a minute, only
-- while the status is on screen.
--
-- Three limits a caller should know:
--   * read_since_start counts receipts, and receipts exist only since the ledger was switched on. A photo read before
--     then has no receipt, so the count is given with its start date and never as a share of the library.
--   * with_reader is the hand-out window (capped by image_stage_reconciler.max_open and refilled in batches). It is
--     not the number of photos left.
--   * Where the pass has got to (reading_from, worked_through) is given only while the backfill walks the library in
--     the order the photos were taken: image_stage_reconciler.order = 'capture_time', the marker 20261113160000 sets
--     and its revert removes. Until that migration is applied the backfill walks by upload time, a position by
--     capture date would be a guess, and both keys are null.
--
-- The statement budget. Both functions carry SET statement_timeout '5s'. That limits a poll only where the layer in
-- front puts the called function's statement_timeout on the transaction before the call (PostgREST documents doing
-- so from version 12; which version production runs was not read). On its own the setting does not shorten the
-- statement that is already running, because PostgreSQL arms the timer when a statement starts (run on PostgreSQL
-- 16 while writing this file: a 3 s sleep inside a function set to 1 s returned after 3 s; with the 1 s set on the
-- transaction first it was cancelled at 1 s). Where it is not applied, the calling role's own limit is the bound.
--
-- Creates two functions. No table, index, cron job or row; no existing object is changed.
-- Revert: supabase/sql/revert_20261113170000_photo_reading_status.sql.
-- Contract: supabase/sql/test_photo_reading_status.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

DO $pre$
BEGIN
  IF to_regclass('public.image_stage_receipts') IS NULL OR to_regclass('public.image_stage_work') IS NULL
     OR to_regclass('public.image_stage_reconciler_state') IS NULL THEN
    RAISE EXCEPTION 'photo reading status: the stage ledger (20261113110000) is not deployed';
  END IF;
  IF to_regclass('public.job_assay_readings') IS NULL OR to_regclass('public.platform_config') IS NULL THEN
    RAISE EXCEPTION 'photo reading status: job_assay_readings or platform_config is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.vehicle_images'::regclass AND attname = 'taken_at' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'photo reading status: vehicle_images.taken_at is missing';
  END IF;
  -- without this index the one read of vehicle_images would go to the heap
  IF NOT EXISTS (SELECT 1 FROM pg_index i
                  WHERE i.indexrelid = to_regclass('public.idx_vehicle_images_capture_ledger') AND i.indisvalid AND i.indisready) THEN
    RAISE EXCEPTION 'photo reading status: idx_vehicle_images_capture_ledger (20261111190000) is missing or not valid';
  END IF;
END $pre$;

CREATE OR REPLACE FUNCTION public.photo_reading_status_for(p_user_id uuid, p_tz text DEFAULT 'America/Los_Angeles')
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET statement_timeout TO '5s'
AS $fn$
DECLARE
  c_stage         constant text := 'classifier';                      -- "reading a photo" is this stage
  c_reader        constant text := 'subscription-frame-classifier';   -- the reader whose heartbeat is shown
  c_default_tz    constant text := 'America/Los_Angeles';
  -- Thresholds. These are judgment, not measurements: chosen from how the pieces are scheduled (the reader fires
  -- every 10 minutes and its heartbeat row calls itself fresh for 40; the job that lines photos up runs every 10).
  -- Change them here and nowhere else; the sentences below that say "an hour" follow c_due_wait.
  c_reader_fresh  constant interval := interval '40 minutes';  -- a heartbeat older than this: the reader is not checking in
  c_dry_fires     constant integer  := 3;                      -- runs in a row that took photos and read none
  c_due_wait      constant interval := interval '60 minutes';  -- work due this long with nothing tried in as long
  c_filler_quiet  constant interval := interval '60 minutes';  -- the job that lines photos up has not run for this long
  c_moving_window constant interval := interval '30 minutes';  -- a photo read this recently means reading is moving

  v_now timestamptz := now();
  v_tz text; v_year text; v_cfg jsonb; v_on boolean := false; v_date_order boolean := false;
  v_total bigint; v_lib_from timestamptz; v_lib_to timestamptz;
  v_reading_from timestamptz; v_pos_read_at timestamptz; v_worked bigint;
  v_counting_since timestamptz; v_last_attempt timestamptz; v_last_read timestamptz; v_read_1h bigint; v_read_24h bigint;
  v_read bigint; v_skipped bigint; v_blocked bigint; v_retrying bigint;
  v_open bigint; v_due bigint; v_claimed bigint; v_claimed_live bigint; v_oldest_due timestamptz;
  v_hb_at timestamptz; v_hb jsonb; v_hb_fresh boolean := false; v_hb_frames numeric; v_hb_read numeric; v_hb_fires numeric;
  v_cause text; v_filler_at timestamptz; v_walked_at timestamptz;
  v_hb_ago text; v_due_ago text; v_filler_ago text; v_read_ago text;
  v_state text; v_headline text; v_summary text; v_reasons text[] := '{}'; v_lines text[] := '{}';
  v_show_walked boolean := false; v_show_pos boolean := false;
  v_pos_month text; v_range text; v_walked_day text;
BEGIN
  IF p_user_id IS NULL THEN RETURN NULL; END IF;

  -- A time zone the server does not know must not fail a status poll: fall back to the default.
  BEGIN
    IF p_tz IS NULL OR btrim(p_tz) = '' THEN
      v_tz := c_default_tz;
    ELSE
      PERFORM v_now AT TIME ZONE p_tz;
      v_tz := p_tz;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_tz := c_default_tz;
  END;
  v_year := to_char(v_now AT TIME ZONE v_tz, 'YYYY');

  -- On for the caller: the reconciler is enabled and serves them (no list of users, or a list that names them).
  -- Read without casts that could raise on a hand-edited value.
  SELECT config_value INTO v_cfg FROM public.platform_config WHERE config_key = 'image_stage_reconciler';
  IF coalesce(v_cfg ->> 'enabled', '') = 'true' THEN
    IF jsonb_typeof(v_cfg -> 'user_ids') = 'array' THEN
      v_on := EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_cfg -> 'user_ids') AS u(val) WHERE lower(btrim(u.val)) = p_user_id::text);
    ELSE
      v_on := true;
    END IF;
  END IF;
  -- Does the backfill walk the library in the order the photos were taken? (the marker 20261113160000 sets)
  v_date_order := coalesce(v_cfg ->> 'order', '') = 'capture_time';

  -- The caller's own photos, receipts and work, in one statement. "mine" is the only read of the photo table: the
  -- caller's index entries, once. Everything else is joined to it, so no count can include another person's photo.
  -- "cur" is the current receipt per photo, by the rule of the view image_stage_current (highest version; within it
  -- a success or a policy skip outranks a later non-success; then the highest attempt), restated here so that it is
  -- computed over the caller's receipts only. The contract compares the two.
  -- "pos" is where the date-order pass is: the capture time of the photo it most recently read (a succeeded receipt
  -- on a photo that the backfill lane handed out). A photo read by the live lane, just uploaded, does not move it.
  -- It is found by grouping, not by joining "rc" to "wk": the planner cannot know how many rows those two hold, and
  -- on a 31,842-photo library it chose a nested loop over them (200 million comparisons, 17 s on a local PostgreSQL
  -- 16). Keep it that way: "mine" is joined only to the two stage tables, which are indexed by photo, and the sets
  -- built from it are never joined to one another. The contract runs a 12,000-photo library under a 3 s limit.
  WITH mine AS MATERIALIZED (
    SELECT vi.id, COALESCE(vi.taken_at, vi.created_at) AS shot_at
      FROM public.vehicle_images vi
     WHERE vi.user_id = p_user_id AND vi.user_id IS NOT NULL
  ), rc AS MATERIALIZED (
    SELECT r.image_id, r.outcome, r.producer_version, r.attempt, r.observed_at, m.shot_at
      FROM mine m
      JOIN public.image_stage_receipts r ON r.image_id = m.id
     WHERE r.stage = c_stage
  ), cur AS MATERIALIZED (
    SELECT DISTINCT ON (rc.image_id) rc.image_id, rc.outcome
      FROM rc
     ORDER BY rc.image_id, rc.producer_version DESC, (rc.outcome IN ('succeeded', 'policy_skip')) DESC, rc.attempt DESC
  ), wk AS MATERIALIZED (
    SELECT w.image_id, w.status, w.lane, w.not_before, w.lease_until
      FROM mine m
      JOIN public.image_stage_work w ON w.image_id = m.id
     WHERE w.stage = c_stage
  ), pos AS MATERIALIZED (
    SELECT e.image_id, max(e.shot_at) AS shot_at, max(e.read_at) AS observed_at
      FROM (SELECT rc.image_id, rc.shot_at, rc.observed_at AS read_at, false AS by_pass FROM rc WHERE rc.outcome = 'succeeded'
            UNION ALL
            SELECT wk.image_id, NULL, NULL, true FROM wk WHERE wk.lane = 'backfill' AND wk.status = 'done') e
     GROUP BY e.image_id
    HAVING bool_or(e.by_pass) AND max(e.read_at) IS NOT NULL
     ORDER BY max(e.read_at) DESC, max(e.shot_at) DESC
     LIMIT 1
  ), lib AS (
    SELECT count(*) AS n, min(m.shot_at) AS first_at, max(m.shot_at) AS last_at,
           count(*) FILTER (WHERE m.shot_at <= (SELECT p.shot_at FROM pos p)) AS passed
      FROM mine m
  ), rcs AS (
    SELECT min(rc.observed_at) AS first_at, max(rc.observed_at) AS last_any,
           max(rc.observed_at) FILTER (WHERE rc.outcome = 'succeeded') AS last_ok,
           count(DISTINCT rc.image_id) FILTER (WHERE rc.outcome = 'succeeded' AND rc.observed_at > v_now - interval '1 hour') AS ok_1h,
           count(DISTINCT rc.image_id) FILTER (WHERE rc.outcome = 'succeeded' AND rc.observed_at > v_now - interval '24 hours') AS ok_24h
      FROM rc
  ), curs AS (
    SELECT count(*) FILTER (WHERE cur.outcome = 'succeeded') AS ok,
           count(*) FILTER (WHERE cur.outcome = 'policy_skip') AS skipped,
           count(*) FILTER (WHERE cur.outcome = 'blocked_input') AS blocked,
           count(*) FILTER (WHERE cur.outcome IN ('unavailable', 'rate_limited')) AS retrying
      FROM cur
  ), wks AS (
    SELECT count(*) FILTER (WHERE wk.status IN ('queued', 'claimed')) AS open,
           count(*) FILTER (WHERE wk.status = 'queued' AND wk.not_before <= v_now) AS due,
           count(*) FILTER (WHERE wk.status = 'claimed') AS claimed,
           count(*) FILTER (WHERE wk.status = 'claimed' AND wk.lease_until > v_now) AS claimed_live,
           min(wk.not_before) FILTER (WHERE wk.status = 'queued' AND wk.not_before <= v_now) AS oldest_due
      FROM wk
  )
  SELECT lib.n, lib.first_at, lib.last_at, (SELECT p.shot_at FROM pos p), (SELECT p.observed_at FROM pos p), lib.passed,
         rcs.first_at, rcs.last_any, rcs.last_ok, rcs.ok_1h, rcs.ok_24h,
         curs.ok, curs.skipped, curs.blocked, curs.retrying,
         wks.open, wks.due, wks.claimed, wks.claimed_live, wks.oldest_due
    INTO v_total, v_lib_from, v_lib_to, v_reading_from, v_pos_read_at, v_worked,
         v_counting_since, v_last_attempt, v_last_read, v_read_1h, v_read_24h,
         v_read, v_skipped, v_blocked, v_retrying,
         v_open, v_due, v_claimed, v_claimed_live, v_oldest_due
    FROM lib, rcs, curs, wks;
  -- No date-order pass, no position: a place in the library by capture date would be a guess.
  IF NOT v_date_order THEN v_reading_from := NULL; v_pos_read_at := NULL; END IF;
  IF v_reading_from IS NULL THEN v_worked := NULL; END IF;

  -- The reader and the job that lines photos up are one row each for the whole system, not per person: they are
  -- read only for a caller the reconciler serves.
  IF v_on THEN
    SELECT a.assayed_at, a.reading INTO v_hb_at, v_hb FROM public.job_assay_readings a WHERE a.jobname = c_reader;
    SELECT max(st.last_run_at), max(st.wrapped_at) FILTER (WHERE st.lane = 'backfill')
      INTO v_filler_at, v_walked_at
      FROM public.image_stage_reconciler_state st;
    v_hb_fresh  := v_hb_at IS NOT NULL AND v_hb_at > v_now - c_reader_fresh;
    v_hb_frames := CASE WHEN jsonb_typeof(v_hb -> 'frames') = 'number' THEN (v_hb ->> 'frames')::numeric END;
    v_hb_read   := CASE WHEN jsonb_typeof(v_hb -> 'read') = 'number' THEN (v_hb ->> 'read')::numeric END;
    v_hb_fires  := CASE WHEN jsonb_typeof(v_hb -> 'zero_read_fires') = 'number' THEN (v_hb ->> 'zero_read_fires')::numeric END;
  END IF;

  -- Durations in sentences are approximate words, never clock times.
  SELECT max(x.words) FILTER (WHERE x.k = 'hb'), max(x.words) FILTER (WHERE x.k = 'due'),
         max(x.words) FILTER (WHERE x.k = 'filler'), max(x.words) FILTER (WHERE x.k = 'read')
    INTO v_hb_ago, v_due_ago, v_filler_ago, v_read_ago
    FROM (SELECT t.k,
                 CASE WHEN t.s IS NULL THEN NULL
                      WHEN t.s < 90 THEN 'about a minute'
                      WHEN t.s < 600 THEN 'about ' || round(t.s / 60) || ' minutes'
                      WHEN t.s < 3300 THEN 'about ' || round(t.s / 300) * 5 || ' minutes'
                      WHEN t.s < 5400 THEN 'about an hour'
                      WHEN t.s < 129600 THEN 'about ' || round(t.s / 3600) || ' hours'
                      ELSE 'about ' || round(t.s / 86400) || ' days' END AS words
            FROM (VALUES ('hb', extract(epoch FROM v_now - v_hb_at)::numeric),
                         ('due', extract(epoch FROM v_now - v_oldest_due)::numeric),
                         ('filler', extract(epoch FROM v_now - v_filler_at)::numeric),
                         ('read', extract(epoch FROM v_now - v_last_read)::numeric)) AS t(k, s)) x;

  -- ---------------------------------------------------------------- state
  IF NOT v_on THEN
    v_state := 'off';
    v_headline := 'Photo reading is not switched on for this account';
  ELSIF v_total = 0 THEN
    -- nothing of the caller's to read: the reader's troubles are not theirs to be told about
    v_state := 'idle';
    v_headline := 'Photo reading is waiting';
    v_summary := 'No photos here yet';
  ELSE
    -- (a) photos are due or handed out and the reader is not checking in
    IF (v_due > 0 OR v_claimed > 0) AND NOT v_hb_fresh THEN
      v_reasons := v_reasons || (CASE WHEN v_hb_at IS NULL THEN 'The reader on the Mac has not checked in yet.'
                                      ELSE 'The reader on the Mac has not checked in for ' || v_hb_ago || '.' END
                                 || ' It runs only while the Mac is awake and signed in.');
    END IF;
    -- (b) the reader checks in, takes photos and reads none, several runs in a row. The cause is the reason its last
    --     run stopped, else the most frequent failure it reported; each known cause has its own fixed sentence, and
    --     the reader's own words for it are never shown.
    IF v_hb_fresh AND v_hb_frames > 0 AND v_hb_read = 0 AND v_hb_fires >= c_dry_fires THEN
      v_cause := CASE WHEN jsonb_typeof(v_hb -> 'stopped') = 'string' THEN v_hb ->> 'stopped' END;
      IF v_cause IS NULL AND jsonb_typeof(v_hb -> 'error_classes') = 'object' THEN
        SELECT e.key INTO v_cause
          FROM jsonb_each(v_hb -> 'error_classes') e
         ORDER BY CASE WHEN jsonb_typeof(e.value) = 'number' THEN (e.value #>> '{}')::numeric ELSE 0 END DESC, e.key
         LIMIT 1;
      END IF;
      v_reasons := v_reasons || CASE
        WHEN v_cause = 'reader_usage_limit' THEN 'The reading subscription is out of usage for now; reading resumes when it resets.'
        WHEN v_cause = 'reader_unauthorized' THEN 'The reader on the Mac is signed out of its reading account and has to sign in again.'
        WHEN v_cause = 'reader_tool_missing' THEN 'The reader on the Mac is missing a tool it needs to open photos.'
        WHEN v_cause = 'reader_api_unreachable' THEN 'The reader on the Mac cannot reach the reading service.'
        WHEN v_cause = 'reader_timeout' THEN 'The reader is running out of time on every photo it takes.'
        WHEN v_cause IN ('image_http_error', 'image_download_error', 'image_url_missing', 'image_unreadable')
          THEN 'The reader could not open the photos it was given.'
        WHEN v_cause = 'reader_output_invalid' OR v_cause LIKE 'classifier\_response\_%'
          THEN 'The reader''s answers are being turned away as unusable.'
        WHEN v_cause LIKE 'orchestrator\_%' THEN 'The server is not accepting what the reader sends back.'
        ELSE 'The reader has taken photos and read none of them, ' || to_char(v_hb_fires, 'FM999,999,999') || ' runs in a row.' END;
    END IF;
    -- (c) photos have been due for a long time and nothing, of any outcome, has been tried for as long
    IF v_due > 0 AND v_oldest_due < v_now - c_due_wait AND (v_last_attempt IS NULL OR v_last_attempt < v_now - c_due_wait) THEN
      v_reasons := v_reasons || ('Photos have been waiting to be read for ' || v_due_ago || ', and none has been tried for at least an hour.');
    END IF;
    -- (d) the job that lines photos up for the reader has stopped running
    IF v_filler_at IS NULL OR v_filler_at < v_now - c_filler_quiet THEN
      v_reasons := v_reasons || CASE WHEN v_filler_at IS NULL THEN 'The job that lines photos up for the reader has not run yet.'
                                     ELSE 'The job that lines photos up for the reader last ran ' || v_filler_ago || ' ago.' END;
    END IF;

    v_show_walked := v_walked_at IS NOT NULL AND v_open = 0;
    v_show_pos := v_reading_from IS NOT NULL AND NOT v_show_walked AND (v_walked_at IS NULL OR v_pos_read_at > v_walked_at);
    v_pos_month := to_char(v_reading_from AT TIME ZONE v_tz, 'FMMonth YYYY');
    v_walked_day := to_char(v_walked_at AT TIME ZONE v_tz, 'Mon FMDD')
                    || CASE WHEN to_char(v_walked_at AT TIME ZONE v_tz, 'YYYY') <> v_year THEN to_char(v_walked_at AT TIME ZONE v_tz, ', YYYY') ELSE '' END;

    IF cardinality(v_reasons) > 0 THEN
      v_state := 'stalled';
      v_headline := 'Photo reading has stalled';
      v_summary := v_reasons[1];
    ELSIF (v_last_read IS NOT NULL AND v_last_read > v_now - c_moving_window) OR (v_claimed_live > 0 AND v_hb_fresh) THEN
      v_state := 'moving';
      v_headline := 'Reading your photos';
      v_summary := CASE WHEN v_read_1h > 0 THEN to_char(v_read_1h, 'FM999,999,999') || ' read in the last hour' ELSE 'Reading now' END
                   || CASE WHEN v_show_pos THEN ' · on photos from ' || v_pos_month ELSE '' END;
    ELSE
      v_state := 'idle';
      v_headline := 'Photo reading is waiting';
      v_summary := CASE WHEN v_due > 0 OR v_claimed > 0 THEN 'Waiting for the reader''s next run'
                        WHEN v_retrying > 0 THEN to_char(v_retrying, 'FM999,999,999') || ' waiting to be tried again'
                        WHEN v_show_walked THEN 'The whole library has been looked at once, as of ' || v_walked_day
                        ELSE 'Nothing waiting right now' END;
    END IF;
  END IF;

  -- ---------------------------------------------------------------- the sentences to show
  -- A sentence whose number is zero or unknown is left out, never printed as a zero or a guess.
  -- 1. how much was read lately
  IF v_on AND v_read_1h > 0 THEN
    v_lines := v_lines || (to_char(v_read_1h, 'FM999,999,999') || ' read in the last hour'
                           || CASE WHEN v_read_24h > v_read_1h THEN ', ' || to_char(v_read_24h, 'FM999,999,999') || ' in the last day.' ELSE '.' END);
  ELSIF v_on AND v_read_24h > 0 THEN
    v_lines := v_lines || (to_char(v_read_24h, 'FM999,999,999') || ' read in the last day, the last one ' || v_read_ago || ' ago.');
  ELSIF v_on AND v_last_read IS NOT NULL THEN
    v_lines := v_lines || ('The last photo was read ' || v_read_ago || ' ago.');
  END IF;
  -- 2. where the date-order pass is, and the span of the library
  IF v_total > 0 THEN
    v_range := CASE WHEN to_char(v_lib_from AT TIME ZONE v_tz, 'YYYY-MM') = to_char(v_lib_to AT TIME ZONE v_tz, 'YYYY-MM')
                    THEN 'Your photos are all from ' || to_char(v_lib_from AT TIME ZONE v_tz, 'FMMonth YYYY') || '.'
                    ELSE 'Your photos run from ' || to_char(v_lib_from AT TIME ZONE v_tz, 'FMMonth YYYY') || ' to '
                         || to_char(v_lib_to AT TIME ZONE v_tz, 'FMMonth YYYY') || '.' END;
    v_lines := v_lines || (CASE WHEN NOT v_show_pos THEN ''
                                WHEN v_state = 'moving' THEN 'Now on photos taken in ' || v_pos_month || '. '
                                ELSE 'Reading has reached photos taken in ' || v_pos_month || '. ' END || v_range);
  END IF;
  -- 3. how far the date-order pass has got
  IF v_show_pos AND v_worked > 0 THEN
    v_lines := v_lines || ('Worked through ' || to_char(v_worked, 'FM999,999,999') || ' of ' || to_char(v_total, 'FM999,999,999')
                           || CASE WHEN v_total = 1 THEN ' photo' ELSE ' photos' END || ' in date order.');
  END IF;
  -- 4. the count, with the clock it has been running on
  IF v_read > 0 AND v_counting_since IS NOT NULL THEN
    v_lines := v_lines || (to_char(v_read, 'FM999,999,999') || CASE WHEN v_read = 1 THEN ' photo' ELSE ' photos' END || ' read since '
                           || to_char(v_counting_since AT TIME ZONE v_tz, 'Mon FMDD')
                           || CASE WHEN to_char(v_counting_since AT TIME ZONE v_tz, 'YYYY') <> v_year THEN to_char(v_counting_since AT TIME ZONE v_tz, ', YYYY') ELSE '' END
                           || '. Readings made before then are not counted here.');
  END IF;
  -- 5. the hand-out window: what the reader holds now, which is not what is left
  IF v_on AND v_open > 0 THEN
    v_lines := v_lines || (to_char(v_open, 'FM999,999,999') || CASE WHEN v_open = 1 THEN ' is' ELSE ' are' END || ' with the reader now.');
  END IF;
  -- 6. what did not go through (nothing is tried again while reading is off, so these are said only when it is on)
  IF v_on AND v_retrying > 0 THEN
    v_lines := v_lines || (to_char(v_retrying, 'FM999,999,999') || ' did not go through and will be tried again.');
  END IF;
  IF v_on AND v_blocked > 0 THEN
    v_lines := v_lines || (to_char(v_blocked, 'FM999,999,999') || ' could not be opened.');
  END IF;
  IF v_on AND v_skipped > 0 THEN
    v_lines := v_lines || (to_char(v_skipped, 'FM999,999,999') || CASE WHEN v_skipped = 1 THEN ' was' ELSE ' were' END || ' skipped on purpose.');
  END IF;
  -- 7. the pass has been over the whole library and holds nothing now
  IF v_show_walked THEN
    v_lines := v_lines || ('The whole library has been looked at once, as of ' || v_walked_day || '.');
  END IF;

  RETURN jsonb_build_object(
    'as_of', v_now,
    'state', v_state,
    'headline', v_headline,
    'summary', v_summary,
    'reasons', to_jsonb(v_reasons),
    'lines', to_jsonb(v_lines),
    'photos_total', v_total,
    'worked_through', v_worked,
    'read_since_start', v_read,
    'counting_since', v_counting_since,
    'could_not_read', v_blocked,
    'skipped', v_skipped,
    'retrying', v_retrying,
    'with_reader', v_open,
    'read_1h', v_read_1h,
    'read_24h', v_read_24h,
    'last_read_at', v_last_read,
    'last_attempt_at', v_last_attempt,
    'reading_from', v_reading_from,
    'library_from', v_lib_from,
    'library_to', v_lib_to,
    'library_walked_at', CASE WHEN v_on THEN v_walked_at END,
    'reader_checked_in_at', CASE WHEN v_on THEN v_hb_at END);
END $fn$;
REVOKE ALL ON FUNCTION public.photo_reading_status_for(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.photo_reading_status_for(uuid, text) TO service_role;
COMMENT ON FUNCTION public.photo_reading_status_for(uuid, text) IS
  'Internal body of photo_reading_status: for one user, whether their photos are being read (state moving, stalled, idle or off, decided here), why not when stalled, their own counts and the sentences to show. Reads the user''s entries in idx_vehicle_images_capture_ledger once and joins image_stage_receipts and image_stage_work to them; reads the reader''s heartbeat and the reconciler''s state only when the reconciler serves that user. Never returns another user''s counts, the reconciler''s user list or cursor, receipt detail, image URLs or the heartbeat''s by_type. Service role only. Migration 20261113170000.';

CREATE OR REPLACE FUNCTION public.photo_reading_status(p_tz text DEFAULT 'America/Los_Angeles')
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET statement_timeout TO '5s'
AS $fn$
  SELECT CASE WHEN auth.uid() IS NULL THEN NULL ELSE public.photo_reading_status_for(auth.uid(), p_tz) END
$fn$;
REVOKE ALL ON FUNCTION public.photo_reading_status(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.photo_reading_status(text) TO authenticated;
COMMENT ON FUNCTION public.photo_reading_status(text) IS
  'For the signed-in caller: whether their photos are being read, and why not when reading has stalled. One object: state (moving, stalled, idle, off), headline, summary, reasons, lines (sentences ready to show, dates in p_tz) and the caller''s own counts. Takes no user id; answers for auth.uid() and returns NULL when there is none. An unknown time zone falls back to America/Los_Angeles. The phone and the website both read it. Signed-in users only. Migration 20261113170000.';

DO $chk$
DECLARE f text;
BEGIN
  IF has_function_privilege('anon', 'public.photo_reading_status(text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.photo_reading_status_for(uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'photo reading status: anon must not execute either reader';
  END IF;
  IF has_function_privilege('authenticated', 'public.photo_reading_status_for(uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'photo reading status: the internal reader takes a user id and must not be executable by signed-in users';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.photo_reading_status(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'photo reading status: signed-in users must be able to execute the public reader';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.photo_reading_status_for(uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'photo reading status: the service role must be able to execute the internal reader';
  END IF;
  FOREACH f IN ARRAY ARRAY['public.photo_reading_status(text)', 'public.photo_reading_status_for(uuid, text)'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = f::regprocedure AND p.prosecdef AND p.provolatile = 's'
                      AND EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c WHERE c LIKE 'statement_timeout=%')
                      AND EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c WHERE c LIKE 'search_path=%')) THEN
      RAISE EXCEPTION 'photo reading status: % must be a stable definer function with its own search_path and statement_timeout', f;
    END IF;
  END LOOP;
END $chk$;
COMMIT;
