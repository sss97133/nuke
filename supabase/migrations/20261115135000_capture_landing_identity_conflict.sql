-- Identity conflict: a set must not clear onto a candidate whose make/year the frames contradict.
-- Derived from the gold vs 2026-02-27 distribution (not a visual-score floor):
--   * visual >= 1.0 would drop 25/91 filed, gate-passed clear sets (all had a correct gate sample).
--   * no visual threshold can catch the 0.347 dually and keep gold (would-drop p50 visual was 0.028).
--   * after alias/token normalization, gold make-conflicts are all a single frame (4/91);
--     2026-02-27 has 3 Chevrolet-make frames (conf 0.9) plus year 1988 vs 1983 (delta 5, conf 0.8).
-- Rule: >=2 conflicting-make frames (conf >= 0.8), or >=1 conflicting make plus a year delta >= 5.
-- chevrolet is not gmc. typ=other / receipt_document frames are ignored.
-- Stacked after 20261111200000 (and live typ-patched plan_step 20261115123000).
-- Does not bump any epoch, does not call capture_landing_gate_check, does not clear the halt.

SET lock_timeout = '5s';
SET statement_timeout = '120s';

CREATE OR REPLACE FUNCTION public.capture_landing_norm_make(p_raw text)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  n text;
  v text;
BEGIN
  n := lower(trim(regexp_replace(coalesce(p_raw, ''), '[^a-zA-Z0-9]+', ' ', 'g')));
  IF n = '' THEN RETURN NULL; END IF;
  v := CASE n
    WHEN 'chevy' THEN 'chevrolet' WHEN 'chev' THEN 'chevrolet' WHEN 'chevrolet' THEN 'chevrolet'
    WHEN 'gmc' THEN 'gmc' WHEN 'ford' THEN 'ford' WHEN 'dodge' THEN 'dodge'
    ELSE NULL
  END;
  IF v IS NOT NULL THEN RETURN v; END IF;
  IF to_regclass('public.canonical_makes') IS NOT NULL THEN
    EXECUTE $q$
      SELECT lower(cm.canonical_name)
        FROM canonical_makes cm
        CROSS JOIN unnest(coalesce(cm.aliases, '{}') || ARRAY[cm.canonical_name, cm.short_name]) a
       WHERE a IS NOT NULL AND lower(trim(a)) = $1
       LIMIT 1
    $q$ INTO v USING n;
    IF v IS NOT NULL THEN RETURN v; END IF;
    EXECUTE $q$
      SELECT lower(cm.canonical_name)
        FROM canonical_makes cm
        CROSS JOIN unnest(coalesce(cm.aliases, '{}') || ARRAY[cm.canonical_name, cm.short_name]) a
       WHERE a IS NOT NULL AND length(trim(a)) >= 3 AND $1 LIKE lower(trim(a)) || ' %'
       ORDER BY length(trim(a)) DESC
       LIMIT 1
    $q$ INTO v USING n;
    IF v IS NOT NULL THEN RETURN v; END IF;
  END IF;
  IF to_regclass('public.make_alias_ref') IS NOT NULL THEN
    EXECUTE $q$
      SELECT lower(trim(canonical_make))
        FROM make_alias_ref
       WHERE retired_at IS NULL AND relation_type = 'same_make'
         AND lower(trim(alias_text)) = $1
       LIMIT 1
    $q$ INTO v USING n;
    IF v IS NOT NULL THEN RETURN v; END IF;
    EXECUTE $q$
      SELECT lower(trim(canonical_make))
        FROM make_alias_ref
       WHERE retired_at IS NULL AND relation_type = 'same_make'
         AND length(trim(alias_text)) >= 3 AND $1 LIKE lower(trim(alias_text)) || ' %'
       ORDER BY length(trim(alias_text)) DESC
       LIMIT 1
    $q$ INTO v USING n;
  END IF;
  IF v IS NULL AND n LIKE '% %' AND length(split_part(n, ' ', 1)) >= 3 THEN
    RETURN public.capture_landing_norm_make(split_part(n, ' ', 1));
  END IF;
  RETURN v;
END
$fn$;

CREATE OR REPLACE FUNCTION public.capture_landing_set_identity_conflict(p_vehicle uuid, p_imgs uuid[])
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
-- (20261115135000) identity_conflict helper
DECLARE
  v_brand text;
  v_year int;
  n_make int := 0;
  n_year int := 0;
BEGIN
  IF p_vehicle IS NULL OR p_imgs IS NULL THEN RETURN false; END IF;
  SELECT public.capture_landing_norm_make(make), year INTO v_brand, v_year
    FROM vehicles WHERE id = p_vehicle;
  IF v_brand IS NULL AND v_year IS NULL THEN RETURN false; END IF;
  SELECT
    (SELECT count(DISTINCT vi.id)
       FROM vehicle_images vi
       JOIN LATERAL jsonb_array_elements(coalesce(vi.ai_scan_metadata#>'{classification,v2,vehicle_fields}', '[]')) x ON true
      WHERE vi.id = ANY (p_imgs)
        AND coalesce(vi.ai_scan_metadata#>>'{classification,image_type}', '') NOT IN ('other', 'receipt_document')
        AND x->>'field_name' = 'make' AND (x->>'confidence')::numeric >= 0.8
        AND public.capture_landing_norm_make(x->>'value') IS NOT NULL
        AND v_brand IS NOT NULL
        AND public.capture_landing_norm_make(x->>'value') IS DISTINCT FROM v_brand),
    (SELECT count(DISTINCT vi.id)
       FROM vehicle_images vi
       JOIN LATERAL jsonb_array_elements(coalesce(vi.ai_scan_metadata#>'{classification,v2,vehicle_fields}', '[]')) x ON true
      WHERE vi.id = ANY (p_imgs)
        AND coalesce(vi.ai_scan_metadata#>>'{classification,image_type}', '') NOT IN ('other', 'receipt_document')
        AND x->>'field_name' = 'year' AND (x->>'confidence')::numeric >= 0.8
        AND x->>'value' ~ '^[0-9]{4}$' AND v_year IS NOT NULL
        AND abs((x->>'value')::int - v_year) >= 5)
  INTO n_make, n_year;
  RETURN n_make >= 2 OR (n_make >= 1 AND n_year >= 1);
END
$fn$;

REVOKE ALL ON FUNCTION public.capture_landing_norm_make(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_landing_set_identity_conflict(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
DO $g$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.capture_landing_norm_make(text) TO service_role;
    GRANT EXECUTE ON FUNCTION public.capture_landing_set_identity_conflict(uuid, uuid[]) TO service_role;
  END IF;
END $g$;

DO $do$
DECLARE
  v_plan text;
  v_n int;
  v_a_old text := $ev$or coalesce((t.signals->>'model')::numeric, 0) > 0) as has_evidence
      from sc t where t.rank = 1$ev$;
  v_a_new text := $ev$or coalesce((t.signals->>'model')::numeric, 0) > 0) as has_evidence,
             public.capture_landing_set_identity_conflict(t.vehicle_id, t.image_ids) as identity_conflict  -- (20261115135000)
      from sc t where t.rank = 1$ev$;
  v_b_old text := $ev$and t.has_evidence then 'clear'$ev$;
  v_b_new text := $ev$and t.has_evidence and not t.identity_conflict then 'clear'$ev$;
  v_c_old text := $ev$when not t.has_evidence then 'priors_only' end,$ev$;
  v_c_new text := $ev$when not t.has_evidence then 'priors_only'
                when t.identity_conflict then 'identity_conflict' end,  -- (20261115135000)$ev$;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_plan
    FROM pg_proc
   WHERE proname = 'capture_landing_plan_step' AND pronargs = 2 AND pronamespace = 'public'::regnamespace;
  IF v_plan IS NULL THEN RAISE EXCEPTION 'capture_landing_plan_step is not live'; END IF;
  IF position('(20261115135000)' in v_plan) > 0 THEN
    RAISE NOTICE 'capture_landing_plan_step already carries 20261115135000 identity_conflict';
    RETURN;
  END IF;
  v_n := (length(v_plan) - length(replace(v_plan, v_a_old, ''))) / length(v_a_old);
  IF v_n <> 1 THEN RAISE EXCEPTION 'plan_step has_evidence block drifted (n=%); refusing identity_conflict patch', v_n; END IF;
  v_plan := replace(v_plan, v_a_old, v_a_new);
  v_n := (length(v_plan) - length(replace(v_plan, v_b_old, ''))) / length(v_b_old);
  IF v_n <> 1 THEN RAISE EXCEPTION 'plan_step clear conjunct drifted (n=%); refusing identity_conflict patch', v_n; END IF;
  v_plan := replace(v_plan, v_b_old, v_b_new);
  v_n := (length(v_plan) - length(replace(v_plan, v_c_old, ''))) / length(v_c_old);
  IF v_n <> 1 THEN RAISE EXCEPTION 'plan_step reason case drifted (n=%); refusing identity_conflict patch', v_n; END IF;
  v_plan := replace(v_plan, v_c_old, v_c_new);
  IF position('(20261115135000)' in v_plan) = 0 THEN
    RAISE EXCEPTION 'plan_step identity_conflict patch did not land';
  END IF;
  EXECUTE v_plan;
END
$do$;

REVOKE ALL ON FUNCTION public.capture_landing_plan_step(uuid, integer) FROM PUBLIC, anon, authenticated;
DO $g2$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.capture_landing_plan_step(uuid, integer) TO service_role;
  END IF;
END $g2$;
