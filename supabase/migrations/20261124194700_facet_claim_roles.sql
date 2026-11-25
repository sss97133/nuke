-- vehicle_facet_claim_roles: the claim-role -> fact item map, moved out of vehicle_facet_items into one rule table so
-- the data-set candidates can read the same rows (G3b, next migration) instead of a second copy.
--
-- WHY. vehicle_facet_items holds a VALUES list (roles: claim role, field read, item key, comparison kind, decoded detail)
-- that decides which photo readings speak to which fact item: e.g. an 'identified_transmission_housing' reading's
-- 'transmission' field is transmission.current.type. The data-set grade needs the same map to admit those readings as
-- witnessed memberships (the proof vehicle's trans_type manual has a second reader family only there). A map held inside
-- one reader's body cannot be shared; copying it would be a second copy that drifts.
--
-- WHAT.
-- 1. vehicle_facet_claim_roles (role, field, item_key) PK, nk, detail text[]: filled at migration time from the live
--    reader's VALUES list itself (extracted from pg_get_functiondef, executed as INSERT ... SELECT FROM (VALUES ...)), so
--    the rows are byte-identical to what the reader holds today. SELECT for anon/authenticated (rule rows, no vehicle data):
--    vehicle_facet_items runs as its caller.
-- 2. vehicle_facet_items: the roles CTE becomes SELECT ... FROM vehicle_facet_claim_roles. Marker facet_claim_roles_v1.
-- Nothing else changes; the output must be identical (contract + the probe before/after).
--
-- REVERT: re-run the reader body with the VALUES list (rebuild it from the table rows) and DROP TABLE.
-- Contract: supabase/sql/test_facet_claim_roles.sql.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS public.vehicle_facet_claim_roles (
  role text NOT NULL,
  field text NOT NULL,
  item_key text NOT NULL,
  nk text NOT NULL,
  detail text[],
  PRIMARY KEY (role, field, item_key)
);
ALTER TABLE public.vehicle_facet_claim_roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vehicle_facet_claim_roles_read ON public.vehicle_facet_claim_roles;
CREATE POLICY vehicle_facet_claim_roles_read ON public.vehicle_facet_claim_roles FOR SELECT USING (true);
REVOKE ALL ON public.vehicle_facet_claim_roles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.vehicle_facet_claim_roles TO anon, authenticated, service_role;
COMMENT ON TABLE public.vehicle_facet_claim_roles IS
  'Rule rows: which field of a photo reading with this closed claim role speaks to which fact item, compared as nk. Read by vehicle_facet_items and the data-set candidates. 20261124194700.';

DO $patch$
DECLARE d text; i int; j int; blk text;
  head text := 'roles (role, field, key, nk, detail) AS (VALUES';
  tail text := E'\n),\n-- The ids of the observations that can speak to a token';
BEGIN
  d := pg_get_functiondef('public.vehicle_facet_items(uuid, text)'::regprocedure);
  IF position('facet_claim_roles_v1' IN d) > 0 THEN RETURN; END IF;
  IF (length(d) - length(replace(d, head, ''))) / length(head) <> 1 THEN RAISE EXCEPTION 'vehicle_facet_items: roles head not found exactly once'; END IF;
  IF (length(d) - length(replace(d, tail, ''))) / length(tail) <> 1 THEN RAISE EXCEPTION 'vehicle_facet_items: roles tail not found exactly once'; END IF;
  i := position(head IN d) + length(head);
  j := position(tail IN d);
  blk := substr(d, i, j - i);
  EXECUTE 'INSERT INTO public.vehicle_facet_claim_roles (role, field, item_key, nk, detail) SELECT * FROM (VALUES' || blk
       || ') v(role, field, item_key, nk, detail) ON CONFLICT (role, field, item_key) DO UPDATE SET nk = excluded.nk, detail = excluded.detail';
  d := substr(d, 1, position(head IN d) - 1)
       || 'roles (role, field, key, nk, detail) AS (SELECT r.role, r.field, r.item_key, r.nk, r.detail FROM public.vehicle_facet_claim_roles r'
       || substr(d, j);
  d := replace(d, '-- facet_items_v1', '-- facet_items_v1' || chr(10) || '-- facet_claim_roles_v1');
  EXECUTE d;
END $patch$;
