-- Follow-up to 20261015060000. MEASURED 2026-10-15 01:19Z to 01:23Z on prod: the job's cohort reads timed out at 120 s on
-- two cold runs and finished all nine sources in 8 s on a warm one (cron.job_run_details; the log did not say which source).
-- 1. snapshot_stack_dominoes_read(raw, from, to) reads one source over an ended_at band (from inclusive, to exclusive, NULL
--    unbounded; rows with no ended_at only when from IS NULL and to is NULL or -infinity), so BaT, 280,683 rows, can be read
--    as five statements. A statement cancelled by the timeout is tried once more (the second try normally runs warm); each
--    try is logged in a session temp table and returned by finish. A second cancel re-raises.
--    Medians need the whole cohort, so the read keeps each cohort's prices as an array and finish takes the median over the
--    bands together.
-- 2. stack_cohort_prices: per reading, per source and cohort with >= 10 sold priced lots, the lot count and median hammer.
--    This is the input the cross-venue tests (V014 to V018) read; written only by finish.
-- 3. The job reads BaT in five bands; every other source is one statement.
-- 4. A one-off job runs the whole command once at 02:05 UTC on 2026-10-15 (cron expression pinned to that date, so a
--    failure cannot repeat it) and unschedules itself as its last statement.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.stack_cohort_prices (
  measured_at   timestamptz NOT NULL,
  source_key    text        NOT NULL,
  year          integer     NOT NULL,
  make          text        NOT NULL,
  model         text        NOT NULL,
  lots          integer     NOT NULL CHECK (lots >= 10),
  median_price  numeric     NOT NULL CHECK (median_price > 0),
  population    text        NOT NULL,
  registered_by text        NOT NULL,
  CONSTRAINT stack_cohort_prices_pkey PRIMARY KEY (measured_at, source_key, year, make, model)
);
DROP TRIGGER IF EXISTS stack_cohort_prices_append_only ON public.stack_cohort_prices;
CREATE TRIGGER stack_cohort_prices_append_only BEFORE UPDATE OR DELETE ON public.stack_cohort_prices
  FOR EACH ROW EXECUTE FUNCTION public.vein_append_only();
ALTER TABLE public.stack_cohort_prices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stack_cohort_prices FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.stack_cohort_prices TO service_role;
COMMENT ON TABLE public.stack_cohort_prices IS
'Per reading, the median hammer of each (year, make, model) cohort with at least 10 sold priced lots on a source (grain: measured_at + source_key + year + make + model). Cohort = year + lower make + lower model (string-equal, un-normalized); lots = vehicle_events (event_type auction, event_status sold, final_price > 0) joined to vehicles (deleted_at null); median_price = percentile_cont(0.5) of final_price in the unit the source reports (buyer''s premium treatment differs by source and is not adjusted). Written only by snapshot_stack_dominoes_finish(); append-only. Input of the cross-venue hypotheses V014 to V018. Clock: measured_at is the transaction clock of the reading.';
COMMENT ON COLUMN public.stack_cohort_prices.measured_at IS 'When the reading was taken (the reading''s begin clock). Unit: timestamptz. Source: snapshot_stack_dominoes_begin(). Grain: one reading. Clock: measurement time.';
COMMENT ON COLUMN public.stack_cohort_prices.source_key IS 'Source key (source_platform lower-cased, -, _ and spaces removed). Unit: none (key). Source: vehicle_events.source_platform. Grain: one source per cohort. Clock: n/a.';
COMMENT ON COLUMN public.stack_cohort_prices.year IS 'Model year of the cohort. Unit: year. Source: vehicles.year. Grain: one cohort. Clock: n/a.';
COMMENT ON COLUMN public.stack_cohort_prices.make IS 'Lower-cased trimmed make of the cohort. Unit: text. Source: vehicles.make. Grain: one cohort. Clock: n/a.';
COMMENT ON COLUMN public.stack_cohort_prices.model IS 'Lower-cased trimmed model of the cohort. Unit: text. Source: vehicles.model. Grain: one cohort. Clock: n/a.';
COMMENT ON COLUMN public.stack_cohort_prices.lots IS 'Sold priced lots of the source in the cohort (>= 10 by CHECK). Unit: count of vehicle_events rows. Source: vehicle_events. Grain: one cohort. Clock: as of measured_at.';
COMMENT ON COLUMN public.stack_cohort_prices.median_price IS 'Median final_price of those lots. Unit: currency units as reported by the source (not converted). Source: vehicle_events.final_price. Grain: one cohort. Clock: as of measured_at.';
COMMENT ON COLUMN public.stack_cohort_prices.population IS 'What was counted, in words, with the sources read and the date. Unit: text. Source: snapshot_stack_dominoes_finish(). Grain: one row. Clock: as of measured_at.';
COMMENT ON COLUMN public.stack_cohort_prices.registered_by IS 'Caller of begin (session, job). Unit: none. Source: p_registered_by. Grain: one reading. Clock: n/a.';

INSERT INTO public.pipeline_registry (table_name, column_name, owned_by, description, do_not_write_directly, write_via)
SELECT 'stack_cohort_prices', NULL, 'snapshot_stack_dominoes',
       'Per reading, median hammer of each cohort with >= 10 sold priced lots on a source; append-only; input of V014 to V018.',
       true, 'snapshot_stack_dominoes_finish() only (SECURITY DEFINER, service_role; write_receipts); cron job snapshot-stack-dominoes daily. Migration 20261015063000.'
WHERE NOT EXISTS (SELECT 1 FROM public.pipeline_registry p WHERE p.table_name = 'stack_cohort_prices' AND p.column_name IS NULL);

-- begin: also opens the try log.
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

  DROP TABLE IF EXISTS pg_temp._dom_cohort, pg_temp._dom_run, pg_temp._dom_log;
  CREATE TEMP TABLE _dom_cohort (src text, y integer, mk text, md text, prices numeric[]);
  CREATE TEMP TABLE _dom_log (src text, band_from timestamptz, band_to timestamptz, try integer, outcome text, cohorts integer, ms integer);
  CREATE TEMP TABLE _dom_run AS SELECT v_at AS at, p_registered_by AS by, clock_timestamp() AS started;

  PERFORM set_config('app.writer', coalesce(v_prev_writer, ''), true);
  RETURN jsonb_build_object('input_rows', v_inputs, 'measured_at', v_at);
END
$$;

DROP FUNCTION IF EXISTS public.snapshot_stack_dominoes_read(text);
CREATE OR REPLACE FUNCTION public.snapshot_stack_dominoes_read(p_raw_platform text, p_from timestamptz DEFAULT NULL, p_to timestamptz DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_src     text := regexp_replace(lower(p_raw_platform), '[-_ ]', '', 'g');
  v_nulls   boolean := p_from IS NULL AND (p_to IS NULL OR p_to = '-infinity');
  v_started timestamptz;
  v_n       integer;
  v_try     integer;
BEGIN
  IF to_regclass('pg_temp._dom_run') IS NULL THEN
    RAISE EXCEPTION 'snapshot_stack_dominoes_read: call snapshot_stack_dominoes_begin first in this session' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  FOR v_try IN 1..2 LOOP
    v_started := clock_timestamp();
    BEGIN
      INSERT INTO pg_temp._dom_cohort
      SELECT v_src, v.year, lower(btrim(v.make)), lower(btrim(v.model)), array_agg(ve.final_price)
      FROM public.vehicle_events ve
      JOIN public.vehicles v ON v.id = ve.vehicle_id
      WHERE ve.source_platform = p_raw_platform AND ve.event_type = 'auction' AND ve.event_status = 'sold' AND ve.final_price > 0
        AND ((ve.ended_at IS NULL AND v_nulls)
             OR (ve.ended_at IS NOT NULL AND (p_from IS NULL OR ve.ended_at >= p_from) AND (p_to IS NULL OR ve.ended_at < p_to)))
        AND v.deleted_at IS NULL AND v.year BETWEEN 1885 AND 2100
        AND coalesce(btrim(v.make), '') <> '' AND coalesce(btrim(v.model), '') <> ''
      GROUP BY 2, 3, 4;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      INSERT INTO pg_temp._dom_log VALUES (v_src, p_from, p_to, v_try, 'ok', v_n, round(extract(epoch FROM clock_timestamp() - v_started) * 1000));
      RETURN jsonb_build_object('source_platform', p_raw_platform, 'cohorts', v_n, 'try', v_try,
                                'ms', round(extract(epoch FROM clock_timestamp() - v_started) * 1000));
    EXCEPTION WHEN query_canceled THEN
      INSERT INTO pg_temp._dom_log VALUES (v_src, p_from, p_to, v_try, 'cancelled', NULL, round(extract(epoch FROM clock_timestamp() - v_started) * 1000));
      IF v_try = 2 THEN RAISE; END IF;
    END;
  END LOOP;
  RETURN NULL;
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
  v_prices      integer := 0;
  v_sources     text;
  v_log         jsonb;
  v_pop         text;
BEGIN
  IF to_regclass('pg_temp._dom_run') IS NULL THEN
    RAISE EXCEPTION 'snapshot_stack_dominoes_finish: call snapshot_stack_dominoes_begin first in this session' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  SELECT at, by, started INTO v_at, v_by, v_started FROM pg_temp._dom_run;
  PERFORM set_config('app.writer', c_writer, true);

  CREATE TEMP TABLE _p ON COMMIT DROP AS
    SELECT c.src, c.y, c.mk, c.md, x.price FROM pg_temp._dom_cohort c CROSS JOIN LATERAL unnest(c.prices) AS x(price);
  CREATE TEMP TABLE _c ON COMMIT DROP AS
    SELECT src, y, mk, md, count(*)::integer AS n, percentile_cont(0.5) WITHIN GROUP (ORDER BY price) AS med FROM _p GROUP BY 1, 2, 3, 4;
  SELECT string_agg(DISTINCT src, ', ' ORDER BY src) INTO v_sources FROM _c;
  v_pop := 'vehicle_events (event_type auction, event_status sold, final_price > 0) joined to vehicles (deleted_at null, year, make, model present); cohort = year + lower make + lower model; sources read in this reading: '
           || coalesce(v_sources, 'none') || '; read ' || to_char(v_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"');

  INSERT INTO public.stack_cohort_depth
    (measured_at, source_a, source_b, min_lots, cohorts, lots_a, lots_b, population, registered_by)
  SELECT v_at, p.sa, p.sb, k.n, coalesce(x.cohorts, 0), coalesce(x.la, 0), coalesce(x.lb, 0), v_pop, v_by
  FROM (SELECT a.src AS sa, b.src AS sb
        FROM (SELECT DISTINCT src FROM _c) a JOIN (SELECT DISTINCT src FROM _c) b ON a.src <= b.src) p
  CROSS JOIN (VALUES (1), (3), (5), (10), (20), (50), (60)) AS k(n)
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS cohorts, sum(a.n) AS la, sum(b.n) AS lb
    FROM _c a JOIN _c b ON b.src = p.sb AND b.y = a.y AND b.mk = a.mk AND b.md = a.md
    WHERE a.src = p.sa AND a.n >= k.n AND b.n >= k.n) x ON true
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_depth = ROW_COUNT;

  INSERT INTO public.stack_cohort_prices (measured_at, source_key, year, make, model, lots, median_price, population, registered_by)
  SELECT v_at, src, y, mk, md, n, med, v_pop, v_by FROM _c WHERE n >= 10 AND med > 0
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_prices = ROW_COUNT;

  IF v_depth > 0 THEN
    INSERT INTO public.write_receipts (tbl, op, rows, writer, db_role, app_name, txid)
    VALUES ('stack_cohort_depth', 'INSERT', v_depth, c_writer, current_user, current_setting('application_name', true), txid_current());
  END IF;
  IF v_prices > 0 THEN
    INSERT INTO public.write_receipts (tbl, op, rows, writer, db_role, app_name, txid)
    VALUES ('stack_cohort_prices', 'INSERT', v_prices, c_writer, current_user, current_setting('application_name', true), txid_current());
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.src, l.band_from NULLS FIRST, l.try), '[]'::jsonb) INTO v_log FROM pg_temp._dom_log l;
  DROP TABLE pg_temp._dom_cohort, pg_temp._dom_run, pg_temp._dom_log;
  PERFORM set_config('app.writer', coalesce(v_prev_writer, ''), true);
  RETURN jsonb_build_object('depth_rows', v_depth, 'price_rows', v_prices, 'sources_read', v_sources, 'reads', v_log,
                            'measured_at', v_at, 'ms', round(extract(epoch FROM clock_timestamp() - v_started) * 1000));
END
$$;

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

REVOKE ALL ON FUNCTION public.snapshot_stack_dominoes_begin(text), public.snapshot_stack_dominoes_read(text, timestamptz, timestamptz),
  public.snapshot_stack_dominoes_finish(), public.snapshot_stack_dominoes(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.snapshot_stack_dominoes_begin(text), public.snapshot_stack_dominoes_read(text, timestamptz, timestamptz),
  public.snapshot_stack_dominoes_finish(), public.snapshot_stack_dominoes(text) TO service_role;
COMMENT ON FUNCTION public.snapshot_stack_dominoes_read(text, timestamptz, timestamptz) IS 'Stage 2: reads one source''s cohorts (sold priced vehicle_events joined to vehicles) into the session temp table, optionally over an ended_at band (from inclusive, to exclusive, NULL unbounded; rows without ended_at only when from IS NULL and to is NULL or -infinity). A cancelled statement is tried once more; every try is logged for finish. p_raw_platform is the raw vehicle_events.source_platform spelling. service_role only.';
COMMENT ON FUNCTION public.snapshot_stack_dominoes_finish() IS 'Stage 3: writes stack_cohort_depth and stack_cohort_prices for the sources read (a source not read is absent, unknown), receipts them, closes the reading and returns {depth_rows, price_rows, sources_read, reads (every try with outcome and ms), measured_at, ms}. service_role only.';

-- The job. BaT in five ended_at bands (null-only, to 2021, 2021-22, 2023-24, 2025 on), the rest one statement each.
SELECT cron.schedule('snapshot-stack-dominoes', '25 4 * * *',
  $c$SET statement_timeout = '120s'; SELECT public.snapshot_stack_coverage('cron:snapshot-stack-dominoes'); SELECT public.snapshot_stack_dominoes_begin('cron:snapshot-stack-dominoes'); SELECT public.snapshot_stack_dominoes_read('bat', NULL, '-infinity'); SELECT public.snapshot_stack_dominoes_read('bat', '-infinity', '2021-01-01'); SELECT public.snapshot_stack_dominoes_read('bat', '2021-01-01', '2023-01-01'); SELECT public.snapshot_stack_dominoes_read('bat', '2023-01-01', '2025-01-01'); SELECT public.snapshot_stack_dominoes_read('bat', '2025-01-01', NULL); SELECT public.snapshot_stack_dominoes_read('mecum'); SELECT public.snapshot_stack_dominoes_read('barrettjackson'); SELECT public.snapshot_stack_dominoes_read('cars_and_bids'); SELECT public.snapshot_stack_dominoes_read('gooding'); SELECT public.snapshot_stack_dominoes_read('bonhams'); SELECT public.snapshot_stack_dominoes_read('rm-sothebys'); SELECT public.snapshot_stack_dominoes_read('pcarmarket'); SELECT public.snapshot_stack_dominoes_read('conceptcarz'); SELECT public.snapshot_stack_dominoes_finish();$c$);

SELECT cron.schedule('snapshot-stack-dominoes-firstrun', '5 2 15 10 *',
  $c$SET statement_timeout = '120s'; SELECT public.snapshot_stack_coverage('cron:firstrun2'); SELECT public.snapshot_stack_dominoes_begin('cron:firstrun2'); SELECT public.snapshot_stack_dominoes_read('bat', NULL, '-infinity'); SELECT public.snapshot_stack_dominoes_read('bat', '-infinity', '2021-01-01'); SELECT public.snapshot_stack_dominoes_read('bat', '2021-01-01', '2023-01-01'); SELECT public.snapshot_stack_dominoes_read('bat', '2023-01-01', '2025-01-01'); SELECT public.snapshot_stack_dominoes_read('bat', '2025-01-01', NULL); SELECT public.snapshot_stack_dominoes_read('mecum'); SELECT public.snapshot_stack_dominoes_read('barrettjackson'); SELECT public.snapshot_stack_dominoes_read('cars_and_bids'); SELECT public.snapshot_stack_dominoes_read('gooding'); SELECT public.snapshot_stack_dominoes_read('bonhams'); SELECT public.snapshot_stack_dominoes_read('rm-sothebys'); SELECT public.snapshot_stack_dominoes_read('pcarmarket'); SELECT public.snapshot_stack_dominoes_read('conceptcarz'); SELECT public.snapshot_stack_dominoes_finish(); SELECT cron.unschedule('snapshot-stack-dominoes-firstrun');$c$);

COMMIT;
