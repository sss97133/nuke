-- Revert 20261124026000_spec_platform_scopes: revert any platform_hex runs first, then restore the 20261124022000 bodies.
begin;
set local lock_timeout = '5s';
CREATE OR REPLACE FUNCTION public.data_set_scope_vehicles(p_scope text, p_vehicle uuid)
 RETURNS uuid[]
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE p_scope
    WHEN 'vehicle' THEN ARRAY[p_vehicle]
    WHEN 'pontiac_f_body' THEN (SELECT array_agg(x.id ORDER BY x.id) FROM public.vehicles x
                                 WHERE lower(x.make) = 'pontiac'
                                   AND (lower(coalesce(x.model, '')) ~ 'firebird|trans ?am'
                                        OR upper(btrim(coalesce(x.vin, ''))) ~ '^2[A-Z]87[A-Z][2-9A][A-Z][0-9]{6}$'
                                        OR upper(btrim(coalesce(x.vin, ''))) ~ '^22[3468]87[01][A-Z][0-9]{6}$'
                                        OR upper(btrim(coalesce(x.vin, ''))) ~ '^1G2[A-C][A-Z]87[A-Z][0-9X]B[A-Z][0-9]{6}$'))
    WHEN 'ford_mustang_65_73' THEN (SELECT array_agg(x.id ORDER BY x.id) FROM public.vehicles x
                                 WHERE lower(x.make) = 'ford' AND x.year BETWEEN 1965 AND 1973
                                   AND lower(coalesce(x.model, '')) ~ 'mustang' )
    WHEN 'chevrolet_camaro_67_69' THEN (SELECT array_agg(x.id ORDER BY x.id) FROM public.vehicles x
                                 WHERE lower(x.make) = 'chevrolet' AND x.year BETWEEN 1967 AND 1969
                                   AND lower(coalesce(x.model, '')) ~ 'camaro' )
    WHEN 'platform_sample_v1' THEN (SELECT array_agg(s.vehicle_id ORDER BY s.vehicle_id) FROM public.coverage_sample_vehicles s
                                 WHERE s.sample_key = 'platform_v1')
  END
$function$;

CREATE OR REPLACE FUNCTION public.spec_landing_drain_v1(p_budget_ms integer DEFAULT 40000)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE j public.spec_landing_jobs%ROWTYPE; r jsonb; t0 timestamptz := clock_timestamp(); n int := 0; v_done boolean;
        v_log jsonb := '[]'::jsonb;
BEGIN
  LOOP
    EXIT WHEN clock_timestamp() - t0 > make_interval(secs => p_budget_ms / 1000.0);
    SELECT s.* INTO j FROM public.spec_landing_jobs s
     WHERE s.status IN ('queued','running')
       AND (s.depends_on IS NULL OR EXISTS (SELECT 1 FROM public.spec_landing_jobs d WHERE d.job_id = s.depends_on AND d.status = 'done'))
     ORDER BY s.priority, s.created_at, s.job_id
     FOR UPDATE SKIP LOCKED LIMIT 1;
    EXIT WHEN NOT FOUND;
    BEGIN
      IF j.step_kind = 'decode' THEN
        r := public.text_code_decode_v2(j.run_id, j.scope, NULL, j.batch, j.next_from, j.step);
        v_done := coalesce((r->>'done')::boolean, false);
      ELSIF j.step_kind = 'plan' THEN
        r := public.data_set_membership_plan_v2(j.run_id, j.scope, NULL, j.kinds, j.next_from, j.step);
        v_done := coalesce((r->>'done')::boolean, false);
      ELSE
        r := public.data_set_membership_apply_v1(j.run_id, j.batch, greatest(1, least(200, j.step)), false);
        v_done := coalesce((r->>'still_planned')::int, 1) = 0;
      END IF;
      UPDATE public.spec_landing_jobs s
         SET next_from = coalesce((r->>'next_from')::int, s.next_from), status = CASE WHEN v_done THEN 'done' ELSE 'running' END,
             last_result = r, ticks = s.ticks + 1, updated_at = now(), done_at = CASE WHEN v_done THEN now() END
       WHERE s.job_id = j.job_id;
      v_log := v_log || jsonb_build_object('job', j.job_id, 'from', j.next_from, 'done', v_done);
    -- a statement timeout (query_canceled) is not in OTHERS: trap it too so the failure is counted and the slice halves
    EXCEPTION WHEN OTHERS OR query_canceled THEN
      UPDATE public.spec_landing_jobs s
         SET errors = s.errors + 1, last_error = left(SQLERRM, 500), step = greatest(s.step / 2, 1),
             status = CASE WHEN s.errors + 1 >= 5 THEN 'failed' ELSE s.status END, updated_at = now()
       WHERE s.job_id = j.job_id;
      v_log := v_log || jsonb_build_object('job', j.job_id, 'from', j.next_from, 'error', left(SQLERRM, 200));
      EXIT;
    END;
    n := n + 1;
  END LOOP;
  RETURN jsonb_build_object('steps', n, 'ms', round(extract(epoch FROM clock_timestamp() - t0) * 1000), 'log', v_log);
END
$function$;

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

CREATE OR REPLACE FUNCTION public.data_set_membership_plan_v2(p_run uuid, p_scope text, p_vehicle uuid DEFAULT NULL::uuid,
  p_kinds text[] DEFAULT NULL::text[], p_from integer DEFAULT 1, p_count integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '600s'
AS $function$
DECLARE v_all uuid[]; v_ids uuid[]; v_end int; n_add int; n_sup int; n_cand int; v_kinds text[]; v_set_kinds text[];
BEGIN
  IF p_run IS NULL THEN RAISE EXCEPTION 'data_set_membership_plan_v2: run required'; END IF;
  IF p_scope NOT IN ('vehicle','pontiac_f_body','ford_mustang_65_73','chevrolet_camaro_67_69','platform_sample_v1') THEN
    RAISE EXCEPTION 'data_set_membership_plan_v2: unknown scope %', p_scope;
  END IF;
  IF p_scope = 'vehicle' AND p_vehicle IS NULL THEN RAISE EXCEPTION 'data_set_membership_plan_v2: scope vehicle needs a vehicle'; END IF;
  IF p_from IS NULL OR p_from < 1 THEN RAISE EXCEPTION 'data_set_membership_plan_v2: p_from starts at 1'; END IF;
  v_kinds := coalesce(p_kinds, ARRAY['engine_block_casting','engine_code','trans_case_casting','trans_tail_casting','paint_code',
    'cowl_style','cowl_option','body_style','trim_level','engine_cid','trans_type','trans_speeds','trans_model','axle_ratio',
    'interior_trim_code','rpo_code','build_date','dealer_zone','documentation']);
  v_set_kinds := ARRAY(SELECT CASE WHEN k = 'build_date' THEN 'build_month' ELSE k END FROM unnest(v_kinds) k);
  IF p_from = 1 THEN
    IF EXISTS (SELECT 1 FROM public.data_set_runs r WHERE r.run_id = p_run::text) THEN
      RAISE EXCEPTION 'data_set_membership_plan_v2: run % already planned', p_run;
    END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM public.data_set_runs r WHERE r.run_id = p_run::text AND r.status = 'planned'
                       AND r.producer = 'data_set_membership_v2' AND r.scope = p_scope
                       AND r.summary->'kinds' = to_jsonb(v_kinds)) THEN
    RAISE EXCEPTION 'data_set_membership_plan_v2: run % is not open for scope % and these kinds', p_run, p_scope;
  END IF;
  v_all := coalesce(public.data_set_scope_vehicles(p_scope, p_vehicle), '{}');
  v_end := least(cardinality(v_all), CASE WHEN p_count IS NULL THEN cardinality(v_all) ELSE p_from + p_count - 1 END);
  v_ids := coalesce(v_all[p_from : v_end], '{}');
  IF p_from = 1 THEN
    INSERT INTO public.data_set_runs (run_id, producer, logic_version, scope, vehicle_id, n_vehicles, summary)
    VALUES (p_run::text, 'data_set_membership_v2', 'data_set_membership/20261124020000.1', p_scope, p_vehicle, cardinality(v_all),
            jsonb_build_object('kinds', to_jsonb(v_kinds)));
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.data_set_cand2 (LIKE public.data_set_member_plan INCLUDING DEFAULTS) ON COMMIT DROP;
  TRUNCATE pg_temp.data_set_cand2;
  INSERT INTO pg_temp.data_set_cand2 (id, run_id, action, set_kind, set_key, set_label, set_provenance, member_type, member_id,
    vehicle_id, basis_type, basis_id, basis_detail, confidence, member_rule_version)
  SELECT 0, p_run::text, 'add', c.set_kind, c.set_key, c.set_label, c.set_provenance, c.member_type, c.member_id,
         c.vehicle_id, c.basis_type, c.basis_id, c.basis_detail, c.confidence, c.member_rule_version
    FROM (SELECT DISTINCT ON (c0.set_kind, c0.set_key, c0.member_type, c0.member_id, c0.basis_type, c0.basis_id) c0.*
            FROM public.data_set_code_candidates_v1(v_ids, v_kinds) c0
           ORDER BY c0.set_kind, c0.set_key, c0.member_type, c0.member_id, c0.basis_type, c0.basis_id, c0.confidence DESC) c;
  GET DIAGNOSTICS n_cand = ROW_COUNT;
  ANALYZE pg_temp.data_set_cand2;

  INSERT INTO public.data_set_member_plan (run_id, action, set_kind, set_key, set_label, set_provenance, member_type, member_id,
    vehicle_id, basis_type, basis_id, basis_detail, confidence, member_rule_version)
  SELECT c.run_id, 'add', c.set_kind, c.set_key, c.set_label, c.set_provenance, c.member_type, c.member_id,
         c.vehicle_id, c.basis_type, c.basis_id, c.basis_detail, c.confidence, c.member_rule_version
    FROM pg_temp.data_set_cand2 c
   WHERE NOT EXISTS (SELECT 1 FROM public.data_set_members m JOIN public.data_sets s ON s.id = m.set_id
                      WHERE m.state = 'active' AND s.set_kind = c.set_kind AND s.set_key = c.set_key
                        AND s.rule_version = 'data_set_keys_v1' AND m.member_type = c.member_type
                        AND m.member_id = c.member_id AND m.basis_type = c.basis_type AND m.basis_id = c.basis_id)
   ORDER BY c.vehicle_id, c.set_kind, c.set_key, c.member_type, c.member_id;
  GET DIAGNOSTICS n_add = ROW_COUNT;

  INSERT INTO public.data_set_member_plan (run_id, action, set_kind, set_key, member_type, member_id, vehicle_id, basis_type,
    basis_id, basis_detail, confidence, member_rule_version, target_member_id)
  SELECT p_run::text, 'supersede', s.set_kind, s.set_key, m.member_type, m.member_id, m.vehicle_id, m.basis_type,
         m.basis_id, m.basis_detail, m.confidence, m.rule_version, m.id
    FROM public.data_set_members m JOIN public.data_sets s ON s.id = m.set_id
   WHERE m.state = 'active' AND m.vehicle_id = ANY (v_ids) AND m.basis_type = 'code_reading' AND s.set_kind = ANY (v_set_kinds)
     AND NOT EXISTS (SELECT 1 FROM pg_temp.data_set_cand2 c
                      WHERE c.set_kind = s.set_kind AND c.set_key = s.set_key AND c.member_type = m.member_type
                        AND c.member_id = m.member_id AND c.basis_type = m.basis_type AND c.basis_id = m.basis_id)
   ORDER BY m.id;
  GET DIAGNOSTICS n_sup = ROW_COUNT;

  UPDATE public.data_set_runs SET summary = summary || jsonb_build_object(
           'candidates', coalesce((summary->>'candidates')::int, 0) + n_cand,
           'planned_add', coalesce((summary->>'planned_add')::int, 0) + n_add,
           'planned_supersede', coalesce((summary->>'planned_supersede')::int, 0) + n_sup,
           'planned_through', v_end)
   WHERE run_id = p_run::text;
  RETURN jsonb_build_object('run_id', p_run, 'scope', p_scope, 'vehicles', cardinality(v_all), 'slice_vehicles', cardinality(v_ids),
    'candidates', n_cand, 'planned_add', n_add, 'planned_supersede', n_sup,
    'next_from', CASE WHEN v_end < cardinality(v_all) THEN v_end + 1 END, 'done', v_end >= cardinality(v_all));
END
$function$;

DROP TABLE IF EXISTS public.spec_landing_control;
commit;
