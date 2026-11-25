-- Reverts 20261126121500_sold_vehicle_proof_tied_org_link.sql: sold_vehicle_proof's manager branch goes back to
-- caller_manages_organization(ov.organization_id) (the 20261126081500 view), then caller_manages_tied_org_link(uuid) and
-- its private_row_policy_copies row are dropped. A self-made organization's owner then reads a stranger's private sold car
-- it linked again. Run as one transaction.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';
DO $revert$
DECLARE
  d text := pg_get_viewdef('public.sold_vehicle_proof'::regclass);
  a text := 'OR caller_manages_tied_org_link(ov.id)));';
  r text := 'OR caller_manages_organization(ov.organization_id)));';
BEGIN
  IF (length(d) - length(replace(d, a, ''))) / length(a) <> 1 THEN
    RAISE EXCEPTION 'the manager-branch anchor does not occur exactly once; review first';
  END IF;
  EXECUTE 'CREATE OR REPLACE VIEW public.sold_vehicle_proof WITH (security_barrier = true) AS ' || replace(d, a, r);
END
$revert$;
DELETE FROM public.private_row_policy_copies WHERE reader = 'caller_manages_tied_org_link(uuid)';
DROP FUNCTION public.caller_manages_tied_org_link(uuid);
DO $check$
BEGIN
  IF md5(pg_get_viewdef('public.sold_vehicle_proof'::regclass)) <> '2cc5f9e239c7a0b6828e8496091dc0d4' THEN -- gitleaks:allow (view definition hash, not a secret)
    RAISE EXCEPTION 'sold_vehicle_proof is not the 20261126081500 view';
  END IF;
END
$check$;
COMMIT;
