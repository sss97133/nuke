BEGIN;

-- Enable RLS and allow public read of public shops
ALTER TABLE public.shops ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shops_public_read ON public.shops;
CREATE POLICY shops_public_read ON public.shops
  FOR SELECT
  TO anon, authenticated
  USING (is_public = true);

-- Allow only admins/moderators to update shops (e.g., verification_status)
DROP POLICY IF EXISTS shops_admin_update ON public.shops;
CREATE POLICY shops_admin_update ON public.shops
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.user_type IN ('admin','moderator')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.user_type IN ('admin','moderator')
    )
  );

-- Shop licenses readable when tied to a public shop
ALTER TABLE public.shop_licenses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shop_licenses_public_read ON public.shop_licenses;
CREATE POLICY shop_licenses_public_read ON public.shop_licenses
  FOR SELECT
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.shops s
      WHERE s.id = shop_licenses.shop_id
        AND s.is_public = true
    )
  );

-- Locations readable for public shops
ALTER TABLE public.shop_locations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shop_locations_public_read ON public.shop_locations;
CREATE POLICY shop_locations_public_read ON public.shop_locations
  FOR SELECT
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.shops s
      WHERE s.id = shop_locations.shop_id
        AND s.is_public = true
    )
  );

-- Departments readable for public shops
ALTER TABLE public.shop_departments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shop_departments_public_read ON public.shop_departments;
CREATE POLICY shop_departments_public_read ON public.shop_departments
  FOR SELECT
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.shops s
      WHERE s.id = shop_departments.shop_id
        AND s.is_public = true
    )
  );

-- Documents readable for public shops when marked public
ALTER TABLE public.shop_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shop_documents_public_read ON public.shop_documents;
CREATE POLICY shop_documents_public_read ON public.shop_documents
  FOR SELECT
  TO anon, authenticated
  USING (
    visibility = 'public'
    AND EXISTS (
      SELECT 1 FROM public.shops s
      WHERE s.id = shop_documents.shop_id
        AND s.is_public = true
    )
  );

-- Vehicles readable only for those tied to a public shop (for activity view)
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vehicles_public_owner_shop_read ON public.vehicles;
CREATE POLICY vehicles_public_owner_shop_read ON public.vehicles
  FOR SELECT
  TO anon, authenticated
  USING (
    owner_shop_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.shops s
      WHERE s.id = vehicles.owner_shop_id
        AND s.is_public = true
    )
  );

-- Note: vehicle_timeline_events is a view; RLS cannot be enabled on views. Rely on RLS of underlying tables.

COMMIT;
