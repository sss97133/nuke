-- Revert 20261125084500_organization_images_read_narrow: restores the two USING (true) SELECT policies, the table-level
-- SELECT grant, anon UPDATE / DELETE, and extract_work_order_data as SECURITY DEFINER reading the whole row.
SET lock_timeout = '5s';
CREATE POLICY "Anyone views org images" ON public.organization_images FOR SELECT USING (true);
CREATE POLICY "Public can view org images" ON public.organization_images FOR SELECT USING (true);
GRANT SELECT ON TABLE public.organization_images TO anon, authenticated;
GRANT UPDATE, DELETE ON TABLE public.organization_images TO anon;
CREATE OR REPLACE FUNCTION public.extract_work_order_data(image_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  result JSONB := '{}'::jsonb;
  img RECORD;
BEGIN
  SELECT * INTO img FROM organization_images WHERE id = image_id;

  IF NOT FOUND THEN
    RETURN '{"error": "Image not found"}'::jsonb;
  END IF;

  -- TODO: Integrate with OCR Edge Function
  -- For now, return placeholder data
  result := jsonb_build_object(
    'status', 'pending_ocr',
    'image_url', img.image_url,
    'requires_manual_entry', TRUE
  );

  RETURN result;
END;
$function$;
COMMENT ON POLICY org_images_public_view ON public.organization_images IS NULL;
DROP FUNCTION IF EXISTS public.organization_image_locations(uuid);
