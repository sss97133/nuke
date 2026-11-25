-- Revert 20261125204500_private_row_policy_copy_drift: remove the assay section, then the table and its hash helper.
SET lock_timeout = '5s';
DO $r$
DECLARE d text; s int; e int;
BEGIN
  d := pg_get_functiondef('public.assay_private_row_exposure()'::regprocedure);
  s := position(E'\n  -- private_row_policy_copy_drift_v1' IN d);
  IF s = 0 THEN RETURN; END IF;
  e := s + position(E'\n  END;\n' IN substr(d, s)) + length(E'\n  END;\n') - 2;
  EXECUTE substr(d, 1, s - 1) || substr(d, e + 1);
END $r$;
REVOKE ALL ON FUNCTION public.assay_private_row_exposure() FROM PUBLIC, anon, authenticated, service_role;
DROP TABLE IF EXISTS public.private_row_policy_copies;
DROP FUNCTION IF EXISTS public.private_row_policy_hash(text, text);
