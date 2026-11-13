-- Header facet items, logged-out speed: vehicle_facet_items reads only the observations that can speak to a token.
--
-- WHY. vehicle_facet_items (20261116016000) is security invoker. Its obs CTE joined every observation of the vehicle and
-- filtered them by claim role and property key. Row policies run before any non-leakproof filter, so for anon
-- observation_is_public(kind, structured_data) ran on all of them. Measured on prod 2026-11-12 as anon:
-- - 043c6d8b (4,522 observations, none of which speak to a token): vehicle_facet_items(…,'masthead') about 1,360 ms per
--   call, and vehicle_profile_read about 1,470 ms, against about 120 ms as postgres.
-- - The same structural filter without row policies: 19 ms. Row policies on 20 rows reached by primary key: 4 ms.
--
-- WHAT.
-- 1. vehicle_facet_observation_ids(vehicle, roles): SECURITY DEFINER. It returns the ids of the vehicle's current
--    observations that carry a property, a claim role in the list or a VIN decode, and nothing else, only when the
--    vehicle passes the reader's own visibility test (is_public AND deleted_at IS NULL, or the caller is its party).
-- 2. vehicle_facet_items reads vehicle_observations by those ids (uuid equality is leakproof, so the primary key is used
--    before the row policies). The row policies still judge every row returned, so what a viewer sees does not change.
-- 3. The location items are not built for 'masthead', which drops them anyway.
-- Both are anchor patches of the deployed body; they refuse drift and are skipped when already applied.
BEGIN;
SET LOCAL statement_timeout = '20s';
SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.vehicle_facet_observation_ids(p_vehicle_id uuid, p_roles text[])
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT coalesce(array_agg(o.id), '{}'::uuid[])
  FROM public.vehicles v
  JOIN public.vehicle_observations o ON o.vehicle_id = v.id
  WHERE v.id = p_vehicle_id
    AND v.deleted_at IS NULL
    AND (v.is_public IS TRUE
         OR ((SELECT auth.uid()) IS NOT NULL AND ((SELECT auth.uid()) IN (v.user_id, v.owner_id, v.uploaded_by)
             OR public.vehicle_user_has_access(v.id, (SELECT auth.uid())))))
    AND o.is_superseded IS NOT TRUE
    AND (o.property_id IS NOT NULL OR o.structured_data ? 'property_key'
         OR o.structured_data->>'claim_role' = ANY (p_roles)
         OR (o.extraction_method LIKE 'vin\_decode\_%' AND o.structured_data ? 'decode_rule'))
$function$;
COMMENT ON FUNCTION public.vehicle_facet_observation_ids(uuid, text[]) IS
  'Ids only: the current observations of one visible vehicle that carry a property, one of the given claim roles or a '
  'VIN decode. vehicle_facet_items reads those rows under the viewer''s own row policies, so the policies run on the '
  'rows that can speak to a token instead of every observation of the vehicle.';
REVOKE ALL ON FUNCTION public.vehicle_facet_observation_ids(uuid, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_facet_observation_ids(uuid, text[]) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION pg_temp.patch_once(p_text text, p_anchor text, p_replacement text, p_what text) RETURNS text
LANGUAGE plpgsql AS $f$
DECLARE n integer := (length(p_text) - length(replace(p_text, p_anchor, ''))) / greatest(length(p_anchor), 1);
BEGIN
  IF n <> 1 THEN RAISE EXCEPTION '% anchor drifted (found % times): %', p_what, n, p_anchor; END IF;
  RETURN replace(p_text, p_anchor, p_replacement);
END $f$;

DO $migration$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.vehicle_facet_items(uuid,text)'::regprocedure);
  IF position('vehicle_facet_observation_ids' in d) = 0 THEN
    d := pg_temp.patch_once(d,
      E'-- Observations in the viewer''s row policies that can speak to a token.\nobs AS MATERIALIZED (',
      E'-- The ids of the observations that can speak to a token (vehicle_facet_observation_ids), so the viewer''s row\n'
      || E'-- policies run on those rows only, not on every observation of the vehicle.\n'
      || E'obs_ids AS MATERIALIZED (\n'
      || E'  SELECT public.vehicle_facet_observation_ids(v.id,\n'
      || E'    ARRAY(SELECT role FROM roles UNION ALL SELECT ''cowl_tag_option_codes'')) AS ids\n'
      || E'  FROM v\n'
      || E'),\n'
      || E'-- Observations in the viewer''s row policies that can speak to a token.\nobs AS MATERIALIZED (',
      'vehicle_facet_items obs CTE');
    d := pg_temp.patch_once(d,
      E'  FROM v JOIN public.vehicle_observations o ON o.vehicle_id = v.id\n',
      E'  FROM v CROSS JOIN obs_ids x JOIN public.vehicle_observations o ON o.id = ANY (x.ids)\n',
      'vehicle_facet_items observation join');
    d := pg_temp.patch_once(d,
      E'UNION ALL SELECT key, doc FROM loc_docs) e',
      E'UNION ALL SELECT key, doc FROM loc_docs WHERE p_dimension IS DISTINCT FROM ''masthead'') e',
      'vehicle_facet_items location union');
    EXECUTE d;
  END IF;
  IF position('vehicle_facet_observation_ids' in pg_get_functiondef('public.vehicle_facet_items(uuid,text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'vehicle_facet_items is not patched';
  END IF;
END $migration$;

DROP FUNCTION pg_temp.patch_once(text, text, text, text);
COMMIT;
