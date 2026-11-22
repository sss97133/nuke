-- public.vehicle_user_permissions as read from production on 2026-11-21: its six policies (pg_policies, unedited)
-- and the trigger that stamps who granted a row a client writes (pg_proc.prosrc byte for byte, md5
-- 61c59015710c5aafabc426a1e7240d4f; pg_get_triggerdef). For the contract tests only.
-- Production also runs trg_enforce_user_vehicle_evidence and trg_auto_consignment_deal on this table; they are not
-- carried here (the first refuses more rows, so a fixture without it admits no less than production does).
CREATE POLICY "Public read access to vehicle permissions" ON public.vehicle_user_permissions
  AS PERMISSIVE FOR SELECT TO public
  USING (true);
CREATE POLICY "Vehicle owners can manage permissions" ON public.vehicle_user_permissions
  AS PERMISSIVE FOR ALL TO public
  USING (((EXISTS ( SELECT 1
   FROM vehicles v
  WHERE ((v.id = vehicle_user_permissions.vehicle_id) AND (v.user_id = ( SELECT auth.uid() AS uid))))) OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "vup_delete_own" ON public.vehicle_user_permissions
  AS PERMISSIVE FOR DELETE TO public
  USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY "vup_insert_own" ON public.vehicle_user_permissions
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY "vup_select_own" ON public.vehicle_user_permissions
  AS PERMISSIVE FOR SELECT TO public
  USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY "vup_update_own" ON public.vehicle_user_permissions
  AS PERMISSIVE FOR UPDATE TO public
  USING ((user_id = ( SELECT auth.uid() AS uid)))
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));
CREATE FUNCTION public.stamp_vehicle_permission_grantor() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $fn$
BEGIN
  IF coalesce(auth.role(), '') NOT IN ('authenticated', 'anon') THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.granted_by := auth.uid(); NEW.granted_at := now();
  ELSIF (NEW.vehicle_id, NEW.user_id, NEW.role, NEW.granted_by) IS DISTINCT FROM (OLD.vehicle_id, OLD.user_id, OLD.role, OLD.granted_by)
     OR (coalesce(NEW.is_active, true) AND NOT coalesce(OLD.is_active, true)) THEN
    NEW.granted_by := auth.uid(); NEW.granted_at := now();
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER trg_stamp_vehicle_permission_grantor BEFORE INSERT OR UPDATE ON public.vehicle_user_permissions FOR EACH ROW EXECUTE FUNCTION public.stamp_vehicle_permission_grantor();
