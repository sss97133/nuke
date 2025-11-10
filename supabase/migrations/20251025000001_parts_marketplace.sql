-- =====================================================
-- PARTS MARKETPLACE SYSTEM
-- Transforms image tags into shoppable parts
-- =====================================================

-- 1. ENHANCE image_tags with part marketplace data
DO $$
BEGIN
  IF to_regclass('public.image_tags') IS NULL THEN
    RAISE NOTICE 'Skipping image_tags enhancement: table does not exist.';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'image_tags'
      AND column_name = 'oem_part_number'
  ) THEN
    EXECUTE 'ALTER TABLE public.image_tags ADD COLUMN oem_part_number TEXT';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'image_tags'
      AND column_name = 'aftermarket_part_numbers'
  ) THEN
    EXECUTE 'ALTER TABLE public.image_tags ADD COLUMN aftermarket_part_numbers TEXT[]';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'image_tags'
      AND column_name = 'part_description'
  ) THEN
    EXECUTE 'ALTER TABLE public.image_tags ADD COLUMN part_description TEXT';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'image_tags'
      AND column_name = 'fits_vehicles'
  ) THEN
    EXECUTE 'ALTER TABLE public.image_tags ADD COLUMN fits_vehicles TEXT[]';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'image_tags'
      AND column_name = 'suppliers'
  ) THEN
    EXECUTE 'ALTER TABLE public.image_tags ADD COLUMN suppliers JSONB DEFAULT ''[]''::jsonb';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'image_tags'
      AND column_name = 'lowest_price_cents'
  ) THEN
    EXECUTE 'ALTER TABLE public.image_tags ADD COLUMN lowest_price_cents INTEGER';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'image_tags'
      AND column_name = 'highest_price_cents'
  ) THEN
    EXECUTE 'ALTER TABLE public.image_tags ADD COLUMN highest_price_cents INTEGER';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'image_tags'
      AND column_name = 'price_last_updated'
  ) THEN
    EXECUTE 'ALTER TABLE public.image_tags ADD COLUMN price_last_updated TIMESTAMPTZ';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'image_tags'
      AND column_name = 'is_shoppable'
  ) THEN
    EXECUTE 'ALTER TABLE public.image_tags ADD COLUMN is_shoppable BOOLEAN DEFAULT false';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'image_tags'
      AND column_name = 'affiliate_links'
  ) THEN
    EXECUTE 'ALTER TABLE public.image_tags ADD COLUMN affiliate_links JSONB DEFAULT ''[]''::jsonb';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'image_tags'
      AND column_name = 'condition'
  ) THEN
    EXECUTE 'ALTER TABLE public.image_tags ADD COLUMN condition TEXT CHECK (condition IN (''new'', ''used'', ''remanufactured'', ''unknown''))';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'image_tags'
      AND column_name = 'warranty_info'
  ) THEN
    EXECUTE 'ALTER TABLE public.image_tags ADD COLUMN warranty_info TEXT';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'image_tags'
      AND column_name = 'install_difficulty'
  ) THEN
    EXECUTE 'ALTER TABLE public.image_tags ADD COLUMN install_difficulty TEXT CHECK (install_difficulty IN (''easy'', ''moderate'', ''hard'', ''expert''))';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'image_tags'
      AND column_name = 'estimated_install_time_minutes'
  ) THEN
    EXECUTE 'ALTER TABLE public.image_tags ADD COLUMN estimated_install_time_minutes INTEGER';
  END IF;
END
$$;

-- 2. CREATE part_suppliers table
CREATE TABLE IF NOT EXISTS part_suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_name TEXT NOT NULL UNIQUE,
  supplier_url TEXT,
  supplier_logo_url TEXT,
  api_available BOOLEAN DEFAULT false,
  api_key_encrypted TEXT,
  scrape_config JSONB DEFAULT '{}'::jsonb,
  commission_rate DECIMAL(5,2),
  shipping_methods JSONB DEFAULT '[]'::jsonb,
  return_policy TEXT,
  trust_score INTEGER DEFAULT 100,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. CREATE part_catalog table  
CREATE TABLE IF NOT EXISTS part_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  part_name TEXT NOT NULL,
  oem_part_number TEXT,
  category TEXT,
  subcategory TEXT,
  fits_makes TEXT[],
  fits_models TEXT[],
  fits_years INT4RANGE,
  description TEXT,
  install_notes TEXT,
  part_image_urls TEXT[],
  supplier_listings JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(oem_part_number)
);

-- 4. CREATE part_purchases table
CREATE TABLE IF NOT EXISTS part_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  vehicle_id UUID REFERENCES vehicles(id),
  image_tag_id UUID REFERENCES image_tags(id),
  part_catalog_id UUID REFERENCES part_catalog(id),
  supplier_id UUID REFERENCES part_suppliers(id),
  
  -- Purchase Details
  part_name TEXT NOT NULL,
  part_number TEXT,
  quantity INTEGER DEFAULT 1,
  unit_price_cents INTEGER NOT NULL,
  shipping_cents INTEGER DEFAULT 0,
  tax_cents INTEGER DEFAULT 0,
  total_cents INTEGER NOT NULL,
  
  -- Payment
  payment_method TEXT,
  payment_intent_id TEXT,
  payment_status TEXT CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded', 'cancelled')),
  
  -- Fulfillment
  order_number TEXT,
  tracking_number TEXT,
  ordered_at TIMESTAMPTZ DEFAULT NOW(),
  shipped_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  
  -- Metadata
  notes TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. CREATE part_price_history table (track price changes)
CREATE TABLE IF NOT EXISTS part_price_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  part_catalog_id UUID REFERENCES part_catalog(id),
  supplier_id UUID REFERENCES part_suppliers(id),
  price_cents INTEGER NOT NULL,
  in_stock BOOLEAN DEFAULT true,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. RLS POLICIES
DO $$
DECLARE
  has_admin_table BOOLEAN := to_regclass('public.admin_users') IS NOT NULL;
  admin_check TEXT;
BEGIN
  admin_check := CASE
    WHEN has_admin_table THEN
      '(auth.role() = ''service_role'' OR EXISTS (SELECT 1 FROM public.admin_users au WHERE au.user_id = auth.uid() AND au.is_active = TRUE AND au.admin_level IN (''admin'',''super_admin'')))'
    ELSE
      '(auth.role() = ''service_role'')'
  END;

  IF to_regclass('public.part_suppliers') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.part_suppliers ENABLE ROW LEVEL SECURITY';

    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'part_suppliers' AND policyname = 'Anyone can view suppliers'
    ) THEN
      EXECUTE 'DROP POLICY "Anyone can view suppliers" ON public.part_suppliers';
    END IF;
    EXECUTE 'CREATE POLICY "Anyone can view suppliers" ON public.part_suppliers FOR SELECT USING (true)';

    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'part_suppliers' AND policyname = 'Only admins can modify suppliers'
    ) THEN
      EXECUTE 'DROP POLICY "Only admins can modify suppliers" ON public.part_suppliers';
    END IF;
    EXECUTE format(
      'CREATE POLICY "Only admins can modify suppliers" ON public.part_suppliers FOR ALL USING (%s) WITH CHECK (%s)',
      admin_check, admin_check
    );
  ELSE
    RAISE NOTICE 'Skipping RLS for part_suppliers: table does not exist.';
  END IF;

  IF to_regclass('public.part_catalog') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.part_catalog ENABLE ROW LEVEL SECURITY';

    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'part_catalog' AND policyname = 'Anyone can view parts catalog'
    ) THEN
      EXECUTE 'DROP POLICY "Anyone can view parts catalog" ON public.part_catalog';
    END IF;
    EXECUTE 'CREATE POLICY "Anyone can view parts catalog" ON public.part_catalog FOR SELECT USING (true)';

    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'part_catalog' AND policyname = 'Authenticated users can suggest parts'
    ) THEN
      EXECUTE 'DROP POLICY "Authenticated users can suggest parts" ON public.part_catalog';
    END IF;
    EXECUTE 'CREATE POLICY "Authenticated users can suggest parts" ON public.part_catalog FOR INSERT TO authenticated WITH CHECK (true)';

    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'part_catalog' AND policyname = 'Admins can modify parts catalog'
    ) THEN
      EXECUTE 'DROP POLICY "Admins can modify parts catalog" ON public.part_catalog';
    END IF;
    EXECUTE format(
      'CREATE POLICY "Admins can modify parts catalog" ON public.part_catalog FOR UPDATE USING (%s) WITH CHECK (%s)',
      admin_check, admin_check
    );
  ELSE
    RAISE NOTICE 'Skipping RLS for part_catalog: table does not exist.';
  END IF;

  IF to_regclass('public.part_purchases') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.part_purchases ENABLE ROW LEVEL SECURITY';

    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'part_purchases' AND policyname = 'Users can view own purchases'
    ) THEN
      EXECUTE 'DROP POLICY "Users can view own purchases" ON public.part_purchases';
    END IF;
    EXECUTE 'CREATE POLICY "Users can view own purchases" ON public.part_purchases FOR SELECT USING (auth.uid() = user_id)';

    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'part_purchases' AND policyname = 'Users can create purchases'
    ) THEN
      EXECUTE 'DROP POLICY "Users can create purchases" ON public.part_purchases';
    END IF;
    EXECUTE 'CREATE POLICY "Users can create purchases" ON public.part_purchases FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id)';

    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'part_purchases' AND policyname = 'Users can update own pending purchases'
    ) THEN
      EXECUTE 'DROP POLICY "Users can update own pending purchases" ON public.part_purchases';
    END IF;
    EXECUTE 'CREATE POLICY "Users can update own pending purchases" ON public.part_purchases FOR UPDATE USING (auth.uid() = user_id AND payment_status = ''pending'') WITH CHECK (auth.uid() = user_id AND payment_status = ''pending'')';
  ELSE
    RAISE NOTICE 'Skipping RLS for part_purchases: table does not exist.';
  END IF;

  IF to_regclass('public.part_price_history') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.part_price_history ENABLE ROW LEVEL SECURITY';

    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'part_price_history' AND policyname = 'Anyone can view price history'
    ) THEN
      EXECUTE 'DROP POLICY "Anyone can view price history" ON public.part_price_history';
    END IF;
    EXECUTE 'CREATE POLICY "Anyone can view price history" ON public.part_price_history FOR SELECT USING (true)';
  ELSE
    RAISE NOTICE 'Skipping RLS for part_price_history: table does not exist.';
  END IF;
END
$$;

-- 7. SEED initial suppliers
DO $$
BEGIN
  IF to_regclass('public.part_suppliers') IS NULL THEN
    RAISE NOTICE 'Skipping initial supplier seed: part_suppliers table does not exist.';
    RETURN;
  END IF;

  INSERT INTO public.part_suppliers (supplier_name, supplier_url, commission_rate, active) VALUES
    ('LMC Truck', 'https://www.lmctruck.com', 5.00, true),
    ('RockAuto', 'https://www.rockauto.com', 3.50, true),
    ('Classic Parts', 'https://www.classicparts.com', 4.00, true),
    ('Summit Racing', 'https://www.summitracing.com', 4.50, true),
    ('Amazon', 'https://www.amazon.com', 2.00, true)
  ON CONFLICT (supplier_name) DO NOTHING;
END
$$;

-- 8. CREATE indexes for performance
CREATE INDEX IF NOT EXISTS idx_part_catalog_oem ON part_catalog(oem_part_number);
CREATE INDEX IF NOT EXISTS idx_part_catalog_category ON part_catalog(category, subcategory);
CREATE INDEX IF NOT EXISTS idx_part_purchases_user ON part_purchases(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_part_purchases_vehicle ON part_purchases(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_image_tags_shoppable ON image_tags(is_shoppable) WHERE is_shoppable = true;
CREATE INDEX IF NOT EXISTS idx_image_tags_part_number ON image_tags(oem_part_number) WHERE oem_part_number IS NOT NULL;

-- 9. CREATE function to update price statistics
CREATE OR REPLACE FUNCTION update_part_price_stats()
RETURNS TRIGGER AS $$
BEGIN
  -- Update part_catalog with latest price range
  UPDATE part_catalog
  SET
    supplier_listings = (
      SELECT jsonb_agg(listing)
      FROM jsonb_array_elements(supplier_listings) AS listing
      WHERE (listing->>'supplier')::text = NEW.supplier_id::text
        OR listing IS NULL
    ),
    updated_at = NOW()
  WHERE id = NEW.part_catalog_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = public;

DROP TRIGGER IF EXISTS update_price_stats_trigger ON part_price_history;
CREATE TRIGGER update_price_stats_trigger
  AFTER INSERT ON part_price_history
  FOR EACH ROW
  EXECUTE FUNCTION update_part_price_stats();

-- 10. CREATE view for shoppable tags with full supplier info
DO $$
BEGIN
  IF to_regclass('public.shoppable_tags_with_suppliers') IS NOT NULL THEN
    PERFORM 1
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'shoppable_tags_with_suppliers'
      AND c.relkind = 'v';

    IF FOUND THEN
      EXECUTE 'DROP VIEW public.shoppable_tags_with_suppliers';
    ELSE
      EXECUTE 'DROP TABLE IF EXISTS public.shoppable_tags_with_suppliers CASCADE';
    END IF;
  END IF;

  IF to_regclass('public.image_tags') IS NULL THEN
    RAISE NOTICE 'Skipping creation of shoppable_tags_with_suppliers view: image_tags table does not exist.';
    RETURN;
  END IF;

  EXECUTE '
CREATE VIEW public.shoppable_tags_with_suppliers AS
SELECT 
  it.*,
  pc.part_name AS catalog_part_name,
  pc.description AS catalog_description,
  pc.install_notes,
  pc.supplier_listings,
  ps.supplier_name,
  ps.supplier_url,
  ps.commission_rate
FROM public.image_tags it
LEFT JOIN public.part_catalog pc ON it.oem_part_number = pc.oem_part_number
LEFT JOIN public.part_suppliers ps ON ps.id = ANY(
  SELECT DISTINCT (listing->>''supplier_id'')::UUID 
  FROM jsonb_array_elements(pc.supplier_listings) AS listing
)
WHERE it.is_shoppable = true';

  EXECUTE 'COMMENT ON VIEW public.shoppable_tags_with_suppliers IS ''Image tags enriched with full supplier and pricing data for marketplace display''';
END
$$;

