-- Spec landing: platform bucket bounds as index conditions (20261124028000), follow-up to 20261124026000.
-- data_set_scope_vehicles('platform_hex_XX') bounded the bucket with "id < next OR bucket = ff", which the planner cannot
-- use as an index bound, so every lookup read from the bucket start to the end of vehicles_pkey (over 58 s). The bucket is
-- now id between XX000000-... and XXffffff-..., the same set. Other scopes unchanged.
-- Revert: supabase/sql/revert_20261124028000_spec_bucket_bounds.sql

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
    -- the rest of the platform in 256 id buckets (platform_hex_00 .. platform_hex_ff), deleted ids kept so slice positions
    -- stay stable, the three landed cohorts left out
    ELSE CASE WHEN p_scope ~ '^platform_hex_[0-9a-f]{2}$' THEN (
      SELECT array_agg(x.id ORDER BY x.id) FROM public.vehicles x
       -- both bounds as plain index conditions (an OR on the upper bound scanned to the end of the index)
       WHERE x.id >= (substr(p_scope, 14, 2) || '000000-0000-0000-0000-000000000000')::uuid
         AND x.id <= (substr(p_scope, 14, 2) || 'ffffff-ffff-ffff-ffff-ffffffffffff')::uuid
         AND NOT coalesce(lower(x.make) = 'pontiac'
                   AND (lower(coalesce(x.model, '')) ~ 'firebird|trans ?am'
                        OR upper(btrim(coalesce(x.vin, ''))) ~ '^2[A-Z]87[A-Z][2-9A][A-Z][0-9]{6}$'
                        OR upper(btrim(coalesce(x.vin, ''))) ~ '^22[3468]87[01][A-Z][0-9]{6}$'
                        OR upper(btrim(coalesce(x.vin, ''))) ~ '^1G2[A-C][A-Z]87[A-Z][0-9X]B[A-Z][0-9]{6}$'), false)
         AND NOT coalesce(lower(x.make) = 'ford' AND x.year BETWEEN 1965 AND 1973 AND lower(coalesce(x.model, '')) ~ 'mustang', false)
         AND NOT coalesce(lower(x.make) = 'chevrolet' AND x.year BETWEEN 1967 AND 1969 AND lower(coalesce(x.model, '')) ~ 'camaro', false))
    END
  END
$function$;

commit;
