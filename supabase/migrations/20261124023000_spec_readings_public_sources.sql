-- Spec readings: public sources only (20261124023000), follow-up to 20261124020000 / 20261124022000.
-- 1. text_code_decode_v2 reads only observations an anonymous reader may see (observation_is_public, and not a speaker-only
--    statement or correction), and skips financial field_evidence sources. Provenance observations are not public, so they are
--    no longer read.
-- 2. Readings already taken from such observations are backed up to vehicle_code_readings_backup and removed, then the
--    affected vehicles are rescored. None are folded into sets yet (no v2 membership run has planned), and the removal refuses
--    to run if any are.
-- 3. field_coverage_snapshot_v1 no_text uses the same field_evidence fields and the same public observation rule as the reader.
-- Revert: supabase/sql/revert_20261124023000_spec_readings_public_sources.sql (restores the 20261124022000 bodies; removed
-- rows stay in vehicle_code_readings_backup).

begin;
set local lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.text_code_decode_v2(p_run uuid, p_scope text DEFAULT 'pontiac_f_body'::text, p_vehicle uuid DEFAULT NULL::uuid,
  p_batch integer DEFAULT 200, p_from integer DEFAULT 1, p_count integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '900s'
AS $function$
DECLARE v_ids uuid[]; v_chunk uuid[]; i int; v_end int; n int := 0; b int := 0;
BEGIN
  IF p_run IS NULL THEN RAISE EXCEPTION 'text_code_decode_v2: run required'; END IF;
  IF p_scope NOT IN ('vehicle','pontiac_f_body','ford_mustang_65_73','chevrolet_camaro_67_69','platform_sample_v1') THEN
    RAISE EXCEPTION 'text_code_decode_v2: unknown scope %', p_scope;
  END IF;
  IF p_scope = 'vehicle' AND p_vehicle IS NULL THEN RAISE EXCEPTION 'text_code_decode_v2: scope vehicle needs a vehicle'; END IF;
  IF p_batch NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'text_code_decode_v2: batch must be 1..1000'; END IF;
  IF p_from IS NULL OR p_from < 1 THEN RAISE EXCEPTION 'text_code_decode_v2: p_from starts at 1'; END IF;
  IF p_from = 1 AND EXISTS (SELECT 1 FROM public.vehicle_code_reading_runs r WHERE r.run_id = p_run::text) THEN
    RAISE EXCEPTION 'text_code_decode_v2: run % already exists', p_run;
  END IF;
  IF p_from > 1 AND NOT EXISTS (SELECT 1 FROM public.vehicle_code_reading_runs r WHERE r.run_id = p_run::text
                                   AND r.status = 'applying' AND r.scope = p_scope AND r.producer = 'text_code_decode_v2') THEN
    RAISE EXCEPTION 'text_code_decode_v2: run % is not open for scope %', p_run, p_scope;
  END IF;
  SELECT array_agg(x ORDER BY x) INTO v_ids FROM unnest(coalesce(public.data_set_scope_vehicles(p_scope, p_vehicle), '{}')) x
   WHERE x::text NOT LIKE '9cf5b7a4%';
  v_ids := coalesce(v_ids, '{}');
  IF p_from = 1 THEN
    INSERT INTO public.vehicle_code_reading_runs (run_id, producer, logic_version, scope, n_vehicles)
    VALUES (p_run::text, 'text_code_decode_v2', 'text_code_decode/20261124020000.1', p_scope, cardinality(v_ids));
  END IF;
  i := p_from;
  v_end := least(cardinality(v_ids), CASE WHEN p_count IS NULL THEN cardinality(v_ids) ELSE p_from + p_count - 1 END);
  WHILE i <= v_end LOOP
    v_chunk := v_ids[i : least(i + p_batch - 1, v_end)];
    WITH veh AS (
      SELECT x.* FROM public.vehicles x
       WHERE x.id = ANY (v_chunk) AND x.deleted_at IS NULL AND x.merged_into_vehicle_id IS NULL
         AND x.status IS DISTINCT FROM 'merged' AND x.make IS NOT NULL),
    src AS (
      -- listing text on the vehicle row: titles, the description's opening (body / trim), and the listing text columns
      SELECT x.id AS vehicle_id, x.year, x.make, x.model, x.is_replica, 'vehicles'::text AS ot, x.id AS oid, c.col, c.s, c.txt,
             1.0::numeric AS f
        FROM veh x
       CROSS JOIN LATERAL (VALUES ('listing_title', 'title', x.listing_title), ('bat_listing_title', 'title', x.bat_listing_title),
                                  ('title', 'title', x.title), ('description', 'lead', left(x.description, 400)),
                                  ('description', 'listing', x.description), ('highlights', 'listing', x.highlights),
                                  ('equipment', 'listing', x.equipment), ('modifications', 'listing', x.modifications),
                                  ('numbers_quote', 'listing', x.numbers_quote)) c(col, s, txt)
       WHERE c.txt IS NOT NULL AND btrim(c.txt) <> ''
      UNION ALL
      -- listing captures kept as observations (eBay, dealer pages, archived listings)
      SELECT x.id, x.year, x.make, x.model, x.is_replica, 'vehicle_observations', o.id, 'content_text', 'listing', o.content_text, 1.0
        FROM veh x JOIN public.vehicle_observations o ON o.vehicle_id = x.id
       WHERE o.kind::text IN ('listing','specification') AND NOT coalesce(o.is_superseded, false)
         -- only rows an anonymous reader may see: speaker-only statements and corrections stay out of shared sets
         AND public.observation_is_public(o.kind, o.structured_data)
         AND coalesce(o.extraction_method, '') <> ALL (ARRAY['garage_owner_correction_v1','owner_statement_v1',
               'owner_statement_org_link_v1','vehicle_statement_v1','work_order_payment_witness_sign_v1'])
         AND o.content_text IS NOT NULL AND length(o.content_text) BETWEEN 20 AND 60000
      UNION ALL
      -- extracted field values: short structured strings, read like a title
      SELECT x.id, x.year, x.make, x.model, x.is_replica, 'field_evidence', f.id, 'proposed_value', 'title', f.proposed_value, 0.9
        FROM veh x JOIN public.field_evidence f ON f.vehicle_id = x.id
       WHERE f.field_name IN ('transmission','transmission_speeds','transmission_details','body_style','body_type','trim','series',
                              'engine_size','engine_displacement','engine_type','engine','engine_code','factory_engine','factory_engine_code')
         AND coalesce(f.status, '') NOT IN ('rejected','superseded') AND f.proposed_value IS NOT NULL
         AND coalesce(f.source_type, '') <> ALL (ARRAY['quickbooks','invoice','email_receipt','receipt','bank_statement','card_statement'])
         AND length(f.proposed_value) BETWEEN 2 AND 300
      UNION ALL
      SELECT x.id, x.year, x.make, x.model, x.is_replica, 'auction_comments', ac.id, 'comment_text', 'comment', ac.comment_text, 0.6
        FROM veh x JOIN public.auction_comments ac ON ac.vehicle_id = x.id
       WHERE ac.comment_type IS DISTINCT FROM 'bid' AND ac.comment_type IS DISTINCT FROM 'sold' AND ac.comment_text IS NOT NULL
         -- a question states nothing about the car
         AND ac.has_question IS NOT TRUE
         AND (ac.comment_text ~* '(code|rpo|ratio|gear|posi|muncie|turbo|th-?[234]00|glide|m-?2[012]|t-?10|loader|fmx|paint|trim|axle|dso|casting|stamp|tag|case|housing|[2-5]\.[0-9]{2})'
              OR ac.comment_text ~ '\m[A-Z](?:[0-9][A-Z0-9]|[A-Z][0-9])\M')),
    hits AS (
      SELECT s.vehicle_id, s.year, lower(btrim(s.make)) AS mk, s.is_replica, s.ot, s.oid, s.col, s.s, s.f,
             t.kind, t.code, t.match_text, t.match_offset, t.pattern_key, t.base_conf
        FROM src s CROSS JOIN LATERAL public.text_spec_matches_v2(s.txt, s.s, s.make, s.model) t
      UNION ALL
      SELECT s.vehicle_id, s.year, lower(btrim(s.make)), s.is_replica, s.ot, s.oid, s.col, s.s, s.f,
             t.kind, t.code, t.match_text, NULL::int, t.pattern_key, t.base_conf
        FROM src s CROSS JOIN LATERAL public.text_code_matches_v1(s.txt) t
       WHERE s.s IN ('listing','comment')),
    ok AS (
      SELECT h.* FROM hits h
       WHERE h.code ~ '^[A-Z0-9][A-Z0-9._-]{0,23}$'
         -- Pontiac engine stamps must be a cited code for that year; Ford letters are read for 1960-79 cars only
         AND (h.kind <> 'engine_code' OR (h.pattern_key = 'ford_letter_code' AND h.year BETWEEN 1960 AND 1979) OR EXISTS (
               SELECT 1 FROM public.vehicle_decode_rules d WHERE d.rule_key = 'engine_stamp_code' AND d.superseded_at IS NULL
                  AND lower(d.make) = h.mk AND upper(d.code) = h.code AND d.year_min <= h.year AND d.year_max >= h.year))
         AND (h.kind NOT IN ('paint_code','cowl_style','cowl_option','body_style','trim_level','rpo_code','interior_trim_code',
                             'documentation','build_date','original_msrp') OR h.year IS NOT NULL)
         AND (h.kind <> 'trim_level' OR h.is_replica IS NOT TRUE)
         AND (h.kind <> 'rpo_code' OR h.pattern_key = 'rpo_label'
              OR public.text_rpo_known_v1(h.code, h.mk, h.year, h.pattern_key = 'rpo_bare'))
         AND (h.kind <> 'build_date' OR left(h.code, 4)::int BETWEEN h.year - 1 AND h.year)
         AND (h.kind <> 'original_msrp' OR (h.year < 1990 AND h.code::bigint BETWEEN 1500 AND 150000)
              OR (h.year >= 1990 AND h.code::bigint BETWEEN 5000 AND 5000000))),
    one AS (
      SELECT DISTINCT ON (o.vehicle_id, o.kind, o.code, o.ot, o.oid, o.col) o.*
        FROM ok o ORDER BY o.vehicle_id, o.kind, o.code, o.ot, o.oid, o.col, o.base_conf * o.f DESC, o.pattern_key)
    INSERT INTO public.vehicle_code_readings (vehicle_id, kind, code, model_year, origin_table, origin_id, origin_column, match_text,
      match_offset, pattern_key, confidence, base_confidence, rule_version, run_id)
    SELECT o.vehicle_id, o.kind, o.code, o.year, o.ot, o.oid, o.col,
           CASE WHEN o.ot IN ('vehicles','vehicle_observations','field_evidence') AND o.kind <> 'selling_dealer' THEN o.match_text END,
           CASE WHEN o.ot IN ('vehicles','vehicle_observations','field_evidence') THEN o.match_offset END,
           o.pattern_key, round(o.base_conf * o.f, 3), round(o.base_conf * o.f, 3), 'text_code_decode_v2', p_run::text
      FROM one o
    ON CONFLICT (vehicle_id, kind, code, origin_table, origin_id, origin_column) WHERE state = 'active' DO NOTHING;
    GET DIAGNOSTICS b = ROW_COUNT;
    n := n + b;
    PERFORM public.text_code_rescore_v1(v_chunk);
    i := i + p_batch;
  END LOOP;
  IF v_end < cardinality(v_ids) THEN
    RETURN jsonb_build_object('run_id', p_run, 'vehicles', cardinality(v_ids), 'inserted_this_slice', n, 'next_from', v_end + 1, 'done', false);
  END IF;
  UPDATE public.vehicle_code_reading_runs SET status = 'applied', applied_at = now(),
         summary = jsonb_build_object('inserted', (SELECT count(*) FROM public.vehicle_code_readings r WHERE r.run_id = p_run::text),
           'by_kind', (SELECT jsonb_object_agg(k, c) FROM (SELECT r.kind || ':' || r.origin_table AS k, count(*) AS c
                         FROM public.vehicle_code_readings r WHERE r.run_id = p_run::text GROUP BY 1) z),
           'vehicles_with_readings', (SELECT count(DISTINCT r.vehicle_id) FROM public.vehicle_code_readings r WHERE r.run_id = p_run::text))
   WHERE run_id = p_run::text;
  RETURN (SELECT jsonb_build_object('run_id', run_id, 'vehicles', n_vehicles, 'done', true, 'inserted_this_slice', n) || summary
            FROM public.vehicle_code_reading_runs WHERE run_id = p_run::text);
END
$function$;

CREATE OR REPLACE FUNCTION public.field_coverage_snapshot_v1(p_snapshot text, p_phase text, p_scope text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '600s'
AS $function$
DECLARE v_ids uuid[]; v_rows int;
BEGIN
  IF p_snapshot IS NULL OR p_phase IS NULL THEN RAISE EXCEPTION 'field_coverage_snapshot_v1: snapshot and phase required'; END IF;
  v_ids := coalesce(public.data_set_scope_vehicles(p_scope, NULL), '{}');
  WITH veh AS (
    SELECT x.* FROM public.vehicles x WHERE x.id = ANY (v_ids) AND x.deleted_at IS NULL AND x.merged_into_vehicle_id IS NULL),
  f(field, set_kinds, reading_kinds) AS (VALUES
    ('body_style', ARRAY['cowl_style','body_style'], ARRAY['cowl_style','body_style']),
    ('trim_level', ARRAY['vin_series','trim_level'], ARRAY['trim_level']),
    ('engine', ARRAY['vin_engine','engine_code','engine_cid','engine_block_casting'], ARRAY['engine_code','engine_cid','engine_block_casting']),
    ('transmission', ARRAY['trans_type','trans_speeds','trans_model','trans_case_casting','trans_tail_casting'],
                     ARRAY['trans_type','trans_speeds','trans_model','trans_case_casting','trans_tail_casting']),
    ('axle_ratio', ARRAY['axle_ratio'], ARRAY['axle_ratio']),
    ('paint_code', ARRAY['paint_code'], ARRAY['paint_code']),
    ('interior_trim_code', ARRAY['interior_trim_code'], ARRAY['interior_trim_code']),
    ('rpo_option_codes', ARRAY['cowl_option','rpo_code'], ARRAY['cowl_option','rpo_code']),
    ('build_date', ARRAY['build_month'], ARRAY['build_date']),
    ('original_msrp', ARRAY[]::text[], ARRAY['original_msrp']),
    ('dealer_zone', ARRAY['dealer_zone'], ARRAY['selling_dealer','dealer_zone']),
    ('documentation', ARRAY['documentation'], ARRAY['documentation'])),
  per AS (
    SELECT f.field, x.id,
      CASE f.field
        WHEN 'body_style' THEN nullif(btrim(coalesce(x.body_style, x.canonical_body_style, '')), '') IS NOT NULL
        WHEN 'trim_level' THEN nullif(btrim(coalesce(x.trim_level, x.trim, '')), '') IS NOT NULL
        WHEN 'engine' THEN nullif(btrim(coalesce(x.engine_size, x.engine_displacement, x.displacement, x.engine_code, '')), '') IS NOT NULL
                           OR x.engine_liters IS NOT NULL
        WHEN 'transmission' THEN nullif(btrim(coalesce(x.transmission, x.transmission_type, x.transmission_model, x.transmission_code, '')), '') IS NOT NULL
                           OR x.transmission_speeds IS NOT NULL
        WHEN 'axle_ratio' THEN x.rear_axle_ratio IS NOT NULL
        WHEN 'paint_code' THEN nullif(btrim(coalesce(x.paint_code, '')), '') IS NOT NULL
        WHEN 'original_msrp' THEN x.msrp IS NOT NULL
        WHEN 'documentation' THEN (x.documents_on_hand IS NOT NULL AND x.documents_on_hand NOT IN ('null'::jsonb, '[]'::jsonb, '{}'::jsonb))
                           OR coalesce(cardinality(x.numbers_documented_by), 0) > 0
        ELSE false END AS typed,
      EXISTS (SELECT 1 FROM public.data_set_members m JOIN public.data_sets s ON s.id = m.set_id
               WHERE m.vehicle_id = x.id AND m.state = 'active' AND s.set_kind = ANY (f.set_kinds)) AS in_sets,
      EXISTS (SELECT 1 FROM public.vehicle_code_readings r WHERE r.vehicle_id = x.id AND r.state = 'active'
                AND r.kind = ANY (f.reading_kinds)) AS keyed
      FROM veh x CROSS JOIN f),
  notext AS (
    SELECT count(*) AS n FROM veh x
     WHERE coalesce(btrim(x.description), '') = '' AND coalesce(btrim(x.highlights), '') = '' AND coalesce(btrim(x.equipment), '') = ''
       AND coalesce(btrim(x.listing_title), '') = '' AND coalesce(btrim(x.bat_listing_title), '') = '' AND coalesce(btrim(x.title), '') = ''
       AND coalesce(btrim(x.modifications), '') = '' AND coalesce(btrim(x.numbers_quote), '') = ''
       AND NOT EXISTS (SELECT 1 FROM public.field_evidence fe WHERE fe.vehicle_id = x.id AND fe.proposed_value IS NOT NULL
                         AND fe.field_name IN ('transmission','transmission_speeds','transmission_details','body_style','body_type','trim',
                              'series','engine_size','engine_displacement','engine_type','engine','engine_code','factory_engine','factory_engine_code')
                         AND coalesce(fe.status, '') NOT IN ('rejected','superseded')
                         AND coalesce(fe.source_type, '') <> ALL (ARRAY['quickbooks','invoice','email_receipt','receipt','bank_statement','card_statement']))
       AND NOT EXISTS (SELECT 1 FROM public.vehicle_observations o WHERE o.vehicle_id = x.id AND o.kind::text IN ('listing','specification')
                         AND o.content_text IS NOT NULL AND NOT coalesce(o.is_superseded, false)
                         AND public.observation_is_public(o.kind, o.structured_data)
                         AND coalesce(o.extraction_method, '') <> ALL (ARRAY['garage_owner_correction_v1','owner_statement_v1',
                               'owner_statement_org_link_v1','vehicle_statement_v1','work_order_payment_witness_sign_v1']))
       AND NOT EXISTS (SELECT 1 FROM public.auction_comments ac WHERE ac.vehicle_id = x.id AND ac.comment_type IS DISTINCT FROM 'bid'
                         AND ac.comment_type IS DISTINCT FROM 'sold'))
  INSERT INTO public.field_coverage_snapshots (snapshot_id, phase, cohort, field, n_vehicles, typed, in_sets, keyed, landed, no_text,
    method, logic_version)
  SELECT p_snapshot, p_phase, p_scope, per.field, count(*), count(*) FILTER (WHERE per.typed), count(*) FILTER (WHERE per.in_sets),
         count(*) FILTER (WHERE per.keyed), count(*) FILTER (WHERE per.typed OR per.in_sets OR per.keyed), (SELECT n FROM notext),
         CASE WHEN p_scope = 'platform_sample_v1' THEN 'frozen 0.5% block sample (coverage_sample_vehicles platform_v1)' ELSE 'full cohort scan' END,
         'field_coverage/20261124023000.1'
    FROM per GROUP BY per.field
  ON CONFLICT (snapshot_id, phase, cohort, field) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN (SELECT jsonb_build_object('snapshot', p_snapshot, 'cohort', p_scope, 'rows', v_rows, 'fields',
            jsonb_object_agg(s.field, jsonb_build_object('n', s.n_vehicles, 'typed', s.typed, 'in_sets', s.in_sets, 'keyed', s.keyed,
                                                         'landed', s.landed)))
            FROM public.field_coverage_snapshots s WHERE s.snapshot_id = p_snapshot AND s.phase = p_phase AND s.cohort = p_scope);
END
$function$;

DO $do$
DECLARE v_veh uuid[]; n_bk int;
BEGIN
  CREATE TEMP TABLE spec_private_readings ON COMMIT DROP AS
  SELECT r.id, r.vehicle_id FROM public.vehicle_code_readings r JOIN public.vehicle_observations o ON o.id = r.origin_id
   WHERE r.origin_table = 'vehicle_observations' AND r.rule_version = 'text_code_decode_v2'
     AND (NOT public.observation_is_public(o.kind, o.structured_data)
          OR coalesce(o.extraction_method, '') = ANY (ARRAY['garage_owner_correction_v1','owner_statement_v1',
               'owner_statement_org_link_v1','vehicle_statement_v1','work_order_payment_witness_sign_v1']));
  IF EXISTS (SELECT 1 FROM public.data_set_members m JOIN spec_private_readings p ON p.id = m.basis_id
              WHERE m.basis_type = 'code_reading' AND m.state = 'active') THEN
    RAISE EXCEPTION 'spec_readings_public_sources: private-source readings are already folded; revert that membership run first';
  END IF;
  INSERT INTO public.vehicle_code_readings_backup (id, vehicle_id, kind, code, model_year, origin_table, origin_id, origin_column, match_text, match_offset, pattern_key, confidence, rule_version, run_id, state, created_at, reverted_at, base_confidence, backed_up_at)
  SELECT r.id, r.vehicle_id, r.kind, r.code, r.model_year, r.origin_table, r.origin_id, r.origin_column, r.match_text, r.match_offset, r.pattern_key, r.confidence, r.rule_version, r.run_id, r.state, r.created_at, r.reverted_at, r.base_confidence, now()
    FROM public.vehicle_code_readings r JOIN spec_private_readings p ON p.id = r.id;
  GET DIAGNOSTICS n_bk = ROW_COUNT;
  SELECT array_agg(DISTINCT vehicle_id) INTO v_veh FROM spec_private_readings;
  DELETE FROM public.vehicle_code_readings r USING spec_private_readings p WHERE r.id = p.id;
  PERFORM public.text_code_rescore_v1(coalesce(v_veh, '{}'));
  RAISE NOTICE 'spec_readings_public_sources: backed up and removed % readings on % vehicles', n_bk, coalesce(cardinality(v_veh), 0);
END
$do$;

commit;
