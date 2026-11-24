-- Revert 20261124025000_data_set_public_counts: restore the 20261124020000 vehicle_data_sets body, stop the refresh, drop the cache.
begin;
set local lock_timeout = '5s';
SELECT cron.unschedule('data-set-public-counts') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'data-set-public-counts');

CREATE OR REPLACE FUNCTION public.vehicle_data_sets(p_vehicle_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '8s'
AS $function$
DECLARE v_out jsonb;
BEGIN
  IF p_vehicle_id IS NULL OR NOT public.data_set_can_read_vehicle(p_vehicle_id) THEN
    RETURN jsonb_build_object('vehicle_id', p_vehicle_id, 'error', 'not_found_or_not_public');
  END IF;
  WITH mine AS (
    SELECT m.set_id, max(m.confidence) AS conf,
           count(*) FILTER (WHERE m.member_type = 'vehicle') AS n_vehicle_bases,
           count(*) FILTER (WHERE m.member_type = 'image') AS n_images,
           count(*) FILTER (WHERE m.member_type = 'auction_comment') AS n_comments,
           jsonb_agg(DISTINCT jsonb_build_object('basis_type', m.basis_type, 'basis_id', m.basis_id, 'rule', m.rule_version,
                                                 'confidence', m.confidence))
             FILTER (WHERE m.member_type = 'vehicle') AS bases
      FROM public.data_set_members m
     WHERE m.vehicle_id = p_vehicle_id AND m.state = 'active'
     GROUP BY m.set_id),
  sets AS (
    SELECT s.id, s.set_kind, s.set_key, s.label, s.rule_version, mine.*,
           (SELECT count(DISTINCT m2.vehicle_id) FROM public.data_set_members m2
              JOIN public.vehicles pv ON pv.id = m2.vehicle_id AND pv.is_public IS TRUE AND pv.deleted_at IS NULL
             WHERE m2.set_id = s.id AND m2.state = 'active' AND m2.member_type IN ('vehicle','auction_comment')) AS n_vehicles
      FROM mine JOIN public.data_sets s ON s.id = mine.set_id)
  SELECT jsonb_build_object(
    'vehicle_id', p_vehicle_id,
    'logic_version', 'data_set_membership/20261123180000.1',
    'sets', coalesce(jsonb_agg(jsonb_build_object(
        'set_id', sets.id, 'set_kind', sets.set_kind, 'set_key', sets.set_key, 'label', sets.label,
        'confidence', sets.conf, 'public_vehicles_in_set', sets.n_vehicles,
        'evidence', jsonb_build_object('vehicle_bases', coalesce(sets.bases, '[]'::jsonb), 'images', sets.n_images,
                                       'comments', sets.n_comments))
        ORDER BY sets.set_kind, sets.set_key), '[]'::jsonb),
    'unknown_kinds', (SELECT coalesce(jsonb_agg(k ORDER BY k), '[]'::jsonb) FROM unnest(ARRAY['vin_cohort','vin_series','vin_engine',
        'plant_year','cowl_style','engine_block_casting','engine_code','trans_case_casting','trans_tail_casting','paint_code',
        'replica_cohort','comment_theme','cowl_option','body_style','trim_level','engine_cid','trans_type','trans_speeds',
        'trans_model','axle_ratio','interior_trim_code','rpo_code','build_month','dealer_zone','documentation']) k WHERE NOT EXISTS (SELECT 1 FROM sets WHERE sets.set_kind = k)))
    INTO v_out FROM sets;
  RETURN v_out;
END
$function$;

DROP FUNCTION IF EXISTS public.data_set_public_counts_refresh_v1();
DROP TABLE IF EXISTS public.data_set_public_counts;
commit;
