-- =====================================================
-- ROI COST TRACKING IMPLEMENTATION
-- =====================================================
-- 1. Extract existing receipts -> spend_attributions
-- 2. Auto-track future costs (listing fees, photography, etc.)
-- 3. Categorize receipts intelligently
--
-- Date: 2026-01-15

BEGIN;

-- ==========================
-- 1) EXTRACT EXISTING RECEIPTS -> SPEND_ATTRIBUTIONS
-- ==========================

-- Function to intelligently categorize receipts
CREATE OR REPLACE FUNCTION categorize_receipt_spend(
  p_vendor_name TEXT,
  p_description TEXT,
  p_category TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_vendor_lower TEXT;
  v_desc_lower TEXT;
BEGIN
  v_vendor_lower := LOWER(COALESCE(p_vendor_name, ''));
  v_desc_lower := LOWER(COALESCE(p_description, ''));

  -- Use explicit category if provided
  IF p_category IS NOT NULL THEN
    CASE p_category
      WHEN 'part' THEN RETURN 'parts';
      WHEN 'labor' THEN RETURN 'labor';
      WHEN 'tax' THEN RETURN 'tax';
      WHEN 'fee' THEN RETURN 'fee';
      ELSE RETURN 'other';
    END CASE;
  END IF;

  -- Auto-detect from vendor name
  IF v_vendor_lower LIKE '%parts%' OR v_vendor_lower LIKE '%auto parts%' OR 
     v_vendor_lower LIKE '%napa%' OR v_vendor_lower LIKE '%oreilly%' OR
     v_vendor_lower LIKE '%autozone%' OR v_vendor_lower LIKE '%advance%' THEN
    RETURN 'parts';
  END IF;

  IF v_vendor_lower LIKE '%shop%' OR v_vendor_lower LIKE '%garage%' OR
     v_vendor_lower LIKE '%mechanic%' OR v_vendor_lower LIKE '%service%' OR
     v_vendor_lower LIKE '%repair%' THEN
    RETURN 'labor';
  END IF;

  IF v_vendor_lower LIKE '%shipping%' OR v_vendor_lower LIKE '%ups%' OR
     v_vendor_lower LIKE '%fedex%' OR v_vendor_lower LIKE '%usps%' THEN
    RETURN 'shipping';
  END IF;

  IF v_vendor_lower LIKE '%storage%' OR v_vendor_lower LIKE '%warehouse%' THEN
    RETURN 'overhead';
  END IF;

  IF v_vendor_lower LIKE '%photography%' OR v_vendor_lower LIKE '%photo%' OR
     v_vendor_lower LIKE '%photographer%' THEN
    RETURN 'fee';
  END IF;

  IF v_vendor_lower LIKE '%auction%' OR v_vendor_lower LIKE '%listing%' OR
     v_vendor_lower LIKE '%bringatrailer%' OR v_vendor_lower LIKE '%carsandbids%' THEN
    RETURN 'fee';
  END IF;

  -- Auto-detect from description
  IF v_desc_lower LIKE '%part%' OR v_desc_lower LIKE '%gasket%' OR
     v_desc_lower LIKE '%filter%' OR v_desc_lower LIKE '%brake%' OR
     v_desc_lower LIKE '%tire%' OR v_desc_lower LIKE '%battery%' THEN
    RETURN 'parts';
  END IF;

  IF v_desc_lower LIKE '%labor%' OR v_desc_lower LIKE '%hour%' OR
     v_desc_lower LIKE '%service%' OR v_desc_lower LIKE '%repair%' THEN
    RETURN 'labor';
  END IF;

  IF v_desc_lower LIKE '%tax%' OR v_desc_lower LIKE '%sales tax%' THEN
    RETURN 'tax';
  END IF;

  IF v_desc_lower LIKE '%shipping%' OR v_desc_lower LIKE '%freight%' THEN
    RETURN 'shipping';
  END IF;

  -- Default
  RETURN 'other';
END;
$$;

COMMENT ON FUNCTION categorize_receipt_spend IS 'Intelligently categorizes receipts into spend categories based on vendor name and description.';

-- Extract receipts for vehicles -> spend_attributions
-- Only creates attributions for receipts that don't already have one
INSERT INTO public.spend_attributions (
  vehicle_id,
  receipt_id,
  direction,
  amount_cents,
  currency,
  spend_category,
  notes,
  metadata,
  created_by
)
SELECT
  r.scope_id AS vehicle_id,
  r.id AS receipt_id,
  'outflow' AS direction,
  FLOOR(COALESCE(r.total, 0) * 100)::BIGINT AS amount_cents,
  COALESCE(r.currency, 'USD') AS currency,
  categorize_receipt_spend(
    r.vendor_name,
    NULL, -- description not in receipts table
    NULL  -- category not in receipts table
  ) AS spend_category,
  CASE
    WHEN r.vendor_name IS NOT NULL THEN 'Extracted from receipt: ' || r.vendor_name
    ELSE 'Extracted from receipt'
  END AS notes,
  jsonb_build_object(
    'source', 'receipt_extraction',
    'receipt_date', r.receipt_date,
    'vendor_name', r.vendor_name,
    'extracted_at', NOW()
  ) AS metadata,
  r.created_by
FROM public.receipts r
WHERE r.scope_type = 'vehicle'
  AND r.scope_id IS NOT NULL
  AND COALESCE(r.total, 0) > 0
  AND r.status = 'processed'
  -- Only extract receipts that don't already have a spend_attribution
  AND NOT EXISTS (
    SELECT 1 FROM public.spend_attributions sa
    WHERE sa.receipt_id = r.id
  )
  -- Only for vehicles that exist
  AND EXISTS (
    SELECT 1 FROM public.vehicles v
    WHERE v.id = r.scope_id
  )
ON CONFLICT DO NOTHING;

-- Also extract from receipt_items if they have vehicle_id
-- (Some receipt_items might be more granular)
INSERT INTO public.spend_attributions (
  vehicle_id,
  receipt_item_id,
  receipt_id,
  direction,
  amount_cents,
  currency,
  spend_category,
  notes,
  metadata,
  created_by
)
SELECT
  ri.vehicle_id,
  ri.id AS receipt_item_id,
  ri.receipt_id,
  'outflow' AS direction,
  FLOOR(COALESCE(ri.total_price, 0) * 100)::BIGINT AS amount_cents,
  COALESCE(r.currency, 'USD') AS currency,
  categorize_receipt_spend(
    r.vendor_name,
    ri.description,
    ri.category
  ) AS spend_category,
  CASE
    WHEN ri.description IS NOT NULL THEN 'Extracted from receipt item: ' || ri.description
    ELSE 'Extracted from receipt item'
  END AS notes,
  jsonb_build_object(
    'source', 'receipt_item_extraction',
    'receipt_date', r.receipt_date,
    'vendor_name', r.vendor_name,
    'description', ri.description,
    'extracted_at', NOW()
  ) AS metadata,
  r.created_by
FROM public.receipt_items ri
JOIN public.receipts r ON r.id = ri.receipt_id
WHERE ri.vehicle_id IS NOT NULL
  AND COALESCE(ri.total_price, 0) > 0
  -- Only extract items that don't already have a spend_attribution
  AND NOT EXISTS (
    SELECT 1 FROM public.spend_attributions sa
    WHERE sa.receipt_item_id = ri.id
  )
  -- Only for vehicles that exist
  AND EXISTS (
    SELECT 1 FROM public.vehicles v
    WHERE v.id = ri.vehicle_id
  )
ON CONFLICT DO NOTHING;

-- ==========================
-- 2) AUTO-TRACK LISTING FEES
-- ==========================

CREATE OR REPLACE FUNCTION auto_attribute_listing_fee()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_fee_cents BIGINT;
  v_platform TEXT;
BEGIN
  -- Only track when listing is created (not updated)
  IF TG_OP = 'INSERT' AND NEW.sale_type IN ('auction', 'live_auction') THEN
    -- Determine fee based on platform (if external) or default
    v_platform := LOWER(COALESCE((NEW.metadata->>'platform')::TEXT, ''));
    
    -- Platform-specific fees (in cents)
    IF v_platform LIKE '%bringatrailer%' OR v_platform = 'bat' THEN
      v_fee_cents := 9900; -- $99 BaT listing fee
    ELSIF v_platform LIKE '%carsandbids%' OR v_platform = 'cars_and_bids' THEN
      v_fee_cents := 9900; -- $99 Cars & Bids listing fee
    ELSE
      v_fee_cents := 5000; -- $50 default for native listings
    END IF;

    INSERT INTO public.spend_attributions (
      vehicle_id,
      direction,
      amount_cents,
      spend_category,
      metadata,
      created_by
    ) VALUES (
      NEW.vehicle_id,
      'outflow',
      v_fee_cents,
      'fee',
      jsonb_build_object(
        'fee_type', 'listing',
        'listing_id', NEW.id,
        'sale_type', NEW.sale_type,
        'platform', v_platform,
        'auto_created', true
      ),
      NEW.seller_id
    );
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION auto_attribute_listing_fee IS 'Automatically creates spend attribution for auction listing fees when a listing is created.';

-- Create trigger (idempotent)
DROP TRIGGER IF EXISTS trigger_auto_attribute_listing_fee ON public.vehicle_listings;
CREATE TRIGGER trigger_auto_attribute_listing_fee
  AFTER INSERT ON public.vehicle_listings
  FOR EACH ROW
  WHEN (NEW.sale_type IN ('auction', 'live_auction'))
  EXECUTE FUNCTION auto_attribute_listing_fee();

-- ==========================
-- 3) AUTO-TRACK PHOTOGRAPHY COSTS
-- ==========================

CREATE OR REPLACE FUNCTION auto_attribute_photography_cost()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_cost_per_image_cents BIGINT := 500; -- $5 per image default
  v_total_images INTEGER;
BEGIN
  -- Only track when images are uploaded in bulk (batch)
  -- This is a simplified version - in practice, you might want to track per-image
  -- or only for professional photography sessions
  
  -- For now, we'll track a flat fee per vehicle when first images are uploaded
  -- You can enhance this to track actual photography costs from receipts
  
  -- Count total images for this vehicle
  SELECT COUNT(*) INTO v_total_images
  FROM public.vehicle_images
  WHERE vehicle_id = NEW.vehicle_id;

  -- Only attribute photography cost once (when vehicle has 5+ images, suggesting professional shoot)
  IF v_total_images >= 5 AND NOT EXISTS (
    SELECT 1 FROM public.spend_attributions sa
    WHERE sa.vehicle_id = NEW.vehicle_id
      AND sa.metadata->>'fee_type' = 'photography'
  ) THEN
    INSERT INTO public.spend_attributions (
      vehicle_id,
      direction,
      amount_cents,
      spend_category,
      metadata,
      created_by
    ) VALUES (
      NEW.vehicle_id,
      'outflow',
      v_cost_per_image_cents * v_total_images,
      'fee',
      jsonb_build_object(
        'fee_type', 'photography',
        'image_count', v_total_images,
        'auto_created', true,
        'note', 'Estimated photography cost based on image count'
      ),
      NEW.user_id
    );
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION auto_attribute_photography_cost IS 'Automatically estimates photography costs when vehicle has 5+ images (suggesting professional shoot).';

-- Create trigger (idempotent)
DROP TRIGGER IF EXISTS trigger_auto_attribute_photography_cost ON public.vehicle_images;
CREATE TRIGGER trigger_auto_attribute_photography_cost
  AFTER INSERT ON public.vehicle_images
  FOR EACH ROW
  EXECUTE FUNCTION auto_attribute_photography_cost();

-- ==========================
-- 4) AUTO-TRACK CONSIGNMENT FEES
-- ==========================

CREATE OR REPLACE FUNCTION auto_attribute_consignment_fee()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_fee_rate NUMERIC := 0.05; -- 5% default consignment fee
  v_vehicle_value NUMERIC;
  v_fee_cents BIGINT;
BEGIN
  -- Only track when consignment relationship is created
  IF TG_OP = 'INSERT' AND NEW.relationship_type = 'consigner' THEN
    -- Get vehicle value (current_value or asking_price)
    SELECT COALESCE(v.current_value, v.asking_price, 0)
    INTO v_vehicle_value
    FROM public.vehicles v
    WHERE v.id = NEW.vehicle_id;

    -- Only attribute if vehicle has a value
    IF v_vehicle_value > 0 THEN
      v_fee_cents := FLOOR(v_vehicle_value * v_fee_rate * 100)::BIGINT;

      -- Only create if one doesn't exist for this vehicle/org combo
      IF NOT EXISTS (
        SELECT 1 FROM public.spend_attributions sa
        WHERE sa.vehicle_id = NEW.vehicle_id
          AND sa.metadata->>'fee_type' = 'consignment'
          AND sa.metadata->>'organization_id' = NEW.organization_id::TEXT
      ) THEN
        INSERT INTO public.spend_attributions (
          vehicle_id,
          direction,
          amount_cents,
          spend_category,
          metadata,
          created_by
        ) VALUES (
          NEW.vehicle_id,
          'outflow',
          v_fee_cents,
          'fee',
          jsonb_build_object(
            'fee_type', 'consignment',
            'organization_id', NEW.organization_id,
            'fee_rate', v_fee_rate,
            'vehicle_value', v_vehicle_value,
            'auto_created', true,
            'note', 'Estimated consignment fee (5% of vehicle value)'
          ),
          (SELECT user_id FROM public.vehicles WHERE id = NEW.vehicle_id)
        );
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION auto_attribute_consignment_fee IS 'Automatically creates spend attribution for consignment fees when consignment relationship is established.';

-- Check if vehicle_organization_relationships table exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'vehicle_organization_relationships'
  ) THEN
    DROP TRIGGER IF EXISTS trigger_auto_attribute_consignment_fee ON public.vehicle_organization_relationships;
    CREATE TRIGGER trigger_auto_attribute_consignment_fee
      AFTER INSERT ON public.vehicle_organization_relationships
      FOR EACH ROW
      WHEN (NEW.relationship_type = 'consigner')
      EXECUTE FUNCTION auto_attribute_consignment_fee();
  END IF;
END $$;

-- ==========================
-- 5) LINK GPT USAGE TO VEHICLES (Platform Costs)
-- ==========================

-- Function to link existing GPT usage to vehicles via images
CREATE OR REPLACE FUNCTION link_gpt_usage_to_vehicles()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_linked_count INTEGER := 0;
BEGIN
  -- Link GPT usage from image analysis to vehicles
  INSERT INTO public.spend_attributions (
    vehicle_id,
    direction,
    amount_cents,
    spend_category,
    metadata,
    created_by
  )
  SELECT DISTINCT
    vi.vehicle_id,
    'outflow' AS direction,
    FLOOR(COALESCE(gul.cost_usd, 0) * 100)::BIGINT AS amount_cents,
    'overhead' AS spend_category,
    jsonb_build_object(
      'fee_type', 'platform_ai',
      'source', 'gpt_usage_logs',
      'usage_log_id', gul.id,
      'model', gul.model,
      'tokens_used', gul.tokens_used,
      'extracted_at', NOW()
    ) AS metadata,
    vi.user_id AS created_by
  FROM public.gpt_usage_logs gul
  JOIN public.vehicle_images vi ON vi.id::TEXT = gul.metadata->>'image_id'
  WHERE gul.metadata->>'image_id' IS NOT NULL
    AND vi.vehicle_id IS NOT NULL
    AND COALESCE(gul.cost_usd, 0) > 0
    -- Only link if not already attributed
    AND NOT EXISTS (
      SELECT 1 FROM public.spend_attributions sa
      WHERE sa.metadata->>'usage_log_id' = gul.id::TEXT
    )
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_linked_count = ROW_COUNT;
  RETURN v_linked_count;
END;
$$;

COMMENT ON FUNCTION link_gpt_usage_to_vehicles IS 'Links existing GPT usage logs to vehicle spend attributions for platform/AI costs.';

-- ==========================
-- 6) SUMMARY REPORT FUNCTION
-- ==========================

CREATE OR REPLACE FUNCTION get_receipt_extraction_summary()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'total_receipts', (
      SELECT COUNT(*) FROM public.receipts
      WHERE scope_type = 'vehicle' AND COALESCE(total, 0) > 0
    ),
    'extracted_receipts', (
      SELECT COUNT(DISTINCT receipt_id) FROM public.spend_attributions
      WHERE receipt_id IS NOT NULL
    ),
    'extracted_receipt_items', (
      SELECT COUNT(DISTINCT receipt_item_id) FROM public.spend_attributions
      WHERE receipt_item_id IS NOT NULL
    ),
    'total_attributed_spend_cents', (
      SELECT COALESCE(SUM(amount_cents), 0) FROM public.spend_attributions
      WHERE direction = 'outflow'
    ),
    'by_category', (
      SELECT jsonb_object_agg(spend_category, total_cents)
      FROM (
        SELECT spend_category, SUM(amount_cents) AS total_cents
        FROM public.spend_attributions
        WHERE direction = 'outflow'
        GROUP BY spend_category
      ) cats
    ),
    'auto_tracked_costs', (
      SELECT jsonb_build_object(
        'listing_fees', COUNT(*) FILTER (WHERE metadata->>'fee_type' = 'listing'),
        'photography', COUNT(*) FILTER (WHERE metadata->>'fee_type' = 'photography'),
        'consignment', COUNT(*) FILTER (WHERE metadata->>'fee_type' = 'consignment'),
        'platform_ai', COUNT(*) FILTER (WHERE metadata->>'fee_type' = 'platform_ai')
      )
      FROM public.spend_attributions
      WHERE metadata->>'auto_created' = 'true'
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION get_receipt_extraction_summary IS 'Returns summary of receipt extraction and cost tracking status.';

GRANT EXECUTE ON FUNCTION get_receipt_extraction_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION link_gpt_usage_to_vehicles() TO authenticated;

COMMIT;
