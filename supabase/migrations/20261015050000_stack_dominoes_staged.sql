-- Follow-up to 20261015034500_stack_dominoes.sql. MEASURED 2026-10-15 00:55Z on prod: snapshot_stack_dominoes() as one
-- statement hit the 10 s statement_timeout in its first cohort read (the vehicle_events x vehicles join; vehicles is 11 GB,
-- planner estimate 1,014,519 rows). A caught EXCEPTION inside a function does not isolate a timeout: the timer belongs to
-- the outer statement, so one slow source would cancel the whole reading under the job's 300 s as well.
-- Fix: three stages, each its own statement in the job (statement_timeout applies per statement of a multi-statement
-- command), sharing session temp tables:
--   snapshot_stack_dominoes_begin(by)    writes the input counts, opens the reading
--   snapshot_stack_dominoes_read(raw)    reads one source's cohorts
--   snapshot_stack_dominoes_finish()     writes cohort depth for the sources read, receipts, closes the reading
-- snapshot_stack_dominoes(by) stays as the one-call form (begin, a read per source with >= 500 sold lots, finish).
-- A source not read is absent from the reading (unknown). The job names the sources: bat, mecum, barrettjackson,
-- cars_and_bids, gooding, bonhams, rm-sothebys, pcarmarket, conceptcarz (raw source_platform spellings).
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.snapshot_stack_dominoes_begin(p_registered_by text DEFAULT 'snapshot_stack_dominoes')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c_writer      constant text := 'snapshot_stack_dominoes';
  v_prev_writer text := current_setting('app.writer', true);
  v_at          timestamptz := now();
  v_inputs      integer := 0;
  v_n           integer;
BEGIN
  IF coalesce(btrim(p_registered_by), '') = '' THEN
    RAISE EXCEPTION 'snapshot_stack_dominoes: p_registered_by must name the caller' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  PERFORM set_config('app.writer', c_writer, true);

  INSERT INTO public.stack_input_support
    (measured_at, input_table, source_key, basis, rows, rows_sold, rows_with_start, rows_with_end, clock_min, clock_max, population, registered_by)
  SELECT v_at, 'vehicle_events', regexp_replace(lower(coalesce(source_platform, 'unknown')), '[-_ ]', '', 'g'), 'count',
         count(*), count(*) FILTER (WHERE event_status = 'sold'), count(started_at), count(ended_at), min(ended_at), max(ended_at),
         'vehicle_events rows of every event_type, by normalized source_platform, counted ' || to_char(v_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"'),
         p_registered_by
  FROM public.vehicle_events
  GROUP BY 3
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_inputs := v_inputs + v_n;

  INSERT INTO public.stack_input_support
    (measured_at, input_table, source_key, basis, rows, rows_sold, rows_with_start, rows_with_end, clock_min, clock_max, population, registered_by)
  SELECT v_at, 'auction_events', regexp_replace(lower(coalesce(source, 'unknown')), '[-_ ]', '', 'g'), 'count',
         count(*), count(*) FILTER (WHERE outcome = 'sold'), count(auction_start_date), count(auction_end_date),
         min(auction_end_date), max(auction_end_date),
         'auction_events rows by normalized source, counted ' || to_char(v_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"'),
         p_registered_by
  FROM public.auction_events
  GROUP BY 3
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_inputs := v_inputs + v_n;

  INSERT INTO public.stack_input_support
    (measured_at, input_table, source_key, basis, rows, population, registered_by)
  SELECT v_at, t.tbl, regexp_replace(lower(m.val), '[-_ ]', '', 'g'), 'estimate', round(c.reltuples * m.freq)::bigint,
         t.tbl || ' planner estimate (reltuples x most_common_freqs of ' || t.col || '), values outside the most common list not shown, read ' ||
           to_char(v_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"'),
         p_registered_by
  FROM (VALUES ('bat_bids', 'source'), ('auction_comments', 'platform')) AS t(tbl, col)
  JOIN pg_class c ON c.oid = to_regclass('public.' || t.tbl) AND c.reltuples > 0
  JOIN pg_stats s ON s.schemaname = 'public' AND s.tablename = t.tbl AND s.attname = t.col
  CROSS JOIN LATERAL unnest(s.most_common_vals::text::text[], s.most_common_freqs) AS m(val, freq)
  WHERE m.val IS NOT NULL
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_inputs := v_inputs + v_n;

  IF v_inputs > 0 THEN
    INSERT INTO public.write_receipts (tbl, op, rows, writer, db_role, app_name, txid)
    VALUES ('stack_input_support', 'INSERT', v_inputs, c_writer, current_user, current_setting('application_name', true), txid_current());
  END IF;

  DROP TABLE IF EXISTS pg_temp._dom_cohort, pg_temp._dom_run;
  CREATE TEMP TABLE _dom_cohort (src text, y integer, mk text, md text, n integer);
  CREATE TEMP TABLE _dom_run AS SELECT v_at AS at, p_registered_by AS by, clock_timestamp() AS started;

  PERFORM set_config('app.writer', coalesce(v_prev_writer, ''), true);
  RETURN jsonb_build_object('input_rows', v_inputs, 'measured_at', v_at);
END
$$;

CREATE OR REPLACE FUNCTION public.snapshot_stack_dominoes_read(p_raw_platform text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_started timestamptz := clock_timestamp();
  v_n       integer;
BEGIN
  IF to_regclass('pg_temp._dom_run') IS NULL THEN
    RAISE EXCEPTION 'snapshot_stack_dominoes_read: call snapshot_stack_dominoes_begin first in this session' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  DELETE FROM pg_temp._dom_cohort WHERE src = regexp_replace(lower(p_raw_platform), '[-_ ]', '', 'g');
  INSERT INTO pg_temp._dom_cohort
  SELECT regexp_replace(lower(p_raw_platform), '[-_ ]', '', 'g'), v.year, lower(btrim(v.make)), lower(btrim(v.model)), count(*)
  FROM public.vehicle_events ve
  JOIN public.vehicles v ON v.id = ve.vehicle_id
  WHERE ve.source_platform = p_raw_platform AND ve.event_type = 'auction' AND ve.event_status = 'sold' AND ve.final_price > 0
    AND v.deleted_at IS NULL AND v.year BETWEEN 1885 AND 2100
    AND coalesce(btrim(v.make), '') <> '' AND coalesce(btrim(v.model), '') <> ''
  GROUP BY 2, 3, 4;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('source_platform', p_raw_platform, 'cohorts', v_n,
                            'ms', round(extract(epoch FROM clock_timestamp() - v_started) * 1000));
END
$$;

CREATE OR REPLACE FUNCTION public.snapshot_stack_dominoes_finish()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c_writer      constant text := 'snapshot_stack_dominoes';
  v_prev_writer text := current_setting('app.writer', true);
  v_at          timestamptz;
  v_by          text;
  v_started     timestamptz;
  v_depth       integer := 0;
  v_sources     text;
BEGIN
  IF to_regclass('pg_temp._dom_run') IS NULL THEN
    RAISE EXCEPTION 'snapshot_stack_dominoes_finish: call snapshot_stack_dominoes_begin first in this session' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  SELECT at, by, started INTO v_at, v_by, v_started FROM pg_temp._dom_run;
  PERFORM set_config('app.writer', c_writer, true);

  CREATE TEMP TABLE _c ON COMMIT DROP AS SELECT src, y, mk, md, sum(n)::integer AS n FROM pg_temp._dom_cohort GROUP BY 1, 2, 3, 4;
  SELECT string_agg(DISTINCT src, ', ' ORDER BY src) INTO v_sources FROM _c;

  INSERT INTO public.stack_cohort_depth
    (measured_at, source_a, source_b, min_lots, cohorts, lots_a, lots_b, population, registered_by)
  SELECT v_at, p.sa, p.sb, k.n, coalesce(x.cohorts, 0), coalesce(x.la, 0), coalesce(x.lb, 0),
         'vehicle_events (event_type auction, event_status sold, final_price > 0) joined to vehicles (deleted_at null, year, make, model present); cohort = year + lower make + lower model; sources read in this reading: '
           || coalesce(v_sources, 'none') || '; read ' || to_char(v_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"'),
         v_by
  FROM (SELECT a.src AS sa, b.src AS sb
        FROM (SELECT DISTINCT src FROM _c) a JOIN (SELECT DISTINCT src FROM _c) b ON a.src <= b.src) p
  CROSS JOIN (VALUES (1), (3), (5), (10), (20), (50), (60)) AS k(n)
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS cohorts, sum(a.n) AS la, sum(b.n) AS lb
    FROM _c a JOIN _c b ON b.src = p.sb AND b.y = a.y AND b.mk = a.mk AND b.md = a.md
    WHERE a.src = p.sa AND a.n >= k.n AND b.n >= k.n) x ON true
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_depth = ROW_COUNT;

  IF v_depth > 0 THEN
    INSERT INTO public.write_receipts (tbl, op, rows, writer, db_role, app_name, txid)
    VALUES ('stack_cohort_depth', 'INSERT', v_depth, c_writer, current_user, current_setting('application_name', true), txid_current());
  END IF;

  DROP TABLE pg_temp._dom_cohort, pg_temp._dom_run;
  PERFORM set_config('app.writer', coalesce(v_prev_writer, ''), true);
  RETURN jsonb_build_object('depth_rows', v_depth, 'sources_read', v_sources, 'measured_at', v_at,
                            'ms', round(extract(epoch FROM clock_timestamp() - v_started) * 1000));
END
$$;

-- One-call form: begin, a read per source with >= 500 sold priced lots, finish. Bounded by the caller's one statement
-- timeout; the job uses the three stages instead.
CREATE OR REPLACE FUNCTION public.snapshot_stack_dominoes(p_registered_by text DEFAULT 'snapshot_stack_dominoes')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r       record;
  v_begin jsonb;
  v_fin   jsonb;
BEGIN
  v_begin := public.snapshot_stack_dominoes_begin(p_registered_by);
  FOR r IN
    SELECT source_platform AS raw FROM public.vehicle_events
    WHERE source_platform IS NOT NULL AND event_type = 'auction' AND event_status = 'sold' AND final_price > 0
    GROUP BY source_platform HAVING count(*) >= 500
  LOOP
    PERFORM public.snapshot_stack_dominoes_read(r.raw);
  END LOOP;
  v_fin := public.snapshot_stack_dominoes_finish();
  RETURN v_begin || v_fin;
END
$$;

REVOKE ALL ON FUNCTION public.snapshot_stack_dominoes_begin(text), public.snapshot_stack_dominoes_read(text),
  public.snapshot_stack_dominoes_finish(), public.snapshot_stack_dominoes(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.snapshot_stack_dominoes_begin(text), public.snapshot_stack_dominoes_read(text),
  public.snapshot_stack_dominoes_finish(), public.snapshot_stack_dominoes(text) TO service_role;

COMMENT ON FUNCTION public.snapshot_stack_dominoes_begin(text) IS 'Stage 1 of snapshot_stack_dominoes: writes stack_input_support for the reading (receipted) and opens session temp tables for the cohort stages. Call stages in one session; the job runs them as separate statements so each has its own statement_timeout. service_role only.';
COMMENT ON FUNCTION public.snapshot_stack_dominoes_read(text) IS 'Stage 2: reads one source''s cohorts (sold priced vehicle_events joined to vehicles) into the session temp table; p_raw_platform is the raw vehicle_events.source_platform spelling. Re-reading a source replaces its rows. service_role only.';
COMMENT ON FUNCTION public.snapshot_stack_dominoes_finish() IS 'Stage 3: writes stack_cohort_depth for the sources read (a source not read is absent, unknown), receipts it, closes the reading and returns {depth_rows, sources_read, measured_at, ms}. service_role only.';
COMMENT ON FUNCTION public.snapshot_stack_dominoes(text) IS 'One-call form of the three stages: reads every source with >= 500 sold priced lots, bounded by one statement timeout. The daily job uses the stages. Sanctioned writer of stack_input_support and stack_cohort_depth; SECURITY DEFINER, service_role only.';
COMMENT ON TABLE public.stack_cohort_depth IS
'Per reading, how deep the shared cohorts of two sources are (grain: measured_at + source_a + source_b + min_lots; source_a <= source_b; source_a = source_b is a source alone). cohorts = (year, make, model) cohorts, string-equal on lower-cased make and model (un-normalized, so an undercount of true cohorts), with at least min_lots sold priced lots on both sources. Population: vehicle_events with event_type auction, event_status sold, final_price > 0, joined to vehicles (deleted_at null) with year, make and model; the sources read are named in each row''s population. Written only by the snapshot_stack_dominoes stages; append-only. Reader: v_hypothesis_support. A source pair absent from a reading was not read (unknown), a present row with cohorts = 0 is a measured zero.';

SELECT cron.schedule('snapshot-stack-dominoes', '25 4 * * *',
  $c$SET statement_timeout = '300s'; SELECT public.snapshot_stack_coverage('cron:snapshot-stack-dominoes'); SELECT public.snapshot_stack_dominoes_begin('cron:snapshot-stack-dominoes'); SELECT public.snapshot_stack_dominoes_read('bat'); SELECT public.snapshot_stack_dominoes_read('mecum'); SELECT public.snapshot_stack_dominoes_read('barrettjackson'); SELECT public.snapshot_stack_dominoes_read('cars_and_bids'); SELECT public.snapshot_stack_dominoes_read('gooding'); SELECT public.snapshot_stack_dominoes_read('bonhams'); SELECT public.snapshot_stack_dominoes_read('rm-sothebys'); SELECT public.snapshot_stack_dominoes_read('pcarmarket'); SELECT public.snapshot_stack_dominoes_read('conceptcarz'); SELECT public.snapshot_stack_dominoes_finish();$c$);

COMMIT;
