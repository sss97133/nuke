-- Skill input join key, so the skill match answers from capability records instead of needing the capability name in the
-- requirement text (usually "unknown").
--   capability_evidence_map (the capability fold's reviewed mapping, 20261019235000) gains kind requirement_template:
--     <slugged post_work_request template description>:<capability type>, one row per capability. Reviewed rows below; reused, not forked.
--   requirement_capability_keys(requirement, specifications): a requirement's capability keys from (a) its reviewed template,
--     (b) the requested process keys of its operation (capability_map_process) and (c) its operation's task_type and
--     component system (capability_map_operation), the same functions the fold uses.
--   open_requirement_skill_input(user, bridge, kind, keys, text): pass when the account's evidenced actor(s) hold an
--     evidence_fold capability covering a key (direct or corroborating basis); against evidence on a matched capability
--     is returned as a caution beside the pass; against-only or hand-entered-only records are unknown; capabilities the
--     account or its actor records only state (profile expertise, profession, actor specialties) are "stated, not
--     evidenced" (unknown). Requirements without keys keep the previous text rule.
--   open_requirements_read rows gain capability_keys; work_order_provider_matches_read requirements gain capability_keys;
--     both skill inputs use the helper (anchored edits; additive shape).
-- Contract: supabase/sql/test_requirement_capability_keys.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

ALTER TABLE public.capability_evidence_map DROP CONSTRAINT capability_evidence_map_kind_check,
  ADD CONSTRAINT capability_evidence_map_kind_check CHECK (kind = ANY (ARRAY['process_key','component_system','task_system','task_type','requirement_template']));
COMMENT ON TABLE public.capability_evidence_map IS 'Reviewed mapping (checked into 20261019235000; requirement_template rows in 20261020060000) from evidence keys onto actor_capabilities.capability_type. process_key and component_system match the key or a finer dotted/underscored key (longest wins); task_system is task_type:system_key; requirement_template is <slugged post_work_request template description>:<capability_type>, one row per capability. A tier only where defined.';
INSERT INTO public.capability_evidence_map(kind, source_key, system_key, capability_type, note) VALUES
  ('requirement_template', 'dent_repair_paintless_or_conventional:body_repair', NULL, 'body_repair', 'template: dent'),
  ('requirement_template', 'rust_repair_and_panel_welding:rust_repair', NULL, 'rust_repair', 'template: rust_body'),
  ('requirement_template', 'rust_repair_and_panel_welding:welding_mig', NULL, 'welding_mig', 'template: rust_body (panel welding; the template asks for a MIG welder)'),
  ('requirement_template', 'automotive_paint_refinishing:paint_refinish', NULL, 'paint_refinish', 'template: paint_refinish'),
  ('requirement_template', 'exhaust_repair_and_fabrication:fabrication_exhaust', NULL, 'fabrication_exhaust', 'template: exhaust'),
  ('requirement_template', 'exhaust_repair_and_fabrication:exhaust_system', NULL, 'exhaust_system', 'template: exhaust'),
  ('requirement_template', 'automotive_upholstery:upholstery_repair', NULL, 'upholstery_repair', 'template: seat_upholstery'),
  ('requirement_template', 'automotive_interior_trim:upholstery_repair', NULL, 'upholstery_repair', 'template: carpet, headliner, dash'),
  ('requirement_template', 'auto_glass_installation:glass_installation', NULL, 'glass_installation', 'template: windshield'),
  ('requirement_template', 'cooling_system_service:cooling_system', NULL, 'cooling_system', 'template: cooling'),
  ('requirement_template', 'automotive_electrical_diagnosis_and_repair:electrical_repair', NULL, 'electrical_repair', 'template: gauges, wiring_repair, lights'),
  ('requirement_template', 'diagnose_the_engine_condition_before_repair:engine_diagnostics', NULL, 'engine_diagnostics', 'template: engine_health (inspection)'),
  ('requirement_template', 'diagnose_the_engine_condition_before_repair:inspection', NULL, 'inspection', 'template: engine_health (inspection)'),
  ('requirement_template', 'engine_diagnosis_and_repair:engine_diagnostics', NULL, 'engine_diagnostics', 'template: engine_health');

CREATE FUNCTION public.capability_template_slug(p_text text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT NULLIF(btrim(regexp_replace(lower(COALESCE(p_text, '')), '[^a-z0-9]+', '_', 'g'), '_'), '')
$$;

CREATE FUNCTION public.requirement_capability_keys(p_requirement jsonb, p_specifications jsonb) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('key', k, 'from', f) ORDER BY k, f), '[]'::jsonb)
  FROM (
    SELECT DISTINCT m.capability_type AS k, 'reviewed_template' AS f FROM public.capability_evidence_map m
      WHERE m.kind = 'requirement_template' AND split_part(m.source_key, ':', 1) = public.capability_template_slug(p_requirement->>'description')
    UNION
    SELECT DISTINCT cp.capability_type, 'requested_specification' FROM jsonb_array_elements(COALESCE(p_specifications, '[]'::jsonb)) sp,
      LATERAL public.capability_map_process(sp->>'process_key') cp
      WHERE sp->>'specification_stage' = 'requested' AND sp->>'process_key' IS NOT NULL
        AND (sp->>'line_item_id' IS NULL OR sp->>'line_item_id' = p_requirement->>'line_item_id')
    UNION
    SELECT DISTINCT co.capability_type, 'operation' FROM public.work_order_line_items li,
      LATERAL public.capability_map_operation(li.task_type, li.component_table) co
      WHERE li.id = (p_requirement->>'line_item_id')::uuid AND co.capability_type IS NOT NULL
  ) t
$$;

CREATE FUNCTION public.open_requirement_skill_input(p_user uuid, p_bridge jsonb, p_kind text, p_capability_keys jsonb, p_text text) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $$
DECLARE
  rk text[] := ARRAY(SELECT DISTINCT x->>'key' FROM jsonb_array_elements(COALESCE(p_capability_keys, '[]'::jsonb)) x WHERE x->>'key' IS NOT NULL ORDER BY 1);
  actors uuid[] := ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_bridge->'evidenced_actor_ids', '[]'::jsonb))::uuid);
  covered jsonb;
  cautions jsonb;
  against_only text[];
  hand_only text[];
  stated text[];
  caps text[];
  named text;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('skill','inspection') THEN
    RETURN jsonb_build_object('input', 'skill', 'result', 'pass', 'reason', 'not required for a ' || COALESCE(p_kind, 'unknown') || ' requirement');
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('capability', c.capability_type, 'strength', c.strength, 'direct', c.direct_count,
      'corroborating', c.corroborating_count, 'against', c.against_count) ORDER BY c.capability_type) FILTER (WHERE c.direct_count + c.corroborating_count > 0), '[]'::jsonb),
    COALESCE(jsonb_agg(jsonb_build_object('kind', 'against_evidence', 'capability', c.capability_type, 'against', c.against_count,
      'reason', 'requested and reported-performed specifications differed on earlier work (evidence against, not a verdict)')
      ORDER BY c.capability_type) FILTER (WHERE c.against_count > 0), '[]'::jsonb),
    COALESCE(array_agg(c.capability_type ORDER BY c.capability_type) FILTER (WHERE c.direct_count + c.corroborating_count = 0 AND c.against_count > 0), '{}')
    INTO covered, cautions, against_only
  FROM (SELECT ac.capability_type, CASE WHEN bool_or(ac.strength = 'direct') THEN 'direct' ELSE 'corroborating' END AS strength, sum(ac.direct_count)::int AS direct_count,
      sum(ac.corroborating_count)::int AS corroborating_count, sum(ac.against_count)::int AS against_count
    FROM public.actor_capabilities ac
    WHERE ac.actor_id = ANY (actors) AND ac.derivation = 'evidence_fold' AND ac.capability_type = ANY (rk)
    GROUP BY ac.capability_type) c;
  IF jsonb_array_length(covered) > 0 THEN
    RETURN jsonb_build_object('input', 'skill', 'result', 'pass', 'basis', 'evidence_fold', 'capability_keys', to_jsonb(rk),
      'matched_capabilities', covered, 'cautions', cautions,
      'reason', 'evidence-derived capability ' || (SELECT string_agg(x->>'capability', ', ') FROM jsonb_array_elements(covered) x) || ' covers this requirement'
        || CASE WHEN jsonb_array_length(cautions) > 0 THEN '; with evidence against ' || (SELECT string_agg(x->>'capability', ', ') FROM jsonb_array_elements(cautions) x) ELSE '' END);
  END IF;
  IF cardinality(against_only) > 0 THEN
    RETURN jsonb_build_object('input', 'skill', 'result', 'unknown', 'basis', 'evidence_fold_against_only', 'capability_keys', to_jsonb(rk),
      'matched_capabilities', '[]'::jsonb, 'cautions', cautions,
      'reason', 'only evidence against ' || array_to_string(against_only, ', ') || ' for this requirement');
  END IF;
  hand_only := ARRAY(SELECT DISTINCT ac.capability_type FROM public.actor_capabilities ac
    WHERE ac.actor_id = ANY (actors) AND ac.derivation = 'legacy_hand_entered' AND ac.capability_type = ANY (rk) ORDER BY 1);
  stated := ARRAY(SELECT DISTINCT k FROM unnest(rk) k
    WHERE EXISTS (SELECT 1 FROM (
        SELECT unnest(p.expertise_areas)::text AS s FROM public.profiles p WHERE p.id = p_user
        UNION ALL SELECT p.profession::text FROM public.profiles p WHERE p.id = p_user
        UNION ALL SELECT unnest(a.specialties)::text FROM public.actors a
          WHERE a.id IN (SELECT c.actor_id FROM public.account_link_claims c WHERE c.user_id = p_user AND c.status IN ('pending','approved') AND c.actor_id IS NOT NULL)) st
      WHERE st.s IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM unnest(string_to_array(k, '_')) w
          WHERE NOT (regexp_split_to_array(lower(st.s), '[^a-z0-9]+') @> ARRAY[w])))
    ORDER BY 1);
  IF cardinality(rk) > 0 THEN
    RETURN jsonb_build_object('input', 'skill', 'result', 'unknown', 'capability_keys', to_jsonb(rk), 'matched_capabilities', '[]'::jsonb, 'cautions', cautions,
      'basis', CASE WHEN cardinality(hand_only) > 0 THEN 'hand_entered_without_basis' WHEN cardinality(stated) > 0 THEN 'stated_not_evidenced'
        WHEN cardinality(actors) = 0 THEN 'no_evidenced_identity_bridge' ELSE 'no_evidence_fold_capability' END,
      'stated_capabilities', to_jsonb(stated),
      'reason', CASE WHEN cardinality(hand_only) > 0 THEN 'hand-entered capability record without basis: ' || array_to_string(hand_only, ', ')
        WHEN cardinality(stated) > 0 THEN 'stated, not evidenced: ' || array_to_string(stated, ', ')
        WHEN cardinality(actors) = 0 THEN 'no evidenced identity bridge; capability records belong to work actors'
        ELSE 'no evidence-derived capability covers ' || array_to_string(rk, ', ') END,
      'next', CASE WHEN cardinality(actors) = 0 THEN 'claim_provider_link' END);
  END IF;
  IF cardinality(actors) = 0 THEN
    RETURN jsonb_build_object('input', 'skill', 'result', 'unknown', 'capability_keys', '[]'::jsonb, 'basis', 'requirement_has_no_capability_key',
      'reason', 'no evidenced identity bridge; capability records belong to work actors');
  END IF;
  caps := ARRAY(SELECT DISTINCT lower(c.capability_type) FROM public.actor_capabilities c
    WHERE c.actor_id = ANY (actors) AND COALESCE(c.evidence_count, 0) > 0 AND NULLIF(btrim(c.capability_type), '') IS NOT NULL);
  named := (SELECT string_agg(c, ', ') FROM unnest(caps) c WHERE lower(COALESCE(p_text, '')) ~ ('\m' || regexp_replace(c, '\W', '', 'g') || '\M'));
  IF named IS NOT NULL THEN
    RETURN jsonb_build_object('input', 'skill', 'result', 'pass', 'basis', 'requirement_text_names_capability', 'capability_keys', '[]'::jsonb,
      'reason', 'capability ' || named || ' is named in the requirement');
  END IF;
  RETURN jsonb_build_object('input', 'skill', 'result', 'unknown', 'capability_keys', '[]'::jsonb, 'basis', 'requirement_has_no_capability_key',
    'reason', CASE WHEN cardinality(caps) = 0 THEN 'no evidence-derived capability records' ELSE 'capability records do not name this requirement' END);
END $$;

REVOKE ALL ON FUNCTION public.capability_template_slug(text), public.requirement_capability_keys(jsonb,jsonb),
  public.open_requirement_skill_input(uuid,jsonb,text,jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capability_template_slug(text), public.requirement_capability_keys(jsonb,jsonb),
  public.open_requirement_skill_input(uuid,jsonb,text,jsonb,text) TO service_role;
COMMENT ON FUNCTION public.open_requirement_skill_input(uuid,jsonb,text,jsonb,text) IS 'Skill input of the requirement match for one account: pass when an evidenced actor''s evidence_fold capability covers a requirement capability key (against evidence returned as cautions); against-only, hand-entered-only and stated-only answer unknown. Requirements without keys keep the capability-name-in-text rule.';

DO $apply$
DECLARE
  def text := pg_get_functiondef('public.open_requirements_read(uuid,integer,text)'::regprocedure);
  a1 constant text := $a$public.requirement_tool_keys(s.q, s.g->'specifications') AS tool_keys$a$;
  a2 constant text := $a$'tool_keys', b.tool_keys,$a$;
  a3 constant text := $a$        CASE WHEN b.q->>'requirement_kind' NOT IN ('skill','inspection') THEN
            jsonb_build_object('input', 'skill', 'result', 'pass', 'reason', 'not required for a ' || (b.q->>'requirement_kind') || ' requirement')
          WHEN cardinality(v_actors) = 0 THEN
            jsonb_build_object('input', 'skill', 'result', 'unknown', 'reason', 'no evidenced identity bridge; capability records belong to work actors')
          WHEN EXISTS (SELECT 1 FROM unnest(v_caps) c WHERE b.dtext ~ ('\m' || regexp_replace(c, '\W', '', 'g') || '\M')) THEN
            jsonb_build_object('input', 'skill', 'result', 'pass', 'reason', 'capability ' || (SELECT string_agg(c, ', ') FROM unnest(v_caps) c
              WHERE b.dtext ~ ('\m' || regexp_replace(c, '\W', '', 'g') || '\M')) || ' is named in the requirement')
          ELSE jsonb_build_object('input', 'skill', 'result', 'unknown',
            'reason', CASE WHEN cardinality(v_caps) = 0 THEN 'no evidence-derived capability records'
              ELSE 'capability records do not name this requirement' END) END,$a$;
  pdef text := pg_get_functiondef('public.provider_requirement_match(uuid,jsonb,jsonb,uuid,jsonb,uuid,jsonb,jsonb,jsonb)'::regprocedure);
  p1 constant text := $a$    CASE WHEN kind NOT IN ('skill','inspection') THEN
        jsonb_build_object('input', 'skill', 'result', 'pass', 'reason', 'not required for a ' || kind || ' requirement')
      WHEN cardinality(actors) = 0 THEN
        jsonb_build_object('input', 'skill', 'result', 'unknown', 'reason', 'no evidenced identity bridge; capability records belong to work actors')
      WHEN named IS NOT NULL THEN
        jsonb_build_object('input', 'skill', 'result', 'pass', 'reason', 'capability ' || named || ' is named in the requirement')
      ELSE jsonb_build_object('input', 'skill', 'result', 'unknown',
        'reason', CASE WHEN cardinality(caps) = 0 THEN 'no evidence-derived capability records' ELSE 'capability records do not name this requirement' END) END,$a$;
  wdef text := pg_get_functiondef('public.work_order_provider_matches_read(uuid,integer)'::regprocedure);
  w1 constant text := $a$FROM people p, jsonb_array_elements(COALESCE(g->'requirements', '[]'::jsonb)) q
$a$;
  w2 constant text := $a$'requirement_kind', p.q->'requirement_kind', 'description', p.q->'description',$a$;
BEGIN
  IF position('open_requirement_skill_input' IN def) > 0 OR position('open_requirement_skill_input' IN pdef) > 0 THEN
    RAISE EXCEPTION 'skill inputs already use the capability keys';
  END IF;
  IF (length(def) - length(replace(def, a1, ''))) / length(a1) <> 1 THEN RAISE EXCEPTION 'open_requirements_read tool_keys anchor not found once'; END IF;
  IF (length(def) - length(replace(def, a2, ''))) / length(a2) <> 1 THEN RAISE EXCEPTION 'open_requirements_read output anchor not found once'; END IF;
  IF (length(def) - length(replace(def, a3, ''))) / length(a3) <> 1 THEN RAISE EXCEPTION 'open_requirements_read skill anchor not found once'; END IF;
  IF (length(pdef) - length(replace(pdef, p1, ''))) / length(p1) <> 1 THEN RAISE EXCEPTION 'provider_requirement_match skill anchor not found once'; END IF;
  IF (length(wdef) - length(replace(wdef, w1, ''))) / length(w1) <> 1 THEN RAISE EXCEPTION 'work_order_provider_matches_read requirements anchor not found once'; END IF;
  IF (length(wdef) - length(replace(wdef, w2, ''))) / length(w2) <> 1 THEN RAISE EXCEPTION 'work_order_provider_matches_read output anchor not found once'; END IF;
  def := replace(def, a1, a1 || $r$,
      public.requirement_capability_keys(s.q, s.g->'specifications') AS capability_keys$r$);
  def := replace(def, a2, a2 || $r$ 'capability_keys', b.capability_keys,$r$);
  def := replace(def, a3, $r$        public.open_requirement_skill_input(uid, bridge, b.q->>'requirement_kind', b.capability_keys, b.dtext),$r$);
  EXECUTE def;
  EXECUTE replace(pdef, p1, $r$    public.open_requirement_skill_input(p_user, p_bridge, kind,
      COALESCE(p_requirement->'capability_keys', public.requirement_capability_keys(p_requirement, NULL)), dtext),$r$);
  wdef := replace(wdef, w1, $r$FROM people p, jsonb_array_elements(COALESCE(g->'requirements', '[]'::jsonb)) q0,
      LATERAL (SELECT q0 || jsonb_build_object('capability_keys', public.requirement_capability_keys(q0, g->'specifications')) AS q) qx
$r$);
  wdef := replace(wdef, w2, w2 || $r$ 'capability_keys', p.q->'capability_keys',$r$);
  EXECUTE wdef;
END $apply$;
NOTIFY pgrst, 'reload schema';
COMMIT;
