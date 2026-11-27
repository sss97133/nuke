-- Preserve legacy assignments; prevent new broken design-to-vehicle edges.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='2s';
DO $shape$
BEGIN
 IF NOT EXISTS(SELECT FROM pg_attribute a
  WHERE a.attrelid='public.harness_designs'::regclass AND a.attname='vehicle_id'
   AND a.atttypid='uuid'::regtype AND NOT a.attnotnull AND NOT a.attisdropped) THEN
  RAISE EXCEPTION 'Harness design vehicle key shape changed; inspect current owner' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT FROM pg_constraint c JOIN pg_attribute a
  ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
  WHERE c.conrelid='public.harness_designs'::regclass AND c.contype='f'
   AND a.attname='vehicle_id') THEN
  RAISE EXCEPTION 'Harness design vehicle reference already constrained; review current definition' USING ERRCODE='55000';
 END IF;
END $shape$;
ALTER TABLE public.harness_designs
 ADD CONSTRAINT harness_designs_vehicle_id_fkey
 FOREIGN KEY(vehicle_id) REFERENCES public.vehicles(id) NOT VALID;
COMMENT ON CONSTRAINT harness_designs_vehicle_id_fkey ON public.harness_designs IS
 'Enforces subsequent non-null vehicle assignments. Existing assignments are deliberately unvalidated until legacy orphan history is recovered through canonical attribution; no source row is rewritten by this constraint.';
COMMENT ON COLUMN public.harness_designs.id IS
 'Stable UUID identity of one harness design; harness_endpoints.design_id refers here. Not a circuit, electrical net, physical wire piece or device identity.';
COMMENT ON COLUMN public.harness_designs.vehicle_id IS
 'Nullable vehicle subject key. Non-null new or changed assignments must reference vehicles.id; NULL is unassigned. Legacy pre-constraint assignments remain unvalidated. This key does not establish vehicle ownership, public visibility, current design status or engineering approval.';
NOTIFY pgrst,'reload schema';
COMMIT;
