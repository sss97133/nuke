-- Sale-date recovery FLAGS only (additive, reversible).
-- Date-clock recovery (Mecum/Gooding/C&B/BaT/Broad Arrow) is owned by another lane —
-- stage 1–2 drains here are no-ops so this migration cannot double-write sold clocks.
-- This migration: additive flag columns, orphan-backfill → ask, unpriced Mecum →
-- unverified_sale, and placeholder precision flags. Never overwrites sold_at/ended_at.
SET statement_timeout = '120s';
SET lock_timeout = '15s';

-- ─── Before-image snapshot (reversible) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sale_date_recovery_snapshots (
  id bigserial PRIMARY KEY,
  snapshotted_at timestamptz NOT NULL DEFAULT now(),
  stage text NOT NULL,
  event_id uuid NOT NULL,
  vehicle_id uuid,
  row_data jsonb NOT NULL,
  UNIQUE (stage, event_id)
);

COMMENT ON TABLE public.sale_date_recovery_snapshots IS
  'Before-image of vehicle_events rows touched by sale-date recovery. Additive; never deletes testimony.';

CREATE INDEX IF NOT EXISTS idx_sale_date_recovery_snapshots_event
  ON public.sale_date_recovery_snapshots (event_id);

ALTER TABLE public.sale_date_recovery_snapshots ENABLE ROW LEVEL SECURITY;

-- ─── Run scoreboard ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sale_date_recovery_runs (
  id bigserial PRIMARY KEY,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  stage text NOT NULL,
  batch_size int NOT NULL,
  snapshotted int NOT NULL DEFAULT 0,
  observations_written int NOT NULL DEFAULT 0,
  flagged int NOT NULL DEFAULT 0,
  skipped int NOT NULL DEFAULT 0,
  notes jsonb NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE public.sale_date_recovery_runs IS
  'Per-batch receipts for sale_date_recovery drains. Queryable scoreboard.';

ALTER TABLE public.sale_date_recovery_runs ENABLE ROW LEVEL SECURITY;

-- ─── Baseline coverage receipt (before any writes) ──────────────────────────
CREATE TABLE IF NOT EXISTS public.sale_date_recovery_baselines (
  id bigserial PRIMARY KEY,
  measured_at timestamptz NOT NULL DEFAULT now(),
  label text NOT NULL,
  payload jsonb NOT NULL
);

ALTER TABLE public.sale_date_recovery_baselines ENABLE ROW LEVEL SECURITY;

-- ─── Additive flags on vehicle_events (nullable; no overwrite of clocks) ────
ALTER TABLE public.vehicle_events
  ADD COLUMN IF NOT EXISTS sale_truth_role text,
  ADD COLUMN IF NOT EXISTS sold_at_precision text,
  ADD COLUMN IF NOT EXISTS sale_date_recovery_rule text,
  ADD COLUMN IF NOT EXISTS sale_date_recovery_at timestamptz;

COMMENT ON COLUMN public.vehicle_events.sale_truth_role IS
  'Additive flag: ask | unverified_sale | hammer. Null = unset. Never deletes the row.';
COMMENT ON COLUMN public.vehicle_events.sold_at_precision IS
  'Additive: day | event_window | month_placeholder | auction_level | unknown. Clock quality.';
COMMENT ON COLUMN public.vehicle_events.sale_date_recovery_rule IS
  'Which recovery rule last flagged or cited this event (e.g. mecum_index_v1).';

CREATE INDEX IF NOT EXISTS idx_vehicle_events_sale_truth_role
  ON public.vehicle_events (sale_truth_role)
  WHERE sale_truth_role IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vehicle_events_undated_sold
  ON public.vehicle_events (id)
  WHERE event_status = 'sold' AND sold_at IS NULL AND ended_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_vehicle_events_sale_date_recovery_at
  ON public.vehicle_events (id)
  WHERE sale_date_recovery_at IS NULL
    AND event_status = 'sold'
    AND sold_at IS NULL
    AND ended_at IS NULL;

-- ─── BJ auction calendar (~90 slugs) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bj_auction_calendar (
  slug text PRIMARY KEY,
  start_date date NOT NULL,
  end_date date NOT NULL,
  source text NOT NULL DEFAULT 'slug_season_heuristic',
  notes text
);

COMMENT ON TABLE public.bj_auction_calendar IS
  'Barrett-Jackson docket slug → auction window for undated sold recovery (B1).';

ALTER TABLE public.bj_auction_calendar ENABLE ROW LEVEL SECURITY;

-- Mecum lot → auction window map (anchors for M3 neighbour attribution)
CREATE TABLE IF NOT EXISTS public.sale_date_recovery_mecum_lot_map (
  lot bigint PRIMARY KEY,
  auction_name text NOT NULL,
  sale_starts_on date,
  sale_ends_on date NOT NULL,
  refreshed_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.sale_date_recovery_mecum_lot_map IS
  'Mecum lot ids with known auction windows; used for neighbour attribution (M3).';

ALTER TABLE public.sale_date_recovery_mecum_lot_map ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_sale_date_recovery_mecum_lot_map_an
  ON public.sale_date_recovery_mecum_lot_map (auction_name);

INSERT INTO public.bj_auction_calendar (slug, start_date, end_date, source, notes)
SELECT
  slug,
  start_date,
  end_date,
  'slug_season_heuristic',
  'Derived from docket slug year and BJ season norms'
FROM (
  SELECT DISTINCT
    substring(e.source_url from 'barrett-jackson\.com/([^/]+)/docket') AS slug,
    CASE
      WHEN substring(e.source_url from 'barrett-jackson\.com/([^/]+)/docket') ~* 'scottsdale-fall|fall.*scottsdale'
        THEN make_date(
          (regexp_match(substring(e.source_url from 'barrett-jackson\.com/([^/]+)/docket'), '(19|20)\d{2}'))[1]::int,
          10, 15)
      WHEN substring(e.source_url from 'barrett-jackson\.com/([^/]+)/docket') ~* 'scottsdale'
        THEN make_date(
          (regexp_match(substring(e.source_url from 'barrett-jackson\.com/([^/]+)/docket'), '(19|20)\d{2}'))[1]::int,
          1, 15)
      WHEN substring(e.source_url from 'barrett-jackson\.com/([^/]+)/docket') ~* 'palm-beach'
        THEN make_date(
          (regexp_match(substring(e.source_url from 'barrett-jackson\.com/([^/]+)/docket'), '(19|20)\d{2}'))[1]::int,
          4, 10)
      WHEN substring(e.source_url from 'barrett-jackson\.com/([^/]+)/docket') ~* 'las-vegas'
        THEN make_date(
          (regexp_match(substring(e.source_url from 'barrett-jackson\.com/([^/]+)/docket'), '(19|20)\d{2}'))[1]::int,
          6, 15)
      WHEN substring(e.source_url from 'barrett-jackson\.com/([^/]+)/docket') ~* 'northeast'
        THEN make_date(
          (regexp_match(substring(e.source_url from 'barrett-jackson\.com/([^/]+)/docket'), '(19|20)\d{2}'))[1]::int,
          6, 20)
      WHEN substring(e.source_url from 'barrett-jackson\.com/([^/]+)/docket') ~* 'houston'
        THEN make_date(
          (regexp_match(substring(e.source_url from 'barrett-jackson\.com/([^/]+)/docket'), '(19|20)\d{2}'))[1]::int,
          9, 15)
      WHEN substring(e.source_url from 'barrett-jackson\.com/([^/]+)/docket') ~* 'reno'
        THEN make_date(
          (regexp_match(substring(e.source_url from 'barrett-jackson\.com/([^/]+)/docket'), '(19|20)\d{2}'))[1]::int,
          7, 15)
      WHEN substring(e.source_url from 'barrett-jackson\.com/([^/]+)/docket') ~* 'orange-county'
        THEN make_date(
          (regexp_match(substring(e.source_url from 'barrett-jackson\.com/([^/]+)/docket'), '(19|20)\d{2}'))[1]::int,
          6, 20)
      ELSE make_date(
        (regexp_match(substring(e.source_url from 'barrett-jackson\.com/([^/]+)/docket'), '(19|20)\d{2}'))[1]::int,
        6, 15)
    END AS start_date,
    CASE
      WHEN substring(e.source_url from 'barrett-jackson\.com/([^/]+)/docket') ~* 'scottsdale-fall|fall.*scottsdale'
        THEN make_date(
          (regexp_match(substring(e.source_url from 'barrett-jackson\.com/([^/]+)/docket'), '(19|20)\d{2}'))[1]::int,
          10, 22)
      WHEN substring(e.source_url from 'barrett-jackson\.com/([^/]+)/docket') ~* 'scottsdale'
        THEN make_date(
          (regexp_match(substring(e.source_url from 'barrett-jackson\.com/([^/]+)/docket'), '(19|20)\d{2}'))[1]::int,
          1, 22)
      WHEN substring(e.source_url from 'barrett-jackson\.com/([^/]+)/docket') ~* 'palm-beach'
        THEN make_date(
          (regexp_match(substring(e.source_url from 'barrett-jackson\.com/([^/]+)/docket'), '(19|20)\d{2}'))[1]::int,
          4, 18)
      WHEN substring(e.source_url from 'barrett-jackson\.com/([^/]+)/docket') ~* 'las-vegas'
        THEN make_date(
          (regexp_match(substring(e.source_url from 'barrett-jackson\.com/([^/]+)/docket'), '(19|20)\d{2}'))[1]::int,
          6, 22)
      ELSE make_date(
        (regexp_match(substring(e.source_url from 'barrett-jackson\.com/([^/]+)/docket'), '(19|20)\d{2}'))[1]::int,
        6, 22)
    END AS end_date
  FROM public.vehicle_events e
  WHERE e.source_url ~ 'barrett-jackson\.com/.+/docket'
    AND substring(e.source_url from 'barrett-jackson\.com/([^/]+)/docket') ~
      '(19|20)\d{2}'
) s
WHERE slug IS NOT NULL AND start_date IS NOT NULL AND end_date IS NOT NULL
ON CONFLICT (slug) DO NOTHING;

-- Observation source for recovery citations (category required; tier is int)
INSERT INTO public.observation_sources (
  slug, display_name, category, base_trust_score, tier, notes, supported_observations
)
SELECT
  'sale-date-recovery',
  'Sale Date Recovery',
  'internal',
  0.80,
  3,
  'Cited sale-clock recovery from retained metadata, lot neighbours, and auction calendars. Additive; does not overwrite sold_at.',
  ARRAY['sale_result']::text[]
WHERE NOT EXISTS (
  SELECT 1 FROM public.observation_sources WHERE slug = 'sale-date-recovery'
);

-- ─── Snapshot helper (narrow before-image) ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.sale_date_recovery_snapshot_events(
  p_stage text,
  p_event_ids uuid[]
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  n int;
BEGIN
  INSERT INTO public.sale_date_recovery_snapshots (stage, event_id, vehicle_id, row_data)
  SELECT
    p_stage,
    e.id,
    e.vehicle_id,
    jsonb_build_object(
      'id', e.id,
      'vehicle_id', e.vehicle_id,
      'event_status', e.event_status,
      'sold_at', e.sold_at,
      'ended_at', e.ended_at,
      'final_price', e.final_price,
      'source_platform', e.source_platform,
      'extraction_method', e.extraction_method,
      'sale_truth_role', e.sale_truth_role,
      'sold_at_precision', e.sold_at_precision,
      'sale_date_recovery_rule', e.sale_date_recovery_rule,
      'sale_date_recovery_at', e.sale_date_recovery_at
    )
  FROM public.vehicle_events e
  WHERE e.id = ANY (p_event_ids)
  ON CONFLICT (stage, event_id) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.sale_date_recovery_snapshot_events(text, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sale_date_recovery_snapshot_events(text, uuid[]) TO service_role;

-- ─── Core writer: set-based cited observations + optional flags ─────────────
CREATE OR REPLACE FUNCTION public.record_sale_date_recovery_batch(
  p_stage text,
  p_rows jsonb,
  p_asserted_by text DEFAULT 'sale_date_recovery'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET statement_timeout TO '55s'
AS $$
DECLARE
  c_writer CONSTANT text := 'record_sale_date_recovery_batch';
  v_src uuid;
  v_ids uuid[];
  v_snap int := 0;
  v_obs int := 0;
  v_flag int := 0;
  v_skip int := 0;
  v_run_id bigint;
  v_n int;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION '%: p_rows must be a JSON array', c_writer;
  END IF;
  v_n := jsonb_array_length(p_rows);
  IF v_n > 5000 THEN
    RAISE EXCEPTION '%: at most 5000 rows per call', c_writer;
  END IF;
  IF coalesce(btrim(p_asserted_by), '') = '' THEN
    RAISE EXCEPTION '%: asserted_by required', c_writer;
  END IF;

  SELECT id INTO v_src FROM public.observation_sources WHERE slug = 'sale-date-recovery';
  IF v_src IS NULL THEN
    RAISE EXCEPTION '%: observation_sources.sale-date-recovery missing', c_writer;
  END IF;

  INSERT INTO public.sale_date_recovery_runs (stage, batch_size)
  VALUES (p_stage, v_n)
  RETURNING id INTO v_run_id;

  SELECT coalesce(array_agg(DISTINCT (r->>'event_id')::uuid)
           FILTER (WHERE nullif(r->>'event_id', '') IS NOT NULL),
         ARRAY[]::uuid[])
  INTO v_ids
  FROM jsonb_array_elements(p_rows) AS t(r);

  v_skip := v_n - coalesce(cardinality(v_ids), 0);
  v_snap := public.sale_date_recovery_snapshot_events(p_stage, v_ids);
  PERFORM set_config('app.writer', c_writer, true);

  WITH parsed AS (
    SELECT
      (r->>'event_id')::uuid AS event_id,
      nullif(r->>'vehicle_id', '')::uuid AS vehicle_id,
      nullif(r->>'source_event_at', '')::timestamptz AS source_event_at,
      nullif(r->>'precision', '') AS precision,
      nullif(r->>'basis', '') AS basis,
      left(coalesce(r->>'excerpt', ''), 500) AS excerpt,
      coalesce((r->>'confidence')::numeric, 0.5) AS confidence,
      coalesce(nullif(r->>'rule', ''), p_stage) AS rule,
      nullif(r->>'sale_truth_role', '') AS sale_truth_role,
      nullif(r->>'source_comment_id', '')::uuid AS source_comment_id
    FROM jsonb_array_elements(p_rows) AS t(r)
    WHERE nullif(r->>'event_id', '') IS NOT NULL
      AND nullif(r->>'vehicle_id', '') IS NOT NULL
  ),
  to_write AS (
    SELECT *
    FROM parsed
    WHERE source_event_at IS NOT NULL
  ),
  inserted AS (
    INSERT INTO public.vehicle_observations (
      vehicle_id, source_id, source_identifier, observed_at, observed_at_basis,
      source_event_at, source_event_time_precision, kind, content_text, content_hash,
      structured_data, citation_excerpt, confidence_score, confidence,
      source_vehicle_event_id, source_comment_id, extraction_method, is_superseded
    )
    SELECT
      w.vehicle_id,
      v_src,
      'sale_date_recovery:' || w.event_id::text || ':' || w.rule,
      now(),
      coalesce(w.basis, 'derived'),
      w.source_event_at,
      coalesce(w.precision, 'event_window'),
      'sale_result'::public.observation_kind,
      coalesce(w.excerpt, format('Recovered sale clock via %s', w.rule)),
      md5(format('sale_date_recovery|%s|%s|%s|%s',
        w.event_id, w.source_event_at, coalesce(w.basis, ''), coalesce(w.rule, ''))),
      jsonb_build_object(
        'sale_date_recovery', jsonb_build_object(
          'version', 1,
          'rule', w.rule,
          'stage', p_stage,
          'event_id', w.event_id,
          'precision', w.precision,
          'basis', w.basis,
          'confidence', w.confidence,
          'asserted_by', p_asserted_by,
          'run_id', v_run_id
        ),
        'sold_at', w.source_event_at,
        'sale_date', (w.source_event_at AT TIME ZONE 'UTC')::date::text
      ),
      w.excerpt,
      w.confidence,
      CASE
        WHEN w.confidence >= 0.85 THEN 'high'::public.confidence_level
        WHEN w.confidence >= 0.6 THEN 'medium'::public.confidence_level
        ELSE 'low'::public.confidence_level
      END,
      w.event_id,
      w.source_comment_id,
      'sale_date_recovery_v1',
      false
    FROM to_write w
    ON CONFLICT (source_id, source_identifier, kind, content_hash) DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::int INTO v_obs FROM inserted;

  WITH parsed AS (
    SELECT
      (r->>'event_id')::uuid AS event_id,
      nullif(r->>'precision', '') AS precision,
      coalesce(nullif(r->>'rule', ''), p_stage) AS rule,
      nullif(r->>'sale_truth_role', '') AS sale_truth_role
    FROM jsonb_array_elements(p_rows) AS t(r)
    WHERE nullif(r->>'event_id', '') IS NOT NULL
  ),
  upd AS (
    UPDATE public.vehicle_events e
    SET
      sale_truth_role = COALESCE(p.sale_truth_role, e.sale_truth_role),
      sold_at_precision = COALESCE(p.precision, e.sold_at_precision),
      sale_date_recovery_rule = p.rule,
      sale_date_recovery_at = now()
    FROM parsed p
    WHERE e.id = p.event_id
    RETURNING 1
  )
  SELECT count(*)::int INTO v_flag FROM upd;

  UPDATE public.sale_date_recovery_runs
  SET finished_at = now(),
      snapshotted = v_snap,
      observations_written = v_obs,
      flagged = v_flag,
      skipped = v_skip,
      notes = jsonb_build_object('asserted_by', p_asserted_by)
  WHERE id = v_run_id;

  RETURN jsonb_build_object(
    'run_id', v_run_id,
    'stage', p_stage,
    'snapshotted', v_snap,
    'observations_written', v_obs,
    'flagged', v_flag,
    'skipped', v_skip
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_sale_date_recovery_batch(text, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_sale_date_recovery_batch(text, jsonb, text) TO service_role;

COMMENT ON FUNCTION public.record_sale_date_recovery_batch(text, jsonb, text) IS
  'Service-only: snapshot vehicle_events, write cited sale_date_recovery observations, set additive flags. Never deletes; never overwrites sold_at.';

-- ─── Stage 1 drain: mecum_gooding_meta (M1/M1b + G1) ────────────────────────
CREATE OR REPLACE FUNCTION public.drain_sale_date_recovery_mecum_gooding(
  p_limit int DEFAULT 5000
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  -- Date-clock recovery owned by another lane; do not write observations here.
  RETURN jsonb_build_object(
    'stage', 'mecum_gooding_meta',
    'skipped', true,
    'reason', 'owned_elsewhere',
    'observations_written', 0
  );
END;
$$;

REVOKE ALL ON FUNCTION public.drain_sale_date_recovery_mecum_gooding(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.drain_sale_date_recovery_mecum_gooding(int) TO service_role;

COMMENT ON FUNCTION public.drain_sale_date_recovery_mecum_gooding(int) IS
  'No-op stub: Mecum/Gooding date-clock recovery is owned by another lane.';

-- Refresh Mecum lot→auction map from retained metadata (batched, idempotent).
CREATE OR REPLACE FUNCTION public.refresh_sale_date_recovery_mecum_lot_map(
  p_limit int DEFAULT 20000
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  -- Lot map refresh belongs to the date-recovery lane.
  RETURN 0;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_sale_date_recovery_mecum_lot_map(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_sale_date_recovery_mecum_lot_map(int) TO service_role;

-- ─── Stage 2 drain: other in-DB rules (M2/M3, B1, A1, C1/C2, BaT) ───────────
CREATE OR REPLACE FUNCTION public.drain_sale_date_recovery_other_rules(
  p_limit int DEFAULT 5000
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  -- Date-clock recovery owned by another lane; do not write observations here.
  RETURN jsonb_build_object(
    'stage', 'other_rules',
    'skipped', true,
    'reason', 'owned_elsewhere',
    'observations_written', 0
  );
END;
$$;

REVOKE ALL ON FUNCTION public.drain_sale_date_recovery_other_rules(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.drain_sale_date_recovery_other_rules(int) TO service_role;

-- ─── Stage 3: reclassify orphan-backfill + flag unpriced Mecum ───────────────
CREATE OR REPLACE FUNCTION public.drain_sale_date_recovery_reclassify(
  p_limit int DEFAULT 5000
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET statement_timeout TO '55s'
AS $$
DECLARE
  v_limit int := LEAST(GREATEST(coalesce(p_limit, 5000), 1), 5000);
  v_rows jsonb;
BEGIN
  -- Flag-only: does not wait on date-clock recovery (owned by another lane).
  WITH candidates AS (
    -- Orphan backfill: asking / listing, not a verified sale
    SELECT e.id AS event_id, e.vehicle_id,
      NULL::timestamptz AS source_event_at,
      'unknown'::text AS precision,
      'orphan_backfill_ask'::text AS basis,
      format('orphan-backfill-v1 on %s: asking price, not a recorded sale', coalesce(e.source_platform, 'unknown')) AS excerpt,
      0.3::numeric AS confidence,
      'orphan_backfill_reclassify'::text AS rule,
      'ask'::text AS sale_truth_role
    FROM public.vehicle_events e
    WHERE e.event_status = 'sold'
      AND e.sold_at IS NULL AND e.ended_at IS NULL
      AND e.extraction_method = 'orphan-backfill-v1'
      AND (e.sale_truth_role IS DISTINCT FROM 'ask'
           OR e.sale_date_recovery_rule IS DISTINCT FROM 'orphan_backfill_reclassify')

    UNION ALL

    -- Unpriced Mecum index "sold" rows: sale_status unverified
    SELECT e.id, e.vehicle_id,
      NULL::timestamptz,
      coalesce(e.sold_at_precision, 'event_window'),
      'mecum_unpriced_sold',
      'Mecum index row has no price; sold status unverified',
      0.4,
      'mecum_unpriced_unverified',
      'unverified_sale'
    FROM public.vehicle_events e
    WHERE e.event_status = 'sold'
      AND e.extraction_method = 'mecum-index-v1'
      AND coalesce(e.final_price, 0) = 0
      AND (e.sale_truth_role IS DISTINCT FROM 'unverified_sale'
           OR e.sale_date_recovery_rule IS DISTINCT FROM 'mecum_unpriced_unverified')
  ),
  limited AS (
    SELECT * FROM candidates ORDER BY event_id LIMIT v_limit
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'event_id', event_id,
    'vehicle_id', vehicle_id,
    'precision', precision,
    'basis', basis,
    'excerpt', excerpt,
    'confidence', confidence,
    'rule', rule,
    'sale_truth_role', sale_truth_role
  )), '[]'::jsonb)
  INTO v_rows
  FROM limited;

  IF jsonb_array_length(v_rows) = 0 THEN
    RETURN jsonb_build_object('stage', 'reclassify', 'done', true, 'flagged', 0);
  END IF;

  RETURN public.record_sale_date_recovery_batch(
    'reclassify', v_rows, 'drain_sale_date_recovery_reclassify');
END;
$$;

REVOKE ALL ON FUNCTION public.drain_sale_date_recovery_reclassify(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.drain_sale_date_recovery_reclassify(int) TO service_role;

-- ─── Stage 4: flag placeholder mid-month / auction-level dates ──────────────
CREATE OR REPLACE FUNCTION public.drain_sale_date_recovery_placeholders(
  p_limit int DEFAULT 5000
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET statement_timeout TO '55s'
AS $$
DECLARE
  v_limit int := LEAST(GREATEST(coalesce(p_limit, 5000), 1), 5000);
  v_rows jsonb;
BEGIN
  WITH candidates AS (
    -- BJ mid-month 00:00 placeholders
    SELECT e.id AS event_id, e.vehicle_id,
      coalesce(e.sold_at, e.ended_at) AS source_event_at,
      'month_placeholder'::text AS precision,
      'bj_mid_month_placeholder'::text AS basis,
      format('BJ sold_at %s is mid-month 00:00 placeholder; auction-level only', coalesce(e.sold_at, e.ended_at)) AS excerpt,
      0.55::numeric AS confidence,
      'placeholder_bj_midmonth'::text AS rule
    FROM public.vehicle_events e
    WHERE e.event_status = 'sold'
      AND e.source_platform IN ('barrettjackson', 'barrett-jackson')
      AND coalesce(e.sold_at, e.ended_at) IS NOT NULL
      AND extract(day from coalesce(e.sold_at, e.ended_at) AT TIME ZONE 'UTC') = 15
      AND (coalesce(e.sold_at, e.ended_at) AT TIME ZONE 'UTC')::time = time '00:00'
      AND (e.sold_at_precision IS DISTINCT FROM 'month_placeholder'
           OR e.sale_date_recovery_rule IS DISTINCT FROM 'placeholder_bj_midmonth')

    UNION ALL

    -- Broad Arrow day-1 midnight → auction-level
    SELECT e.id, e.vehicle_id,
      coalesce(e.sold_at, e.ended_at),
      'auction_level',
      'broad_arrow_month_start_placeholder',
      format('Broad Arrow clock %s clusters on month-start; auction-level precision', coalesce(e.sold_at, e.ended_at)),
      0.55,
      'placeholder_broad_arrow_day1'
    FROM public.vehicle_events e
    WHERE e.event_status = 'sold'
      AND e.source_platform = 'broad_arrow'
      AND coalesce(e.sold_at, e.ended_at) IS NOT NULL
      AND extract(day from coalesce(e.sold_at, e.ended_at) AT TIME ZONE 'UTC') = 1
      AND (coalesce(e.sold_at, e.ended_at) AT TIME ZONE 'UTC')::time = time '00:00'
      AND (e.sold_at_precision IS DISTINCT FROM 'auction_level'
           OR e.sale_date_recovery_rule IS DISTINCT FROM 'placeholder_broad_arrow_day1')

    UNION ALL

    -- Gooding placeholder_session
    SELECT e.id, e.vehicle_id,
      coalesce(e.sold_at, e.ended_at, (e.metadata->'auction_session_days'->>-1)::date::timestamptz),
      'auction_level',
      'gooding_placeholder_session',
      format('Gooding sold_at_basis=placeholder_session; auction-level (%s)', e.metadata->'auction_session_days'),
      0.55,
      'placeholder_gooding_session'
    FROM public.vehicle_events e
    WHERE e.event_status = 'sold'
      AND e.source_platform = 'gooding'
      AND e.metadata->>'sold_at_basis' = 'placeholder_session'
      AND (e.sold_at_precision IS DISTINCT FROM 'auction_level'
           OR e.sale_date_recovery_rule IS DISTINCT FROM 'placeholder_gooding_session')
  ),
  limited AS (
    SELECT * FROM candidates
    WHERE source_event_at IS NOT NULL OR rule LIKE 'placeholder_%'
    ORDER BY event_id
    LIMIT v_limit
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'event_id', event_id,
    'vehicle_id', vehicle_id,
    'source_event_at', source_event_at,
    'precision', precision,
    'basis', basis,
    'excerpt', excerpt,
    'confidence', confidence,
    'rule', rule
  )), '[]'::jsonb)
  INTO v_rows
  FROM limited;

  IF jsonb_array_length(v_rows) = 0 THEN
    RETURN jsonb_build_object('stage', 'placeholders', 'done', true, 'flagged', 0);
  END IF;

  RETURN public.record_sale_date_recovery_batch(
    'placeholders', v_rows, 'drain_sale_date_recovery_placeholders');
END;
$$;

REVOKE ALL ON FUNCTION public.drain_sale_date_recovery_placeholders(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.drain_sale_date_recovery_placeholders(int) TO service_role;

-- ─── Flag-only orchestrator (reclassify + placeholders) ──────────────────────
-- Date-clock recovery (Mecum/Gooding/C&B/BaT/Broad Arrow) is owned by another
-- lane. This orchestrator must not write sale-date observations or touch sold_at.
CREATE OR REPLACE FUNCTION public.drain_sale_date_recovery(
  p_limit int DEFAULT 5000
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET statement_timeout TO '55s'
AS $$
DECLARE
  r jsonb;
BEGIN
  r := public.drain_sale_date_recovery_reclassify(p_limit);
  IF coalesce((r->>'flagged')::int, 0) > 0
     OR coalesce((r->>'observations_written')::int, 0) > 0
     OR coalesce((r->>'done')::boolean, false) IS NOT TRUE THEN
    IF coalesce((r->>'done')::boolean, false) IS NOT TRUE THEN
      RETURN r || jsonb_build_object('orchestrator', 'reclassify');
    END IF;
  END IF;

  r := public.drain_sale_date_recovery_placeholders(p_limit);
  RETURN r || jsonb_build_object('orchestrator', 'placeholders');
END;
$$;

REVOKE ALL ON FUNCTION public.drain_sale_date_recovery(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.drain_sale_date_recovery(int) TO service_role;

-- Best recovered sale clock per event (advisor / readers)
CREATE OR REPLACE FUNCTION public.sale_date_recovery_best_for_events(p_event_ids uuid[])
RETURNS TABLE (
  event_id uuid,
  source_event_at timestamptz,
  precision text,
  basis text,
  confidence numeric,
  observation_id uuid,
  citation_excerpt text,
  rule text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT DISTINCT ON (o.source_vehicle_event_id)
    o.source_vehicle_event_id,
    o.source_event_at,
    o.source_event_time_precision,
    o.observed_at_basis,
    o.confidence_score,
    o.id,
    o.citation_excerpt,
    o.structured_data #>> '{sale_date_recovery,rule}'
  FROM public.vehicle_observations o
  WHERE o.source_vehicle_event_id = ANY (p_event_ids)
    AND o.extraction_method = 'sale_date_recovery_v1'
    AND o.is_superseded IS NOT TRUE
    AND o.source_event_at IS NOT NULL
  ORDER BY o.source_vehicle_event_id, o.confidence_score DESC NULLS LAST, o.observed_at DESC;
$$;

REVOKE ALL ON FUNCTION public.sale_date_recovery_best_for_events(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sale_date_recovery_best_for_events(uuid[]) TO service_role, authenticated, anon;

-- Coverage probe (read-only helper for reports)
CREATE OR REPLACE FUNCTION public.sale_date_recovery_coverage()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT jsonb_build_object(
    'as_of', now(),
    'undated_sold', (
      SELECT count(*) FROM public.vehicle_events
      WHERE event_status = 'sold' AND sold_at IS NULL AND ended_at IS NULL
    ),
    'undated_sold_unrecovered', (
      SELECT count(*) FROM public.vehicle_events e
      WHERE e.event_status = 'sold' AND e.sold_at IS NULL AND e.ended_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.vehicle_observations o
          WHERE o.source_vehicle_event_id = e.id
            AND o.extraction_method = 'sale_date_recovery_v1'
            AND o.is_superseded IS NOT TRUE
            AND o.source_event_at IS NOT NULL
        )
    ),
    'undated_by_platform', (
      SELECT coalesce(jsonb_object_agg(src, n), '{}'::jsonb)
      FROM (
        SELECT coalesce(source_platform, '(null)') AS src, count(*)::int AS n
        FROM public.vehicle_events
        WHERE event_status = 'sold' AND sold_at IS NULL AND ended_at IS NULL
        GROUP BY 1
        ORDER BY 2 DESC
        LIMIT 40
      ) s
    ),
    'recovered_obs', (
      SELECT count(*) FROM public.vehicle_observations
      WHERE extraction_method = 'sale_date_recovery_v1' AND is_superseded IS NOT TRUE
        AND source_event_at IS NOT NULL
    ),
    'month_placeholder_dated', (
      SELECT count(*) FROM public.vehicle_events
      WHERE event_status = 'sold'
        AND coalesce(sold_at, ended_at) IS NOT NULL
        AND extract(day from coalesce(sold_at, ended_at) AT TIME ZONE 'UTC') = 15
        AND (coalesce(sold_at, ended_at) AT TIME ZONE 'UTC')::time = time '00:00'
    ),
    'placeholder_flagged', (
      SELECT count(*) FROM public.vehicle_events
      WHERE sold_at_precision IN ('month_placeholder', 'auction_level')
    ),
    'placeholder_by_platform', (
      SELECT coalesce(jsonb_object_agg(src, n), '{}'::jsonb)
      FROM (
        SELECT coalesce(source_platform, '(null)') AS src, count(*)::int AS n
        FROM public.vehicle_events
        WHERE sold_at_precision IN ('month_placeholder', 'auction_level')
        GROUP BY 1
        ORDER BY 2 DESC
        LIMIT 20
      ) s
    ),
    'by_role', (
      SELECT coalesce(jsonb_object_agg(coalesce(sale_truth_role, 'unset'), n), '{}'::jsonb)
      FROM (
        SELECT sale_truth_role, count(*)::int AS n
        FROM public.vehicle_events
        WHERE sale_truth_role IS NOT NULL OR sale_date_recovery_at IS NOT NULL
        GROUP BY sale_truth_role
      ) s
    ),
    'bj_calendar_rows', (SELECT count(*) FROM public.bj_auction_calendar),
    'runs', (SELECT count(*) FROM public.sale_date_recovery_runs)
  );
$$;

REVOKE ALL ON FUNCTION public.sale_date_recovery_coverage() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sale_date_recovery_coverage() TO service_role, authenticated;

-- Record pre-migration baseline
INSERT INTO public.sale_date_recovery_baselines (label, payload)
SELECT 'pre_recovery', public.sale_date_recovery_coverage();

-- Schedule flag-only drain (reclassify + placeholders). No date-clock writes.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid)
    FROM cron.job
    WHERE jobname IN (
      'sale-date-recovery-mecum-gooding',
      'sale-date-recovery-drain'
    );
    PERFORM cron.schedule(
      'sale-date-recovery-drain',
      '*/2 * * * *',
      $cron$SELECT public.drain_sale_date_recovery(4000)$cron$
    );
  END IF;
END $$;

-- Kick first flag-only batch (orphan-backfill reclassify). Does not write sold_at.
SELECT public.drain_sale_date_recovery_reclassify(500);

GRANT SELECT ON public.bj_auction_calendar TO authenticated;
GRANT SELECT ON public.sale_date_recovery_baselines TO authenticated;
GRANT SELECT ON public.sale_date_recovery_runs TO service_role;
GRANT ALL ON public.sale_date_recovery_snapshots TO service_role;
GRANT ALL ON public.sale_date_recovery_runs TO service_role;
GRANT ALL ON public.sale_date_recovery_baselines TO service_role;
GRANT ALL ON public.sale_date_recovery_mecum_lot_map TO service_role;
GRANT ALL ON public.bj_auction_calendar TO service_role;
