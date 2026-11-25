-- sold_vehicle_proof_tied_org_link_v1: the manager branch of sold_vehicle_proof (20261126081500, #3998, live) reads a car
-- the public cannot read only through a link organization_vehicle_link_grants() accepts.
--
-- WHY. 20261126081500 lists a sold link on a car vehicle_publicly_readable() refuses when caller_manages_organization()
-- holds. Any signed-in user can create an organization, make themselves its active owner and link a stranger's private
-- sold car (skeptic2, 2026-11-25: three inserts; the link insert has no check beyond the stamped linker), so that branch
-- shows them the car's year, make, model, VIN, sale event and listing price.
--
-- WHAT.
--   caller_manages_tied_org_link(p_link_id uuid) (new; plpgsql STABLE SECURITY DEFINER, search_path ''): false for a
--   caller with no auth.uid() before anything is read; false when the link does not exist or the caller does not manage
--   its organization (no error, so it is not an existence probe); else organization_vehicle_link_grants(its vehicle,
--   its linker). It takes the link's id, not a vehicle and a user, so it never answers whether some other person is
--   tied to some car. EXECUTE: anon, authenticated, service_role (a view checks EXECUTE as the caller);
--   organization_vehicle_link_grants itself stays ungranted to anon (lead ruling 2026-11-25). Registered in
--   private_row_policy_copies as a copy of the vehicle_images organization-member policy (owner_lane ta-packet), as
--   20261126034500 registered its readers; a changed policy (md5 other than 5294ed44..., read 2026-11-25) refuses.
--   sold_vehicle_proof: anchored edit of the live definition (md5 of pg_get_viewdef guarded),
--     ... OR caller_manages_organization(ov.organization_id)))  ->  ... OR caller_manages_tied_org_link(ov.id)))
--   security_barrier kept. The sale_price column keeps its CASE on caller_manages_organization: it is the link's own
--   number, written by the organization, shown only on rows the gate passed.
-- CONTRACT: supabase/sql/test_sold_vehicle_proof_tied_org_link.sql (PG17).
-- REVERSAL: CREATE OR REPLACE VIEW with the 20261126081500 definition (WHERE ... OR caller_manages_organization(
-- ov.organization_id)), then DROP FUNCTION caller_manages_tied_org_link(uuid) and its private_row_policy_copies row.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

DO $guard$
DECLARE h text;
BEGIN
  IF to_regprocedure('public.vehicle_publicly_readable(boolean,timestamp with time zone,uuid)') IS NULL
     OR to_regprocedure('public.caller_manages_organization(uuid)') IS NULL
     OR to_regprocedure('public.organization_vehicle_link_grants(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'vehicle_publicly_readable, caller_manages_organization or organization_vehicle_link_grants is missing';
  END IF;
  SELECT x.policy_hash INTO h FROM public.private_row_policy_hash('vehicle_images',
    'p.policyname = ''Organization members can view org vehicle images''') x;
  IF h IS DISTINCT FROM '5294ed44f4d29e6d2e51225209975cb4' THEN -- gitleaks:allow (policy fingerprint read 2026-11-25, not a secret)
    RAISE EXCEPTION 'the vehicle_images organization-member policy changed since 2026-11-25 (md5 %); review first', h;
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.caller_manages_tied_org_link(p_link_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE l record;
BEGIN
  -- sold_vehicle_proof_tied_org_link_v1: the caller only; anon is answered before any read
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;
  SELECT ov.organization_id, ov.vehicle_id, ov.linked_by_user_id INTO l
    FROM public.organization_vehicles ov WHERE ov.id = p_link_id;
  IF NOT FOUND OR NOT public.caller_manages_organization(l.organization_id) THEN
    RETURN false;
  END IF;
  RETURN coalesce(public.organization_vehicle_link_grants(l.vehicle_id, l.linked_by_user_id), false);
END
$function$;
REVOKE ALL ON FUNCTION public.caller_manages_tied_org_link(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.caller_manages_tied_org_link(uuid) TO anon, authenticated, service_role;

INSERT INTO public.private_row_policy_copies (reader, relation, policy_filter, recorded_hash, owner_lane, note)
SELECT 'caller_manages_tied_org_link(uuid)', 'vehicle_images',
       'p.policyname = ''Organization members can view org vehicle images''', h.policy_hash, 'ta-packet',
       '20261126121500: restates the organization-member rule (active owner/manager/board_member, organization_vehicle_link_grants) for sold_vehicle_proof'
  FROM public.private_row_policy_hash('vehicle_images', 'p.policyname = ''Organization members can view org vehicle images''') h
ON CONFLICT (reader, relation, policy_filter) DO UPDATE SET recorded_hash = EXCLUDED.recorded_hash, recorded_at = now();

DO $edit$
DECLARE
  d text := pg_get_viewdef('public.sold_vehicle_proof'::regclass);
  a text := 'OR caller_manages_organization(ov.organization_id)));';
  r text := 'OR caller_manages_tied_org_link(ov.id)));';
BEGIN
  IF position('caller_manages_tied_org_link(' IN d) > 0 THEN
    RAISE NOTICE 'sold_vehicle_proof_tied_org_link_v1 already applied';
    RETURN;
  END IF;
  IF md5(d) <> '2cc5f9e239c7a0b6828e8496091dc0d4' THEN -- gitleaks:allow (view definition hash read 2026-11-26 after 20261126081500, not a secret)
    RAISE EXCEPTION 'sold_vehicle_proof changed since 20261126081500 (md5 %); review first', md5(d);
  END IF;
  IF (length(d) - length(replace(d, a, ''))) / length(a) <> 1 THEN
    RAISE EXCEPTION 'the manager-branch anchor does not occur exactly once';
  END IF;
  EXECUTE 'CREATE OR REPLACE VIEW public.sold_vehicle_proof WITH (security_barrier = true) AS ' || replace(d, a, r);
END
$edit$;

DO $check$
DECLARE d text := pg_get_viewdef('public.sold_vehicle_proof'::regclass);
BEGIN
  IF position('vehicle_publicly_readable(v.is_public, v.deleted_at, v.merged_into_vehicle_id) OR caller_manages_tied_org_link(ov.id)' IN d) = 0
     OR position('OR caller_manages_organization(ov.organization_id)' IN d) > 0
     OR has_function_privilege('anon', 'public.organization_vehicle_link_grants(uuid,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('anon', 'public.caller_manages_tied_org_link(uuid)', 'EXECUTE')
     OR NOT EXISTS (SELECT 1 FROM public.private_row_policy_copies c WHERE c.reader = 'caller_manages_tied_org_link(uuid)'
                      AND c.relation = 'vehicle_images' AND c.active)
     OR NOT coalesce((SELECT 'security_barrier=true' = ANY (c.reloptions) FROM pg_class c
                       WHERE c.oid = 'public.sold_vehicle_proof'::regclass), false)
     OR NOT has_table_privilege('anon', 'public.sold_vehicle_proof', 'SELECT') THEN
    RAISE EXCEPTION 'sold_vehicle_proof not as intended';
  END IF;
END
$check$;
COMMIT;
