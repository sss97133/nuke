-- recover_vehicle_event_sold_at: fill null sold_at on sold vehicle_events from retained
-- evidence (metadata windows, vehicles.sale_date, bid comments, lot-id neighbors), writing a
-- cited vehicle_observations row first, then the event clock, with a one-statement revert marker.
--
-- Also: admit extraction_method=sold_at_date_recovery_v1 observations that cite
-- source_vehicle_event_id (the existing typed-episode guard is BaT-protected-sale only), and
-- teach get_comps_scored to read dated vehicle_events (excluding undated sales).
--
-- No mass backfill in this migration — call recover_vehicle_event_sold_at_batch / plan_* after deploy
-- (scripts/sold-at-date-recovery/run.mjs). Revert: scripts/sold-at-date-recovery/revert.sql.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '10s';

-- 1. Admit date-recovery observations that cite an episode (service role / postgres / writer).
DO $patch$
DECLARE
  def text := pg_get_functiondef('public.validate_comment_observation_source()'::regprocedure);
  needle text := $n$IF NEW.source_vehicle_event_id IS NOT NULL THEN$n$;
  inject text := $i$IF NEW.source_vehicle_event_id IS NOT NULL
     AND NEW.extraction_method = 'sold_at_date_recovery_v1' THEN
    -- Date recovery from retained episode metadata / sibling clocks. Not a protected BaT sale admit.
    IF current_setting('role', true) IS DISTINCT FROM 'service_role'
       AND session_user NOT IN ('service_role', 'postgres', 'supabase_admin')
       AND nullif(current_setting('app.writer', true), '') IS DISTINCT FROM 'recover_vehicle_event_sold_at_batch' THEN
      RAISE EXCEPTION 'sold_at date recovery requires service role or recover writer' USING ERRCODE = '42501';
    END IF;
    IF NEW.vehicle_id IS NULL OR NEW.source_id IS NULL
       OR NEW.kind::text IS DISTINCT FROM 'sale_result'
       OR NEW.source_comment_id IS NOT NULL AND NEW.structured_data->>'recovery_rule' NOT IN ('C2', 'BAT2')
       OR NEW.subject_type IS DISTINCT FROM 'vehicle'
       OR NEW.content_hash IS NULL
       OR NEW.citation_excerpt IS NULL OR length(btrim(NEW.citation_excerpt)) < 8
       OR NEW.source_event_at IS NULL
       OR NEW.source_event_time_precision IS NULL
         OR NEW.source_event_time_precision NOT IN ('day', 'event_window', 'minute')
       OR NEW.observed_at_basis IS NULL
       OR NEW.confidence_score IS NULL
       OR NEW.structured_data->>'recovery_marker' IS DISTINCT FROM 'sold_at_date_recovery_v1'
       OR NEW.structured_data->>'recovery_rule' IS NULL THEN
      RAISE EXCEPTION 'invalid sold_at date recovery observation shape' USING ERRCODE = '23514';
    END IF;
    PERFORM 1 FROM public.vehicle_events e
      WHERE e.id = NEW.source_vehicle_event_id
        AND e.vehicle_id = NEW.vehicle_id
        AND e.event_status = 'sold'
      FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'date recovery episode missing or not a sold event for this vehicle' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.source_vehicle_event_id IS NOT NULL THEN$i$;
BEGIN
  IF (length(def) - length(replace(def, needle, ''))) / length(needle) <> 1 THEN
    RAISE EXCEPTION 'validate_comment_observation_source: source_vehicle_event_id anchor not found exactly once';
  END IF;
  EXECUTE replace(def, needle, inject);
END $patch$;

-- 2. Writer: insert observation, then fill sold_at only where still null.
CREATE OR REPLACE FUNCTION public.recover_vehicle_event_sold_at_batch(
  p_rows jsonb,
  p_asserted_by text DEFAULT 'agent'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET "TimeZone" TO 'UTC'
AS $fn$
DECLARE
  c_writer CONSTANT text := 'recover_vehicle_event_sold_at_batch';
  c_marker CONSTANT text := 'sold_at_date_recovery_v1';
  c_method CONSTANT text := 'sold_at_date_recovery_v1';
  v_timeout_ms bigint := (SELECT setting::bigint FROM pg_settings WHERE name = 'statement_timeout');
  r jsonb;
  v_event_id uuid;
  v_vehicle_id uuid;
  v_sold_at timestamptz;
  v_precision text;
  v_rule text;
  v_confidence numeric;
  v_excerpt text;
  v_basis text;
  v_comment_id uuid;
  v_source_id uuid;
  v_platform text;
  v_ev vehicle_events%ROWTYPE;
  v_obs_id uuid;
  v_hash text;
  v_ident text;
  v_corrected jsonb := '[]'::jsonb;
  v_noop jsonb := '[]'::jsonb;
  v_missing jsonb := '[]'::jsonb;
  v_stale jsonb := '[]'::jsonb;
  v_refused jsonb := '[]'::jsonb;
  v_prev_writer text := current_setting('app.writer', true);
BEGIN
  IF v_timeout_ms < 1 OR v_timeout_ms > 60000 THEN
    RAISE EXCEPTION '%: caller must set statement_timeout between 1 ms and 60 s (now % ms)', c_writer, v_timeout_ms;
  END IF;
  PERFORM set_config('lock_timeout', '3s', true);
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION '%: p_rows must be a JSON array', c_writer;
  END IF;
  IF jsonb_array_length(p_rows) > 200 THEN
    RAISE EXCEPTION '%: at most 200 rows per call (got %)', c_writer, jsonb_array_length(p_rows);
  END IF;
  IF coalesce(btrim(p_asserted_by), '') = '' THEN
    RAISE EXCEPTION '%: asserted_by is required', c_writer;
  END IF;

  -- Shape check before any write.
  FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    IF coalesce(r->>'event_id', '') = '' OR coalesce(r->>'vehicle_id', '') = '' THEN
      RAISE EXCEPTION '%: each row needs event_id and vehicle_id', c_writer;
    END IF;
    IF coalesce(r->>'sold_at', '') = '' OR coalesce(r->>'precision', '') = ''
       OR coalesce(r->>'rule', '') = '' OR coalesce(r->>'citation_excerpt', '') = ''
       OR coalesce(r->>'observed_at_basis', '') = '' OR r->>'confidence' IS NULL THEN
      RAISE EXCEPTION '%: event % needs sold_at, precision, rule, confidence, citation_excerpt, observed_at_basis',
        c_writer, r->>'event_id';
    END IF;
    IF (r->>'precision') NOT IN ('day', 'event_window', 'minute') THEN
      RAISE EXCEPTION '%: precision must be day|event_window|minute', c_writer;
    END IF;
    IF length(btrim(r->>'citation_excerpt')) < 8 THEN
      RAISE EXCEPTION '%: citation_excerpt too short for event %', c_writer, r->>'event_id';
    END IF;
  END LOOP;

  PERFORM set_config('app.writer', c_writer, true);

  FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    v_event_id := (r->>'event_id')::uuid;
    v_vehicle_id := (r->>'vehicle_id')::uuid;
    v_sold_at := (r->>'sold_at')::timestamptz;
    v_precision := r->>'precision';
    v_rule := r->>'rule';
    v_confidence := (r->>'confidence')::numeric;
    v_excerpt := btrim(r->>'citation_excerpt');
    v_basis := btrim(r->>'observed_at_basis');
    v_comment_id := nullif(r->>'source_comment_id', '')::uuid;

    SELECT * INTO v_ev FROM vehicle_events WHERE id = v_event_id FOR UPDATE;
    IF NOT FOUND THEN
      v_missing := v_missing || to_jsonb(v_event_id);
      CONTINUE;
    END IF;
    IF v_ev.vehicle_id IS DISTINCT FROM v_vehicle_id THEN
      v_stale := v_stale || jsonb_build_object('event_id', v_event_id, 'why', 'vehicle');
      CONTINUE;
    END IF;
    IF v_ev.event_status IS DISTINCT FROM 'sold' THEN
      v_refused := v_refused || jsonb_build_object('event_id', v_event_id, 'why', 'not_sold');
      CONTINUE;
    END IF;
    IF v_ev.sold_at IS NOT NULL OR v_ev.ended_at IS NOT NULL THEN
      v_noop := v_noop || to_jsonb(v_event_id);
      CONTINUE;
    END IF;
    IF v_ev.metadata ? 'sold_at_date_recovery' THEN
      v_noop := v_noop || to_jsonb(v_event_id);
      CONTINUE;
    END IF;

    v_platform := lower(coalesce(v_ev.source_platform, ''));
    SELECT s.id INTO v_source_id
    FROM observation_sources s
    WHERE s.slug = CASE v_platform
      WHEN 'bat' THEN 'bat'
      WHEN 'bringatrailer' THEN 'bat'
      WHEN 'cars_and_bids' THEN 'cars_and_bids'
      WHEN 'cars-and-bids' THEN 'cars-and-bids'
      WHEN 'mecum' THEN 'mecum'
      WHEN 'gooding' THEN 'gooding'
      WHEN 'broad_arrow' THEN 'broad_arrow'
      WHEN 'broad-arrow' THEN 'broad-arrow'
      ELSE v_platform
    END
    LIMIT 1;
    IF v_source_id IS NULL THEN
      SELECT s.id INTO v_source_id FROM observation_sources s WHERE s.slug = 'mecum' LIMIT 1;
    END IF;
    IF v_source_id IS NULL THEN
      v_refused := v_refused || jsonb_build_object('event_id', v_event_id, 'why', 'no_source');
      CONTINUE;
    END IF;

    v_ident := 'sold_at_date_recovery:' || v_rule || ':' || v_event_id::text;
    IF EXISTS (
      SELECT 1 FROM vehicle_observations o
      WHERE o.source_identifier = v_ident
        AND o.extraction_method = c_method
        AND coalesce(o.is_superseded, false) IS FALSE
    ) THEN
      v_noop := v_noop || to_jsonb(v_event_id);
      CONTINUE;
    END IF;

    v_hash := encode(sha256(convert_to(v_ident || '|' || v_sold_at::text || '|' || v_excerpt, 'UTF8')), 'hex');

    INSERT INTO vehicle_observations (
      vehicle_id, source_id, source_identifier, kind,
      observed_at, observed_at_basis, source_event_at, source_event_time_precision,
      citation_excerpt, confidence_score, confidence,
      source_vehicle_event_id, source_comment_id,
      content_text, content_hash, structured_data, extraction_method,
      subject_type, ingested_at, is_superseded
    ) VALUES (
      v_vehicle_id, v_source_id, v_ident, 'sale_result',
      transaction_timestamp(), v_basis, v_sold_at, v_precision,
      v_excerpt, v_confidence, 'high'::confidence_level,
      v_event_id, v_comment_id,
      format('Recovered sold_at via %s: %s', v_rule, v_excerpt),
      v_hash,
      jsonb_build_object(
        'recovery_marker', c_marker,
        'recovery_rule', v_rule,
        'sold_at', v_sold_at,
        'precision', v_precision,
        'confidence', v_confidence,
        'asserted_by', p_asserted_by
      ),
      c_method,
      'vehicle', transaction_timestamp(), false
    )
    RETURNING id INTO v_obs_id;

    UPDATE vehicle_events e
    SET sold_at = v_sold_at,
        metadata = coalesce(e.metadata, '{}'::jsonb) || jsonb_build_object(
          'sold_at_date_recovery', jsonb_build_object(
            'marker', c_marker,
            'rule', v_rule,
            'observation_id', v_obs_id,
            'precision', v_precision,
            'confidence', v_confidence,
            'citation_excerpt', v_excerpt,
            'recovered_at', transaction_timestamp(),
            'asserted_by', p_asserted_by
          )
        ),
        updated_at = transaction_timestamp()
    WHERE e.id = v_event_id
      AND e.sold_at IS NULL
      AND e.ended_at IS NULL;

    IF NOT FOUND THEN
      -- Race: another writer filled the clock; supersede the observation we just wrote.
      UPDATE vehicle_observations
      SET is_superseded = true, superseded_at = transaction_timestamp()
      WHERE id = v_obs_id;
      v_stale := v_stale || jsonb_build_object('event_id', v_event_id, 'why', 'race');
      CONTINUE;
    END IF;

    v_corrected := v_corrected || jsonb_build_object(
      'event_id', v_event_id,
      'observation_id', v_obs_id,
      'rule', v_rule,
      'sold_at', v_sold_at
    );
  END LOOP;

  PERFORM set_config('app.writer', coalesce(v_prev_writer, ''), true);

  RETURN jsonb_build_object(
    'writer', c_writer,
    'corrected', v_corrected,
    'corrected_n', jsonb_array_length(v_corrected),
    'noop', v_noop,
    'missing', v_missing,
    'stale', v_stale,
    'refused', v_refused
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.recover_vehicle_event_sold_at_batch(jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recover_vehicle_event_sold_at_batch(jsonb, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recover_vehicle_event_sold_at_batch(jsonb, text) TO service_role;
-- Management API / migrations run as postgres; allow explicit execute for operators.
GRANT EXECUTE ON FUNCTION public.recover_vehicle_event_sold_at_batch(jsonb, text) TO postgres;

COMMENT ON FUNCTION public.recover_vehicle_event_sold_at_batch(jsonb, text) IS
  'Fills vehicle_events.sold_at only where null (and ended_at null) from cited recovery rows: writes a sale_result observation (extraction_method sold_at_date_recovery_v1) then stamps metadata.sold_at_date_recovery for one-statement revert. At most 200 rows per call; service_role/postgres.';

-- 3. Planners: return ready payloads for one rule chunk (after_id cursor).
CREATE OR REPLACE FUNCTION public.plan_sold_at_date_recovery(
  p_rule text,
  p_after_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET "TimeZone" TO 'UTC'
AS $plan$
DECLARE
  v_limit int := LEAST(GREATEST(coalesce(p_limit, 100), 1), 200);
  v_rows jsonb := '[]'::jsonb;
BEGIN
  IF p_rule IS NULL OR p_rule NOT IN ('M1', 'M2', 'M3', 'G1', 'A1', 'C1', 'C2') THEN
    RAISE EXCEPTION 'plan_sold_at_date_recovery: unknown rule % (M1|M2|M3|G1|A1|C1|C2)', p_rule;
  END IF;

  IF p_rule = 'M1' THEN
    SELECT coalesce(jsonb_agg(x.payload ORDER BY x.id), '[]'::jsonb) INTO v_rows
    FROM (
      SELECT e.id,
        jsonb_build_object(
          'event_id', e.id,
          'vehicle_id', e.vehicle_id,
          'sold_at', (CASE
            WHEN v.sale_date IS NOT NULL
              AND v.sale_date BETWEEN (e.metadata->>'sale_starts_on')::date
                                 AND (e.metadata->>'sale_ends_on')::date
            THEN (v.sale_date::timestamp AT TIME ZONE 'UTC')
            ELSE (((e.metadata->>'sale_ends_on')::date)::timestamp AT TIME ZONE 'UTC')
          END),
          'precision', (CASE
            WHEN v.sale_date IS NOT NULL
              AND v.sale_date BETWEEN (e.metadata->>'sale_starts_on')::date
                                 AND (e.metadata->>'sale_ends_on')::date
            THEN 'day' ELSE 'event_window' END),
          'rule', (CASE
            WHEN v.sale_date IS NOT NULL
              AND v.sale_date BETWEEN (e.metadata->>'sale_starts_on')::date
                                 AND (e.metadata->>'sale_ends_on')::date
            THEN 'M1b' ELSE 'M1' END),
          'confidence', (CASE
            WHEN v.sale_date IS NOT NULL
              AND v.sale_date BETWEEN (e.metadata->>'sale_starts_on')::date
                                 AND (e.metadata->>'sale_ends_on')::date
            THEN 0.85 ELSE 0.95 END),
          'observed_at_basis', (CASE
            WHEN v.sale_date IS NOT NULL
              AND v.sale_date BETWEEN (e.metadata->>'sale_starts_on')::date
                                 AND (e.metadata->>'sale_ends_on')::date
            THEN 'lot_run_day_within_auction' ELSE 'auction_event_end_upper_bound' END),
          'citation_excerpt', format(
            'Mecum %s (%s–%s); lot run day %s',
            e.metadata->>'auction_name',
            e.metadata->>'sale_starts_on',
            e.metadata->>'sale_ends_on',
            coalesce(v.sale_date::text, 'unknown')
          )
        ) AS payload
      FROM vehicle_events e
      JOIN vehicles v ON v.id = e.vehicle_id
      WHERE e.event_status = 'sold' AND e.sold_at IS NULL AND e.ended_at IS NULL
        AND e.extraction_method = 'mecum-index-v1'
        AND e.metadata ? 'sale_ends_on'
        AND e.metadata->>'sale_ends_on' IS NOT NULL
        AND NOT (e.metadata ? 'sold_at_date_recovery')
        AND (p_after_id IS NULL OR e.id > p_after_id)
      ORDER BY e.id
      LIMIT v_limit
    ) x;
  ELSIF p_rule = 'M2' THEN
    SELECT coalesce(jsonb_agg(x.payload ORDER BY x.id), '[]'::jsonb) INTO v_rows
    FROM (
      SELECT e.id,
        jsonb_build_object(
          'event_id', e.id,
          'vehicle_id', e.vehicle_id,
          'sold_at', (v.sale_date::timestamp AT TIME ZONE 'UTC'),
          'precision', 'day',
          'rule', 'M2',
          'confidence', 0.80,
          'observed_at_basis', 'vehicles.sale_date',
          'citation_excerpt', format('Mecum lot %s; vehicles.sale_date %s', e.source_url, v.sale_date)
        ) AS payload
      FROM vehicle_events e
      JOIN vehicles v ON v.id = e.vehicle_id
      WHERE e.event_status = 'sold' AND e.sold_at IS NULL AND e.ended_at IS NULL
        AND e.source_platform = 'mecum'
        AND e.extraction_method IS DISTINCT FROM 'mecum-index-v1'
        AND v.sale_date IS NOT NULL
        AND NOT (e.metadata ? 'sold_at_date_recovery')
        AND (p_after_id IS NULL OR e.id > p_after_id)
      ORDER BY e.id
      LIMIT v_limit
    ) x;
  ELSIF p_rule = 'M3' THEN
    SELECT coalesce(jsonb_agg(x.payload ORDER BY x.id), '[]'::jsonb) INTO v_rows
    FROM (
      WITH labeled AS (
        SELECT substring(source_url FROM 'mecum\.com/lots/(\d+)')::bigint AS lot,
               nullif(metadata->>'auction_name', '') AS an
        FROM vehicle_events
        WHERE event_status = 'sold' AND source_platform = 'mecum'
          AND source_url ~ 'mecum\.com/lots/\d+'
          AND metadata->>'auction_name' IS NOT NULL
      ),
      win AS (
        SELECT nullif(metadata->>'auction_name', '') AS an,
               min((metadata->>'sale_starts_on')::date) AS s0,
               max((metadata->>'sale_ends_on')::date) AS s1
        FROM vehicle_events
        WHERE source_platform = 'mecum'
          AND metadata->>'sale_ends_on' IS NOT NULL
          AND metadata->>'auction_name' IS NOT NULL
        GROUP BY 1
      ),
      resid AS (
        SELECT e.id, e.vehicle_id, e.source_url,
               substring(e.source_url FROM 'mecum\.com/lots/(\d+)')::bigint AS lot
        FROM vehicle_events e
        WHERE e.event_status = 'sold' AND e.sold_at IS NULL AND e.ended_at IS NULL
          AND e.source_platform = 'mecum'
          AND e.extraction_method IS DISTINCT FROM 'mecum-index-v1'
          AND e.source_url ~ 'mecum\.com/lots/\d+'
          AND nullif(e.metadata->>'auction_name', '') IS NULL
          AND NOT (e.metadata ? 'sold_at_date_recovery')
          AND NOT EXISTS (
            SELECT 1 FROM vehicles v WHERE v.id = e.vehicle_id AND v.sale_date IS NOT NULL
          )
          AND (p_after_id IS NULL OR e.id > p_after_id)
      )
      SELECT r.id,
        jsonb_build_object(
          'event_id', r.id,
          'vehicle_id', r.vehicle_id,
          'sold_at', (w.s1::timestamp AT TIME ZONE 'UTC'),
          'precision', 'event_window',
          'rule', 'M3',
          'confidence', 0.85,
          'observed_at_basis', 'mecum_lot_id_bracketed_by_same_auction',
          'citation_excerpt', format(
            'lot %s between lots of %s (%s–%s)',
            r.lot, w.an, w.s0, w.s1
          )
        ) AS payload
      FROM resid r
      JOIN LATERAL (
        SELECT b.an AS prev_an FROM labeled b WHERE b.lot < r.lot ORDER BY b.lot DESC LIMIT 1
      ) prev ON true
      JOIN LATERAL (
        SELECT b.an AS next_an FROM labeled b WHERE b.lot > r.lot ORDER BY b.lot ASC LIMIT 1
      ) nxt ON true
      JOIN win w ON w.an = prev.prev_an AND w.an = nxt.next_an AND w.s1 IS NOT NULL
      ORDER BY r.id
      LIMIT v_limit
    ) x;
  ELSIF p_rule = 'G1' THEN
    SELECT coalesce(jsonb_agg(x.payload ORDER BY x.id), '[]'::jsonb) INTO v_rows
    FROM (
      SELECT e.id,
        jsonb_build_object(
          'event_id', e.id,
          'vehicle_id', e.vehicle_id,
          'sold_at', ((e.metadata->'auction_session_days'->>-1)::date::timestamp AT TIME ZONE 'UTC'),
          'precision', (CASE
            WHEN jsonb_array_length(e.metadata->'auction_session_days') = 1
              AND e.metadata->>'sold_at_basis' IS NULL THEN 'day'
            ELSE 'event_window' END),
          'rule', 'G1',
          'confidence', (CASE
            WHEN e.metadata->>'sold_at_basis' = 'placeholder_session' THEN 0.70
            WHEN jsonb_array_length(e.metadata->'auction_session_days') = 1 THEN 0.85
            ELSE 0.80 END),
          'observed_at_basis', coalesce(e.metadata->>'sold_at_basis', 'single_session'),
          'citation_excerpt', format(
            'Gooding sessions %s (%s)',
            e.metadata->'auction_session_days',
            coalesce(e.metadata->>'auction_calendar_position', e.metadata->>'auction_name', 'session')
          )
        ) AS payload
      FROM vehicle_events e
      WHERE e.event_status = 'sold' AND e.sold_at IS NULL AND e.ended_at IS NULL
        AND e.source_platform = 'gooding'
        AND jsonb_typeof(e.metadata->'auction_session_days') = 'array'
        AND jsonb_array_length(e.metadata->'auction_session_days') > 0
        AND NOT (e.metadata ? 'sold_at_date_recovery')
        AND (p_after_id IS NULL OR e.id > p_after_id)
      ORDER BY e.id
      LIMIT v_limit
    ) x;
  ELSIF p_rule = 'A1' THEN
    SELECT coalesce(jsonb_agg(x.payload ORDER BY x.id), '[]'::jsonb) INTO v_rows
    FROM (
      WITH b AS (
        SELECT id, vehicle_id,
               lower(substring(source_url FROM 'broadarrowauctions\.com/vehicles/([a-z]+\d+[a-z]?)_')) AS code,
               coalesce(sold_at, ended_at) AS t,
               (metadata->>'sale_ends_on')::date AS se,
               metadata
        FROM vehicle_events
        WHERE event_status = 'sold'
          AND source_url ~ 'broadarrowauctions\.com/vehicles/'
      ),
      cal AS (
        SELECT code, max(coalesce(se, t::date)) AS d1
        FROM b
        WHERE code IS NOT NULL AND (t IS NOT NULL OR se IS NOT NULL)
        GROUP BY code
      )
      SELECT b.id,
        jsonb_build_object(
          'event_id', b.id,
          'vehicle_id', b.vehicle_id,
          'sold_at', (cal.d1::timestamp AT TIME ZONE 'UTC'),
          'precision', 'event_window',
          'rule', 'A1',
          'confidence', 0.90,
          'observed_at_basis', 'broad_arrow_sale_code',
          'citation_excerpt', format('Broad Arrow sale code %s ends %s', b.code, cal.d1)
        ) AS payload
      FROM b
      JOIN cal USING (code)
      WHERE b.t IS NULL
        AND NOT (coalesce(b.metadata, '{}'::jsonb) ? 'sold_at_date_recovery')
        AND (p_after_id IS NULL OR b.id > p_after_id)
      ORDER BY b.id
      LIMIT v_limit
    ) x;
  ELSIF p_rule = 'C1' THEN
    SELECT coalesce(jsonb_agg(x.payload ORDER BY x.id), '[]'::jsonb) INTO v_rows
    FROM (
      SELECT e.id,
        jsonb_build_object(
          'event_id', e.id,
          'vehicle_id', e.vehicle_id,
          'sold_at', (CASE
            WHEN v.sale_date IS NOT NULL THEN (v.sale_date::timestamp AT TIME ZONE 'UTC')
            ELSE (nullif(v.auction_end_date, '')::timestamptz)
          END),
          'precision', (CASE WHEN v.sale_date IS NOT NULL THEN 'day' ELSE 'day' END),
          'rule', 'C1',
          'confidence', 0.85,
          'observed_at_basis', (CASE
            WHEN v.sale_date IS NOT NULL THEN 'vehicles.sale_date'
            ELSE 'vehicles.auction_end_date' END),
          'citation_excerpt', format(
            '%s sale date %s',
            e.source_platform,
            coalesce(v.sale_date::text, nullif(v.auction_end_date, ''))
          )
        ) AS payload
      FROM vehicle_events e
      JOIN vehicles v ON v.id = e.vehicle_id
      WHERE e.event_status = 'sold' AND e.sold_at IS NULL AND e.ended_at IS NULL
        AND e.source_platform IN ('cars_and_bids', 'bat')
        AND (v.sale_date IS NOT NULL OR nullif(v.auction_end_date, '') IS NOT NULL)
        AND NOT (e.metadata ? 'sold_at_date_recovery')
        AND (p_after_id IS NULL OR e.id > p_after_id)
      ORDER BY e.id
      LIMIT v_limit
    ) x;
  ELSIF p_rule = 'C2' THEN
    SELECT coalesce(jsonb_agg(x.payload ORDER BY x.id), '[]'::jsonb) INTO v_rows
    FROM (
      SELECT e.id,
        jsonb_build_object(
          'event_id', e.id,
          'vehicle_id', e.vehicle_id,
          'sold_at', pb.posted_at,
          'precision', 'minute',
          'rule', (CASE WHEN e.source_platform = 'bat' THEN 'BAT2' ELSE 'C2' END),
          'confidence', 0.85,
          'observed_at_basis', 'last_bid_comment_at_final_price',
          'citation_excerpt', left(format('bid comment %s at %s: %s', pb.id, pb.posted_at, coalesce(pb.comment_text, '')), 200),
          'source_comment_id', pb.id
        ) AS payload
      FROM vehicle_events e
      JOIN vehicles v ON v.id = e.vehicle_id
      JOIN LATERAL (
        SELECT c.id, c.posted_at, c.comment_text
        FROM auction_comments c
        WHERE c.vehicle_id = e.vehicle_id
          AND c.bid_amount = e.final_price
          AND c.posted_at IS NOT NULL
        ORDER BY c.posted_at DESC
        LIMIT 1
      ) pb ON true
      WHERE e.event_status = 'sold' AND e.sold_at IS NULL AND e.ended_at IS NULL
        AND e.source_platform IN ('cars_and_bids', 'bat')
        AND v.sale_date IS NULL
        AND nullif(v.auction_end_date, '') IS NULL
        AND e.final_price IS NOT NULL
        AND NOT (e.metadata ? 'sold_at_date_recovery')
        AND (p_after_id IS NULL OR e.id > p_after_id)
      ORDER BY e.id
      LIMIT v_limit
    ) x;
  END IF;

  RETURN jsonb_build_object(
    'rule', p_rule,
    'n', jsonb_array_length(v_rows),
    'rows', v_rows,
    'next_after_id', CASE
      WHEN jsonb_array_length(v_rows) = 0 THEN p_after_id
      ELSE (v_rows -> (jsonb_array_length(v_rows) - 1) ->> 'event_id')::uuid
    END
  );
END;
$plan$;

REVOKE ALL ON FUNCTION public.plan_sold_at_date_recovery(text, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.plan_sold_at_date_recovery(text, uuid, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.plan_sold_at_date_recovery(text, uuid, integer) TO service_role, postgres;

COMMENT ON FUNCTION public.plan_sold_at_date_recovery(text, uuid, integer) IS
  'Plans one chunk of sold_at date-recovery payloads for rule M1|M2|M3|G1|A1|C1|C2 (cursor p_after_id, at most 200). Read-only; pair with recover_vehicle_event_sold_at_batch.';

-- 4. Comps RPC: include dated vehicle_events; drop undated candidates; surface precision/confidence.
CREATE OR REPLACE FUNCTION public.get_comps_scored(
  p_make text,
  p_model text DEFAULT NULL::text,
  p_year integer DEFAULT NULL::integer,
  p_year_range integer DEFAULT 5,
  p_engine_type text DEFAULT NULL::text,
  p_transmission text DEFAULT NULL::text,
  p_drivetrain text DEFAULT NULL::text,
  p_mileage integer DEFAULT NULL::integer,
  p_trim text DEFAULT NULL::text,
  p_body_style text DEFAULT NULL::text,
  p_min_price numeric DEFAULT NULL::numeric,
  p_max_price numeric DEFAULT NULL::numeric,
  p_exclude_vehicle_id uuid DEFAULT NULL::uuid,
  p_limit integer DEFAULT 20
)
RETURNS TABLE(
  vehicle_id uuid, yr integer, mk text, mdl text, tr text, vi text,
  sale_price numeric, miles integer, clr text, image_url text, loc text,
  listing_url text, platform text, sold_date timestamp with time zone,
  source_type text, similarity_score numeric, score_breakdown jsonb
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET statement_timeout TO '10s'
AS $function$
DECLARE
  w_year        constant numeric := 15;
  w_model       constant numeric := 25;
  w_engine_cyl  constant numeric := 12;
  w_engine_cfg  constant numeric := 5;
  w_trans       constant numeric := 15;
  w_drivetrain  constant numeric := 10;
  w_mileage     constant numeric := 8;
  w_body        constant numeric := 5;
  w_trim_w      constant numeric := 5;

  ref_trans     text;
  ref_cyls      integer;
  ref_eng_cfg   text;
  ref_drive     text;
BEGIN
  ref_trans    := classify_transmission(p_transmission);
  ref_cyls     := extract_cylinder_count(p_engine_type);
  ref_eng_cfg  := extract_engine_config(p_engine_type);
  ref_drive    := classify_drivetrain(p_drivetrain);

  RETURN QUERY
  WITH auction_cands AS (
    SELECT
      v.id, v.year, v.make, v.model, v.trim, v.vin,
      ae.winning_bid AS price, v.mileage, v.color,
      v.primary_image_url, v.location, ae.source_url,
      ae.source, ae.auction_end_date,
      'auction_event'::text AS src_type,
      v.engine_type AS v_engine, v.transmission AS v_trans,
      v.drivetrain AS v_drive, v.body_style AS v_body,
      NULL::jsonb AS recovery
    FROM vehicles v
    JOIN auction_events ae ON ae.vehicle_id = v.id
    WHERE lower(v.make) = lower(p_make)
      AND (p_model IS NULL OR lower(v.model) = lower(p_model) OR lower(v.model) LIKE '%' || lower(p_model) || '%' OR lower(p_model) LIKE '%' || lower(v.model) || '%')
      AND (p_year IS NULL OR v.year BETWEEN p_year - p_year_range AND p_year + p_year_range)
      AND ae.winning_bid > 0
      AND ae.outcome = 'sold'
      AND ae.auction_end_date IS NOT NULL
      AND (p_min_price IS NULL OR ae.winning_bid >= p_min_price)
      AND (p_max_price IS NULL OR ae.winning_bid <= p_max_price)
      AND (p_exclude_vehicle_id IS NULL OR v.id != p_exclude_vehicle_id)
      AND v.deleted_at IS NULL AND v.merged_into_vehicle_id IS NULL
  ),
  event_cands AS (
    SELECT
      v.id, v.year, v.make, v.model, v.trim, v.vin,
      e.final_price AS price, v.mileage, v.color,
      v.primary_image_url, v.location, e.source_url,
      e.source_platform AS source,
      coalesce(e.sold_at, e.ended_at) AS auction_end_date,
      'vehicle_event'::text AS src_type,
      v.engine_type AS v_engine, v.transmission AS v_trans,
      v.drivetrain AS v_drive, v.body_style AS v_body,
      e.metadata->'sold_at_date_recovery' AS recovery
    FROM vehicles v
    JOIN vehicle_events e ON e.vehicle_id = v.id
    WHERE lower(v.make) = lower(p_make)
      AND (p_model IS NULL OR lower(v.model) = lower(p_model) OR lower(v.model) LIKE '%' || lower(p_model) || '%' OR lower(p_model) LIKE '%' || lower(v.model) || '%')
      AND (p_year IS NULL OR v.year BETWEEN p_year - p_year_range AND p_year + p_year_range)
      AND e.event_status = 'sold'
      AND e.final_price IS NOT NULL AND e.final_price > 0
      AND coalesce(e.sold_at, e.ended_at) IS NOT NULL
      AND (p_min_price IS NULL OR e.final_price >= p_min_price)
      AND (p_max_price IS NULL OR e.final_price <= p_max_price)
      AND (p_exclude_vehicle_id IS NULL OR v.id != p_exclude_vehicle_id)
      AND v.deleted_at IS NULL AND v.merged_into_vehicle_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM auction_events ae2
        WHERE ae2.vehicle_id = v.id AND ae2.winning_bid > 0 AND ae2.outcome = 'sold'
          AND ae2.auction_end_date IS NOT NULL
      )
  ),
  vehicle_cands AS (
    SELECT
      v.id, v.year, v.make, v.model, v.trim, v.vin,
      v.sale_price AS price, v.mileage, v.color,
      v.primary_image_url, v.location, v.listing_url AS source_url,
      NULL::text AS source,
      (COALESCE(v.sale_date, v.bat_sale_date)::timestamp AT TIME ZONE 'UTC') AS auction_end_date,
      'vehicle_record'::text AS src_type,
      v.engine_type AS v_engine, v.transmission AS v_trans,
      v.drivetrain AS v_drive, v.body_style AS v_body,
      NULL::jsonb AS recovery
    FROM vehicles v
    WHERE lower(v.make) = lower(p_make)
      AND (p_model IS NULL OR lower(v.model) = lower(p_model) OR lower(v.model) LIKE '%' || lower(p_model) || '%' OR lower(p_model) LIKE '%' || lower(v.model) || '%')
      AND (p_year IS NULL OR v.year BETWEEN p_year - p_year_range AND p_year + p_year_range)
      AND v.sale_price IS NOT NULL AND v.sale_price > 0
      AND COALESCE(v.sale_date, v.bat_sale_date) IS NOT NULL
      AND (p_min_price IS NULL OR v.sale_price >= p_min_price)
      AND (p_max_price IS NULL OR v.sale_price <= p_max_price)
      AND (p_exclude_vehicle_id IS NULL OR v.id != p_exclude_vehicle_id)
      AND v.deleted_at IS NULL AND v.merged_into_vehicle_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM auction_events ae2
        WHERE ae2.vehicle_id = v.id AND ae2.winning_bid > 0 AND ae2.outcome = 'sold'
          AND ae2.auction_end_date IS NOT NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM vehicle_events e2
        WHERE e2.vehicle_id = v.id AND e2.event_status = 'sold'
          AND e2.final_price IS NOT NULL AND e2.final_price > 0
          AND coalesce(e2.sold_at, e2.ended_at) IS NOT NULL
      )
  ),
  all_cands AS (
    SELECT * FROM auction_cands
    UNION ALL
    SELECT * FROM event_cands
    UNION ALL
    SELECT * FROM vehicle_cands
  ),
  scored AS (
    SELECT
      c.id AS vehicle_id,
      c.year AS yr,
      c.make AS mk,
      c.model AS mdl,
      c.trim AS tr,
      c.vin AS vi,
      c.price AS sale_price,
      c.mileage AS miles,
      c.color AS clr,
      c.primary_image_url AS image_url,
      c.location AS loc,
      c.source_url AS listing_url,
      c.source AS platform,
      c.auction_end_date AS sold_date,
      c.src_type AS source_type,
      c.recovery,

      (CASE WHEN p_year IS NOT NULL AND c.year IS NOT NULL
        THEN w_year * GREATEST(0, 1.0 - ABS(c.year - p_year)::numeric / GREATEST(p_year_range, 1))
        ELSE w_year * 0.5
      END) AS s_year,

      (CASE
        WHEN p_model IS NULL THEN w_model * 0.5
        WHEN lower(c.model) = lower(p_model) THEN w_model
        WHEN lower(c.model) LIKE '%' || lower(p_model) || '%' THEN w_model * 0.7
        WHEN lower(p_model) LIKE '%' || lower(c.model) || '%' THEN w_model * 0.6
        WHEN lower(c.model) LIKE '%' || lower(split_part(p_model, ' ', 1)) || '%' THEN w_model * 0.4
        ELSE 0
      END) AS s_model,

      (CASE
        WHEN ref_cyls IS NULL OR extract_cylinder_count(c.v_engine) IS NULL THEN w_engine_cyl * 0.3
        WHEN extract_cylinder_count(c.v_engine) = ref_cyls THEN w_engine_cyl
        WHEN ABS(extract_cylinder_count(c.v_engine) - ref_cyls) <= 2 THEN w_engine_cyl * 0.5
        ELSE 0
      END) AS s_engine_cyl,

      (CASE
        WHEN ref_eng_cfg IS NULL OR extract_engine_config(c.v_engine) IS NULL THEN w_engine_cfg * 0.3
        WHEN extract_engine_config(c.v_engine) = ref_eng_cfg THEN w_engine_cfg
        ELSE 0
      END) AS s_engine_cfg,

      (CASE
        WHEN ref_trans IS NULL OR classify_transmission(c.v_trans) IS NULL THEN w_trans * 0.3
        WHEN classify_transmission(c.v_trans) = ref_trans THEN w_trans
        ELSE 0
      END) AS s_trans,

      (CASE
        WHEN ref_drive IS NULL OR classify_drivetrain(c.v_drive) IS NULL THEN w_drivetrain * 0.3
        WHEN classify_drivetrain(c.v_drive) = ref_drive THEN w_drivetrain
        WHEN classify_drivetrain(c.v_drive) IN ('4WD','AWD') AND ref_drive IN ('4WD','AWD') THEN w_drivetrain * 0.8
        ELSE 0
      END) AS s_drivetrain,

      (CASE
        WHEN p_mileage IS NULL OR c.mileage IS NULL OR p_mileage = 0 THEN w_mileage * 0.3
        WHEN ABS(c.mileage - p_mileage) <= p_mileage * 0.2 THEN w_mileage
        WHEN ABS(c.mileage - p_mileage) <= p_mileage * 0.5 THEN w_mileage * 0.6
        WHEN ABS(c.mileage - p_mileage) <= p_mileage * 1.0 THEN w_mileage * 0.3
        ELSE 0
      END) AS s_mileage,

      (CASE
        WHEN p_body_style IS NULL OR c.v_body IS NULL THEN w_body * 0.3
        WHEN lower(c.v_body) = lower(p_body_style) THEN w_body
        WHEN lower(c.v_body) LIKE '%' || lower(p_body_style) || '%' THEN w_body * 0.6
        ELSE 0
      END) AS s_body,

      (CASE
        WHEN p_trim IS NULL OR c.trim IS NULL THEN w_trim_w * 0.3
        WHEN lower(c.trim) = lower(p_trim) THEN w_trim_w
        WHEN lower(c.trim) LIKE '%' || lower(p_trim) || '%' THEN w_trim_w * 0.6
        ELSE 0
      END) AS s_trim

    FROM all_cands c
    WHERE c.auction_end_date IS NOT NULL
  )
  SELECT
    s.vehicle_id, s.yr, s.mk, s.mdl, s.tr, s.vi,
    s.sale_price, s.miles, s.clr, s.image_url, s.loc,
    s.listing_url, s.platform, s.sold_date, s.source_type,
    ROUND(s.s_year + s.s_model + s.s_engine_cyl + s.s_engine_cfg + s.s_trans + s.s_drivetrain + s.s_mileage + s.s_body + s.s_trim, 1) AS similarity_score,
    jsonb_build_object(
      'year', ROUND(s.s_year, 1),
      'model', ROUND(s.s_model, 1),
      'engine_cyl', ROUND(s.s_engine_cyl, 1),
      'engine_cfg', ROUND(s.s_engine_cfg, 1),
      'transmission', ROUND(s.s_trans, 1),
      'drivetrain', ROUND(s.s_drivetrain, 1),
      'mileage', ROUND(s.s_mileage, 1),
      'body_style', ROUND(s.s_body, 1),
      'trim', ROUND(s.s_trim, 1),
      'date_precision', coalesce(s.recovery->>'precision',
        CASE s.source_type
          WHEN 'auction_event' THEN 'minute'
          WHEN 'vehicle_event' THEN 'day'
          ELSE 'day'
        END),
      'date_confidence', coalesce((s.recovery->>'confidence')::numeric,
        CASE s.source_type WHEN 'auction_event' THEN 0.9 ELSE 0.85 END),
      'date_observation_id', s.recovery->>'observation_id',
      'date_recovery_rule', s.recovery->>'rule'
    ) AS score_breakdown
  FROM scored s
  ORDER BY
    (s.s_year + s.s_model + s.s_engine_cyl + s.s_engine_cfg + s.s_trans + s.s_drivetrain + s.s_mileage + s.s_body + s.s_trim) DESC,
    s.sold_date DESC NULLS LAST
  LIMIT p_limit;
END;
$function$;

COMMIT;
