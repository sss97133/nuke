-- RLS policies as read from production on 2026-11-12 ~10:50 AM AST (UTC-4) from the catalog snapshot (pg_policies; text as
-- pg_get_expr prints it, whitespace flattened), for test_garage_visibility.sql. Tables: vehicle_images, organization_contributors,
-- organization_vehicles, vehicle_user_permissions, vehicle_contributor_roles, work_sessions, and the storage.objects policies of
-- the vehicle-images / vehicle-photos / capture-media buckets. work_order_assignments has NO policy live (RLS on, default deny).
-- Generated from the snapshot; policy names and expressions are verbatim.
CREATE POLICY "capture-media: owner insert after attribution" ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((bucket_id = 'capture-media'::text) AND ((storage.foldername(name))[1] = 'users'::text) AND ((storage.foldername(name))[2] = (( SELECT auth.uid() AS uid))::text) AND ((storage.foldername(name))[3] = ANY (ARRAY['previews'::text, 'full'::text])) AND (EXISTS ( SELECT 1    FROM vehicle_images vi   WHERE ((vi.id =         CASE             WHEN (split_part(storage.filename(objects.name), '.'::text, 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text) THEN (split_part(storage.filename(objects.name), '.'::text, 1))::uuid             ELSE NULL::uuid         END) AND (vi.user_id = ( SELECT auth.uid() AS uid)) AND (vi.source = 'capture_relay_ios_media'::text) AND (vi.vehicle_id IS NOT NULL) AND (((storage.foldername(objects.name))[3] = 'previews'::text) OR ((vi.exif_data #>> '{media,kind}'::text[]) = 'camera_video'::text)))))));
CREATE POLICY "capture-media: owner read" ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated
  USING (((bucket_id = 'capture-media'::text) AND ((storage.foldername(name))[1] = 'users'::text) AND ((storage.foldername(name))[2] = (( SELECT auth.uid() AS uid))::text)));
CREATE POLICY "vehicle-photos: owner insert" ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((bucket_id = 'vehicle-photos'::text) AND ((storage.foldername(name))[1] = 'users'::text) AND ((storage.foldername(name))[2] = (( SELECT auth.uid() AS uid))::text)));
CREATE POLICY "vehicle_images_delete" ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated
  USING (((bucket_id = 'vehicle-images'::text) AND ((owner_id = (( SELECT auth.uid() AS uid))::text) OR (owner = ( SELECT auth.uid() AS uid)))));
CREATE POLICY "vehicle_images_read" ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated
  USING (((bucket_id = 'vehicle-images'::text) AND ((owner_id = (( SELECT auth.uid() AS uid))::text) OR (owner = ( SELECT auth.uid() AS uid)))));
CREATE POLICY "vehicle_images_update" ON storage.objects AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((bucket_id = 'vehicle-images'::text) AND ((owner_id = (( SELECT auth.uid() AS uid))::text) OR (owner = ( SELECT auth.uid() AS uid)))))
  WITH CHECK (((bucket_id = 'vehicle-images'::text) AND ((owner_id = (( SELECT auth.uid() AS uid))::text) OR (owner = ( SELECT auth.uid() AS uid)))));
CREATE POLICY "vehicle_images_upload" ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((bucket_id = 'vehicle-images'::text));
CREATE POLICY "organization_contributors_insert" ON public.organization_contributors AS PERMISSIVE FOR INSERT
  WITH CHECK (((( SELECT auth.uid() AS uid) IS NOT NULL) AND (((user_id = ( SELECT auth.uid() AS uid)) AND (role = ANY (ARRAY['contributor'::text, 'photographer'::text])) AND (status = 'pending'::text) AND (verification_method = 'self_claimed'::text) AND (verified_by IS NULL) AND (verified_at IS NULL)) OR ((user_id = ( SELECT auth.uid() AS uid)) AND (role = 'owner'::text) AND (verification_method = 'self_claimed'::text) AND (verified_by IS NULL) AND (verified_at IS NULL) AND (EXISTS ( SELECT 1    FROM business_ownership bo   WHERE ((bo.business_id = organization_contributors.organization_id) AND (bo.owner_id = ( SELECT auth.uid() AS uid)) AND (bo.status = 'active'::text))))) OR (EXISTS ( SELECT 1    FROM organization_contributors oc   WHERE ((oc.organization_id = organization_contributors.organization_id) AND (oc.user_id = ( SELECT auth.uid() AS uid)) AND (oc.role = ANY (ARRAY['owner'::text, 'co_founder'::text])) AND (oc.status = 'active'::text)))))));
CREATE POLICY "organization_contributors_select" ON public.organization_contributors AS PERMISSIVE FOR SELECT
  USING (true);
CREATE POLICY "organization_contributors_update_own" ON public.organization_contributors AS PERMISSIVE FOR UPDATE
  USING ((user_id = ( SELECT auth.uid() AS uid)))
  WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1    FROM organization_contributors prior   WHERE ((prior.id = organization_contributors.id) AND (prior.organization_id = organization_contributors.organization_id) AND (prior.user_id = organization_contributors.user_id) AND (prior.role = organization_contributors.role) AND (prior.verification_method = organization_contributors.verification_method) AND (NOT (prior.verified_by IS DISTINCT FROM organization_contributors.verified_by)) AND (NOT (prior.verified_at IS DISTINCT FROM organization_contributors.verified_at)) AND ((organization_contributors.status IS DISTINCT FROM 'active'::text) OR (prior.status = 'active'::text)))))));
CREATE POLICY "Anyone views org-vehicle links" ON public.organization_vehicles AS PERMISSIVE FOR SELECT
  USING (true);
CREATE POLICY "Users/owners manage links" ON public.organization_vehicles AS PERMISSIVE FOR ALL
  USING (((linked_by_user_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1    FROM vehicles v   WHERE ((v.id = organization_vehicles.vehicle_id) AND (v.user_id = ( SELECT auth.uid() AS uid))))) OR (EXISTS ( SELECT 1    FROM organization_contributors oc   WHERE ((oc.organization_id = organization_vehicles.organization_id) AND (oc.user_id = ( SELECT auth.uid() AS uid)) AND (oc.role = ANY (ARRAY['owner'::text, 'manager'::text, 'board_member'::text])) AND (oc.status = 'active'::text))))));
CREATE POLICY "organization_vehicles_select" ON public.organization_vehicles AS PERMISSIVE FOR SELECT
  USING (true);
CREATE POLICY "contributor_roles_select" ON public.vehicle_contributor_roles AS PERMISSIVE FOR SELECT
  USING (((user_id = ( SELECT auth.uid() AS uid)) OR (vehicle_id IN ( SELECT vehicles.id    FROM vehicles   WHERE (vehicles.uploaded_by = ( SELECT auth.uid() AS uid)))) OR (EXISTS ( SELECT 1    FROM vehicle_contributors vc   WHERE ((vc.vehicle_id = vehicle_contributor_roles.vehicle_id) AND (vc.user_id = ( SELECT auth.uid() AS uid)))))));
CREATE POLICY "Allow vehicle owners to delete images" ON public.vehicle_images AS PERMISSIVE FOR DELETE
  USING (((( SELECT auth.uid() AS uid) IS NOT NULL) AND ((( SELECT auth.uid() AS uid) = user_id) OR (EXISTS ( SELECT 1    FROM vehicles   WHERE ((vehicles.id = vehicle_images.vehicle_id) AND (vehicles.user_id = ( SELECT auth.uid() AS uid))))) OR (EXISTS ( SELECT 1    FROM vehicles   WHERE ((vehicles.id = vehicle_images.vehicle_id) AND (vehicles.uploaded_by = ( SELECT auth.uid() AS uid))))))));
CREATE POLICY "Allow vehicle owners to update images" ON public.vehicle_images AS PERMISSIVE FOR UPDATE
  USING (((( SELECT auth.uid() AS uid) IS NOT NULL) AND ((( SELECT auth.uid() AS uid) = user_id) OR (EXISTS ( SELECT 1    FROM vehicles   WHERE ((vehicles.id = vehicle_images.vehicle_id) AND (vehicles.user_id = ( SELECT auth.uid() AS uid))))) OR (EXISTS ( SELECT 1    FROM vehicles   WHERE ((vehicles.id = vehicle_images.vehicle_id) AND (vehicles.uploaded_by = ( SELECT auth.uid() AS uid))))))));
CREATE POLICY "Authenticated can upload vehicle images" ON public.vehicle_images AS PERMISSIVE FOR INSERT
  WITH CHECK (((( SELECT auth.uid() AS uid) = submitted_by) OR ((submitted_by IS NULL) AND (( SELECT auth.uid() AS uid) IS NOT NULL))));
CREATE POLICY "Authenticated users can upload images to any vehicle" ON public.vehicle_images AS PERMISSIVE FOR INSERT
  WITH CHECK (((( SELECT auth.uid() AS uid) IS NOT NULL) AND (( SELECT auth.uid() AS uid) = user_id) AND (vehicle_id IS NOT NULL)));
CREATE POLICY "Logged in users can upload images" ON public.vehicle_images AS PERMISSIVE FOR INSERT
  WITH CHECK (((( SELECT auth.uid() AS uid) IS NOT NULL) AND (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "Organization members can view org vehicle images" ON public.vehicle_images AS PERMISSIVE FOR SELECT
  USING ((EXISTS ( SELECT 1    FROM (organization_vehicles ov      JOIN organization_contributors oc ON ((ov.organization_id = oc.organization_id)))   WHERE ((ov.vehicle_id = vehicle_images.vehicle_id) AND (oc.user_id = ( SELECT auth.uid() AS uid)) AND (oc.status = 'active'::text)))));
CREATE POLICY "Owners and contributors can delete images" ON public.vehicle_images AS PERMISSIVE FOR DELETE
  USING (((( SELECT auth.uid() AS uid) = user_id) OR (EXISTS ( SELECT 1    FROM vehicles v   WHERE ((v.id = vehicle_images.vehicle_id) AND ((v.uploaded_by = ( SELECT auth.uid() AS uid)) OR (v.owner_id = ( SELECT auth.uid() AS uid)))))) OR (EXISTS ( SELECT 1    FROM vehicle_contributor_roles vcr   WHERE ((vcr.vehicle_id = vehicle_images.vehicle_id) AND (vcr.user_id = ( SELECT auth.uid() AS uid)) AND (COALESCE(vcr.is_active, true) = true))))));
CREATE POLICY "Owners and contributors can update images" ON public.vehicle_images AS PERMISSIVE FOR UPDATE
  USING (((( SELECT auth.uid() AS uid) = user_id) OR (EXISTS ( SELECT 1    FROM vehicles v   WHERE ((v.id = vehicle_images.vehicle_id) AND ((v.uploaded_by = ( SELECT auth.uid() AS uid)) OR (v.owner_id = ( SELECT auth.uid() AS uid)))))) OR (EXISTS ( SELECT 1    FROM vehicle_contributor_roles vcr   WHERE ((vcr.vehicle_id = vehicle_images.vehicle_id) AND (vcr.user_id = ( SELECT auth.uid() AS uid)) AND (COALESCE(vcr.is_active, true) = true))))));
CREATE POLICY "Users can delete images for their own vehicles" ON public.vehicle_images AS PERMISSIVE FOR DELETE
  USING (((( SELECT auth.uid() AS uid) = user_id) AND ((vehicle_id IS NULL) OR (EXISTS ( SELECT 1    FROM vehicles   WHERE ((vehicles.id = vehicle_images.vehicle_id) AND (vehicles.user_id = ( SELECT auth.uid() AS uid))))))));
CREATE POLICY "Users can delete their own images" ON public.vehicle_images AS PERMISSIVE FOR DELETE TO authenticated
  USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY "Users can insert images for their own vehicles" ON public.vehicle_images AS PERMISSIVE FOR INSERT
  WITH CHECK (((( SELECT auth.uid() AS uid) = user_id) AND ((vehicle_id IS NULL) OR (EXISTS ( SELECT 1    FROM vehicles   WHERE ((vehicles.id = vehicle_images.vehicle_id) AND (vehicles.user_id = ( SELECT auth.uid() AS uid))))))));
CREATE POLICY "Users can update images for their own vehicles" ON public.vehicle_images AS PERMISSIVE FOR UPDATE
  USING (((( SELECT auth.uid() AS uid) = user_id) AND ((vehicle_id IS NULL) OR (EXISTS ( SELECT 1    FROM vehicles   WHERE ((vehicles.id = vehicle_images.vehicle_id) AND (vehicles.user_id = ( SELECT auth.uid() AS uid))))))));
CREATE POLICY "Users can view images for public vehicles" ON public.vehicle_images AS PERMISSIVE FOR SELECT
  USING (((COALESCE(is_sensitive, false) = false) AND (COALESCE(is_superseded, false) = false) AND ((vision_gate_status IS NULL) OR (vision_gate_status <> ALL (ARRAY['rejected_personal'::vision_gate_status, 'rejected_misattributed'::vision_gate_status, 'review_needed'::vision_gate_status]))) AND (EXISTS ( SELECT 1    FROM vehicles v   WHERE ((v.id = vehicle_images.vehicle_id) AND (v.is_public = true))))));
CREATE POLICY "Users can view images for vehicles they own" ON public.vehicle_images AS PERMISSIVE FOR SELECT
  USING ((EXISTS ( SELECT 1    FROM vehicles   WHERE ((vehicles.id = vehicle_images.vehicle_id) AND ((vehicles.user_id = auth.uid()) OR (vehicles.uploaded_by = auth.uid()) OR (vehicles.owner_id = auth.uid()))))));
CREATE POLICY "Users can view their own images" ON public.vehicle_images AS PERMISSIVE FOR SELECT
  USING ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "Vehicle owners and contributors can delete images" ON public.vehicle_images AS PERMISSIVE FOR DELETE
  USING (((( SELECT auth.uid() AS uid) = user_id) OR (EXISTS ( SELECT 1    FROM vehicles v   WHERE ((v.id = vehicle_images.vehicle_id) AND ((v.owner_id = ( SELECT auth.uid() AS uid)) OR (v.user_id = ( SELECT auth.uid() AS uid)))))) OR (EXISTS ( SELECT 1    FROM vehicle_user_permissions vup   WHERE ((vup.vehicle_id = vehicle_images.vehicle_id) AND (vup.user_id = ( SELECT auth.uid() AS uid)) AND (COALESCE(vup.is_active, true) = true) AND (vup.role = ANY (ARRAY['owner'::text, 'co_owner'::text, 'mechanic'::text, 'appraiser'::text, 'moderator'::text, 'contributor'::text, 'photographer'::text, 'dealer_rep'::text, 'sales_agent'::text])))))));
CREATE POLICY "Vehicle owners and contributors can update images" ON public.vehicle_images AS PERMISSIVE FOR UPDATE
  USING (((( SELECT auth.uid() AS uid) = user_id) OR (EXISTS ( SELECT 1    FROM vehicles v   WHERE ((v.id = vehicle_images.vehicle_id) AND ((v.owner_id = ( SELECT auth.uid() AS uid)) OR (v.user_id = ( SELECT auth.uid() AS uid)))))) OR (EXISTS ( SELECT 1    FROM vehicle_user_permissions vup   WHERE ((vup.vehicle_id = vehicle_images.vehicle_id) AND (vup.user_id = ( SELECT auth.uid() AS uid)) AND (COALESCE(vup.is_active, true) = true) AND (vup.role = ANY (ARRAY['owner'::text, 'co_owner'::text, 'mechanic'::text, 'appraiser'::text, 'moderator'::text, 'contributor'::text, 'photographer'::text, 'dealer_rep'::text, 'sales_agent'::text])))))));
CREATE POLICY "service_role_can_insert_vehicle_images" ON public.vehicle_images AS PERMISSIVE FOR INSERT
  WITH CHECK ((auth.role() = 'service_role'::text));
CREATE POLICY "users_can_delete_own_images" ON public.vehicle_images AS PERMISSIVE FOR DELETE
  USING (((( SELECT auth.uid() AS uid) = user_id) OR ((vehicle_id IS NOT NULL) AND (EXISTS ( SELECT 1    FROM vehicles   WHERE ((vehicles.id = vehicle_images.vehicle_id) AND (vehicles.user_id = ( SELECT auth.uid() AS uid))))))));
CREATE POLICY "users_can_insert_own_images" ON public.vehicle_images AS PERMISSIVE FOR INSERT
  WITH CHECK (((( SELECT auth.uid() AS uid) = user_id) AND ((vehicle_id IS NULL) OR (EXISTS ( SELECT 1    FROM vehicles   WHERE ((vehicles.id = vehicle_images.vehicle_id) AND (vehicles.user_id = ( SELECT auth.uid() AS uid))))))));
CREATE POLICY "users_can_update_own_images" ON public.vehicle_images AS PERMISSIVE FOR UPDATE
  USING (((( SELECT auth.uid() AS uid) = user_id) OR ((vehicle_id IS NOT NULL) AND (EXISTS ( SELECT 1    FROM vehicles   WHERE ((vehicles.id = vehicle_images.vehicle_id) AND (vehicles.user_id = ( SELECT auth.uid() AS uid))))))));
CREATE POLICY "users_can_view_own_unorganized_images" ON public.vehicle_images AS PERMISSIVE FOR SELECT
  USING (((vehicle_id IS NULL) AND ((user_id = auth.uid()) OR (documented_by_user_id = auth.uid()))));
CREATE POLICY "Public read access to vehicle permissions" ON public.vehicle_user_permissions AS PERMISSIVE FOR SELECT
  USING (true);
CREATE POLICY "Vehicle owners can manage permissions" ON public.vehicle_user_permissions AS PERMISSIVE FOR ALL
  USING (((EXISTS ( SELECT 1    FROM vehicles v   WHERE ((v.id = vehicle_user_permissions.vehicle_id) AND (v.user_id = ( SELECT auth.uid() AS uid))))) OR (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "vup_delete_own" ON public.vehicle_user_permissions AS PERMISSIVE FOR DELETE
  USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY "vup_insert_own" ON public.vehicle_user_permissions AS PERMISSIVE FOR INSERT
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY "vup_select_own" ON public.vehicle_user_permissions AS PERMISSIVE FOR SELECT
  USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY "vup_update_own" ON public.vehicle_user_permissions AS PERMISSIVE FOR UPDATE
  USING ((user_id = ( SELECT auth.uid() AS uid)))
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY "Users can create own work sessions" ON public.work_sessions AS PERMISSIVE FOR INSERT
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "Users can create their own work sessions" ON public.work_sessions AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY "Users can delete their own work sessions" ON public.work_sessions AS PERMISSIVE FOR DELETE TO authenticated
  USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY "Users can update own work sessions" ON public.work_sessions AS PERMISSIVE FOR UPDATE
  USING ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "Users can update their own work sessions" ON public.work_sessions AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((user_id = ( SELECT auth.uid() AS uid)))
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY "Users can view their own work sessions" ON public.work_sessions AS PERMISSIVE FOR SELECT TO authenticated
  USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY "Users can view work sessions for vehicles they have access to" ON public.work_sessions AS PERMISSIVE FOR SELECT
  USING (((( SELECT auth.uid() AS uid) = user_id) OR (EXISTS ( SELECT 1    FROM vehicles v   WHERE ((v.id = work_sessions.vehicle_id) AND ((v.owner_id = ( SELECT auth.uid() AS uid)) OR (v.user_id = ( SELECT auth.uid() AS uid))))))));
CREATE POLICY "delete_own_work_sessions" ON public.work_sessions AS PERMISSIVE FOR DELETE
  USING ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "select_work_sessions_by_org_or_self" ON public.work_sessions AS PERMISSIVE FOR SELECT
  USING (((( SELECT auth.uid() AS uid) = user_id) OR (EXISTS ( SELECT 1    FROM vehicles v   WHERE ((v.id = work_sessions.vehicle_id) AND ((v.owner_id = ( SELECT auth.uid() AS uid)) OR (v.user_id = ( SELECT auth.uid() AS uid)))))) OR (EXISTS ( SELECT 1    FROM vehicle_user_permissions vup   WHERE ((vup.vehicle_id = work_sessions.vehicle_id) AND (vup.user_id = ( SELECT auth.uid() AS uid)) AND (COALESCE(vup.is_active, true) = true) AND (vup.role = ANY (ARRAY['owner'::text, 'co_owner'::text, 'mechanic'::text, 'appraiser'::text, 'moderator'::text, 'contributor'::text, 'photographer'::text, 'dealer_rep'::text, 'sales_agent'::text])))))));
CREATE POLICY "update_own_work_sessions" ON public.work_sessions AS PERMISSIVE FOR UPDATE
  USING ((( SELECT auth.uid() AS uid) = user_id))
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));
