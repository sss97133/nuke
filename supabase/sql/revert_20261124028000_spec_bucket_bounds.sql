-- Revert 20261124028000_spec_bucket_bounds: restore the 20261124026000 data_set_scope_vehicles body.
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
       WHERE x.id >= (substr(p_scope, 14, 2) || '000000-0000-0000-0000-000000000000')::uuid
         AND (substr(p_scope, 14, 2) = 'ff'
              OR x.id < (lpad(to_hex(('x' || substr(p_scope, 14, 2))::bit(8)::int + 1), 2, '0') || '000000-0000-0000-0000-000000000000')::uuid)
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
