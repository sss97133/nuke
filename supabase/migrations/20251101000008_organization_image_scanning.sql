-- Organization Image Scanning System
-- AI-powered tagging and inventory extraction from images

-- Image Tags Table
CREATE TABLE IF NOT EXISTS public.organization_image_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE NOT NULL,
  image_id UUID REFERENCES public.organization_images(id) ON DELETE CASCADE NOT NULL,
  tag TEXT NOT NULL,
  tagged_by UUID REFERENCES auth.users(id),
  confidence DECIMAL(3,2) DEFAULT 0.80,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(image_id, tag)
);

-- Add AI scanning fields to organization_images
ALTER TABLE public.organization_images 
  ADD COLUMN IF NOT EXISTS ai_scanned BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ai_scan_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_description TEXT,
  ADD COLUMN IF NOT EXISTS ai_confidence DECIMAL(3,2);

-- Add columns to organization_inventory as needed
DO $$ 
BEGIN
  IF to_regclass('public.organization_inventory') IS NULL THEN
    RAISE NOTICE 'organization_inventory table missing; skipping column additions.';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public'
      AND table_name = 'organization_inventory' 
      AND column_name = 'confidence_score'
  ) THEN
    EXECUTE 'ALTER TABLE public.organization_inventory ADD COLUMN confidence_score DECIMAL(3,2)';
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public'
      AND table_name = 'organization_inventory' 
      AND column_name = 'ai_extracted'
  ) THEN
    EXECUTE 'ALTER TABLE public.organization_inventory ADD COLUMN ai_extracted BOOLEAN DEFAULT FALSE';
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public'
      AND table_name = 'organization_inventory' 
      AND column_name = 'image_id'
  ) THEN
    EXECUTE 'ALTER TABLE public.organization_inventory ADD COLUMN image_id UUID REFERENCES public.organization_images(id) ON DELETE SET NULL';
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_org_image_tags_org ON public.organization_image_tags(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_image_tags_image ON public.organization_image_tags(image_id);
CREATE INDEX IF NOT EXISTS idx_org_image_tags_tag ON public.organization_image_tags(tag);
CREATE INDEX IF NOT EXISTS idx_org_images_scanned ON public.organization_images(ai_scanned);
CREATE INDEX IF NOT EXISTS idx_org_inventory_image ON public.organization_inventory(image_id);

-- RLS Policies for organization_image_tags
DO $$
DECLARE
  has_admin_table BOOLEAN := to_regclass('public.admin_users') IS NOT NULL;
  admin_check TEXT;
BEGIN
  IF to_regclass('public.organization_image_tags') IS NULL THEN
    RAISE NOTICE 'organization_image_tags table missing; skipping RLS setup.';
    RETURN;
  END IF;

  admin_check := CASE
    WHEN has_admin_table THEN
      '(auth.role() = ''service_role'' OR EXISTS (SELECT 1 FROM public.admin_users au WHERE au.user_id = auth.uid() AND au.is_active = TRUE AND au.admin_level IN (''admin'',''super_admin'')))'
    ELSE
      '(auth.role() = ''service_role'')'
  END;

  EXECUTE 'ALTER TABLE public.organization_image_tags ENABLE ROW LEVEL SECURITY';

  EXECUTE 'DROP POLICY IF EXISTS "Public can view organization image tags" ON public.organization_image_tags';
  EXECUTE 'DROP POLICY IF EXISTS "Authenticated users can create tags" ON public.organization_image_tags';
  EXECUTE 'DROP POLICY IF EXISTS "Users can update their own tags" ON public.organization_image_tags';
  EXECUTE 'DROP POLICY IF EXISTS "Users can delete their own tags" ON public.organization_image_tags';
  EXECUTE 'DROP POLICY IF EXISTS "Service role full access to tags" ON public.organization_image_tags';

  EXECUTE 'CREATE POLICY "Public can view organization image tags" ON public.organization_image_tags FOR SELECT USING (true)';
  EXECUTE 'CREATE POLICY "Authenticated users can create tags" ON public.organization_image_tags FOR INSERT WITH CHECK (auth.role() = ''authenticated'')';
  EXECUTE 'CREATE POLICY "Users can update their own tags" ON public.organization_image_tags FOR UPDATE USING (tagged_by = auth.uid()) WITH CHECK (tagged_by = auth.uid())';
  EXECUTE 'CREATE POLICY "Users can delete their own tags" ON public.organization_image_tags FOR DELETE USING (tagged_by = auth.uid())';
  EXECUTE format(
    'CREATE POLICY "Service role full access to tags" ON public.organization_image_tags FOR ALL USING (%s) WITH CHECK (%s)',
    admin_check,
    admin_check
  );
END
$$;

-- Function to get image tags summary
CREATE OR REPLACE FUNCTION public.get_image_tags_summary(img_id UUID)
RETURNS JSON AS $$
BEGIN
  RETURN (
    SELECT JSON_BUILD_OBJECT(
      'tags', COALESCE(JSON_AGG(DISTINCT tag ORDER BY tag), '[]'::JSON),
      'tag_count', COUNT(DISTINCT tag),
      'ai_extracted', COUNT(*) FILTER (WHERE confidence IS NOT NULL AND confidence > 0.7),
      'user_added', COUNT(*) FILTER (WHERE confidence IS NULL OR confidence <= 0.7)
    )
    FROM public.organization_image_tags
    WHERE image_id = img_id
  );
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = public
   STABLE;

-- Function to get organization inventory from images
DROP FUNCTION IF EXISTS public.get_organization_inventory_from_images(uuid);
CREATE OR REPLACE FUNCTION public.get_organization_inventory_from_images(org_id UUID)
RETURNS TABLE (
  item_name TEXT,
  item_type TEXT,
  brand TEXT,
  model_number TEXT,
  total_quantity INTEGER,
  image_count INTEGER,
  avg_confidence DECIMAL,
  image_ids UUID[]
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    name AS item_name,
    item_type,
    brand,
    model_number,
    SUM(quantity)::INTEGER AS total_quantity,
    COUNT(DISTINCT image_id)::INTEGER AS image_count,
    AVG(confidence_score) AS avg_confidence,
    ARRAY_AGG(DISTINCT image_id) AS image_ids
  FROM public.organization_inventory
  WHERE organization_id = org_id
    AND ai_extracted = true
    AND image_id IS NOT NULL
  GROUP BY name, item_type, brand, model_number
  ORDER BY total_quantity DESC, avg_confidence DESC;
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = public
   STABLE;

COMMENT ON TABLE public.organization_image_tags IS 'AI and user-generated tags for organization images';
COMMENT ON FUNCTION public.get_image_tags_summary IS 'Returns tag summary for a specific image';
COMMENT ON FUNCTION public.get_organization_inventory_from_images IS 'Aggregates AI-extracted inventory across all org images';

