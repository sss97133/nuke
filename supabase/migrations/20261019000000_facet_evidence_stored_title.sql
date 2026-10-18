-- record_facet_evidence accepts a proposal only when the vehicle's own stored title carries it.
-- The first version checked the value against a caller-supplied cited_title, which nothing bound to stored testimony.
-- It now checks vehicles.listing_title (else vehicles.title), keeps the caller's string in raw_extraction_data, and
-- leaves as pending: a title naming a replica, tribute, clone, conversion, kit, engine or parts; an engine option
-- proposed as a trim (427/435, L88, Cobra Jet); a bed length or cab proposed as a body style (Short Bed, Crew Cab).
-- Registers this function as the writer that fills vehicles.series, trim and body_style after intake.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION public.record_facet_evidence(p_proposals jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c_writer     CONSTANT text := 'record_facet_evidence';
  c_fields     CONSTANT text[] := ARRAY['series', 'trim', 'body_style'];
  c_listing    CONSTANT text[] := ARRAY['cars_and_bids_listing', 'bat_listing', 'mecum_listing', 'barrett-jackson_listing',
                                        'rm_sothebys_listing', 'bonhams_listing', 'gooding_listing', 'pcarmarket_listing',
                                        'facebook_marketplace_listing', 'craigslist_listing'];
  c_derived    CONSTANT text[] := ARRAY['derived_chassis_rule'];
  v_timeout_ms bigint := (SELECT setting::bigint FROM pg_settings WHERE name = 'statement_timeout');
  v_n          integer;
  v_accepted   integer;
  v_pending    integer;
  v_filled     integer := 0;
  v_narrowed   integer := 0;
  v_rows       integer;
BEGIN
  IF v_timeout_ms < 1 OR v_timeout_ms > 60000 THEN
    RAISE EXCEPTION '%: caller must set statement_timeout between 1 ms and 60 s (now % ms)', c_writer, v_timeout_ms;
  END IF;
  IF p_proposals IS NULL OR jsonb_typeof(p_proposals) <> 'array' THEN
    RAISE EXCEPTION '%: p_proposals must be a json array', c_writer;
  END IF;
  v_n := jsonb_array_length(p_proposals);
  IF v_n > 500 THEN RAISE EXCEPTION '%: at most 500 proposals per call (got %)', c_writer, v_n; END IF;
  PERFORM set_config('lock_timeout', '3s', true);

  CREATE TEMP TABLE IF NOT EXISTS facet_proposals (
    vehicle_id uuid, field text, value text, source_type text, cited_title text, derivation text,
    expected_live text, narrow boolean, live text, cited boolean, status text, stored_title text
  ) ON COMMIT DROP;
  TRUNCATE facet_proposals;

  INSERT INTO facet_proposals (vehicle_id, field, value, source_type, cited_title, derivation, expected_live, narrow)
  SELECT (p ->> 'vehicle_id')::uuid, p ->> 'field', nullif(btrim(p ->> 'value'), ''), p ->> 'source_type',
         nullif(btrim(p ->> 'cited_title'), ''), nullif(btrim(p ->> 'derivation'), ''),
         nullif(btrim(p ->> 'expected_live'), ''), coalesce((p ->> 'narrow')::boolean, false)
  FROM jsonb_array_elements(p_proposals) p;

  IF EXISTS (SELECT 1 FROM facet_proposals WHERE vehicle_id IS NULL OR value IS NULL) THEN
    RAISE EXCEPTION '%: every proposal needs vehicle_id and value', c_writer;
  END IF;
  IF EXISTS (SELECT 1 FROM facet_proposals WHERE field <> ALL (c_fields)) THEN
    RAISE EXCEPTION '%: field must be one of %', c_writer, c_fields;
  END IF;
  IF EXISTS (SELECT 1 FROM facet_proposals WHERE source_type <> ALL (c_listing || c_derived)) THEN
    RAISE EXCEPTION '%: source_type must be a listing source or derived_chassis_rule', c_writer;
  END IF;
  IF EXISTS (SELECT 1 FROM facet_proposals WHERE length(value) > 60) THEN
    RAISE EXCEPTION '%: value longer than 60 characters', c_writer;
  END IF;
  IF EXISTS (SELECT 1 FROM facet_proposals WHERE source_type = ANY (c_derived) AND derivation IS NULL) THEN
    RAISE EXCEPTION '%: a derived proposal must name its derivation', c_writer;
  END IF;
  IF EXISTS (SELECT 1 FROM facet_proposals WHERE narrow AND field <> 'series') THEN
    RAISE EXCEPTION '%: only series may be narrowed', c_writer;
  END IF;

  UPDATE facet_proposals f
     SET live = CASE f.field WHEN 'series' THEN nullif(btrim(v.series), '')
                             WHEN 'trim' THEN nullif(btrim(v.trim), '')
                             ELSE nullif(btrim(v.body_style), '') END,
         stored_title = coalesce(nullif(btrim(v.listing_title), ''), nullif(btrim(v.title), ''))
    FROM public.vehicles v
   WHERE v.id = f.vehicle_id;

  UPDATE facet_proposals f
     SET cited = f.source_type = ANY (c_listing) AND f.stored_title IS NOT NULL
             AND position(' ' || btrim(lower(regexp_replace(f.value, '[^A-Za-z0-9]+', ' ', 'g'))) || ' '
                          IN ' ' || lower(regexp_replace(f.stored_title, '[^A-Za-z0-9]+', ' ', 'g')) || ' ') > 0
             -- A copy, a part or a conversion quotes a badge it is not.
             AND f.stored_title !~* '\m(replica|tribute|clone|recreation|re-creation|continuation|kit|evocation|homage|conversion|engine|motor|parts?|body only|shell)\M'
             -- An engine option is not a trim; a bed length or cab is not a body style.
             AND NOT (f.field = 'trim' AND btrim(f.value) ~* '^(\d{3,4}(\s*/\s*\d{3})?(\s*(ci|cid|hp|v-?8))?|L\d{2}|LS\d|LT-?\d|(super\s+)?cobra\s+jet|hemi|426\s+hemi|fuel\s+injected|fuelie)$')
             AND NOT (f.field = 'body_style' AND btrim(f.value) ~* '^((short|long)[\s-]?(bed|box)|(crew|extended|regular|single|standard|super|club|king|extra|double|quad)[\s-]?cab)$');
  UPDATE facet_proposals SET status = CASE WHEN cited THEN 'accepted' ELSE 'pending' END;

  WITH ins AS (
    INSERT INTO public.field_evidence (
      vehicle_id, field_name, proposed_value, source_type, source_confidence,
      extraction_context, status, assigned_at, assigned_by, raw_extraction_data
    )
    SELECT f.vehicle_id, f.field, f.value, f.source_type,
           CASE WHEN f.cited THEN 75 ELSE 55 END,
           coalesce(f.stored_title, f.cited_title), f.status, CASE WHEN f.cited THEN now() END, c_writer,
           jsonb_strip_nulls(jsonb_build_object('derivation', f.derivation, 'value_in_stored_title', f.cited, 'caller_cited_title', f.cited_title, 'live_value', f.live))
    FROM facet_proposals f
    JOIN public.vehicles v ON v.id = f.vehicle_id
    ON CONFLICT (vehicle_id, field_name, source_type, proposed_value) DO NOTHING
    RETURNING status
  )
  SELECT count(*) FILTER (WHERE status = 'accepted'), count(*) FILTER (WHERE status = 'pending')
    INTO v_accepted, v_pending FROM ins;

  PERFORM set_config('app.writer', c_writer, true);

  UPDATE public.vehicles v SET series = f.value
    FROM facet_proposals f
   WHERE f.vehicle_id = v.id AND f.field = 'series' AND f.cited AND NOT f.narrow AND nullif(btrim(v.series), '') IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_filled := v_filled + v_rows;
  UPDATE public.vehicles v SET trim = f.value
    FROM facet_proposals f
   WHERE f.vehicle_id = v.id AND f.field = 'trim' AND f.cited AND nullif(btrim(v.trim), '') IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_filled := v_filled + v_rows;
  UPDATE public.vehicles v SET body_style = f.value
    FROM facet_proposals f
   WHERE f.vehicle_id = v.id AND f.field = 'body_style' AND f.cited AND nullif(btrim(v.body_style), '') IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_filled := v_filled + v_rows;

  -- Narrowing: the live series must equal the caller's expected value, list several codes, and contain the new code.
  CREATE TEMP TABLE IF NOT EXISTS facet_narrow (vehicle_id uuid, was text, now_value text, derivation text) ON COMMIT DROP;
  TRUNCATE facet_narrow;
  -- Codes are separated by " / " when a code has its own slash ("E36/7 / E36/8"), else by "/" ("E90/E92/E93");
  -- a trailing model suffix ("E90/E92/E93 M3") applies to every code.
  INSERT INTO facet_narrow
  SELECT f.vehicle_id, f.live, f.value, f.derivation
  FROM facet_proposals f
  CROSS JOIN LATERAL (
    SELECT regexp_replace(f.live, '\s+(M\d)$', '') AS base, substring(f.live FROM '\s+(M\d)$') AS suffix
  ) s
  CROSS JOIN LATERAL (
    SELECT CASE WHEN s.base ~ '\s/\s' THEN regexp_split_to_array(s.base, '\s+/\s+')
                ELSE regexp_split_to_array(s.base, '/') END AS codes
  ) c
  WHERE f.narrow
    AND f.live IS NOT NULL AND f.live = f.expected_live
    AND array_length(c.codes, 1) > 1
    AND (f.value = ANY (c.codes) OR (s.suffix IS NOT NULL AND f.value = ANY (
          SELECT code || ' ' || s.suffix FROM unnest(c.codes) code)));

  INSERT INTO public.superseded_rows (source_table, row_id, row_data, asserted_by, source, reason)
  SELECT 'vehicles', n.vehicle_id, jsonb_build_object('field', 'series', 'value', n.was, 'replacement', n.now_value),
         c_writer, jsonb_build_object('type', 'derived_chassis_rule', 'derivation', n.derivation),
         'Multi-code series narrowed to one of its own codes'
  FROM facet_narrow n;

  UPDATE public.vehicles v SET series = n.now_value
    FROM facet_narrow n
   WHERE v.id = n.vehicle_id AND v.series = n.was;
  GET DIAGNOSTICS v_narrowed = ROW_COUNT;

  RETURN jsonb_build_object('proposals', v_n, 'evidence_accepted', v_accepted, 'evidence_pending', v_pending,
                            'filled', v_filled, 'narrowed', v_narrowed);
END;
$function$;

REVOKE ALL ON FUNCTION public.record_facet_evidence(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_facet_evidence(jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.record_facet_evidence(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_facet_evidence(jsonb) TO service_role;

INSERT INTO public.pipeline_registry (table_name, column_name, owned_by, description, do_not_write_directly, write_via)
SELECT 'vehicles', c, 'record_facet_evidence',
       'Filled after intake only from accepted field_evidence whose value reads as whole words in the stored listing title. Extractors may set it when they create the row; later fills go through record_facet_evidence.',
       false, 'record_facet_evidence(p_proposals jsonb)'
FROM unnest(ARRAY['series', 'trim', 'body_style']) c
WHERE NOT EXISTS (SELECT 1 FROM public.pipeline_registry r WHERE r.table_name = 'vehicles' AND r.column_name = c);

COMMIT;
