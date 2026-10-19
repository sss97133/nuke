-- Live row policies of business_ownership, organization_contributors, organization_ownership_verifications and
-- organizations, and the two functions around them (caller_manages_organization; create_initial_business_ownership
-- with its trigger), as read from production on 2026-10-14 10:21Z (pg_policy through pg_get_expr, pg_get_functiondef,
-- pg_get_triggerdef). Test fixture only: supabase/sql/test_organization_roles_not_self_granted.sql loads it to
-- reproduce the state that 20261014160000_organization_roles_not_self_granted.sql replaces.
--
-- Policy-set hashes: base64 SHA-256 of a table's policies, one line per policy ordered by name (name, cmd, permissive,
-- role names or 'public', USING, WITH CHECK; tab-separated). The migration's guard accepts the first three.
--   business_ownership                    2 policies   9fhZL8e9nL6s6VBtEHM+P25zAvyRbFQeOAO4YsmO1m4=
--   organization_contributors             3 policies   R4c0+Y0LvKtNABRvnhYLUgxKuxfHPyVTIj2uZJuUAm0=
--   organization_ownership_verifications  3 policies   +2+rWomj4YzHGuV0jNZNPef850xilx80m8RISvGnbBo=
--   organizations                         10 policies  lIyIhbGfqUJ7HclStWLHj51KicI1fky/ipAqH+UqH3I= (not changed)
-- Function bodies (base64 SHA-256 of prosrc): caller_manages_organization sFoYAFu4CNU1wF10IBh8Eyflpfm8W366dXlJ9mEEHYM=,
-- create_initial_business_ownership bbR2tsdhjw+OhFujEAcsiQDjPrJM7QI4qybwyRPvQHM=.

CREATE POLICY "Owners manage own ownership" ON public.business_ownership AS PERMISSIVE FOR ALL TO public
  USING ((owner_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY "Service role full access" ON public.business_ownership AS PERMISSIVE FOR ALL TO public
  USING ((auth.role() = 'service_role'::text));
CREATE POLICY organization_contributors_insert ON public.organization_contributors AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((( SELECT auth.uid() AS uid) IS NOT NULL) AND (((user_id = ( SELECT auth.uid() AS uid)) AND (role = ANY (ARRAY['contributor'::text, 'photographer'::text])) AND (status = 'pending'::text)) OR ((user_id = ( SELECT auth.uid() AS uid)) AND (role = 'owner'::text) AND (EXISTS ( SELECT 1
   FROM organizations o
  WHERE ((o.id = organization_contributors.organization_id) AND (o.discovered_by = ( SELECT auth.uid() AS uid)))))) OR (EXISTS ( SELECT 1
   FROM organization_contributors oc
  WHERE ((oc.organization_id = organization_contributors.organization_id) AND (oc.user_id = ( SELECT auth.uid() AS uid)) AND (oc.role = ANY (ARRAY['owner'::text, 'co_founder'::text])) AND (oc.status = 'active'::text)))))));
CREATE POLICY organization_contributors_select ON public.organization_contributors AS PERMISSIVE FOR SELECT TO public
  USING (true);
CREATE POLICY organization_contributors_update_own ON public.organization_contributors AS PERMISSIVE FOR UPDATE TO public
  USING ((user_id = ( SELECT auth.uid() AS uid)))
  WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND ((role <> ALL (ARRAY['owner'::text, 'co_founder'::text])) OR (EXISTS ( SELECT 1
   FROM organizations o
  WHERE ((o.id = organization_contributors.organization_id) AND (o.discovered_by = ( SELECT auth.uid() AS uid))))) OR (EXISTS ( SELECT 1
   FROM organization_contributors oc
  WHERE ((oc.organization_id = organization_contributors.organization_id) AND (oc.user_id = ( SELECT auth.uid() AS uid)) AND (oc.role = ANY (ARRAY['owner'::text, 'co_founder'::text])) AND (oc.status = 'active'::text)))))));
CREATE POLICY "Service role manages org verifications" ON public.organization_ownership_verifications AS PERMISSIVE FOR ALL TO public
  USING ((auth.role() = 'service_role'::text))
  WITH CHECK ((auth.role() = 'service_role'::text));
CREATE POLICY "Users submit org ownership claims" ON public.organization_ownership_verifications AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY "Users view own org verifications" ON public.organization_ownership_verifications AS PERMISSIVE FOR SELECT TO public
  USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY "Anyone views public orgs" ON public.organizations AS PERMISSIVE FOR SELECT TO public
  USING ((is_public = true));
CREATE POLICY "Authenticated users can create businesses" ON public.organizations AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((( SELECT auth.uid() AS uid) IS NOT NULL));
CREATE POLICY "Business owners can update their businesses" ON public.organizations AS PERMISSIVE FOR UPDATE TO public
  USING ((EXISTS ( SELECT 1
   FROM business_ownership
  WHERE ((business_ownership.business_id = organizations.id) AND (business_ownership.owner_id = ( SELECT auth.uid() AS uid)) AND (business_ownership.status = 'active'::text)))));
CREATE POLICY "Business owners can view their businesses" ON public.organizations AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM business_ownership
  WHERE ((business_ownership.business_id = organizations.id) AND (business_ownership.owner_id = ( SELECT auth.uid() AS uid)) AND (business_ownership.status = 'active'::text)))));
CREATE POLICY "Discoverers can update their businesses" ON public.organizations AS PERMISSIVE FOR UPDATE TO public
  USING (((discovered_by = ( SELECT auth.uid() AS uid)) OR (uploaded_by = ( SELECT auth.uid() AS uid))));
CREATE POLICY "Owners/contributors update orgs" ON public.organizations AS PERMISSIVE FOR UPDATE TO public
  USING (((( SELECT auth.uid() AS uid) = discovered_by) OR (EXISTS ( SELECT 1
   FROM organization_contributors oc
  WHERE ((oc.organization_id = organizations.id) AND (oc.user_id = ( SELECT auth.uid() AS uid)) AND (oc.status = 'active'::text) AND (oc.role = ANY (ARRAY['owner'::text, 'co_founder'::text, 'board_member'::text, 'manager'::text]))))) OR (EXISTS ( SELECT 1
   FROM organization_ownership_verifications oov
  WHERE ((oov.organization_id = organizations.id) AND (oov.user_id = ( SELECT auth.uid() AS uid)) AND (oov.status = 'approved'::text))))));
CREATE POLICY "Public can view public businesses" ON public.organizations AS PERMISSIVE FOR SELECT TO public
  USING ((is_public = true));
CREATE POLICY "Users can create businesses" ON public.organizations AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((( SELECT auth.uid() AS uid) IS NOT NULL));
CREATE POLICY "Users create orgs" ON public.organizations AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((( SELECT auth.uid() AS uid) = discovered_by) OR (( SELECT auth.uid() AS uid) = uploaded_by)));
CREATE POLICY "Verified businesses are publicly viewable" ON public.organizations AS PERMISSIVE FOR SELECT TO public
  USING (((is_verified = true) AND (is_public = true)));

CREATE OR REPLACE FUNCTION public.caller_manages_organization(p_organization_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT coalesce(auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.organization_contributors oc
    WHERE oc.organization_id = p_organization_id
      AND oc.user_id = auth.uid()
      AND oc.status = 'active'
      AND oc.role IN ('owner', 'manager', 'board_member')), false)
$function$;

CREATE OR REPLACE FUNCTION public.create_initial_business_ownership()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    -- Only create ownership if there's an authenticated user (not service role)
    -- Service role inserts (like from edge functions) won't have auth.uid()
    IF auth.uid() IS NOT NULL THEN
        INSERT INTO public.business_ownership (
            business_id,
            owner_id,
            ownership_percentage,
            ownership_type,
            ownership_title,
            acquisition_date
        ) VALUES (
            NEW.id,
            auth.uid(),
            100.00,
            'founder',
            'Founder/Owner',
            CURRENT_DATE
        )
        ON CONFLICT (business_id, owner_id) DO NOTHING;
    END IF;

    RETURN NEW;
END;
$function$;


CREATE TRIGGER trigger_create_initial_business_ownership AFTER INSERT ON public.organizations FOR EACH ROW EXECUTE FUNCTION create_initial_business_ownership();
