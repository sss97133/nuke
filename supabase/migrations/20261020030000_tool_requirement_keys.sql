-- Tool <-> requirement join key, so open_requirements_read's tools input answers from a reviewed mapping instead of word
-- matching (most rows said "no claimed tool record names this requirement").
--   tool_requirement_key_map (reviewed data, checked in here): tool categories (user_tools / tool_inventory / tool_categories /
--     equipment categories) and reviewed tool terms (whole phrases in a tool's name or description, e.g. "tig welder",
--     "back purge") onto requirement keys, which are the specification material/process keys (welding.tig,
--     stainless_steel.304, machining.lathe, paint.refinish) plus tool./equipment. keys; and reviewed requirement-template
--     descriptions (post_work_request's template, e.g. "MIG welder") onto the same keys.
--   requirement_tool_keys(requirement, specifications): a requirement's normalized keys = its template keys + the
--     requested material/process keys of its operation (or of the work order scope).
--   user_tool_keys(user): the keys a user's claimed tools map to (user_tools, tool_inventory; category or term).
--   A tool key satisfies a requirement key when equal or finer (welding.tig satisfies welding; not the reverse).
--   open_requirement_tools_input(user, kind, requirement keys, requirement text): pass when a claimed tool maps to the
--     requirement (claimed ownership, not physical verification); equipment seen in photos at the user's shops is listed
--     as corroboration; seen-only gives unknown (claim_tool_record); otherwise fail with plan_b_supplier_needed. The old
--     text match stays as a labelled fallback for requirements without keys.
--   open_requirements_read: rows gain tool_keys; the tools input uses the helper (three anchored edits; additive shape).
-- Contract: supabase/sql/test_tool_requirement_keys.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

CREATE TABLE public.tool_requirement_key_map (
  source_kind text NOT NULL CHECK (source_kind IN ('tool_category','tool_term','requirement_template')),
  source_key text NOT NULL CHECK (source_key = lower(btrim(source_key)) AND length(source_key) BETWEEN 2 AND 80),
  requirement_key text NOT NULL CHECK (requirement_key ~ '^[a-z0-9_]+(\.[a-z0-9_]+)*$'),
  note text,
  PRIMARY KEY (source_kind, source_key, requirement_key)
);
ALTER TABLE public.tool_requirement_key_map ENABLE ROW LEVEL SECURITY;
CREATE POLICY tool_requirement_key_map_read ON public.tool_requirement_key_map FOR SELECT USING (true);
REVOKE ALL ON public.tool_requirement_key_map FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.tool_requirement_key_map TO anon, authenticated;
GRANT ALL ON public.tool_requirement_key_map TO service_role;
COMMENT ON TABLE public.tool_requirement_key_map IS 'Reviewed mapping (checked into 20261020030000; extend only by reviewed migration) from tool categories, tool terms (whole phrases in a tool name/description) and requirement-template descriptions onto requirement keys: specification material/process keys plus tool./equipment. keys. A finer key satisfies a coarser one.';
INSERT INTO public.tool_requirement_key_map(source_kind, source_key, requirement_key, note) VALUES
  ('tool_term', 'tig welder', 'welding.tig', NULL),
  ('tool_term', 'tig torch', 'welding.tig', NULL),
  ('tool_term', 'argon regulator', 'welding.tig', 'shielding gas for TIG'),
  ('tool_term', 'back purge', 'welding.tig', 'stainless back-purging is a TIG practice'),
  ('tool_term', 'back purge', 'stainless_steel.304', 'back-purge kits exist for stainless (304) root protection'),
  ('tool_term', 'back-purge', 'welding.tig', NULL),
  ('tool_term', 'back-purge', 'stainless_steel.304', NULL),
  ('tool_term', 'purge kit', 'welding.tig', NULL),
  ('tool_term', 'purge kit', 'stainless_steel.304', NULL),
  ('tool_term', 'mig welder', 'welding.mig', NULL),
  ('tool_term', 'stick welder', 'welding.stick', NULL),
  ('tool_term', 'oxy-acetylene', 'welding.oxyacetylene', NULL),
  ('tool_term', 'oxyacetylene', 'welding.oxyacetylene', NULL),
  ('tool_term', 'brazing torch', 'welding.brazing', NULL),
  ('tool_term', 'plasma cutter', 'cutting.plasma', NULL),
  ('tool_term', 'angle grinder', 'tool.power.grinder', NULL),
  ('tool_term', 'lathe', 'machining.lathe', NULL),
  ('tool_term', 'milling machine', 'machining.mill', NULL),
  ('tool_term', 'cylinder hone', 'machining.hone', NULL),
  ('tool_term', 'spray gun', 'paint.refinish', NULL),
  ('tool_term', 'paint gun', 'paint.refinish', NULL),
  ('tool_term', 'hvlp', 'paint.refinish', NULL),
  ('tool_term', 'powder coat', 'coating.powder', NULL),
  ('tool_term', 'paint booth', 'equipment.paint_booth', NULL),
  ('tool_term', 'two-post lift', 'equipment.lift.vehicle', NULL),
  ('tool_term', '2-post lift', 'equipment.lift.vehicle', NULL),
  ('tool_term', 'four-post lift', 'equipment.lift.vehicle', NULL),
  ('tool_term', '4-post lift', 'equipment.lift.vehicle', NULL),
  ('tool_term', 'vehicle lift', 'equipment.lift.vehicle', NULL),
  ('tool_term', 'car lift', 'equipment.lift.vehicle', NULL),
  ('tool_term', 'engine hoist', 'equipment.lift.engine_hoist', NULL),
  ('tool_term', 'cherry picker', 'equipment.lift.engine_hoist', NULL),
  ('tool_term', 'floor jack', 'equipment.lift.floor_jack', NULL),
  ('tool_term', 'jack stand', 'equipment.support.jack_stand', NULL),
  ('tool_term', 'engine stand', 'equipment.support.engine_stand', NULL),
  ('tool_term', 'air compressor', 'equipment.air_compressor', NULL),
  ('tool_term', 'impact wrench', 'tool.power.impact_wrench', NULL),
  ('tool_term', 'torque wrench', 'tool.hand.torque_wrench', NULL),
  ('tool_term', 'compression gauge', 'tool.diagnostic.compression', NULL),
  ('tool_term', 'compression tester', 'tool.diagnostic.compression', NULL),
  ('tool_term', 'scan tool', 'tool.diagnostic.scan', NULL),
  ('tool_term', 'obd2 scanner', 'tool.diagnostic.scan', NULL),
  ('tool_term', 'obd scanner', 'tool.diagnostic.scan', NULL),
  ('tool_term', 'diagnostic scanner', 'tool.diagnostic.scan', NULL),
  ('tool_term', 'multimeter', 'tool.diagnostic.electrical', NULL),
  ('tool_term', 'ac recovery machine', 'equipment.ac_recovery', NULL),
  ('tool_term', 'refrigerant recovery', 'equipment.ac_recovery', NULL),
  ('tool_term', 'ac pressure gauge', 'tool.diagnostic.ac_gauges', NULL),
  ('tool_term', 'manifold gauge', 'tool.diagnostic.ac_gauges', NULL),
  ('tool_term', 'wire crimper', 'tool.hand.crimper', NULL),
  ('tool_term', 'brake bleeder', 'tool.brake_bleeder', NULL),
  ('tool_category', 'air tools', 'tool.air', NULL),
  ('tool_category', 'power tools', 'tool.power', NULL),
  ('tool_category', 'power_tool', 'tool.power', NULL),
  ('tool_category', 'hand tools', 'tool.hand', NULL),
  ('tool_category', 'hand_tool', 'tool.hand', NULL),
  ('tool_category', 'diagnostic', 'tool.diagnostic', NULL),
  ('tool_category', 'diagnostic equipment', 'tool.diagnostic', NULL),
  ('tool_category', 'measuring', 'tool.measuring', NULL),
  ('tool_category', 'measuring tools', 'tool.measuring', NULL),
  ('tool_category', 'compressor', 'equipment.air_compressor', NULL),
  ('tool_category', 'lift', 'equipment.lift', 'any lift; does not satisfy a vehicle-lift requirement'),
  ('requirement_template', 'mig welder', 'welding.mig', 'post_work_request template: rust_body'),
  ('requirement_template', 'vehicle lift', 'equipment.lift.vehicle', 'post_work_request template: exhaust, brakes, transmission, tailshaft_seal, front_suspension'),
  ('requirement_template', 'paint booth', 'equipment.paint_booth', 'post_work_request template: paint_refinish'),
  ('requirement_template', 'body shop bay', 'facility.body_bay', 'post_work_request template: rust_body');

CREATE FUNCTION public.tool_key_satisfies(p_tool_key text, p_requirement_key text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT p_tool_key = p_requirement_key OR starts_with(p_tool_key, p_requirement_key || '.')
$$;

CREATE FUNCTION public.requirement_tool_keys(p_requirement jsonb, p_specifications jsonb) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('key', k, 'from', f) ORDER BY k, f), '[]'::jsonb)
  FROM (
    SELECT DISTINCT m.requirement_key AS k, 'reviewed_template' AS f FROM public.tool_requirement_key_map m
      WHERE m.source_kind = 'requirement_template' AND m.source_key = lower(btrim(COALESCE(p_requirement->>'description', '')))
    UNION
    SELECT DISTINCT x.k, 'requested_specification' FROM jsonb_array_elements(COALESCE(p_specifications, '[]'::jsonb)) sp,
      LATERAL (VALUES (sp->>'material_key'), (sp->>'process_key')) x(k)
      WHERE sp->>'specification_stage' = 'requested' AND x.k IS NOT NULL
        AND (sp->>'line_item_id' IS NULL OR sp->>'line_item_id' = p_requirement->>'line_item_id')
  ) t
$$;

CREATE FUNCTION public.tool_text_keys(p_category text, p_text text)
RETURNS TABLE(requirement_key text, via text, matched text)
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT m.requirement_key, 'category', m.source_key FROM public.tool_requirement_key_map m
    WHERE m.source_kind = 'tool_category' AND m.source_key = lower(btrim(COALESCE(p_category, '')))
  UNION
  SELECT m.requirement_key, 'term', m.source_key FROM public.tool_requirement_key_map m
    WHERE m.source_kind = 'tool_term' AND p_text IS NOT NULL
      AND lower(p_text) ~ ('\m' || regexp_replace(m.source_key, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') || '\M')
$$;

CREATE FUNCTION public.user_tool_keys(p_user uuid)
RETURNS TABLE(requirement_key text, tool_source text, tool_id uuid, via text, matched text)
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT k.requirement_key, 'user_tools', t.id, k.via, k.matched
  FROM public.user_tools t
  LEFT JOIN public.tool_catalog c ON c.id = t.catalog_id
  LEFT JOIN public.tool_categories tc ON tc.id = c.category_id,
  LATERAL (SELECT * FROM public.tool_text_keys(t.category, concat_ws(' ', t.description, c.name, c.description))
    UNION SELECT * FROM public.tool_text_keys(tc.name, NULL)) k
  WHERE t.user_id = p_user
  UNION
  SELECT k.requirement_key, 'tool_inventory', i.id, k.via, k.matched
  FROM public.tool_inventory i, LATERAL public.tool_text_keys(i.category, concat_ws(' ', i.name, i.brand, i.model)) k
  WHERE i.owner_id = p_user AND COALESCE(i.status, 'active') NOT IN ('sold','lost','retired','disposed')
$$;

CREATE FUNCTION public.open_requirement_tools_input(p_user uuid, p_kind text, p_requirement_keys jsonb, p_text text) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $$
DECLARE
  rk text[] := ARRAY(SELECT DISTINCT x->>'key' FROM jsonb_array_elements(COALESCE(p_requirement_keys, '[]'::jsonb)) x WHERE x->>'key' IS NOT NULL);
  matched text[];
  n_claimed integer;
  words text[];
  photo jsonb;
  orgs uuid[];
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('tool','equipment') THEN
    RETURN jsonb_build_object('input', 'tools', 'result', 'pass', 'reason', 'not required for a ' || COALESCE(p_kind, 'unknown') || ' requirement');
  END IF;
  SELECT count(*) INTO n_claimed FROM (SELECT t.id FROM public.user_tools t WHERE t.user_id = p_user
    UNION ALL SELECT i.id FROM public.tool_inventory i WHERE i.owner_id = p_user) c;
  matched := ARRAY(SELECT DISTINCT r FROM public.user_tool_keys(p_user) u, unnest(rk) r WHERE public.tool_key_satisfies(u.requirement_key, r) ORDER BY 1);
  orgs := ARRAY(SELECT oc.organization_id FROM public.organization_contributors oc WHERE oc.user_id = p_user AND oc.status = 'active'
    UNION SELECT bo.business_id FROM public.business_ownership bo WHERE bo.owner_id = p_user AND bo.status = 'active');
  SELECT COALESCE(jsonb_agg(jsonb_build_object('key', x.r, 'equipment', x.name, 'photo_occurrences', x.seen) ORDER BY x.r, x.name), '[]'::jsonb) INTO photo
  FROM (SELECT DISTINCT r, e.name, (SELECT count(*) FROM public.equipment_usage_evidence u WHERE u.equipment_id = e.id AND u.derived_from_image_id IS NOT NULL) AS seen
    FROM public.equipment e, LATERAL public.tool_text_keys(e.category, e.name) k, unnest(rk) r
    WHERE e.shop_id = ANY (orgs) AND public.tool_key_satisfies(k.requirement_key, r)
      AND (e.source = 'photo_evidence_inferred' OR EXISTS (SELECT 1 FROM public.equipment_usage_evidence u WHERE u.equipment_id = e.id AND u.derived_from_image_id IS NOT NULL))) x;
  IF cardinality(matched) > 0 THEN
    RETURN jsonb_build_object('input', 'tools', 'result', 'pass', 'basis', 'reviewed_tool_key_map',
      'reason', 'claimed tool maps to ' || array_to_string(matched, ', ') || ' (claimed ownership, not physical verification)',
      'requirement_keys', to_jsonb(rk), 'matched_keys', to_jsonb(matched), 'corroboration', photo);
  END IF;
  words := ARRAY(SELECT DISTINCT lower(btrim(x)) FROM public.user_tools t, LATERAL unnest(ARRAY[t.category, t.description]) x
    WHERE t.user_id = p_user AND length(btrim(COALESCE(x, ''))) >= 3 AND strpos(lower(COALESCE(p_text, '')), lower(btrim(x))) > 0 ORDER BY 1 LIMIT 3);
  IF cardinality(words) > 0 THEN
    RETURN jsonb_build_object('input', 'tools', 'result', 'pass', 'basis', 'requirement_text_names_tool',
      'reason', 'claimed tool record named in the requirement: ' || array_to_string(words, ', ') || ' (claimed ownership, not physical verification)',
      'requirement_keys', to_jsonb(rk), 'matched_keys', '[]'::jsonb, 'corroboration', photo);
  END IF;
  IF jsonb_array_length(photo) > 0 THEN
    RETURN jsonb_build_object('input', 'tools', 'result', 'unknown', 'next', 'claim_tool_record', 'basis', 'photo_corroboration_only',
      'reason', 'seen in photos at your shop; not claimed as your tool', 'requirement_keys', to_jsonb(rk), 'matched_keys', '[]'::jsonb,
      'corroboration', photo);
  END IF;
  RETURN jsonb_build_object('input', 'tools', 'result', 'fail', 'next', 'plan_b_supplier_needed',
    'basis', CASE WHEN cardinality(rk) = 0 THEN 'requirement_has_no_reviewed_key' ELSE 'reviewed_tool_key_map' END,
    'reason', CASE WHEN n_claimed = 0 THEN 'no claimed tool records'
      WHEN cardinality(rk) = 0 THEN 'no claimed tool record names this requirement'
      ELSE 'no claimed tool maps to ' || array_to_string(rk, ', ') END,
    'requirement_keys', to_jsonb(rk), 'matched_keys', '[]'::jsonb, 'corroboration', photo);
END $$;

REVOKE ALL ON FUNCTION public.tool_key_satisfies(text,text), public.requirement_tool_keys(jsonb,jsonb), public.tool_text_keys(text,text),
  public.user_tool_keys(uuid), public.open_requirement_tools_input(uuid,text,jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tool_key_satisfies(text,text), public.requirement_tool_keys(jsonb,jsonb), public.tool_text_keys(text,text),
  public.user_tool_keys(uuid), public.open_requirement_tools_input(uuid,text,jsonb,text) TO service_role;
COMMENT ON FUNCTION public.open_requirement_tools_input(uuid,text,jsonb,text) IS 'Tools input of the open-requirements match for one user: pass when a claimed tool (user_tools, tool_inventory) maps through tool_requirement_key_map to a requirement key; photo-seen shop equipment is corroboration; seen-only is unknown; else plan_b_supplier_needed. Requirement-text match kept as a labelled fallback.';

DO $apply$
DECLARE
  def text := pg_get_functiondef('public.open_requirements_read(uuid,integer,text)'::regprocedure);
  a1 constant text := $a$lower(COALESCE(s.q->>'description', '')) AS dtext$a$;
  a2 constant text := $a$'area_band', b.area,$a$;
  a3 constant text := $a$        CASE WHEN b.q->>'requirement_kind' NOT IN ('tool','equipment') THEN
            jsonb_build_object('input', 'tools', 'result', 'pass', 'reason', 'not required for a ' || (b.q->>'requirement_kind') || ' requirement')
          WHEN EXISTS (SELECT 1 FROM unnest(v_tools) t WHERE strpos(b.dtext, t) > 0) THEN
            jsonb_build_object('input', 'tools', 'result', 'pass', 'reason', 'claimed tool record named in the requirement: '
              || (SELECT string_agg(t, ', ') FROM (SELECT t FROM unnest(v_tools) t WHERE strpos(b.dtext, t) > 0 ORDER BY t LIMIT 3) x)
              || ' (claimed ownership, not physical verification)')
          ELSE jsonb_build_object('input', 'tools', 'result', 'fail', 'next', 'plan_b_supplier_needed',
            'reason', CASE WHEN cardinality(v_tools) = 0 THEN 'no claimed tool records' ELSE 'no claimed tool record names this requirement' END) END,$a$;
BEGIN
  IF position('open_requirement_tools_input' IN def) > 0 THEN RAISE EXCEPTION 'open_requirements_read already uses the tool key map'; END IF;
  IF (length(def) - length(replace(def, a1, ''))) / length(a1) <> 1 THEN RAISE EXCEPTION 'dtext anchor not found once'; END IF;
  IF (length(def) - length(replace(def, a2, ''))) / length(a2) <> 1 THEN RAISE EXCEPTION 'area_band anchor not found once'; END IF;
  IF (length(def) - length(replace(def, a3, ''))) / length(a3) <> 1 THEN RAISE EXCEPTION 'tools input anchor not found once'; END IF;
  def := replace(def, a1, a1 || $r$,
      public.requirement_tool_keys(s.q, s.g->'specifications') AS tool_keys$r$);
  def := replace(def, a2, $r$'tool_keys', b.tool_keys, 'area_band', b.area,$r$);
  def := replace(def, a3, $r$        public.open_requirement_tools_input(uid, b.q->>'requirement_kind', b.tool_keys, b.dtext),$r$);
  EXECUTE def;
END $apply$;
NOTIFY pgrst, 'reload schema';
COMMIT;
