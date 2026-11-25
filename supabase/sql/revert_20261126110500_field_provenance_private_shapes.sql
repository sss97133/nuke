-- REVERT of 20261126110500_field_provenance_private_shapes.sql: takes the shape term back out of get_field_provenance
-- (the body returns to prosrc sha256 deb01cff..., checked) and records the copy row at its pre-105000 hash 16c9e48f...,
-- so while vo_private_shape_read is live the exposure watch reads this copy as stale, which it then is: the body again
-- serves rows the policy hides from a caller who is not tied.
-- Apply only through a migration that copies this file.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $revert$
DECLARE
  d text;
  term text := $t$      -- private_shape_rows_v1 (20261126110500): vo_private_shape_read (RESTRICTIVE) hides a row whose structured_data
      -- contains an active vehicle_observation_private_shapes match from a caller not tied to the vehicle.
      and ((select privileged from viewer)
        or not (coalesce(o.structured_data,'{}'::jsonb) @> any (array(select s.structured_match
              from public.vehicle_observation_private_shapes s where s.active))))
$t$;
BEGIN
  d := pg_get_functiondef('public.get_field_provenance(uuid,text)'::regprocedure);
  IF position(term IN d) > 0 THEN
    IF (length(d) - length(replace(d, term, ''))) / length(term) <> 1 THEN
      RAISE EXCEPTION 'get_field_provenance holds the shape term more than once; re-read it';
    END IF;
    EXECUTE replace(d, term, '');
  END IF;
  IF (SELECT encode(sha256(convert_to(p.prosrc, 'UTF8')), 'hex') FROM pg_proc p
       WHERE p.oid = 'public.get_field_provenance(uuid,text)'::regprocedure)
       IS DISTINCT FROM 'deb01cff80782e411b1b0e22b7cde9209249f9e8aa1f25545b18c8dbd00900aa' THEN
    RAISE EXCEPTION 'get_field_provenance is not the pre-20261126110500 body after the revert; re-read it';
  END IF;
  IF to_regclass('public.private_row_policy_copies') IS NOT NULL THEN
    UPDATE public.private_row_policy_copies
       SET recorded_hash = '16c9e48fc1fbfbe5dc4ae10fe8947c7c', recorded_at = now(),
           note = '#3915 restates the vehicle_observations read policies (vo_authenticated_read and the restrictive ones) in the definer body'
     WHERE reader = 'get_field_provenance(uuid,text)' AND relation = 'vehicle_observations'
       AND policy_filter = 'p.cmd IN (''SELECT'', ''ALL'')';
  END IF;
END
$revert$;
COMMIT;
