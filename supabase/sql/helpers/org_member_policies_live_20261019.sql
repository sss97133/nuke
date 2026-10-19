-- RLS policies as read from production on 2026-10-19 ~23:00Z (pg_policies, search_path public), for
-- test_org_member_policies_require_active.sql. The 17 policies 20261020150000 changes are verbatim; the others are the
-- ones those policies' subqueries and the contract's writes depend on (organization_contributors select/update,
-- organization_ownership_verifications and business_ownership own-row reads, contractor_work_contributions own insert,
-- deal_jackets public/privileged).
CREATE POLICY "Owners read own ownership" ON public.business_ownership AS PERMISSIVE FOR SELECT
  USING ((owner_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY "contractor_insert_own" ON public.contractor_work_contributions AS PERMISSIVE FOR INSERT
  WITH CHECK ((contractor_user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY "contractor_view_own" ON public.contractor_work_contributions AS PERMISSIVE FOR SELECT
  USING ((contractor_user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY "deal_contacts_org" ON public.deal_contacts AS PERMISSIVE FOR SELECT
  USING ((organization_id IN ( SELECT oc.organization_id
   FROM organization_contributors oc
  WHERE (oc.user_id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY "deal_docs_org" ON public.deal_documents AS PERMISSIVE FOR SELECT
  USING ((deal_id IN ( SELECT dj.id
   FROM (deal_jackets dj
     JOIN organization_contributors oc ON ((oc.organization_id = dj.organization_id)))
  WHERE (oc.user_id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY "deal_jackets_org" ON public.deal_jackets AS PERMISSIVE FOR SELECT
  USING (((visibility = ANY (ARRAY['public'::intel_visibility, 'org'::intel_visibility])) AND (organization_id IN ( SELECT oc.organization_id
   FROM organization_contributors oc
  WHERE (oc.user_id = ( SELECT auth.uid() AS uid))))));
CREATE POLICY "deal_jackets_principals" ON public.deal_jackets AS PERMISSIVE FOR SELECT
  USING (((visibility = ANY (ARRAY['public'::intel_visibility, 'org'::intel_visibility, 'principals'::intel_visibility])) AND ((created_by = ( SELECT auth.uid() AS uid)) OR (organization_id IN ( SELECT oc.organization_id
   FROM organization_contributors oc
  WHERE ((oc.user_id = ( SELECT auth.uid() AS uid)) AND (oc.role = ANY (ARRAY['owner'::text, 'admin'::text]))))))));
CREATE POLICY "deal_jackets_privileged" ON public.deal_jackets AS PERMISSIVE FOR SELECT
  USING (((visibility = 'privileged'::intel_visibility) AND (created_by = ( SELECT auth.uid() AS uid))));
CREATE POLICY "deal_jackets_public" ON public.deal_jackets AS PERMISSIVE FOR SELECT
  USING ((visibility = 'public'::intel_visibility));
CREATE POLICY "deal_recon_org" ON public.deal_reconditioning AS PERMISSIVE FOR SELECT
  USING ((deal_id IN ( SELECT dj.id
   FROM (deal_jackets dj
     JOIN organization_contributors oc ON ((oc.organization_id = dj.organization_id)))
  WHERE (oc.user_id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY "deal_vehicle_details_org" ON public.deal_vehicle_details AS PERMISSIVE FOR SELECT
  USING ((organization_id IN ( SELECT oc.organization_id
   FROM organization_contributors oc
  WHERE (oc.user_id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY "documents_insert_policy" ON public.documents AS PERMISSIVE FOR INSERT
  WITH CHECK (((uploaded_by = ( SELECT auth.uid() AS uid)) AND (((entity_type = 'vehicle'::text) AND (entity_id IN ( SELECT vehicles.id
   FROM vehicles
  WHERE (vehicles.user_id = ( SELECT auth.uid() AS uid))))) OR ((entity_type = 'organization'::text) AND (entity_id IN ( SELECT organization_contributors.organization_id
   FROM organization_contributors
  WHERE (organization_contributors.user_id = ( SELECT auth.uid() AS uid))))) OR ((entity_type = 'user'::text) AND (entity_id = ( SELECT auth.uid() AS uid))) OR ((entity_type = 'timeline_event'::text) AND (entity_id IN ( SELECT te.id
   FROM (timeline_events te
     JOIN vehicles v ON ((v.id = te.vehicle_id)))
  WHERE (v.user_id = ( SELECT auth.uid() AS uid))))))));
CREATE POLICY "documents_view_policy" ON public.documents AS PERMISSIVE FOR SELECT
  USING (((is_public = true) OR (uploaded_by = ( SELECT auth.uid() AS uid)) OR ((entity_type = 'vehicle'::text) AND (entity_id IN ( SELECT vehicles.id
   FROM vehicles
  WHERE (vehicles.user_id = ( SELECT auth.uid() AS uid))))) OR ((entity_type = 'organization'::text) AND (entity_id IN ( SELECT organization_contributors.organization_id
   FROM organization_contributors
  WHERE (organization_contributors.user_id = ( SELECT auth.uid() AS uid))))) OR ((entity_type = 'user'::text) AND (entity_id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY "View work extractions" ON public.image_work_extractions AS PERMISSIVE FOR SELECT
  USING (((EXISTS ( SELECT 1
   FROM organization_vehicles ov
  WHERE ((ov.vehicle_id = image_work_extractions.vehicle_id) AND (EXISTS ( SELECT 1
           FROM organization_contributors oc
          WHERE ((oc.organization_id = ov.organization_id) AND (oc.user_id = ( SELECT auth.uid() AS uid)))))))) OR (EXISTS ( SELECT 1
   FROM vehicle_images vi
  WHERE ((vi.id = image_work_extractions.image_id) AND (vi.user_id = ( SELECT auth.uid() AS uid)))))));
CREATE POLICY "Organizations can manage own location collaborations" ON public.location_collaborations AS PERMISSIVE FOR ALL
  USING ((EXISTS ( SELECT 1
   FROM organization_contributors oc
  WHERE ((oc.organization_id = location_collaborations.organization_id) AND (oc.user_id = ( SELECT auth.uid() AS uid)) AND (oc.role = ANY (ARRAY['owner'::text, 'co_founder'::text, 'board_member'::text, 'manager'::text]))))));
CREATE POLICY "Organizations can view location collaborations" ON public.location_collaborations AS PERMISSIVE FOR SELECT
  USING (((EXISTS ( SELECT 1
   FROM organization_contributors oc
  WHERE ((oc.organization_id = location_collaborations.organization_id) AND (oc.user_id = ( SELECT auth.uid() AS uid))))) OR (EXISTS ( SELECT 1
   FROM location_collaborations lc2
  WHERE ((lc2.location_address = location_collaborations.location_address) AND (EXISTS ( SELECT 1
           FROM organization_contributors oc2
          WHERE ((oc2.organization_id = lc2.organization_id) AND (oc2.user_id = ( SELECT auth.uid() AS uid))))))))));
CREATE POLICY "obs_deal" ON public.organization_behavior_signals AS PERMISSIVE FOR SELECT
  USING (((visibility = ANY (ARRAY['public'::intel_visibility, 'org'::intel_visibility, 'deal'::intel_visibility])) AND ((reported_by = ( SELECT auth.uid() AS uid)) OR (organization_id IN ( SELECT oc.organization_id
   FROM organization_contributors oc
  WHERE ((oc.user_id = ( SELECT auth.uid() AS uid)) AND (oc.role = ANY (ARRAY['owner'::text, 'admin'::text]))))))));
CREATE POLICY "obs_org" ON public.organization_behavior_signals AS PERMISSIVE FOR SELECT
  USING (((visibility = ANY (ARRAY['public'::intel_visibility, 'org'::intel_visibility])) AND (organization_id IN ( SELECT organization_contributors.organization_id
   FROM organization_contributors
  WHERE (organization_contributors.user_id = ( SELECT auth.uid() AS uid))))));
CREATE POLICY "Manage own capabilities" ON public.organization_capabilities AS PERMISSIVE FOR ALL
  USING ((EXISTS ( SELECT 1
   FROM organization_contributors oc
  WHERE ((oc.organization_id = organization_capabilities.organization_id) AND (oc.user_id = ( SELECT auth.uid() AS uid)) AND (oc.role = ANY (ARRAY['owner'::text, 'co_founder'::text, 'board_member'::text, 'manager'::text]))))));
CREATE POLICY "organization_contributors_insert" ON public.organization_contributors AS PERMISSIVE FOR INSERT
  WITH CHECK (((( SELECT auth.uid() AS uid) IS NOT NULL) AND (((user_id = ( SELECT auth.uid() AS uid)) AND (role = ANY (ARRAY['contributor'::text, 'photographer'::text])) AND (status = 'pending'::text) AND (verification_method = 'self_claimed'::text) AND (verified_by IS NULL) AND (verified_at IS NULL)) OR ((user_id = ( SELECT auth.uid() AS uid)) AND (role = 'owner'::text) AND (verification_method = 'self_claimed'::text) AND (verified_by IS NULL) AND (verified_at IS NULL) AND ((EXISTS ( SELECT 1
   FROM business_ownership bo
  WHERE ((bo.business_id = organization_contributors.organization_id) AND (bo.owner_id = ( SELECT auth.uid() AS uid)) AND (bo.status = 'active'::text)))) OR (EXISTS ( SELECT 1
   FROM organization_ownership_verifications v
  WHERE ((v.organization_id = organization_contributors.organization_id) AND (v.user_id = ( SELECT auth.uid() AS uid)) AND (v.status = 'approved'::text)))))) OR (EXISTS ( SELECT 1
   FROM organization_contributors oc
  WHERE ((oc.organization_id = organization_contributors.organization_id) AND (oc.user_id = ( SELECT auth.uid() AS uid)) AND (oc.role = ANY (ARRAY['owner'::text, 'co_founder'::text])) AND (oc.status = 'active'::text)))))));
CREATE POLICY "organization_contributors_select" ON public.organization_contributors AS PERMISSIVE FOR SELECT
  USING (true);
CREATE POLICY "organization_contributors_update_own" ON public.organization_contributors AS PERMISSIVE FOR UPDATE
  USING ((user_id = ( SELECT auth.uid() AS uid)))
  WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM organization_contributors prior
  WHERE ((prior.id = organization_contributors.id) AND (prior.organization_id = organization_contributors.organization_id) AND (prior.user_id = organization_contributors.user_id) AND (prior.role = organization_contributors.role) AND (prior.verification_method = organization_contributors.verification_method) AND (NOT (prior.verified_by IS DISTINCT FROM organization_contributors.verified_by)) AND (NOT (prior.verified_at IS DISTINCT FROM organization_contributors.verified_at)) AND ((organization_contributors.status IS DISTINCT FROM 'active'::text) OR (prior.status = 'active'::text)))))));
CREATE POLICY "Users view own org verifications" ON public.organization_ownership_verifications AS PERMISSIVE FOR SELECT
  USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY "Update own work matches" ON public.work_organization_matches AS PERMISSIVE FOR UPDATE
  USING ((EXISTS ( SELECT 1
   FROM organization_contributors oc
  WHERE ((oc.organization_id = work_organization_matches.matched_organization_id) AND (oc.user_id = ( SELECT auth.uid() AS uid)) AND (oc.role = ANY (ARRAY['owner'::text, 'co_founder'::text, 'board_member'::text, 'manager'::text]))))));
CREATE POLICY "View work matches" ON public.work_organization_matches AS PERMISSIVE FOR SELECT
  USING (((EXISTS ( SELECT 1
   FROM organization_contributors oc
  WHERE ((oc.organization_id = work_organization_matches.matched_organization_id) AND (oc.user_id = ( SELECT auth.uid() AS uid))))) OR (EXISTS ( SELECT 1
   FROM organization_vehicles ov
  WHERE ((ov.vehicle_id = work_organization_matches.vehicle_id) AND (EXISTS ( SELECT 1
           FROM organization_contributors oc2
          WHERE ((oc2.organization_id = ov.organization_id) AND (oc2.user_id = ( SELECT auth.uid() AS uid))))))))));
