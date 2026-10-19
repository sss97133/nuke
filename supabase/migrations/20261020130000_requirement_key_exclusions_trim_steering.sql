-- Two reviewed refinements to requirement keys, from the 39 live open requirements (owner's published jobs):
-- 1. Fastener context is not body rust. The keyword table's rust_body entry matched "Replace corroded header bolts
--    (stainless kit)" on the K2500, so publish_work_order gave that operation the rust_body template requirements ("Rust repair
--    and panel welding", "MIG welder", "Body shop bay"). Corroded bolts are replaced, not panel-repaired.
--      * listing_plan_keyword_table: rust_body's exclude gains a fastener context (rust*/corro* within one word of
--        bolt/stud/nut/screw/fastener), so future posts and publications skip it.
--      * requirement_template_exclusions (reviewed data): a template's keys are not derived for a requirement whose operation
--        text names one of these words; requirement_capability_keys and requirement_tool_keys honour it (anchored edits;
--        the requirement itself stays, it is testimony).
-- 2. Steering/suspension/alignment and trim work had no capability type (11 live texts stayed keyless). Two reviewed types
--    are added to actor_capabilities' vocabulary, steering_suspension_alignment and trim_installation, with
--    requirement_keyword rows quoting the live texts. The fold's evidence mapping is unchanged (installing steering parts
--    still derives nothing from evidence until a reviewed task/system row says so); the fold and readers accept the types.
-- Contract: supabase/sql/test_requirement_key_exclusions_trim_steering.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

CREATE TABLE public.requirement_template_exclusions (
  template_slug text NOT NULL CHECK (template_slug ~ '^[a-z0-9_]+$'),
  operation_word text NOT NULL CHECK (operation_word ~ '^[a-z]+$'),
  note text NOT NULL,
  PRIMARY KEY (template_slug, operation_word)
);
ALTER TABLE public.requirement_template_exclusions ENABLE ROW LEVEL SECURITY;
CREATE POLICY requirement_template_exclusions_read ON public.requirement_template_exclusions FOR SELECT USING (true);
REVOKE ALL ON public.requirement_template_exclusions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.requirement_template_exclusions TO anon, authenticated;
GRANT ALL ON public.requirement_template_exclusions TO service_role;
COMMENT ON TABLE public.requirement_template_exclusions IS 'Reviewed (20261020130000): a requirement whose description is <template_slug> (slugged template description) gets no template keys when its operation text names <operation_word> as a whole word (plural allowed). Fastener context for the rust_body templates.';
INSERT INTO public.requirement_template_exclusions(template_slug, operation_word, note)
SELECT t, w, 'rust_body template matched "Replace corroded header bolts (stainless kit)": a corroded fastener is replaced, not panel-repaired'
FROM unnest(ARRAY['rust_repair_and_panel_welding', 'mig_welder', 'body_shop_bay']) t, unnest(ARRAY['bolt', 'stud', 'nut', 'screw', 'fastener']) w;

CREATE FUNCTION public.requirement_template_excluded(p_requirement jsonb) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.requirement_template_exclusions e,
      (SELECT ' ' || regexp_replace(lower(COALESCE((SELECT li.task_description FROM public.work_order_line_items li
          WHERE li.id = (p_requirement->>'line_item_id')::uuid), '')), '[^a-z0-9]+', ' ', 'g') || ' ' AS txt) x
    WHERE e.template_slug = (SELECT public.capability_template_slug(p_requirement->>'description'))
      AND (x.txt LIKE '% ' || e.operation_word || ' %' OR x.txt LIKE '% ' || e.operation_word || 's %'))
$$;
REVOKE ALL ON FUNCTION public.requirement_template_excluded(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.requirement_template_excluded(jsonb) TO service_role;

DO $types$
DECLARE
  def text := (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.actor_capabilities'::regclass AND conname = 'chk_ac_capability_type');
  vals text[];
BEGIN
  IF def IS NULL OR position('fabrication_exhaust' IN def) = 0 THEN RAISE EXCEPTION 'chk_ac_capability_type not found as expected'; END IF;
  IF position('trim_installation' IN def) > 0 THEN RAISE EXCEPTION 'capability types already extended'; END IF;
  SELECT array_agg(m[1] ORDER BY ord) INTO vals FROM regexp_matches(def, '''([a-z_]+)''', 'g') WITH ORDINALITY x(m, ord);
  vals := vals || ARRAY['steering_suspension_alignment', 'trim_installation'];
  EXECUTE 'ALTER TABLE public.actor_capabilities DROP CONSTRAINT chk_ac_capability_type, ADD CONSTRAINT chk_ac_capability_type CHECK (capability_type = ANY (ARRAY['
    || (SELECT string_agg(quote_literal(v), ', ' ORDER BY o) FROM unnest(vals) WITH ORDINALITY u(v, o)) || '])) NOT VALID';
  ALTER TABLE public.actor_capabilities VALIDATE CONSTRAINT chk_ac_capability_type;
END $types$;

INSERT INTO public.capability_evidence_map(kind, source_key, system_key, capability_type, note) VALUES
  ('requirement_keyword', 'steering_box:steering_suspension_alignment', NULL, 'steering_suspension_alignment', '"ORD Bolt-In Steering Box Brace (73-91 GM)", "2WD steering box upgrade"'),
  ('requirement_keyword', 'idler_arm:steering_suspension_alignment', NULL, 'steering_suspension_alignment', '"Idler arm replacement"'),
  ('requirement_keyword', 'crossover_steering:steering_suspension_alignment', NULL, 'steering_suspension_alignment', '"Crossover steering kit (Corp 10 bolt axle) - eBay/ORD"'),
  ('requirement_keyword', 'steering_column:steering_suspension_alignment', NULL, 'steering_suspension_alignment', '"Steering column tighten (pull wheel)"'),
  ('requirement_keyword', 'tie_rod_end:steering_suspension_alignment', NULL, 'steering_suspension_alignment', '"Tie rod end inspection/replacement"'),
  ('requirement_keyword', 'front_end_alignment:steering_suspension_alignment', NULL, 'steering_suspension_alignment', '"Front end alignment"'),
  ('requirement_keyword', 'window_molding:trim_installation', NULL, 'trim_installation', '"Rear window molding (GMC)"'),
  ('requirement_keyword', 'trim_piece:trim_installation', NULL, 'trim_installation', '"Tailgate fancy trim piece + GMC emblem"'),
  ('requirement_keyword', 'shift_indicator:trim_installation', NULL, 'trim_installation', '"Shift indicator pointer (orange)" (an interior indicator trim part)'),
  ('requirement_keyword', 'vent_seal:trim_installation', NULL, 'trim_installation', '"Fresh air vent seal replacement"');

DO $apply$
DECLARE
  kdef text := pg_get_functiondef('public.listing_plan_keyword_table()'::regprocedure);
  cdef text := pg_get_functiondef('public.requirement_capability_keys(jsonb,jsonb)'::regprocedure);
  tdef text := pg_get_functiondef('public.requirement_tool_keys(jsonb,jsonb)'::regprocedure);
  k1 constant text := $a$"exclude":"\\brust[- ]free\\b|\\bno (visible )?rust\\b|\\bwithout rust\\b"$a$;
  c1 constant text := $a$WHERE m.kind = 'requirement_template' AND split_part(m.source_key, ':', 1) = (SELECT public.capability_template_slug(p_requirement->>'description'))$a$;
  t1 constant text := $a$WHERE m.source_kind = 'requirement_template' AND m.source_key = lower(btrim(COALESCE(p_requirement->>'description', '')))$a$;
BEGIN
  IF position('requirement_template_excluded' IN cdef) > 0 OR position('requirement_template_excluded' IN tdef) > 0 THEN
    RAISE EXCEPTION 'key functions already honour template exclusions';
  END IF;
  IF (length(kdef) - length(replace(kdef, k1, ''))) / length(k1) <> 1 THEN RAISE EXCEPTION 'keyword table rust_body exclude anchor not found once'; END IF;
  IF (length(cdef) - length(replace(cdef, c1, ''))) / length(c1) <> 1 THEN RAISE EXCEPTION 'requirement_capability_keys template anchor not found once'; END IF;
  IF (length(tdef) - length(replace(tdef, t1, ''))) / length(t1) <> 1 THEN RAISE EXCEPTION 'requirement_tool_keys template anchor not found once'; END IF;
  EXECUTE replace(kdef, k1, $r$"exclude":"\\brust[- ]free\\b|\\bno (visible )?rust\\b|\\bwithout rust\\b|\\b(rust\\w*|corro\\w*)\\s+(\\w+\\s+)?(bolts?|studs?|nuts?|screws?|fasteners?)\\b"$r$);
  EXECUTE replace(cdef, c1, c1 || $r$
        AND NOT public.requirement_template_excluded(p_requirement)$r$);
  EXECUTE replace(tdef, t1, t1 || $r$
        AND NOT public.requirement_template_excluded(p_requirement)$r$);
END $apply$;
COMMIT;
