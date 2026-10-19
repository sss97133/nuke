-- Live shapes (2026-10-19) of the facility tables before 20261019224000: equipment without an organization FK, shop_licenses
-- keyed to shops_archived_20260129 with its archived-shop policies, anon/authenticated grants as live, RLS on.
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS is_public boolean, ADD COLUMN IF NOT EXISTS slug text, ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE public.vehicle_observations ADD COLUMN IF NOT EXISTS subject_type text, ADD COLUMN IF NOT EXISTS subject_id uuid,
  ADD COLUMN IF NOT EXISTS subject_organization_id uuid;
CREATE TABLE IF NOT EXISTS public.organization_images(id uuid PRIMARY KEY, organization_id uuid, user_id uuid);
CREATE TABLE public.shops_archived_20260129(id uuid PRIMARY KEY, slug text, is_public boolean, owner_user_id uuid);
CREATE TABLE public.shop_locations(id uuid PRIMARY KEY, shop_id uuid);
CREATE TABLE IF NOT EXISTS public.equipment(id uuid PRIMARY KEY, shop_id uuid);
ALTER TABLE public.equipment ALTER COLUMN id SET DEFAULT gen_random_uuid(),
  ADD COLUMN name text NOT NULL, ADD COLUMN category text, ADD COLUMN manufacturer text,
  ADD COLUMN model text, ADD COLUMN serial_number text, ADD COLUMN purchase_date date, ADD COLUMN purchase_cost numeric,
  ADD COLUMN est_useful_life_hours numeric, ADD COLUMN est_useful_life_years numeric, ADD COLUMN hours_used_observed numeric,
  ADD COLUMN hours_used_last_computed_at timestamptz, ADD COLUMN current_value_computed numeric,
  ADD COLUMN status text CHECK (status = ANY (ARRAY['in_service','retired','for_sale','broken','sold'])), ADD COLUMN notes text, ADD COLUMN source text,
  ADD COLUMN created_at timestamptz DEFAULT now(), ADD COLUMN updated_at timestamptz DEFAULT now();
CREATE TABLE public.shop_licenses(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL CONSTRAINT shop_licenses_shop_id_fkey REFERENCES public.shops_archived_20260129(id) ON DELETE CASCADE,
  location_id uuid REFERENCES public.shop_locations(id) ON DELETE CASCADE, license_type text NOT NULL, license_number text NOT NULL,
  issuing_authority text, issued_date date, expiration_date date, document_id uuid, is_active boolean, verified boolean,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
DO $$ BEGIN
  IF to_regprocedure('public.is_global_admin()') IS NULL THEN
    CREATE FUNCTION public.is_global_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS 'SELECT EXISTS (SELECT 1 FROM public.admin_users a WHERE a.user_id = auth.uid() AND a.is_active)';
  END IF;
END $$;
CREATE FUNCTION public.is_shop_admin(p_shop_id uuid) RETURNS boolean LANGUAGE sql STABLE AS 'SELECT false';
CREATE FUNCTION public.is_shop_member(p_shop_id uuid) RETURNS boolean LANGUAGE sql STABLE AS 'SELECT false';
CREATE FUNCTION public.is_shop_owner(p_shop_id uuid) RETURNS boolean LANGUAGE sql STABLE AS 'SELECT false';
ALTER TABLE public.equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_licenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_licenses_admin_delete ON public.shop_licenses FOR DELETE TO authenticated USING (public.is_shop_admin(shop_id));
CREATE POLICY shop_licenses_admin_update ON public.shop_licenses FOR UPDATE TO authenticated USING (public.is_shop_admin(shop_id)) WITH CHECK (public.is_shop_admin(shop_id));
CREATE POLICY shop_licenses_admin_write ON public.shop_licenses FOR INSERT TO authenticated WITH CHECK (public.is_shop_admin(shop_id));
CREATE POLICY shop_licenses_insert_own ON public.shop_licenses FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM public.shops_archived_20260129 s
  WHERE s.id = shop_licenses.shop_id AND s.owner_user_id = (SELECT auth.uid())));
CREATE POLICY shop_licenses_member_read ON public.shop_licenses FOR SELECT TO authenticated USING (public.is_shop_member(shop_id) OR public.is_shop_admin(shop_id));
CREATE POLICY shop_licenses_member_read_safe ON public.shop_licenses FOR SELECT TO authenticated USING (public.is_shop_member(shop_id));
CREATE POLICY shop_licenses_owner_admin_read ON public.shop_licenses FOR SELECT TO authenticated USING (public.is_global_admin() OR public.is_shop_owner(shop_id));
CREATE POLICY shop_licenses_public_read ON public.shop_licenses FOR SELECT TO anon, authenticated USING (EXISTS (SELECT 1 FROM public.shops_archived_20260129 s
  WHERE s.id = shop_licenses.shop_id AND s.is_public = true));
GRANT ALL ON public.equipment TO authenticated, service_role;
GRANT ALL ON public.shop_licenses TO anon, authenticated, service_role;
GRANT SELECT ON public.organization_images, public.shops_archived_20260129, public.shop_locations TO service_role;
