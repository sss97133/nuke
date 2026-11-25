-- guardrail-allow(center-key-fk): vehicle_images.vehicle_id: synthetic fixture table in a throwaway contract database, never deployed
-- user_associated_vehicle_ids counts a car reached through an organization link only when organization_vehicle_link_grants
-- accepts the link (20261126051500). The chain fixture of 20261126034500 runs first: Z made an organization and linked
-- the private car P with no tie to it; M is a member of OG, which P's owner O linked.
\ir test_org_link_reads_tied_linker.sql

CREATE FUNCTION public.vehicle_merge_terminal(p_vehicle_id uuid) RETURNS uuid LANGUAGE sql STABLE AS
$f$ SELECT p_vehicle_id $f$; -- fixture stand-in: no merges here

-- The live body, verbatim (pg_get_functiondef, 2026-11-25).
CREATE OR REPLACE FUNCTION public.user_associated_vehicle_ids(p_user uuid)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH caller AS (
    -- An end user is answered only about themselves.
    SELECT p_user AS id
    WHERE p_user IS NOT NULL
      AND (coalesce(auth.role(), '') NOT IN ('anon', 'authenticated') OR p_user = auth.uid())
  ), seed AS (
    SELECT v.id FROM caller c JOIN vehicles v ON v.user_id = c.id
    UNION
    SELECT v.id FROM caller c JOIN vehicles v ON v.owner_id = c.id
    UNION
    SELECT vc.vehicle_id FROM caller c JOIN vehicle_contributors vc ON vc.user_id = c.id
    WHERE coalesce(vc.status, 'active') = 'active'
    UNION
    SELECT ov.vehicle_id
    FROM caller c
    JOIN organization_contributors oc ON oc.user_id = c.id AND oc.status = 'active'
    JOIN organization_vehicles ov ON ov.organization_id = oc.organization_id AND ov.status = 'active'
  )
  SELECT DISTINCT t.id
  FROM seed s
  CROSS JOIN LATERAL (SELECT public.vehicle_merge_terminal(s.id) AS id) t
  WHERE t.id IS NOT NULL
$function$;
REVOKE ALL ON FUNCTION public.user_associated_vehicle_ids(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_associated_vehicle_ids(uuid) TO authenticated;

-- device_file_media_document's vehicle gate, verbatim, in a minimal writer: past it the live writer moves the caller's
-- screen capture onto the car and writes vehicle_documents and vehicle_price_observations.
CREATE FUNCTION public.media_document_gate(p_vehicle_id uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp' AS $f$
DECLARE v_caller uuid := auth.uid();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_associated_vehicle_ids(v_caller) a(vid) WHERE a.vid = p_vehicle_id) THEN
    RETURN 'refused_not_associated';
  END IF;
  RETURN 'filed';
END $f$;
GRANT EXECUTE ON FUNCTION public.media_document_gate(uuid) TO authenticated;

CREATE FUNCTION public.gate_as(p_user uuid, p_vehicle uuid) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE r text;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.media_document_gate(p_vehicle);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  RETURN r;
END $f$;

-- Z's link to P was linked with the stamp trigger in place (the earlier contract drops and restores it); M's org is OG.
SELECT t_assert(public.gate_as(:Z, :P) = 'filed', 'before: the forged link lets Z file a capture onto the private car');
SELECT t_assert(public.gate_as(:M, :P) = 'filed', 'before: a member of the owner''s organization files onto the car');

\ir ../migrations/20261126051500_user_associated_vehicle_ids_tied_link.sql

SELECT t_assert(public.gate_as(:Z, :P) = 'refused_not_associated', 'after: the forged link no longer reaches the car; the write is refused');
SELECT t_assert(public.gate_as(:M, :P) = 'filed', 'after: a member of the organization the owner linked still files onto the car');
SELECT t_assert(public.gate_as(:O, :P) = 'filed', 'after: the owner still files onto the car');
SELECT t_assert(public.gate_as('0e000000-0000-0000-0000-0000000000e0', :P) = 'refused_not_associated',
  'after: a stranger is refused');
SELECT t_assert((SELECT count(*) FROM public.private_row_policy_copies WHERE reader = 'user_associated_vehicle_ids(uuid)'
    AND recorded_hash = (SELECT policy_hash FROM public.private_row_policy_hash(relation, policy_filter))) = 1,
  'registered as a policy copy with the live hash');

-- Cost: the rule runs only on links the caller is an active member through.
SELECT t_assert(pg_temp.rule_calls('0e000000-0000-0000-0000-0000000000e0',
    'SELECT count(*) FROM public.user_associated_vehicle_ids(''0e000000-0000-0000-0000-0000000000e0'')') = 0,
  'a caller in no organization never runs the rule');
SELECT t_assert(pg_temp.rule_calls(:M, format('SELECT count(*) FROM public.user_associated_vehicle_ids(%L)', :M)) <= 2,
  'a member runs it once per link of its organizations, not per link in the table');

-- Re-apply.
SELECT md5(pg_get_functiondef('public.user_associated_vehicle_ids(uuid)'::regprocedure)) AS uav_after \gset
\ir ../migrations/20261126051500_user_associated_vehicle_ids_tied_link.sql
SELECT t_assert(md5(pg_get_functiondef('public.user_associated_vehicle_ids(uuid)'::regprocedure)) = :'uav_after',
  're-applying the migration changes nothing');

-- Later bodies: any migration other than the one that defined it before 2026-11-26 must keep the rule when it rewrites
-- user_associated_vehicle_ids wholesale.
\set uav_rewrites_without_rule `for m in $(grep -lE 'CREATE (OR REPLACE )?FUNCTION (public\.)?user_associated_vehicle_ids\(' supabase/migrations/*.sql); do b=$(basename "$m"); [ "$b" = 20261017021000_device_evidence_files_photos_and_profiles.sql ] && continue; grep -q 'organization_vehicle_link_grants' "$m" || printf '%s ' "$b"; done`
SELECT t_assert(:'uav_rewrites_without_rule' = '',
  'no later migration rewrites user_associated_vehicle_ids without organization_vehicle_link_grants (offenders: ' || :'uav_rewrites_without_rule' || ')');
