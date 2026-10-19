-- Live row policies of public.ownership_verifications and the auto_grant_owner_on_verification trigger function on
-- 2026-10-14, before 20261014200000_ownership_verifications_arrive_pending.sql. Test fixture only
-- (test_ownership_verifications_arrive_pending.sql loads it to reproduce the self-approval the migration closes).
--
-- Table ACL (relacl, owner excluded): anon=arwdDxt, authenticated=arwdDxt, service_role=arwdDxt; nothing to PUBLIC.
-- Policy-set hash eRsDpwfz/KEF71HYdOJJYXnWkhwVkh6Oz/A9Wh973gY= (7 policies). auto_grant_owner_on_verification prosrc
-- hash QDX/sp/LVEO7EnaYDioNRu9avp3bQwNA+S8VPAgPE04=.
CREATE POLICY "Users can create own verifications" ON public.ownership_verifications AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "Users can update their own verification documents" ON public.ownership_verifications AS PERMISSIVE FOR UPDATE TO public
  USING ((user_id = ( SELECT auth.uid() AS uid)))
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY "Users can view own verifications" ON public.ownership_verifications AS PERMISSIVE FOR SELECT TO public
  USING ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY ownership_verifications_admin_access ON public.ownership_verifications AS PERMISSIVE FOR ALL TO public
  USING ((EXISTS ( SELECT 1
   FROM admin_users
  WHERE ((admin_users.user_id = ( SELECT auth.uid() AS uid)) AND (admin_users.is_active = true)))));
CREATE POLICY ownership_verifications_insert ON public.ownership_verifications AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY ownership_verifications_insert_self ON public.ownership_verifications AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY ownership_verifications_select ON public.ownership_verifications AS PERMISSIVE FOR SELECT TO public
  USING (true);

CREATE OR REPLACE FUNCTION public.auto_grant_owner_on_verification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Only fire when status changes to 'approved'
  IF NEW.status = 'approved' AND (OLD IS NULL OR OLD.status != 'approved') THEN
    -- Upsert owner permission
    INSERT INTO public.vehicle_user_permissions (
      vehicle_id, user_id, role, granted_by, context, is_active, granted_at, created_at
    )
    VALUES (
      NEW.vehicle_id,
      NEW.user_id,
      'owner',
      NEW.human_reviewer_id,  -- admin who approved
      'Auto-granted via ownership_verification approval #' || NEW.id::text,
      true,
      NOW(),
      NOW()
    )
    ON CONFLICT (vehicle_id, user_id, role) WHERE is_active = true
    DO UPDATE SET
      context = 'Auto-granted via ownership_verification approval #' || NEW.id::text;
  END IF;

  RETURN NEW;
END;
$function$

;
