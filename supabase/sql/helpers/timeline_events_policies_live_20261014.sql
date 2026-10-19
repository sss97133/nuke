-- The live row policies of public.timeline_events as read from production on 2026-10-14 (pg_policies).
-- For the contract test only.
CREATE POLICY "Allow vehicle owners to delete their timeline events" ON public.timeline_events AS PERMISSIVE FOR DELETE TO public
  USING ((EXISTS ( SELECT 1
   FROM vehicles v
  WHERE ((v.id = timeline_events.vehicle_id) AND (v.user_id = ( SELECT auth.uid() AS uid))))));
CREATE POLICY "Authenticated users can create their own timeline events" ON public.timeline_events AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "Authenticated users can create timeline events" ON public.timeline_events AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "Public can view all timeline events" ON public.timeline_events AS PERMISSIVE FOR SELECT TO public
  USING (true);
CREATE POLICY "Public vehicle timeline events are viewable" ON public.timeline_events AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING ((EXISTS ( SELECT 1
   FROM vehicles
  WHERE ((vehicles.id = timeline_events.vehicle_id) AND (vehicles.is_public = true)))));
CREATE POLICY "Timeline events are viewable by everyone" ON public.timeline_events AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM vehicles
  WHERE ((vehicles.id = timeline_events.vehicle_id) AND ((vehicles.is_public = true) OR (vehicles.id IN ( SELECT vehicle_user_permissions.vehicle_id
           FROM vehicle_user_permissions
          WHERE (vehicle_user_permissions.user_id = ( SELECT auth.uid() AS uid)))))))));
CREATE POLICY "Users can create timeline events for their vehicles" ON public.timeline_events AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((( SELECT auth.uid() AS uid) = user_id) AND (EXISTS ( SELECT 1
   FROM vehicles
  WHERE ((vehicles.id = timeline_events.vehicle_id) AND (vehicles.user_id = ( SELECT auth.uid() AS uid)))))));
CREATE POLICY "Users can delete their own timeline events" ON public.timeline_events AS PERMISSIVE FOR DELETE TO public
  USING (((( SELECT auth.uid() AS uid) = user_id) AND (EXISTS ( SELECT 1
   FROM vehicles
  WHERE ((vehicles.id = timeline_events.vehicle_id) AND (vehicles.uploaded_by = ( SELECT auth.uid() AS uid)))))));
CREATE POLICY "Users can update their own timeline events" ON public.timeline_events AS PERMISSIVE FOR UPDATE TO public
  USING (((( SELECT auth.uid() AS uid) = user_id) AND (EXISTS ( SELECT 1
   FROM vehicles
  WHERE ((vehicles.id = timeline_events.vehicle_id) AND (vehicles.user_id = ( SELECT auth.uid() AS uid)))))));
CREATE POLICY "Users can view timeline events for vehicles they own" ON public.timeline_events AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM vehicles
  WHERE ((vehicles.id = timeline_events.vehicle_id) AND (vehicles.user_id = ( SELECT auth.uid() AS uid))))));
CREATE POLICY "service_role_can_insert_timeline_events" ON public.timeline_events AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.role() = 'service_role'::text));
