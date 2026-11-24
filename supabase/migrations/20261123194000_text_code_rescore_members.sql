-- text_code_rescore_v1 also carries the live reading confidence onto the active data_set_members rows that cite it
-- (basis_type code_reading), so vehicle_data_sets and data_set_comps never show a stale confidence after a later run
-- reads a conflicting code. Only confidence moves; set, member, basis and run stamps are unchanged.
begin;
set local lock_timeout = '3s';
CREATE OR REPLACE FUNCTION public.text_code_rescore_v1(p_vehicles uuid[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE n int; n_m int;
BEGIN
  WITH k AS (
    SELECT r.id, CASE WHEN r.kind <> 'cowl_option'
                       AND max(r.code) OVER (PARTITION BY r.vehicle_id, r.kind) <> min(r.code) OVER (PARTITION BY r.vehicle_id, r.kind)
                      THEN round(r.base_confidence * 0.6, 3) ELSE r.base_confidence END AS c
      FROM public.vehicle_code_readings r WHERE r.vehicle_id = ANY (p_vehicles) AND r.state = 'active'),
  u AS (UPDATE public.vehicle_code_readings r SET confidence = k.c FROM k WHERE r.id = k.id AND r.confidence IS DISTINCT FROM k.c
        RETURNING 1)
  SELECT count(*) INTO n FROM u;
  WITH u AS (
    UPDATE public.data_set_members m SET confidence = r.confidence
      FROM public.vehicle_code_readings r
     WHERE m.basis_type = 'code_reading' AND m.basis_id = r.id AND m.state = 'active'
       AND r.vehicle_id = ANY (p_vehicles) AND r.state = 'active' AND m.confidence IS DISTINCT FROM r.confidence
    RETURNING 1)
  SELECT count(*) INTO n_m FROM u;
  RETURN n + n_m;
END
$function$;
SELECT public.text_code_rescore_v1(coalesce((SELECT array_agg(DISTINCT vehicle_id) FROM public.vehicle_code_readings WHERE state = 'active'), '{}'));
REVOKE ALL ON FUNCTION public.text_code_rescore_v1(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.text_code_rescore_v1(uuid[]) TO service_role;
commit;
