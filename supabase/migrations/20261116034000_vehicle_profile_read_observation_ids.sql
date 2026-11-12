-- vehicle_profile_read: read the description captures by id, and stop folding the unread evidence summary on every page.
--
-- ROOT CAUSE. vehicle_observations' row policy (vo_authenticated_read) calls observation_is_public(kind, structured_data)
-- for every row it is asked about: a regular expression over the whole structured_data text. A reader that filters a
-- vehicle's observations with a test the planner may not run before the policy (enum equality on kind, any jsonb
-- operator) makes the policy run on every observation the vehicle holds. Measured as anon, 2026-11-12: the regex alone is
-- 338 ms over 043c6d8b's 4,522 rows (a plain count is 5 ms). vehicle_facet_items (20261116031000) and this migration
-- route around it the same way: a SECURITY DEFINER helper names the few rows that can matter, and the reader reads those
-- ids under the viewer's own row policies. Whether the policy itself gets cheaper is a separate decision.
--
-- WHAT.
-- 1. vehicle_profile_observation_ids(vehicle): ids only, of the vehicle's listing observations that can be its
--    description (a description capture, or a native dealer listing), on a vehicle the viewer may see, narrowed to the
--    rows the row policy would show that viewer. The narrowing repeats vo_authenticated_read, vo_public_broadcast_read and
--    the two restrictive policies, so the helper names no row its caller cannot read; the reader still reads every row
--    through the policies. test_vehicle_facet_items.sql checks the helper against the policies for every viewer.
-- 2. vehicle_profile_read's `descr` reads those ids (it scanned every observation of the vehicle through the policy:
--    365 ms on 043c6d8b).
-- 3. vehicle_profile_read no longer embeds vehicle_profile_evidence(vehicle) as `evidence`. No web, iOS or edge consumer
--    reads that key (git grep, 2026-11-12), and its observations_by_kind count runs the policy on every observation
--    (453 ms on 043c6d8b, 152 ms on 20d21fb0). The function itself is unchanged and stays. The key was added outside the
--    migrations (docs/function-drift-20261107.md lists vehicle_profile_evidence), so its patch runs only where present.
-- Anchor patches of the deployed body; they refuse drift and are skipped when already applied.
BEGIN;
SET LOCAL statement_timeout = '20s';
SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.vehicle_profile_observation_ids(p_vehicle_id uuid)
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH viewer AS (SELECT (SELECT auth.uid()) AS uid),
  candidates AS MATERIALIZED (
    -- profile_description_v1: the rows vehicle_profile_read's `descr` can choose (it re-applies its own tests).
    SELECT o.id, o.kind, o.structured_data, o.source_id, o.extraction_method, o.submitted_by_user_id,
           v.is_public, (viewer.uid IS NOT NULL AND viewer.uid IN (v.user_id, v.owner_id, v.uploaded_by)) AS party
    FROM public.vehicles v CROSS JOIN viewer
    JOIN public.vehicle_observations o ON o.vehicle_id = v.id
    WHERE v.id = p_vehicle_id
      AND v.deleted_at IS NULL
      AND (v.is_public IS TRUE OR (viewer.uid IS NOT NULL AND viewer.uid IN (v.user_id, v.owner_id, v.uploaded_by)))
      AND o.kind = 'listing'
      AND (o.structured_data->>'description_capture' = 'true'
           OR o.extraction_method IN ('gateway_jsonld_v1', 'dealer_microdata_v1', 'dealer_microdata_v2'))
  )
  SELECT coalesce(array_agg(c.id), '{}'::uuid[])
  FROM candidates c CROSS JOIN viewer
  -- The row policies, on these few rows only.
  WHERE (c.party OR (c.is_public IS TRUE AND public.observation_is_public(c.kind, c.structured_data))
         OR c.source_id = 'e980c7bd-404f-41f6-8a17-1c7cabd1d8a4'::uuid)
    AND (c.extraction_method IS DISTINCT FROM 'garage_owner_correction_v1' OR c.submitted_by_user_id = viewer.uid)
    AND (c.extraction_method IS DISTINCT FROM 'work_order_payment_witness_sign_v1' OR c.submitted_by_user_id = viewer.uid)
$function$;
COMMENT ON FUNCTION public.vehicle_profile_observation_ids(uuid) IS
  'Ids only: the listing observations of one vehicle that can be its description, narrowed to the rows the row policies '
  'show the caller. vehicle_profile_read reads those rows under the caller''s own row policies.';
REVOKE ALL ON FUNCTION public.vehicle_profile_observation_ids(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_profile_observation_ids(uuid) TO anon, authenticated, service_role;

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
  d := pg_get_functiondef('public.vehicle_profile_read(uuid)'::regprocedure);
  IF position('vehicle_profile_observation_ids' in d) = 0 THEN
    d := pg_temp.patch_once(d,
      E'  FROM public.vehicle_observations o\n  WHERE o.vehicle_id = p_vehicle_id AND o.kind = ''listing''\n',
      E'  FROM public.vehicle_observations o\n'
      || E'  WHERE o.id = ANY ((SELECT public.vehicle_profile_observation_ids(p_vehicle_id)))\n'
      || E'    AND o.vehicle_id = p_vehicle_id AND o.kind = ''listing''\n',
      'vehicle_profile_read descr');
  END IF;
  IF position(E'  ''evidence'', public.vehicle_profile_evidence(p_vehicle_id),\n' in d) > 0 THEN
    d := pg_temp.patch_once(d, E'  ''evidence'', public.vehicle_profile_evidence(p_vehicle_id),\n', '',
      'vehicle_profile_read evidence');
  END IF;
  IF d IS DISTINCT FROM pg_get_functiondef('public.vehicle_profile_read(uuid)'::regprocedure) THEN
    EXECUTE d;
  END IF;
  d := pg_get_functiondef('public.vehicle_profile_read(uuid)'::regprocedure);
  IF position('vehicle_profile_observation_ids' in d) = 0 OR position('vehicle_profile_evidence(' in d) > 0 THEN
    RAISE EXCEPTION 'vehicle_profile_read is not patched';
  END IF;
END $migration$;

DROP FUNCTION pg_temp.patch_once(text, text, text, text);
COMMIT;
