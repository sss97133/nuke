-- Inverse of 20261115135000: remove the identity_conflict conjunct and drop the helpers.
-- Refuses if the 20261115135000 marker is not present.

SET lock_timeout = '5s';
SET statement_timeout = '120s';

DO $do$
DECLARE
  v_plan text;
  v_n int;
  v_kind text;
  v_main_a_new text := $ev$or coalesce((t.signals->>'model')::numeric, 0) > 0) as has_evidence,
             public.capture_landing_set_identity_conflict(t.vehicle_id, t.image_ids) as identity_conflict  -- (20261115135000)
      from sc t where t.rank = 1$ev$;
  v_main_a_old text := $ev$or coalesce((t.signals->>'model')::numeric, 0) > 0) as has_evidence
      from sc t where t.rank = 1$ev$;
  v_main_b_new text := $ev$and t.has_evidence and not t.identity_conflict then 'clear'$ev$;
  v_main_b_old text := $ev$and t.has_evidence then 'clear'$ev$;
  v_main_c_new text := $ev$when not t.has_evidence then 'priors_only'
                when t.identity_conflict then 'identity_conflict' end,  -- (20261115135000)$ev$;
  v_main_c_old text := $ev$when not t.has_evidence then 'priors_only' end,$ev$;
  v_typ_a_new text := $ev$or coalesce((t.signals->>'model')::numeric, 0) > 0) as has_evidence,
             coalesce((select array_agg(vi.id order by vi.taken_at)
                         from vehicle_images vi
                        where vi.id = any (t.image_ids)
                          and coalesce(vi.ai_scan_metadata#>>'{classification,image_type}','')
                                not in ('other','receipt_document')), '{}'::uuid[]) as clearable_ids,  -- (20261115123000)
             public.capture_landing_set_identity_conflict(t.vehicle_id, t.image_ids) as identity_conflict  -- (20261115135000)
      from sc t where t.rank = 1$ev$;
  v_typ_a_old text := $ev$or coalesce((t.signals->>'model')::numeric, 0) > 0) as has_evidence,
             coalesce((select array_agg(vi.id order by vi.taken_at)
                         from vehicle_images vi
                        where vi.id = any (t.image_ids)
                          and coalesce(vi.ai_scan_metadata#>>'{classification,image_type}','')
                                not in ('other','receipt_document')), '{}'::uuid[]) as clearable_ids  -- (20261115123000)
      from sc t where t.rank = 1$ev$;
  v_typ_b_new text := $ev$and t.has_evidence
                 and cardinality(t.clearable_ids) > 0
                 and not t.identity_conflict then 'clear'$ev$;
  v_typ_b_old text := $ev$and t.has_evidence
                 and cardinality(t.clearable_ids) > 0 then 'clear'$ev$;
  v_typ_c_new text := $ev$when not t.has_evidence then 'priors_only'
                when cardinality(t.clearable_ids) = 0 then 'non_vehicle_type'
                when t.identity_conflict then 'identity_conflict' end,  -- (20261115123000, 20261115135000)$ev$;
  v_typ_c_old text := $ev$when not t.has_evidence then 'priors_only'
                when cardinality(t.clearable_ids) = 0 then 'non_vehicle_type' end,  -- (20261115123000)$ev$;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_plan
    FROM pg_proc
   WHERE proname = 'capture_landing_plan_step' AND pronargs = 2 AND pronamespace = 'public'::regnamespace;
  IF position('(20261115135000)' in coalesce(v_plan,'')) = 0 THEN
    RAISE EXCEPTION 'refusing revert: live plan_step does not carry the 20261115135000 marker';
  END IF;
  IF (length(v_plan) - length(replace(v_plan, v_typ_a_new, ''))) / length(v_typ_a_new) = 1 THEN
    v_kind := 'typ';
    v_plan := replace(v_plan, v_typ_a_new, v_typ_a_old);
    v_n := (length(v_plan) - length(replace(v_plan, v_typ_b_new, ''))) / length(v_typ_b_new);
    IF v_n <> 1 THEN RAISE EXCEPTION 'typ plan_step identity_conflict clear conjunct drifted (n=%); refusing revert', v_n; END IF;
    v_plan := replace(v_plan, v_typ_b_new, v_typ_b_old);
    v_n := (length(v_plan) - length(replace(v_plan, v_typ_c_new, ''))) / length(v_typ_c_new);
    IF v_n <> 1 THEN RAISE EXCEPTION 'typ plan_step identity_conflict reason marker drifted (n=%); refusing revert', v_n; END IF;
    v_plan := replace(v_plan, v_typ_c_new, v_typ_c_old);
  ELSIF (length(v_plan) - length(replace(v_plan, v_main_a_new, ''))) / length(v_main_a_new) = 1 THEN
    v_kind := 'main';
    v_plan := replace(v_plan, v_main_a_new, v_main_a_old);
    v_n := (length(v_plan) - length(replace(v_plan, v_main_b_new, ''))) / length(v_main_b_new);
    IF v_n <> 1 THEN RAISE EXCEPTION 'plan_step identity_conflict clear conjunct drifted (n=%); refusing revert', v_n; END IF;
    v_plan := replace(v_plan, v_main_b_new, v_main_b_old);
    v_n := (length(v_plan) - length(replace(v_plan, v_main_c_new, ''))) / length(v_main_c_new);
    IF v_n <> 1 THEN RAISE EXCEPTION 'plan_step identity_conflict reason marker drifted (n=%); refusing revert', v_n; END IF;
    v_plan := replace(v_plan, v_main_c_new, v_main_c_old);
  ELSE
    RAISE EXCEPTION 'plan_step identity_conflict has_evidence marker drifted; refusing revert';
  END IF;
  IF position('(20261115135000)' in v_plan) > 0 THEN
    RAISE EXCEPTION 'revert did not remove the 20261115135000 marker (%)', v_kind;
  END IF;
  EXECUTE v_plan;
END
$do$;

DROP FUNCTION IF EXISTS public.capture_landing_set_identity_conflict(uuid, uuid[]);
DROP FUNCTION IF EXISTS public.capture_landing_norm_make(text);

REVOKE ALL ON FUNCTION public.capture_landing_plan_step(uuid, integer) FROM PUBLIC, anon, authenticated;
DO $g$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.capture_landing_plan_step(uuid, integer) TO service_role;
  END IF;
END $g$;
