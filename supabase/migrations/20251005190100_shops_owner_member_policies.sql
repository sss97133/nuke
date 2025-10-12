BEGIN;

-- Helper functions to avoid RLS recursion
CREATE OR REPLACE FUNCTION public.is_shop_member(p_shop_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v boolean;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM public.shop_members m
    WHERE m.shop_id = p_shop_id
      AND m.user_id = auth.uid()
      AND m.status = 'active'
  ) INTO v;
  RETURN COALESCE(v, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.is_shop_admin(p_shop_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v boolean;
BEGIN
  -- Global admin/moderator
  IF EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.user_type IN ('admin','moderator')
  ) THEN
    RETURN true;
  END IF;
  -- Shop-level admin/owner
  SELECT EXISTS(
    SELECT 1 FROM public.shop_members m
    WHERE m.shop_id = p_shop_id
      AND m.user_id = auth.uid()
      AND m.status = 'active'
      AND m.role IN ('owner','admin')
  ) INTO v;
  RETURN COALESCE(v, false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_shop_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_shop_admin(uuid) TO authenticated;

-- ==============================
-- Read policies (owners/members)
-- ==============================

-- Shops: allow authenticated members/admins to read their orgs (public still covered by existing policy)
DROP POLICY IF EXISTS shops_member_read ON public.shops;
CREATE POLICY shops_member_read ON public.shops
  FOR SELECT
  TO authenticated
  USING (
    public.is_shop_member(id) OR public.is_shop_admin(id) OR is_public = true
  );

-- Locations
DROP POLICY IF EXISTS shop_locations_member_read ON public.shop_locations;
CREATE POLICY shop_locations_member_read ON public.shop_locations
  FOR SELECT
  TO authenticated
  USING (
    public.is_shop_member(shop_id) OR public.is_shop_admin(shop_id)
  );

-- Licenses
DROP POLICY IF EXISTS shop_licenses_member_read ON public.shop_licenses;
CREATE POLICY shop_licenses_member_read ON public.shop_licenses
  FOR SELECT
  TO authenticated
  USING (
    public.is_shop_member(shop_id) OR public.is_shop_admin(shop_id)
  );

-- Departments
DROP POLICY IF EXISTS shop_departments_member_read ON public.shop_departments;
CREATE POLICY shop_departments_member_read ON public.shop_departments
  FOR SELECT
  TO authenticated
  USING (
    public.is_shop_member(shop_id) OR public.is_shop_admin(shop_id)
  );

-- Documents: members can read 'members'/'public'; admins can read any
DROP POLICY IF EXISTS shop_documents_member_read ON public.shop_documents;
CREATE POLICY shop_documents_member_read ON public.shop_documents
  FOR SELECT
  TO authenticated
  USING (
    (visibility IN ('members','public') AND public.is_shop_member(shop_id))
    OR public.is_shop_admin(shop_id)
  );

-- Vehicles linked to org: allow members/admins
DROP POLICY IF EXISTS vehicles_owner_shop_member_read ON public.vehicles;
CREATE POLICY vehicles_owner_shop_member_read ON public.vehicles
  FOR SELECT
  TO authenticated
  USING (
    owner_shop_id IS NOT NULL AND (
      public.is_shop_member(owner_shop_id) OR public.is_shop_admin(owner_shop_id)
    )
  );

-- ==============================
-- Write policies (admins/owners)
-- ==============================

-- Locations
DROP POLICY IF EXISTS shop_locations_admin_write ON public.shop_locations;
CREATE POLICY shop_locations_admin_write ON public.shop_locations
  FOR INSERT TO authenticated
  WITH CHECK (public.is_shop_admin(shop_id));
CREATE POLICY shop_locations_admin_update ON public.shop_locations
  FOR UPDATE TO authenticated
  USING (public.is_shop_admin(shop_id))
  WITH CHECK (public.is_shop_admin(shop_id));
CREATE POLICY shop_locations_admin_delete ON public.shop_locations
  FOR DELETE TO authenticated
  USING (public.is_shop_admin(shop_id));

-- Licenses
DROP POLICY IF EXISTS shop_licenses_admin_write ON public.shop_licenses;
CREATE POLICY shop_licenses_admin_write ON public.shop_licenses
  FOR INSERT TO authenticated
  WITH CHECK (public.is_shop_admin(shop_id));
CREATE POLICY shop_licenses_admin_update ON public.shop_licenses
  FOR UPDATE TO authenticated
  USING (public.is_shop_admin(shop_id))
  WITH CHECK (public.is_shop_admin(shop_id));
CREATE POLICY shop_licenses_admin_delete ON public.shop_licenses
  FOR DELETE TO authenticated
  USING (public.is_shop_admin(shop_id));

-- Departments
DROP POLICY IF EXISTS shop_departments_admin_write ON public.shop_departments;
CREATE POLICY shop_departments_admin_write ON public.shop_departments
  FOR INSERT TO authenticated
  WITH CHECK (public.is_shop_admin(shop_id));
CREATE POLICY shop_departments_admin_update ON public.shop_departments
  FOR UPDATE TO authenticated
  USING (public.is_shop_admin(shop_id))
  WITH CHECK (public.is_shop_admin(shop_id));
CREATE POLICY shop_departments_admin_delete ON public.shop_departments
  FOR DELETE TO authenticated
  USING (public.is_shop_admin(shop_id));

-- Documents
DROP POLICY IF EXISTS shop_documents_admin_write ON public.shop_documents;
CREATE POLICY shop_documents_admin_write ON public.shop_documents
  FOR INSERT TO authenticated
  WITH CHECK (public.is_shop_admin(shop_id));
CREATE POLICY shop_documents_admin_update ON public.shop_documents
  FOR UPDATE TO authenticated
  USING (public.is_shop_admin(shop_id))
  WITH CHECK (public.is_shop_admin(shop_id));
CREATE POLICY shop_documents_admin_delete ON public.shop_documents
  FOR DELETE TO authenticated
  USING (public.is_shop_admin(shop_id));

-- Invitations (admin-only)
ALTER TABLE public.shop_invitations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shop_invitations_admin_select ON public.shop_invitations;
CREATE POLICY shop_invitations_admin_select ON public.shop_invitations
  FOR SELECT TO authenticated
  USING (public.is_shop_admin(shop_id));
DROP POLICY IF EXISTS shop_invitations_admin_write ON public.shop_invitations;
CREATE POLICY shop_invitations_admin_write ON public.shop_invitations
  FOR INSERT TO authenticated
  WITH CHECK (public.is_shop_admin(shop_id));
CREATE POLICY shop_invitations_admin_update ON public.shop_invitations
  FOR UPDATE TO authenticated
  USING (public.is_shop_admin(shop_id))
  WITH CHECK (public.is_shop_admin(shop_id));
CREATE POLICY shop_invitations_admin_delete ON public.shop_invitations
  FOR DELETE TO authenticated
  USING (public.is_shop_admin(shop_id));

-- Members (avoid recursion: do not call is_shop_admin here)
ALTER TABLE public.shop_members ENABLE ROW LEVEL SECURITY;

-- SELECT: allow global admins/moderators, shop owners, and the member themselves
DROP POLICY IF EXISTS shop_members_select ON public.shop_members;
CREATE POLICY shop_members_select ON public.shop_members
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.user_type IN ('admin','moderator')
    )
    OR EXISTS (
      SELECT 1 FROM public.shops s
      WHERE s.id = shop_members.shop_id AND s.owner_user_id = auth.uid()
    )
    OR user_id = auth.uid()
  );

-- INSERT/UPDATE/DELETE: allow global admins/moderators and shop owners
DROP POLICY IF EXISTS shop_members_admin_write ON public.shop_members;
CREATE POLICY shop_members_admin_write ON public.shop_members
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.user_type IN ('admin','moderator')
    )
    OR EXISTS (
      SELECT 1 FROM public.shops s
      WHERE s.id = shop_members.shop_id AND s.owner_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS shop_members_admin_update ON public.shop_members;
CREATE POLICY shop_members_admin_update ON public.shop_members
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.user_type IN ('admin','moderator')
    )
    OR EXISTS (
      SELECT 1 FROM public.shops s
      WHERE s.id = shop_members.shop_id AND s.owner_user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.user_type IN ('admin','moderator')
    )
    OR EXISTS (
      SELECT 1 FROM public.shops s
      WHERE s.id = shop_members.shop_id AND s.owner_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS shop_members_admin_delete ON public.shop_members;
CREATE POLICY shop_members_admin_delete ON public.shop_members
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.user_type IN ('admin','moderator')
    )
    OR EXISTS (
      SELECT 1 FROM public.shops s
      WHERE s.id = shop_members.shop_id AND s.owner_user_id = auth.uid()
    )
  );

COMMIT;
