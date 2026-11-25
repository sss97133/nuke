-- Revert of 20261126101900_scan_reading_served_keys_end_user_guard.sql: drops the guard trigger, its function and the
-- served-list reader, removes the served_key rule rows, restores the rule-kind constraints and the 20261125200000 bodies
-- of image_scan_rules (text below) and image_scan_metadata_for_viewer (the three anchors reversed), each md5-checked.
-- After it, the plate rule again compares every string a stranger receives, including keys an end user wrote.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DROP TRIGGER IF EXISTS a000_guard_end_user_scan_reading ON public.vehicle_images;
DROP FUNCTION IF EXISTS public.guard_end_user_scan_reading();
DROP FUNCTION IF EXISTS public.image_scan_served_keys();

DELETE FROM public.image_scan_withheld_paths WHERE rule_kind = 'served_key';

ALTER TABLE public.image_scan_withheld_paths DROP CONSTRAINT IF EXISTS image_scan_withheld_paths_kind_shape;
ALTER TABLE public.image_scan_withheld_paths ADD CONSTRAINT image_scan_withheld_paths_kind_shape CHECK (CASE rule_kind
    WHEN 'path' THEN cardinality(path) >= 1 AND match_key = '' AND match_value = '' AND min_alnum IS NULL
    WHEN 'free_text' THEN cardinality(path) >= 1 AND match_key = '' AND match_value = '' AND min_alnum IS NULL
    WHEN 'array_element' THEN cardinality(path) >= 1 AND match_key <> '' AND match_value <> '' AND min_alnum IS NULL
    WHEN 'vehicle_value' THEN cardinality(path) = 0 AND match_value = '' AND min_alnum >= 4 AND match_key = 'license_plate'
    WHEN 'reviewed_keep' THEN cardinality(path) >= 1 AND match_key = '' AND match_value = '' AND min_alnum IS NULL
  END);
ALTER TABLE public.image_scan_withheld_paths DROP CONSTRAINT IF EXISTS image_scan_withheld_paths_rule_kind_check;
ALTER TABLE public.image_scan_withheld_paths ADD CONSTRAINT image_scan_withheld_paths_rule_kind_check
  CHECK (rule_kind IN ('path', 'free_text', 'array_element', 'vehicle_value', 'reviewed_keep'));

CREATE OR REPLACE FUNCTION public.image_scan_rules(p_surface text)
RETURNS public.image_scan_rule[]
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  WITH rem AS (
    SELECT r.path FROM public.image_scan_withheld_paths r
     WHERE r.surface = p_surface AND r.rule_kind IN ('path', 'free_text')
  ), nodes AS (
    SELECT DISTINCT rem.path[1:k] AS p FROM rem, generate_series(0, cardinality(rem.path) - 1) k
     -- no node inside a path that is removed whole (a rule on {a} makes a rule on {a,b} moot)
     WHERE NOT EXISTS (SELECT 1 FROM rem q WHERE cardinality(q.path) <= k AND rem.path[1:cardinality(q.path)] = q.path)
  ), numbered AS (
    SELECT n.p, row_number() OVER (ORDER BY cardinality(n.p), n.p)::integer AS i FROM nodes n
  ), tree AS (
    SELECT n.i, ROW('node', n.p,
                    coalesce((SELECT array_agg(DISTINCT rem.path[cardinality(rem.path)]) FROM rem
                               WHERE rem.path[1:cardinality(rem.path) - 1] = n.p
                                 AND NOT EXISTS (SELECT 1 FROM rem q WHERE cardinality(q.path) < cardinality(rem.path)
                                                   AND rem.path[1:cardinality(q.path)] = q.path)), '{}'),
                    coalesce((SELECT q.i FROM numbered q WHERE cardinality(n.p) > 0 AND q.p = n.p[1:cardinality(n.p) - 1]), 0),
                    '', '', NULL)::public.image_scan_rule AS rule
      FROM numbered n
  ), other AS (
    SELECT row_number() OVER (ORDER BY (r.rule_kind = 'vehicle_value'), r.path, r.match_key, r.match_value) AS i,
           ROW(r.rule_kind, r.path, '{}'::text[], 0, r.match_key, r.match_value, r.min_alnum)::public.image_scan_rule AS rule
      FROM public.image_scan_withheld_paths r
     WHERE r.surface = p_surface AND r.rule_kind IN ('array_element', 'vehicle_value')
  )
  SELECT coalesce((SELECT array_agg(t.rule ORDER BY t.i) FROM tree t), '{}')
         || coalesce((SELECT array_agg(o.rule ORDER BY o.i) FROM other o), '{}')
$function$;
REVOKE ALL ON FUNCTION public.image_scan_rules(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.image_scan_rules(text) TO service_role;

DO $unpatch$
DECLARE
  v_def text := pg_get_functiondef('public.image_scan_metadata_for_viewer(jsonb, uuid, uuid, public.image_scan_rule[])'::regprocedure);
  a1 text := $a$  IF p_meta IS NULL OR jsonb_typeof(p_meta) <> 'object' OR p_rules IS NULL THEN
    RETURN p_meta;
  END IF;$a$;
  b1 text := $b$  IF p_meta IS NULL OR p_rules IS NULL THEN
    RETURN p_meta;
  END IF;$b$;
  a2 text := $a$  IF v_uid IS NOT NULL AND p_user_id = v_uid THEN
    RETURN p_meta;
  END IF;$a$;
  b2 text := $b$  IF v_uid IS NOT NULL AND p_user_id = v_uid THEN
    RETURN p_meta;
  END IF;
  -- served_key_default_v1: a scan document that is not an object is withheld whole from an untied caller
  IF jsonb_typeof(p_meta) <> 'object' THEN
    IF v_uid IS NOT NULL AND public.vehicle_viewer_tied(p_vehicle_id) THEN
      RETURN p_meta;
    END IF;
    RETURN NULL;
  END IF;$b$;
  a3 text := $a$    ELSIF r.kind = 'array_element' THEN$a$;
  b3 text := $b$    ELSIF r.kind = 'served' THEN
      -- served_key_default_v1: a top-level key not on the served list is withheld (a key no rule names included)
      IF EXISTS (SELECT 1 FROM jsonb_object_keys(v_out) k WHERE NOT (k = ANY (r.keys))) THEN
        v_out := v_out - ARRAY(SELECT k FROM jsonb_object_keys(v_out) k WHERE NOT (k = ANY (r.keys)));
        v_hit := true;
      END IF;
    ELSIF r.kind = 'array_element' THEN$b$;
BEGIN
  IF position('served_key_default_v1' IN v_def) = 0 THEN
    RETURN;
  END IF;
  EXECUTE replace(replace(replace(v_def, b3, a3), b2, a2), b1, a1);
END
$unpatch$;

-- the rule table's statement trigger recompiled on the DELETE above, before image_scan_rules was restored; recompile
SELECT public.image_scan_rules_compile();

DO $verify$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.image_scan_metadata_for_viewer(jsonb, uuid, uuid, public.image_scan_rule[])'::regprocedure)
       NOT IN ('c3ab8411de3cd842c8cafd823f90641e', '3d45767ad3218d2c53cb78879e975be1')
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.image_scan_rules(text)'::regprocedure) <> '420fe0be7f009555945951f1876bb1dd' THEN
    RAISE EXCEPTION 'revert: a body is not the 20261125200000 one';
  END IF;
END
$verify$;
COMMIT;
