-- Case ledger 13.1 point 4 and the owner's 2026-10-14 direction ("recognizing the stacks of the data model and the
-- additional inference data that begins to take shape with data growth"): the domino map from a landed lot to the stacks
-- it feeds, a daily snapshot of it, and the first hypotheses that data volume makes testable.
--
-- MEASURED BEFORE (prod, read-only through scripts/data/q.sh, 2026-10-15 00:30Z to 00:50Z):
--   v_stacks 64 stacks (coverage is structural: needs present / needs). stack_coverage_snapshots had a reading; no cron
--   schedule called snapshot_stack_coverage. source_target_coverage: mecum 266,998 targets, 48,934 landed (18.33%); bonhams
--   142,575 targets, 3,453 landed (2.42%); bat 163,936 targets, 159,060 landed (97.03%), landed_measured_at 00:21Z.
--   Lot tables disagree by source (auction_events source mecum 23,515 rows; vehicle_events source_platform mecum
--   66,742 sold rows), so support is stored per table and per source, never merged.
--   Stack needs (latest versions): 110 abstract, 57 column, 20 stack, 17 table, 14 intake, 7 function.
--   vein_ledger: 11 rows (V001-V007, V010-V013), append-only, the registry's home for pre-registered hypotheses.
--
-- DESIGN. Extends v_stacks / stack_coverage_snapshots; no existing object is changed.
--   stack_input_support    per reading, per input table, per source: rows, sold rows, clocks. Exact counts for
--                          vehicle_events and auction_events; planner estimates (pg_stats) for bat_bids and
--                          auction_comments, which are too large to scan daily. Tables not listed are not measured.
--   stack_cohort_depth     per reading, per source pair and minimum lot count: how many (year, make, model) cohorts have at
--                          least that many sold priced lots on both sources. This is the volume a cross-venue test needs.
--   snapshot_stack_dominoes()  the sanctioned writer of both; one reading per call at the transaction clock.
--   v_stack_dominoes       one row per stack need (latest stack version): verdict, evidence and reading date from
--                          stack_coverage_snapshots, the sources that feed the input with their rows and dates, and whether
--                          a landed lot can change the verdict.
--   v_source_dominoes      the same read from the source's side: target gap beside every input the source feeds.
--   v_hypothesis_support   hypotheses in vein_ledger (parameters.support) against the latest readings: current, needed, met.
--   Hypotheses live in vein_ledger (V014 to V019): its columns already hold hypothesis, population, test, pass rule and
--   baseline, and it is append-only. The testable-at volume sits in parameters.support, so the view reads it.
--   Source keys are lower-cased with '-', '_' and spaces removed (the rule mv_source_target_landed uses).
--   Cron: snapshot-stack-dominoes daily 04:25 UTC runs snapshot_stack_coverage then snapshot_stack_dominoes, same pattern
--   as refresh-source-target-landed (statement_timeout 300s in the job).

BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

-- 1. Tables -----------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stack_input_support (
  measured_at     timestamptz NOT NULL,
  input_table     text        NOT NULL,
  source_key      text        NOT NULL,
  basis           text        NOT NULL CHECK (basis IN ('count', 'estimate')),
  rows            bigint      NOT NULL CHECK (rows >= 0),
  rows_sold       bigint      CHECK (rows_sold >= 0),
  rows_with_start bigint      CHECK (rows_with_start >= 0),
  rows_with_end   bigint      CHECK (rows_with_end >= 0),
  clock_min       timestamptz,
  clock_max       timestamptz,
  population      text        NOT NULL,
  registered_by   text        NOT NULL,
  CONSTRAINT stack_input_support_pkey PRIMARY KEY (measured_at, input_table, source_key)
);
CREATE INDEX IF NOT EXISTS stack_input_support_table_idx ON public.stack_input_support (input_table, measured_at DESC);

CREATE TABLE IF NOT EXISTS public.stack_cohort_depth (
  measured_at   timestamptz NOT NULL,
  source_a      text        NOT NULL,
  source_b      text        NOT NULL,
  min_lots      integer     NOT NULL CHECK (min_lots >= 1),
  cohorts       integer     NOT NULL CHECK (cohorts >= 0),
  lots_a        bigint      NOT NULL CHECK (lots_a >= 0),
  lots_b        bigint      NOT NULL CHECK (lots_b >= 0),
  population    text        NOT NULL,
  registered_by text        NOT NULL,
  CONSTRAINT stack_cohort_depth_pkey PRIMARY KEY (measured_at, source_a, source_b, min_lots),
  CONSTRAINT stack_cohort_depth_order CHECK (source_a <= source_b)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['stack_input_support', 'stack_cohort_depth'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_append_only', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.vein_append_only()',
                   t || '_append_only', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated, service_role', t);
    EXECUTE format('GRANT SELECT ON public.%I TO service_role', t);
  END LOOP;
END $$;

COMMENT ON TABLE public.stack_input_support IS
'Per reading, the rows each stack input table holds per source (grain: measured_at + input_table + source_key). Written only by snapshot_stack_dominoes() (service_role, receipted); append-only (vein_append_only). vehicle_events and auction_events are exact counts; bat_bids and auction_comments are planner estimates (pg_class.reltuples x pg_stats most_common_freqs, values outside the most common list absent). Tables not listed here are not measured per source. Readers: v_stack_dominoes, v_source_dominoes. Clock: measured_at is the transaction clock of the reading.';
COMMENT ON COLUMN public.stack_input_support.measured_at IS 'When the reading was taken (now() of the writer transaction). Unit: timestamptz. Source: snapshot_stack_dominoes(). Grain: one reading. Clock: measurement time.';
COMMENT ON COLUMN public.stack_input_support.input_table IS 'Table in public that stack_needs names as an input (vehicle_events, auction_events, bat_bids, auction_comments). Unit: none (table name). Source: snapshot_stack_dominoes(). Grain: one table per reading. Clock: n/a.';
COMMENT ON COLUMN public.stack_input_support.source_key IS 'Source of the rows: the table''s source column lower-cased with -, _ and spaces removed (mv_source_target_landed rule), e.g. bat, mecum, barrettjackson. Unit: none (key). Source: vehicle_events.source_platform, auction_events.source, bat_bids.source, auction_comments.platform. Grain: one source per table per reading. Clock: n/a.';
COMMENT ON COLUMN public.stack_input_support.basis IS 'count = exact count(*) at measured_at; estimate = planner estimate. Unit: none (enum). Source: snapshot_stack_dominoes(). Grain: one row. Clock: as of measured_at.';
COMMENT ON COLUMN public.stack_input_support.rows IS 'Rows of the table for this source (see basis). Unit: count of table rows. Source: the input table. Grain: one source per table per reading. Clock: as of measured_at.';
COMMENT ON COLUMN public.stack_input_support.rows_sold IS 'Rows with a sold outcome (vehicle_events.event_status = sold; auction_events.outcome = sold); NULL for estimates. Unit: count. Source: the input table. Grain: as rows. Clock: as of measured_at.';
COMMENT ON COLUMN public.stack_input_support.rows_with_start IS 'Rows with a start clock (vehicle_events.started_at; auction_events.auction_start_date); NULL for estimates. Unit: count. Source: the input table. Grain: as rows. Clock: as of measured_at.';
COMMENT ON COLUMN public.stack_input_support.rows_with_end IS 'Rows with an end clock (vehicle_events.ended_at; auction_events.auction_end_date); NULL for estimates. Unit: count. Source: the input table. Grain: as rows. Clock: as of measured_at.';
COMMENT ON COLUMN public.stack_input_support.clock_min IS 'Earliest end clock among the rows (ended_at or auction_end_date); NULL for estimates. Unit: timestamptz. Source: the input table. Grain: as rows. Clock: event clock.';
COMMENT ON COLUMN public.stack_input_support.clock_max IS 'Latest end clock among the rows, including scheduled future ends; NULL for estimates. Unit: timestamptz. Source: the input table. Grain: as rows. Clock: event clock.';
COMMENT ON COLUMN public.stack_input_support.population IS 'What was counted, in words, with the measurement date. Unit: text. Source: snapshot_stack_dominoes(). Grain: one row. Clock: as of measured_at.';
COMMENT ON COLUMN public.stack_input_support.registered_by IS 'Caller of the writer (session, job). Unit: none. Source: p_registered_by. Grain: one reading. Clock: n/a.';

COMMENT ON TABLE public.stack_cohort_depth IS
'Per reading, how deep the shared cohorts of two sources are (grain: measured_at + source_a + source_b + min_lots; source_a <= source_b; source_a = source_b is a source alone). cohorts = (year, make, model) cohorts, string-equal on lower-cased make and model (un-normalized, so an undercount of true cohorts), with at least min_lots sold priced lots on both sources. Population: vehicle_events with event_type auction, event_status sold, final_price > 0, joined to vehicles (deleted_at null) with year, make and model; sources with fewer than 500 such lots are not read. Written only by snapshot_stack_dominoes(); append-only. Reader: v_hypothesis_support. A source pair absent from a reading was not read (unknown), a present row with cohorts = 0 is a measured zero.';
COMMENT ON COLUMN public.stack_cohort_depth.measured_at IS 'When the reading was taken (now() of the writer transaction). Unit: timestamptz. Source: snapshot_stack_dominoes(). Grain: one reading. Clock: measurement time.';
COMMENT ON COLUMN public.stack_cohort_depth.source_a IS 'First source key (alphabetically first of the pair). Unit: none (key). Source: vehicle_events.source_platform normalized. Grain: one source per row. Clock: n/a.';
COMMENT ON COLUMN public.stack_cohort_depth.source_b IS 'Second source key; equal to source_a for a source alone. Unit: none (key). Source: vehicle_events.source_platform normalized. Grain: one source per row. Clock: n/a.';
COMMENT ON COLUMN public.stack_cohort_depth.min_lots IS 'Minimum sold priced lots a cohort needs on each source to count (1, 3, 5, 10, 20, 50, 60). Unit: lots. Source: snapshot_stack_dominoes(). Grain: one threshold per pair. Clock: n/a.';
COMMENT ON COLUMN public.stack_cohort_depth.cohorts IS 'Cohorts meeting min_lots on both sources. Unit: count of (year, make, model) cohorts. Source: vehicle_events joined to vehicles. Grain: one pair and threshold per reading. Clock: as of measured_at.';
COMMENT ON COLUMN public.stack_cohort_depth.lots_a IS 'Sold priced lots of source_a inside those cohorts. Unit: count of vehicle_events rows. Source: vehicle_events. Grain: as cohorts. Clock: as of measured_at.';
COMMENT ON COLUMN public.stack_cohort_depth.lots_b IS 'Sold priced lots of source_b inside those cohorts. Unit: count of vehicle_events rows. Source: vehicle_events. Grain: as cohorts. Clock: as of measured_at.';
COMMENT ON COLUMN public.stack_cohort_depth.population IS 'What was counted, in words, with the measurement date. Unit: text. Source: snapshot_stack_dominoes(). Grain: one row. Clock: as of measured_at.';
COMMENT ON COLUMN public.stack_cohort_depth.registered_by IS 'Caller of the writer (session, job). Unit: none. Source: p_registered_by. Grain: one reading. Clock: n/a.';

-- 2. The writer -------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.snapshot_stack_dominoes(p_registered_by text DEFAULT 'snapshot_stack_dominoes')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c_writer      constant text := 'snapshot_stack_dominoes';
  c_min_sold    constant integer := 500;
  v_prev_writer text := current_setting('app.writer', true);
  v_at          timestamptz := now();
  v_started     timestamptz := clock_timestamp();
  v_inputs      integer := 0;
  v_n           integer;
  v_depth       integer := 0;
  v_failed      jsonb := '[]'::jsonb;
  r             record;
BEGIN
  IF coalesce(btrim(p_registered_by), '') = '' THEN
    RAISE EXCEPTION 'snapshot_stack_dominoes: p_registered_by must name the caller' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  PERFORM set_config('app.writer', c_writer, true);

  -- Inputs: exact counts per source on the two lot tables.
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

  -- Inputs: planner estimates on the two tables too large to scan daily.
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

  -- Cohorts: sold priced lots per source and (year, make, model). One statement per raw source_platform so a timeout
  -- on one source is reported and the others still land.
  DROP TABLE IF EXISTS _cohort, _c;
  CREATE TEMP TABLE _cohort (src text, y integer, mk text, md text, n integer) ON COMMIT DROP;
  FOR r IN
    SELECT source_platform AS raw, regexp_replace(lower(source_platform), '[-_ ]', '', 'g') AS nk
    FROM public.vehicle_events
    WHERE source_platform IS NOT NULL AND event_type = 'auction' AND event_status = 'sold' AND final_price > 0
    GROUP BY source_platform
    HAVING count(*) >= c_min_sold
  LOOP
    BEGIN
      INSERT INTO _cohort
      SELECT r.nk, v.year, lower(btrim(v.make)), lower(btrim(v.model)), count(*)
      FROM public.vehicle_events ve
      JOIN public.vehicles v ON v.id = ve.vehicle_id
      WHERE ve.source_platform = r.raw AND ve.event_type = 'auction' AND ve.event_status = 'sold' AND ve.final_price > 0
        AND v.deleted_at IS NULL AND v.year BETWEEN 1885 AND 2100
        AND coalesce(btrim(v.make), '') <> '' AND coalesce(btrim(v.model), '') <> ''
      GROUP BY 1, 2, 3, 4;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed || jsonb_build_object('source_platform', r.raw, 'sqlstate', SQLSTATE, 'error', left(SQLERRM, 120));
    END;
  END LOOP;

  -- Several raw platform spellings can share a key; fold them.
  CREATE TEMP TABLE _c ON COMMIT DROP AS SELECT src, y, mk, md, sum(n)::integer AS n FROM _cohort GROUP BY 1, 2, 3, 4;

  INSERT INTO public.stack_cohort_depth
    (measured_at, source_a, source_b, min_lots, cohorts, lots_a, lots_b, population, registered_by)
  SELECT v_at, p.sa, p.sb, k.n, coalesce(x.cohorts, 0), coalesce(x.la, 0), coalesce(x.lb, 0),
         'vehicle_events (event_type auction, event_status sold, final_price > 0) joined to vehicles (deleted_at null, year, make, model present); cohort = year + lower make + lower model; sources with >= '
           || c_min_sold || ' such lots; read ' || to_char(v_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"'),
         p_registered_by
  FROM (SELECT a.src AS sa, b.src AS sb
        FROM (SELECT DISTINCT src FROM _c) a JOIN (SELECT DISTINCT src FROM _c) b ON a.src <= b.src) p
  CROSS JOIN (VALUES (1), (3), (5), (10), (20), (50), (60)) AS k(n)
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS cohorts, sum(a.n) AS la, sum(b.n) AS lb
    FROM _c a JOIN _c b ON b.src = p.sb AND b.y = a.y AND b.mk = a.mk AND b.md = a.md
    WHERE a.src = p.sa AND a.n >= k.n AND b.n >= k.n) x ON true
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_depth = ROW_COUNT;

  IF v_inputs > 0 THEN
    INSERT INTO public.write_receipts (tbl, op, rows, writer, db_role, app_name, txid)
    VALUES ('stack_input_support', 'INSERT', v_inputs, c_writer, current_user, current_setting('application_name', true), txid_current());
  END IF;
  IF v_depth > 0 THEN
    INSERT INTO public.write_receipts (tbl, op, rows, writer, db_role, app_name, txid)
    VALUES ('stack_cohort_depth', 'INSERT', v_depth, c_writer, current_user, current_setting('application_name', true), txid_current());
  END IF;

  PERFORM set_config('app.writer', coalesce(v_prev_writer, ''), true);
  RETURN jsonb_build_object('input_rows', v_inputs, 'depth_rows', v_depth, 'failed_sources', v_failed, 'measured_at', v_at,
                            'ms', round(extract(epoch FROM clock_timestamp() - v_started) * 1000));
END
$$;
REVOKE ALL ON FUNCTION public.snapshot_stack_dominoes(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.snapshot_stack_dominoes(text) TO service_role;
COMMENT ON FUNCTION public.snapshot_stack_dominoes(text) IS
'Sanctioned writer of stack_input_support and stack_cohort_depth: one reading per call at the transaction clock, ON CONFLICT DO NOTHING, one write_receipts row per table written, app.writer set and restored. A source whose cohort query fails is listed in failed_sources and absent from that reading (unknown, not zero). SECURITY DEFINER, EXECUTE for service_role only. Run daily by cron job snapshot-stack-dominoes with statement_timeout 300s.';

-- 3. Readers ----------------------------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_stack_dominoes AS
WITH snap AS (
  SELECT max(measured_at) AS m FROM public.stack_coverage_snapshots
), needs AS (
  SELECT s.stack_id, s.version, s.coverage, s.measured_at, n.value AS need, n.ordinality AS ord
  FROM public.stack_coverage_snapshots s
  JOIN snap ON s.measured_at = snap.m
  CROSS JOIN LATERAL jsonb_array_elements(s.needs) WITH ORDINALITY AS n(value, ordinality)
), lot_tables(input_table) AS (
  VALUES ('vehicle_events'), ('auction_events'), ('vehicles'), ('vehicle_observations'), ('vehicle_images'),
         ('timeline_events'), ('vehicle_price_history'), ('vehicle_location_observations'), ('ownership_transfers')
), latest AS (
  SELECT DISTINCT ON (input_table) input_table, measured_at FROM public.stack_input_support ORDER BY input_table, measured_at DESC
), feeds AS (
  SELECT i.input_table,
         jsonb_agg(jsonb_build_object('source_key', i.source_key, 'rows', i.rows, 'rows_sold', i.rows_sold, 'basis', i.basis,
                                      'clock_max', i.clock_max, 'population', i.population, 'measured_at', i.measured_at)
                   ORDER BY i.rows DESC) AS sources,
         array_agg(i.source_key ORDER BY i.rows DESC) FILTER (WHERE i.rows > 0) AS keys,
         bool_and(i.basis = 'count') AS exact
  FROM public.stack_input_support i JOIN latest l USING (input_table, measured_at)
  GROUP BY i.input_table
)
SELECT st.stack_id, st.version, k.name, st.coverage AS stack_coverage, st.measured_at AS coverage_measured_at,
       st.need ->> 'layer' AS layer, st.need ->> 'kind' AS kind, st.need ->> 'object' AS object,
       CASE WHEN st.need ->> 'kind' IN ('table', 'column', 'intake') THEN split_part(st.need ->> 'object', '.', 1) END AS input_table,
       st.need ->> 'verdict' AS verdict, st.need ->> 'evidence' AS evidence,
       CASE WHEN f.input_table IS NOT NULL AND f.exact THEN 'measured'
            WHEN f.input_table IS NOT NULL THEN 'estimate'
            WHEN lt.input_table IS NOT NULL THEN 'any_lot_source_unmeasured'
            ELSE 'none' END AS feed_basis,
       coalesce(f.sources, '[]'::jsonb) AS feeding_sources,
       CASE WHEN f.input_table IS NOT NULL THEN coalesce(f.keys, ARRAY[]::text[])
            WHEN lt.input_table IS NOT NULL THEN (SELECT coalesce(array_agg(DISTINCT regexp_replace(lower(c.source_slug), '[-_ ]', '', 'g')), ARRAY[]::text[])
                                                  FROM public.source_target_coverage c)
            ELSE ARRAY[]::text[] END AS moves_with,
       (st.need ->> 'kind' IN ('table', 'column', 'intake') AND st.need ->> 'verdict' <> 'present'
         AND (f.input_table IS NOT NULL OR lt.input_table IS NOT NULL)) AS verdict_can_change_with_lots
FROM needs st
JOIN public.stacks k ON k.stack_id = st.stack_id AND k.version = st.version
LEFT JOIN feeds f ON f.input_table = split_part(st.need ->> 'object', '.', 1) AND st.need ->> 'kind' IN ('table', 'column', 'intake')
LEFT JOIN lot_tables lt ON lt.input_table = split_part(st.need ->> 'object', '.', 1) AND st.need ->> 'kind' IN ('table', 'column', 'intake')
ORDER BY st.stack_id, st.ord;
REVOKE ALL ON public.v_stack_dominoes FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.v_stack_dominoes TO service_role;
COMMENT ON VIEW public.v_stack_dominoes IS
'One row per need of each stack (version of the latest stack_coverage_snapshots reading, coverage_measured_at): layer, kind, object, verdict and evidence from that reading; feeding_sources = per-source rows, sold rows, newest end clock, basis and population from the latest stack_input_support reading of the input table; feed_basis = measured (exact counts) / estimate / any_lot_source_unmeasured (a table every landed lot feeds, per-source rows not measured) / none (no lot source feeds it: an abstract layer or a non-auction input); moves_with = source keys whose landing more lots grows the input; verdict_can_change_with_lots = a table, column or intake need not yet present that a lot source feeds. Structural verdicts only (an object exists with rows, a column is filled); support is not a modeling result. service_role reads.';

CREATE OR REPLACE VIEW public.v_source_dominoes AS
SELECT c.source_slug, c.total_targets, c.landed, c.gap AS targets_not_in_queue, c.landed_pct, c.landed_measured_at,
       d.stack_id, d.name AS stack_name, d.layer, d.kind, d.object, d.verdict, d.verdict_can_change_with_lots,
       d.feed_basis,
       (SELECT (s ->> 'rows')::bigint FROM jsonb_array_elements(d.feeding_sources) s
         WHERE s ->> 'source_key' = regexp_replace(lower(c.source_slug), '[-_ ]', '', 'g')) AS source_rows_in_input,
       d.coverage_measured_at
FROM public.source_target_coverage c
JOIN public.v_stack_dominoes d ON regexp_replace(lower(c.source_slug), '[-_ ]', '', 'g') = ANY (d.moves_with)
ORDER BY c.source_slug, d.stack_id;
REVOKE ALL ON public.v_source_dominoes FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.v_source_dominoes TO service_role;
COMMENT ON VIEW public.v_source_dominoes IS
'The domino map from a source: for each source in source_target_coverage (targets, landed, landed_measured_at) every stack input that source feeds (v_stack_dominoes.moves_with), with the source''s rows in that input where measured and whether the verdict can change with more lots. service_role reads.';

CREATE OR REPLACE VIEW public.v_hypothesis_support AS
WITH h AS (
  SELECT DISTINCT ON (vein_id) vein_id, version, hypothesis, parameters
  FROM public.vein_ledger
  WHERE parameters ? 'support' AND status = 'active'
  ORDER BY vein_id, version DESC
), req AS (
  SELECT h.vein_id, h.version, h.hypothesis, r.value AS r, r.ordinality AS ord FROM h
  CROSS JOIN LATERAL jsonb_array_elements(h.parameters -> 'support') WITH ORDINALITY AS r(value, ordinality)
), depth AS (
  SELECT DISTINCT ON (source_a, source_b, min_lots) * FROM public.stack_cohort_depth ORDER BY source_a, source_b, min_lots, measured_at DESC
), snap AS (
  SELECT max(measured_at) AS m FROM public.stack_coverage_snapshots
), ev AS (
  SELECT req.*, d.cohorts AS d_cohorts, d.lots_a, d.lots_b, d.measured_at AS d_at, d.population AS d_pop,
         cs.coverage, cs.measured_at AS c_at
  FROM req
  LEFT JOIN depth d ON req.r ->> 'kind' = 'cohort_pair'
    AND d.source_a = least(req.r ->> 'source_a', req.r ->> 'source_b')
    AND d.source_b = greatest(req.r ->> 'source_a', req.r ->> 'source_b')
    AND d.min_lots = (req.r ->> 'min_lots')::integer
  LEFT JOIN public.stack_coverage_snapshots cs ON req.r ->> 'kind' = 'stack_coverage'
    AND cs.stack_id = req.r ->> 'stack_id' AND cs.measured_at = (SELECT m FROM snap)
), out AS (
  SELECT vein_id, version, hypothesis, ord, r ->> 'kind' AS kind, r AS requirement,
         CASE r ->> 'kind' WHEN 'cohort_pair' THEN d_cohorts::numeric WHEN 'stack_coverage' THEN coverage END AS current_value,
         CASE r ->> 'kind' WHEN 'cohort_pair' THEN (r ->> 'min_cohorts')::numeric WHEN 'stack_coverage' THEN (r ->> 'min_coverage')::numeric END AS needed_value,
         CASE r ->> 'kind' WHEN 'cohort_pair' THEN d_at WHEN 'stack_coverage' THEN c_at END AS measured_at,
         CASE r ->> 'kind' WHEN 'cohort_pair' THEN d_pop WHEN 'stack_coverage' THEN 'stack_coverage_snapshots: needs present / needs (structural)' END AS population,
         lots_a, lots_b
  FROM ev
)
SELECT vein_id, version, hypothesis, ord AS requirement_no, kind, requirement, current_value, needed_value,
       (current_value >= needed_value) AS met, measured_at, population, lots_a, lots_b,
       CASE WHEN bool_or(current_value IS NULL) OVER w THEN NULL
            ELSE bool_and(current_value >= needed_value) OVER w END AS hypothesis_testable
FROM out
WINDOW w AS (PARTITION BY vein_id, version)
ORDER BY vein_id, ord;
REVOKE ALL ON public.v_hypothesis_support FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.v_hypothesis_support TO service_role;
COMMENT ON VIEW public.v_hypothesis_support IS
'Registered hypotheses (vein_ledger rows with parameters.support, status active, latest version) against the latest readings: one row per requirement with current_value, needed_value, met, measured_at and population. cohort_pair reads stack_cohort_depth (cohorts with >= min_lots sold priced lots on both sources vs min_cohorts); stack_coverage reads stack_coverage_snapshots (structural coverage vs min_coverage). hypothesis_testable is true when every requirement is met, false when one is not, NULL (unknown) when a requirement has no reading. Thresholds are the registrant''s choices recorded before counting, not derived. service_role reads.';

-- 4. Registry rows ----------------------------------------------------------------------------------------------------
INSERT INTO public.pipeline_registry (table_name, column_name, owned_by, description, do_not_write_directly, write_via)
SELECT x.t, NULL, 'snapshot_stack_dominoes', x.d, true,
       'snapshot_stack_dominoes(text) only (SECURITY DEFINER, service_role; one call per reading; write_receipts); cron job snapshot-stack-dominoes daily. Migration 20261015034500.'
FROM (VALUES
  ('stack_input_support', 'Per reading, rows per stack input table and source (exact for the lot tables, planner estimate for bat_bids and auction_comments); append-only.'),
  ('stack_cohort_depth', 'Per reading, shared (year, make, model) cohorts per source pair and minimum lot count; append-only.')) AS x(t, d)
WHERE NOT EXISTS (SELECT 1 FROM public.pipeline_registry p WHERE p.table_name = x.t AND p.column_name IS NULL);

-- 5. The first hypotheses (registered before any cohort is counted) ---------------------------------------------------
-- Common to V014-V017: spread d = ln(median hammer on B) - ln(median hammer on A) over the cohort's sold priced lots
-- (vehicle_events, event_type auction, event_status sold, final_price > 0), cohorts with >= 10 lots on each source.
-- Pass: >= 30 qualifying cohorts, a 95% bootstrap interval over cohorts for the median d that excludes 0, and the same
-- sign in >= 65% of cohorts. Refuted: >= 30 cohorts and the interval contains 0 with |median d| < 0.05. Otherwise
-- inconclusive. Raw spread only; mileage and condition are not held, so a pass says venues price differently, not why.
-- The thresholds are the registrant's choices, recorded before counting.
INSERT INTO public.vein_ledger (vein_id, version, family, hypothesis, intent, population, outcome, test, pass_rule, baseline, parameters, case_ref, registered_by)
SELECT x.vein_id, 1, 'stack_inference', x.hypothesis,
  'Owner, 2026-10-14: recognize the stacks of the data model and the inference data that takes shape with growth; the more data, the more hypotheses, recursively.',
  x.population, x.outcome, x.test, x.pass_rule, x.baseline, x.parameters, '13.1', 'claude-code lane-stacks (session skylar-f7 subagent) for the owner'
FROM (VALUES
  ('V014',
   'For the same year, make and model, the median hammer price on Mecum differs from the median on BaT, with the same sign in most cohorts.',
   '(year, make, model) cohorts with >= 10 sold priced lots on each of BaT and Mecum (vehicle_events, event_type auction, event_status sold, final_price > 0).',
   'd = ln(median Mecum hammer) - ln(median BaT hammer) per cohort; the median of d across cohorts.',
   'Per cohort, d from the two medians; bootstrap the median of d over cohorts (2,000 resamples); count the share of cohorts with d > 0.',
   'pass: >= 30 cohorts, 95% interval of median d excludes 0, same sign in >= 65% of cohorts. refuted: >= 30 cohorts, interval contains 0 and |median d| < 0.05. Otherwise inconclusive.',
   'd = 0: the two venues price the same year, make and model alike.',
   '{"stacks":["S01","S02","S18"],"support":[{"kind":"cohort_pair","source_a":"bat","source_b":"mecum","min_lots":10,"min_cohorts":30}]}'::jsonb),
  ('V015',
   'For the same year, make and model, the median hammer price on Barrett-Jackson differs from the median on BaT, with the same sign in most cohorts.',
   '(year, make, model) cohorts with >= 10 sold priced lots on each of BaT and Barrett-Jackson (vehicle_events, event_type auction, event_status sold, final_price > 0).',
   'd = ln(median Barrett-Jackson hammer) - ln(median BaT hammer) per cohort; the median of d across cohorts.',
   'As V014 with Barrett-Jackson in place of Mecum.',
   'As V014.',
   'd = 0.',
   '{"stacks":["S01","S02","S18"],"support":[{"kind":"cohort_pair","source_a":"bat","source_b":"barrettjackson","min_lots":10,"min_cohorts":30}]}'::jsonb),
  ('V016',
   'For the same year, make and model, the median hammer price on Bonhams differs from the median on BaT, with the same sign in most cohorts.',
   '(year, make, model) cohorts with >= 10 sold priced lots on each of BaT and Bonhams (vehicle_events, event_type auction, event_status sold, final_price > 0).',
   'd = ln(median Bonhams hammer) - ln(median BaT hammer) per cohort; the median of d across cohorts.',
   'As V014 with Bonhams in place of Mecum. Bonhams lots may carry a buyer''s premium or not by lot; the unit of final_price is checked per source before the run.',
   'As V014.',
   'd = 0.',
   '{"stacks":["S01","S02","S18"],"support":[{"kind":"cohort_pair","source_a":"bat","source_b":"bonhams","min_lots":10,"min_cohorts":30}]}'::jsonb),
  ('V017',
   'Stage auctions agree more with each other than with the online venue: the absolute spread between Mecum and Barrett-Jackson is smaller than either one''s spread against BaT.',
   '(year, make, model) cohorts with >= 10 sold priced lots on each of BaT, Mecum and Barrett-Jackson (vehicle_events, event_type auction, event_status sold, final_price > 0).',
   'Median over cohorts of |d(Mecum, Barrett-Jackson)| against the medians of |d(BaT, Mecum)| and |d(BaT, Barrett-Jackson)|, d as in V014.',
   'Per cohort three pairwise |d|; paired Wilcoxon signed-rank on |d(Mecum, BJ)| minus each BaT-pair |d|.',
   'pass: >= 30 three-way cohorts, both paired differences negative with p < 0.01. refuted: either median difference >= 0 with >= 30 cohorts. Otherwise inconclusive. The three-way cohort count is checked at the run; the support rule below is the pairwise depth.',
   '|d| equal across the three pairs.',
   '{"stacks":["S01","S02","S18"],"support":[{"kind":"cohort_pair","source_a":"bat","source_b":"mecum","min_lots":10,"min_cohorts":30},{"kind":"cohort_pair","source_a":"bat","source_b":"barrettjackson","min_lots":10,"min_cohorts":30},{"kind":"cohort_pair","source_a":"barrettjackson","source_b":"mecum","min_lots":10,"min_cohorts":30}]}'::jsonb),
  ('V018',
   'Within a model cohort the month a BaT lot closes explains hammer price beyond year and cohort level: a seasonal effect exists.',
   '(year, make, model) cohorts with >= 60 sold priced BaT lots (vehicle_events, event_type auction, event_status sold, final_price > 0).',
   'Per cohort, ln(hammer) on year and calendar month of ended_at; the pooled joint F test of the month terms with cohort fixed effects.',
   'Pooled regression across qualifying cohorts, month dummies against year and cohort fixed effects; split-half check of the sign of each month term (odd and even years).',
   'pass: >= 20 cohorts, joint month F p < 0.01, and the sign of the largest month term the same in both halves. refuted: p > 0.20 with >= 20 cohorts. Otherwise inconclusive.',
   'No month effect: the month terms are jointly zero.',
   '{"stacks":["S18","S10"],"support":[{"kind":"cohort_pair","source_a":"bat","source_b":"bat","min_lots":60,"min_cohorts":20}]}'::jsonb),
  ('V019',
   'Lots where commenters flag a defect the seller did not state close below their cohort baseline, and the gap grows with the number of distinct commenters who flag it.',
   'BaT lots with comments folded into attributed claims (the text fold), settled, with a sale residual against the cohort baseline as of the sale date.',
   'Sale residual (ln hammer minus the cohort baseline as of sale date) against distinct commenters flagging an unstated defect.',
   'Spearman rank correlation of the residual with the flag count, then a cohort-fixed-effects regression.',
   'pass: Spearman < 0 with p < 0.01 and the regression slope negative in >= 70% of cohorts with >= 20 flagged lots. refuted: slope >= 0 with p < 0.20. Otherwise inconclusive. Not runnable until the text fold exists (stack S05 coverage 1.0).',
   'Residual unrelated to the flag count (rho = 0).',
   '{"stacks":["S05","S19","S04"],"support":[{"kind":"stack_coverage","stack_id":"S05","min_coverage":1.0}]}'::jsonb)
) AS x(vein_id, hypothesis, population, outcome, test, pass_rule, baseline, parameters)
WHERE NOT EXISTS (SELECT 1 FROM public.vein_ledger l WHERE l.vein_id = x.vein_id);

-- 6. Schedule ---------------------------------------------------------------------------------------------------------
SELECT cron.schedule('snapshot-stack-dominoes', '25 4 * * *',
  $c$SET statement_timeout = '300s'; SELECT public.snapshot_stack_coverage('cron:snapshot-stack-dominoes'); SELECT public.snapshot_stack_dominoes('cron:snapshot-stack-dominoes');$c$);

COMMIT;
