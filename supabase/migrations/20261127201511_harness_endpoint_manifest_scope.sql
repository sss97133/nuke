-- Bind the existing endpoint -> manifest edge to its design's vehicle.
-- Native composite FKs protect both parent reassignment and concurrent writes.
-- No device selection, physical source correction or public reader is introduced.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='2s';
LOCK TABLE public.harness_endpoints IN SHARE ROW EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS(SELECT FROM public.harness_endpoints WHERE manifest_device_id IS NOT NULL) THEN
  RAISE EXCEPTION 'Endpoint device links now exist; review their source before installing the scope key' USING ERRCODE='55000';
 END IF;
END $$;
ALTER TABLE public.harness_designs
 ADD CONSTRAINT harness_designs_id_vehicle_key UNIQUE(id,vehicle_id);
ALTER TABLE public.vehicle_build_manifest
 ADD CONSTRAINT vehicle_build_manifest_id_vehicle_key UNIQUE(id,vehicle_id);
ALTER TABLE public.harness_endpoints ADD COLUMN device_vehicle_id uuid;
COMMENT ON COLUMN public.harness_endpoints.device_vehicle_id IS
 'Derived scope key for manifest_device_id, not an independent vehicle assertion. NULL when no device is linked; otherwise copied from harness_designs.vehicle_id by the endpoint trigger and constrained to both existing parents. Native composite FKs prevent concurrent cross-vehicle links and parent reassignment.';
ALTER TABLE public.harness_endpoints
 ADD CONSTRAINT harness_endpoints_device_scope_complete CHECK(
  (manifest_device_id IS NULL AND device_vehicle_id IS NULL)
  OR (manifest_device_id IS NOT NULL AND device_vehicle_id IS NOT NULL)),
 ADD CONSTRAINT harness_endpoints_device_design_scope_fkey
  FOREIGN KEY(design_id,device_vehicle_id) REFERENCES public.harness_designs(id,vehicle_id) ON DELETE CASCADE,
 ADD CONSTRAINT harness_endpoints_device_manifest_scope_fkey
  FOREIGN KEY(manifest_device_id,device_vehicle_id) REFERENCES public.vehicle_build_manifest(id,vehicle_id)
  ON DELETE SET NULL (manifest_device_id,device_vehicle_id);
CREATE FUNCTION public.harness_endpoint_device_scope() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.manifest_device_id IS NULL THEN NEW.device_vehicle_id:=NULL;RETURN NEW;END IF;
 SELECT d.vehicle_id INTO NEW.device_vehicle_id FROM public.harness_designs d WHERE d.id=NEW.design_id;
 IF NEW.device_vehicle_id IS NULL THEN
  RAISE EXCEPTION 'Linked device requires a vehicle-owned harness design' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
COMMENT ON FUNCTION public.harness_endpoint_device_scope() IS
 'Trigger-only derivation of the existing device link scope. Reads the design parent independently of caller read policies; native FKs enforce the derived design and manifest vehicle match. No source or ownership decision. No API execution grants.';
REVOKE ALL ON FUNCTION public.harness_endpoint_device_scope() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER harness_endpoint_device_scope
 BEFORE INSERT OR UPDATE OF design_id,manifest_device_id,device_vehicle_id ON public.harness_endpoints
 FOR EACH ROW EXECUTE FUNCTION public.harness_endpoint_device_scope();
ALTER TABLE public.harness_endpoints ENABLE ALWAYS TRIGGER harness_endpoint_device_scope;
-- Limit replication-role enforcement to the eight RI triggers of these two
-- new scope FKs; existing source triggers and policies retain their definitions.
DO $$ DECLARE t record; n integer:=0;BEGIN
 FOR t IN SELECT g.tgname,g.tgrelid FROM pg_trigger g JOIN pg_constraint c ON c.oid=g.tgconstraint
  WHERE c.conrelid='public.harness_endpoints'::regclass
   AND c.conname IN('harness_endpoints_device_design_scope_fkey','harness_endpoints_device_manifest_scope_fkey') LOOP
  EXECUTE format('ALTER TABLE %s ENABLE ALWAYS TRIGGER %I',t.tgrelid::regclass,t.tgname);n:=n+1;
 END LOOP;
 IF n<>8 THEN RAISE EXCEPTION 'Unexpected endpoint device FK trigger count: %',n;END IF;
END $$;
COMMIT;
