-- Valuation Citation System: Track source of every dollar in valuation
-- Every price component must cite: WHO submitted, WHEN, relationship to vehicle, evidence type
-- Users can drill into any figure to see source data, evidence, and accuracy score
-- HARDENED: idempotent drops, SECURITY DEFINER functions, guarded FK references

-- ==========================
-- 1) VALUATION CITATIONS
-- ==========================

CREATE TABLE IF NOT EXISTS valuation_citations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  
  -- What this citation is for
  component_type TEXT NOT NULL CHECK (component_type IN (
    'purchase_price', 'msrp', 'current_value', 'asking_price',
    'part_purchase', 'part_value_estimate', 'labor_hours', 'labor_rate',
    'shop_rate', 'market_comp', 'condition_penalty', 'modification_premium',
    'ai_estimate', 'user_estimate', 'appraiser_estimate'
  )),
  component_name TEXT,  -- e.g., "Master Cylinder", "Front Disc Conversion", "Purchase Price"
  
  -- The value being cited
  value_usd NUMERIC(12,2) NOT NULL,
  value_type TEXT CHECK (value_type IN ('cost', 'price', 'rate_hourly', 'hours', 'percentage')),
  
  -- WHO submitted this value
  submitted_by UUID NOT NULL REFERENCES auth.users(id),
  submitter_role TEXT,  -- their relationship: owner, mechanic, appraiser, uploader, ai, system
  submitter_name TEXT,  -- cached for display
  
  -- WHEN
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  effective_date DATE,  -- when the transaction/value was effective (e.g., purchase date)
  
  -- EVIDENCE (linking to source documents)
  evidence_type TEXT NOT NULL CHECK (evidence_type IN (
    'receipt', 'invoice', 'title', 'image_tag', 'market_listing', 
    'appraisal_doc', 'user_input', 'ai_extraction', 'system_calculation'
  )),
  
  -- Link to source records
  source_image_tag_id UUID REFERENCES image_tags(id) ON DELETE SET NULL,
  source_document_id UUID REFERENCES vehicle_documents(id) ON DELETE SET NULL,
  source_image_id UUID REFERENCES vehicle_images(id) ON DELETE SET NULL,
  source_timeline_event_id UUID REFERENCES timeline_events(id) ON DELETE SET NULL,
  
  -- For labor: link to shop and laborer
  shop_id UUID REFERENCES shops(id) ON DELETE SET NULL,
  laborer_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  labor_category TEXT,  -- e.g., "mechanical", "body", "paint", "electrical"
  mitchell_operation_code TEXT,  -- Reference to standard labor times
  
  -- Accuracy tracking
  confidence_score INTEGER DEFAULT 50 CHECK (confidence_score >= 0 AND confidence_score <= 100),
  verification_status TEXT DEFAULT 'unverified' CHECK (verification_status IN (
    'unverified', 'user_verified', 'peer_verified', 'professional_verified', 
    'receipt_confirmed', 'disputed', 'superseded'
  )),
  verified_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  verified_at TIMESTAMPTZ,
  
  -- User input tracking
  is_user_generated BOOLEAN DEFAULT false,
  replaced_system_value BOOLEAN DEFAULT false,  -- true if user overrode AI/system
  superseded_by UUID REFERENCES valuation_citations(id) ON DELETE SET NULL,  -- if replaced by better citation
  
  -- Metadata
  notes TEXT,
  metadata JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_valuation_citations_vehicle ON valuation_citations(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_valuation_citations_submitter ON valuation_citations(submitted_by);
CREATE INDEX IF NOT EXISTS idx_valuation_citations_component ON valuation_citations(component_type, component_name);
CREATE INDEX IF NOT EXISTS idx_valuation_citations_evidence ON valuation_citations(evidence_type);
CREATE INDEX IF NOT EXISTS idx_valuation_citations_tag ON valuation_citations(source_image_tag_id) WHERE source_image_tag_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_valuation_citations_doc ON valuation_citations(source_document_id) WHERE source_document_id IS NOT NULL;

COMMENT ON TABLE valuation_citations IS 'Source attribution for every dollar in vehicle valuation';
COMMENT ON COLUMN valuation_citations.component_type IS 'What this value represents (part, labor, rate, estimate, etc.)';
COMMENT ON COLUMN valuation_citations.evidence_type IS 'How we know this value (receipt, tag, user input, AI, etc.)';
COMMENT ON COLUMN valuation_citations.submitter_role IS 'Submitter relationship: owner, mechanic, appraiser, uploader, ai, system';

-- ==========================
-- 2) USER VALUATION INPUTS (track accuracy)
-- ==========================

CREATE TABLE IF NOT EXISTS user_valuation_inputs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  citation_id UUID REFERENCES valuation_citations(id) ON DELETE SET NULL,
  
  -- What user filled in
  field_name TEXT NOT NULL,  -- "labor_hours", "shop_rate", "part_cost", etc.
  field_value TEXT NOT NULL,
  field_value_numeric NUMERIC(12,2),
  
  -- Context
  input_method TEXT CHECK (input_method IN ('manual', 'dropdown', 'slider', 'ocr_correction', 'ai_correction')),
  replaced_ai_value BOOLEAN DEFAULT false,
  original_ai_value TEXT,
  
  -- Accuracy scoring
  accuracy_score INTEGER CHECK (accuracy_score >= 0 AND accuracy_score <= 100),
  verification_count INTEGER DEFAULT 0,  -- how many users verified this value
  dispute_count INTEGER DEFAULT 0,
  consensus_value TEXT,  -- if multiple users submitted, this is the consensus
  
  -- Timestamps
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  last_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_valuation_inputs_user ON user_valuation_inputs(user_id);
CREATE INDEX IF NOT EXISTS idx_user_valuation_inputs_vehicle ON user_valuation_inputs(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_user_valuation_inputs_citation ON user_valuation_inputs(citation_id);

COMMENT ON TABLE user_valuation_inputs IS 'Track user-submitted valuation data for accuracy scoring and tier elevation';

-- ==========================
-- 3) USER VALUATION ACCURACY SCORES
-- ==========================

CREATE TABLE IF NOT EXISTS user_valuation_accuracy (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Accuracy metrics
  total_inputs INTEGER DEFAULT 0,
  verified_inputs INTEGER DEFAULT 0,
  disputed_inputs INTEGER DEFAULT 0,
  accuracy_rate NUMERIC(5,2) DEFAULT 0.00 CHECK (accuracy_rate >= 0 AND accuracy_rate <= 100),
  
  -- Tier system
  valuation_tier TEXT DEFAULT 'novice' CHECK (valuation_tier IN (
    'novice', 'contributor', 'trusted', 'expert', 'professional', 'appraiser'
  )),
  tier_achieved_at TIMESTAMPTZ,
  
  -- Specializations
  strongest_categories TEXT[] DEFAULT ARRAY[]::TEXT[],  -- e.g., ["labor_hours", "shop_rates"]
  weakest_categories TEXT[] DEFAULT ARRAY[]::TEXT[],
  
  -- Stats
  avg_confidence_score NUMERIC(5,2),
  consensus_match_rate NUMERIC(5,2),  -- % of time user's value matches community consensus
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE user_valuation_accuracy IS 'User accuracy scores and tier elevation for valuation contributions';

-- ==========================
-- 4) VALUATION BLANKS (missing data prompts)
-- ==========================

CREATE TABLE IF NOT EXISTS valuation_blanks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  
  -- What's missing
  blank_type TEXT NOT NULL CHECK (blank_type IN (
    'missing_receipt', 'unknown_labor_hours', 'unknown_shop_rate', 
    'unknown_laborer', 'untagged_part', 'missing_part_cost',
    'missing_install_date', 'unknown_shop_location', 'missing_market_comp'
  )),
  component_name TEXT,  -- e.g., "Master Cylinder install"
  
  -- Priority (how important to fill this blank)
  priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  impact_on_value_usd NUMERIC(12,2),  -- how much this affects valuation accuracy
  
  -- Context to help user fill it
  suggested_questions TEXT[],  -- e.g., ["Who installed this part?", "What was the shop rate?"]
  related_evidence UUID[],  -- image/doc IDs that might help
  
  -- Status
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'filled', 'skipped', 'not_applicable')),
  filled_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  filled_at TIMESTAMPTZ,
  filled_citation_id UUID REFERENCES valuation_citations(id) ON DELETE SET NULL,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_valuation_blanks_vehicle ON valuation_blanks(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_valuation_blanks_status ON valuation_blanks(status) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_valuation_blanks_priority ON valuation_blanks(priority) WHERE status = 'open';

COMMENT ON TABLE valuation_blanks IS 'Tracks missing valuation data and prompts users to fill blanks';

-- ==========================
-- 5) LABOR RATE SOURCES
-- ==========================

CREATE TABLE IF NOT EXISTS labor_rate_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Rate details
  hourly_rate_usd NUMERIC(8,2) NOT NULL CHECK (hourly_rate_usd > 0),
  rate_type TEXT NOT NULL CHECK (rate_type IN (
    'shop_posted_rate', 'laborer_personal_rate', 'mitchell_standard', 
    'chilton_standard', 'regional_average', 'user_reported', 'ai_estimated'
  )),
  
  -- Source
  shop_id UUID REFERENCES shops(id) ON DELETE CASCADE,
  laborer_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  region TEXT,  -- e.g., "Las Vegas, NV"
  labor_category TEXT,  -- mechanical, body, paint, electrical, etc.
  
  -- Evidence
  source_document_id UUID REFERENCES vehicle_documents(id) ON DELETE SET NULL,
  source_url TEXT,  -- link to shop website, Mitchell online, etc.
  
  -- Verification
  verified BOOLEAN DEFAULT false,
  verified_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  verification_count INTEGER DEFAULT 0,
  
  -- Timestamps
  effective_date DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_labor_rate_sources_shop ON labor_rate_sources(shop_id);
CREATE INDEX IF NOT EXISTS idx_labor_rate_sources_laborer ON labor_rate_sources(laborer_user_id);
CREATE INDEX IF NOT EXISTS idx_labor_rate_sources_region ON labor_rate_sources(region);

COMMENT ON TABLE labor_rate_sources IS 'Tracks where labor rates come from: shop, laborer, Mitchell, regional avg, etc.';

-- ==========================
-- 6) RLS POLICIES
-- ==========================

ALTER TABLE valuation_citations ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_valuation_inputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_valuation_accuracy ENABLE ROW LEVEL SECURITY;
ALTER TABLE valuation_blanks ENABLE ROW LEVEL SECURITY;
ALTER TABLE labor_rate_sources ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- Anyone can view citations (transparency)
  DROP POLICY IF EXISTS "Anyone views valuation citations" ON valuation_citations;
  CREATE POLICY "Anyone views valuation citations" ON valuation_citations
    FOR SELECT USING (true);

  -- Users can submit citations for vehicles they have access to
  DROP POLICY IF EXISTS "Users submit citations" ON valuation_citations;
  CREATE POLICY "Users submit citations" ON valuation_citations
  FOR INSERT
  WITH CHECK (
    auth.uid() = submitted_by AND (
      EXISTS (SELECT 1 FROM vehicles v WHERE v.id = vehicle_id AND v.user_id = auth.uid()) OR
      EXISTS (SELECT 1 FROM vehicle_contributors vc WHERE vc.vehicle_id = valuation_citations.vehicle_id AND vc.user_id = auth.uid())
    )
  );

  -- Users can update their own citations
  DROP POLICY IF EXISTS "Users update own citations" ON valuation_citations;
  CREATE POLICY "Users update own citations" ON valuation_citations
    FOR UPDATE
    USING (auth.uid() = submitted_by);

  -- User valuation inputs
  DROP POLICY IF EXISTS "Users view own inputs" ON user_valuation_inputs;
  CREATE POLICY "Users view own inputs" ON user_valuation_inputs
    FOR SELECT USING (user_id = auth.uid());

  DROP POLICY IF EXISTS "Users insert own inputs" ON user_valuation_inputs;
  CREATE POLICY "Users insert own inputs" ON user_valuation_inputs
    FOR INSERT WITH CHECK (user_id = auth.uid());

  -- User accuracy scores (public read)
  DROP POLICY IF EXISTS "Anyone views user accuracy" ON user_valuation_accuracy;
  CREATE POLICY "Anyone views user accuracy" ON user_valuation_accuracy
    FOR SELECT USING (true);

  -- Valuation blanks (anyone can see, contributors can fill)
  DROP POLICY IF EXISTS "Anyone views blanks" ON valuation_blanks;
  CREATE POLICY "Anyone views blanks" ON valuation_blanks
    FOR SELECT USING (true);

  DROP POLICY IF EXISTS "Contributors fill blanks" ON valuation_blanks;
  CREATE POLICY "Contributors fill blanks" ON valuation_blanks
  FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM vehicles v WHERE v.id = vehicle_id AND v.user_id = auth.uid()) OR
    EXISTS (SELECT 1 FROM vehicle_contributors vc WHERE vc.vehicle_id = valuation_blanks.vehicle_id AND vc.user_id = auth.uid())
  );

  -- Labor rate sources (anyone views, verified contributors submit)
  DROP POLICY IF EXISTS "Anyone views labor rates" ON labor_rate_sources;
  CREATE POLICY "Anyone views labor rates" ON labor_rate_sources
    FOR SELECT USING (true);

  DROP POLICY IF EXISTS "Users submit labor rates" ON labor_rate_sources;
  CREATE POLICY "Users submit labor rates" ON labor_rate_sources
    FOR INSERT
    WITH CHECK (
      auth.uid() = laborer_user_id OR
      EXISTS (SELECT 1 FROM shops s WHERE s.id = shop_id AND s.owner_user_id = auth.uid()) OR
      EXISTS (SELECT 1 FROM shop_members sm WHERE sm.shop_id = labor_rate_sources.shop_id AND sm.user_id = auth.uid() AND sm.role IN ('owner', 'admin'))
    );
END $$;

-- ==========================
-- 7) LINK IMAGE TAGS TO RECEIPTS
-- ==========================

-- Add receipt linking to image_tags (guarded in case table doesn't exist yet)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'image_tags') THEN
    ALTER TABLE image_tags
      ADD COLUMN IF NOT EXISTS receipt_line_item_id UUID,
      ADD COLUMN IF NOT EXISTS labor_record_id UUID,
      ADD COLUMN IF NOT EXISTS part_installed_by UUID,
      ADD COLUMN IF NOT EXISTS install_shop_id UUID,
      ADD COLUMN IF NOT EXISTS install_labor_hours NUMERIC(6,2),
      ADD COLUMN IF NOT EXISTS install_labor_rate NUMERIC(8,2);
    
    -- Add FK constraints if target tables exist
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'receipt_items') THEN
      IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'image_tags_receipt_line_item_id_fkey') THEN
        ALTER TABLE image_tags ADD CONSTRAINT image_tags_receipt_line_item_id_fkey FOREIGN KEY (receipt_line_item_id) REFERENCES receipt_items(id) ON DELETE SET NULL;
      END IF;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'image_tags_part_installed_by_fkey') THEN
      ALTER TABLE image_tags ADD CONSTRAINT image_tags_part_installed_by_fkey FOREIGN KEY (part_installed_by) REFERENCES auth.users(id) ON DELETE SET NULL;
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'shops') THEN
      IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'image_tags_install_shop_id_fkey') THEN
        ALTER TABLE image_tags ADD CONSTRAINT image_tags_install_shop_id_fkey FOREIGN KEY (install_shop_id) REFERENCES shops(id) ON DELETE SET NULL;
      END IF;
    END IF;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_image_tags_receipt_item ON image_tags(receipt_line_item_id) WHERE receipt_line_item_id IS NOT NULL;

COMMENT ON COLUMN image_tags.receipt_line_item_id IS 'Links tag to receipt proving part purchase/cost';
COMMENT ON COLUMN image_tags.part_installed_by IS 'User who installed this part (for labor tracking)';
COMMENT ON COLUMN image_tags.install_shop_id IS 'Shop where install happened (for rate sourcing)';
COMMENT ON COLUMN image_tags.install_labor_hours IS 'Actual labor hours for install (user-reported or calculated)';
COMMENT ON COLUMN image_tags.install_labor_rate IS 'Labor rate used for this install ($/hr)';

-- ==========================
-- 8) TRIGGER: Auto-create citations from receipts
-- ==========================

DROP FUNCTION IF EXISTS create_citation_from_receipt() CASCADE;
CREATE OR REPLACE FUNCTION create_citation_from_receipt()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  -- When receipt is created, auto-generate citations for purchase price
  IF NEW.amount IS NOT NULL AND NEW.amount > 0 THEN
    INSERT INTO valuation_citations (
      vehicle_id,
      component_type,
      component_name,
      value_usd,
      value_type,
      submitted_by,
      submitter_role,
      submitter_name,
      submitted_at,
      effective_date,
      evidence_type,
      source_document_id,
      confidence_score,
      verification_status,
      metadata
    )
    VALUES (
      NEW.vehicle_id,
      'part_purchase',
      COALESCE(NEW.title, NEW.vendor_name || ' purchase'),
      NEW.amount,
      'cost',
      NEW.uploaded_by,
      'uploader',
      (SELECT full_name FROM profiles WHERE id = NEW.uploaded_by),
      NEW.created_at,
      NEW.document_date,
      'receipt',
      NEW.id,
      85,  -- high confidence for receipts
      'receipt_confirmed',
      jsonb_build_object(
        'vendor', NEW.vendor_name,
        'document_type', NEW.document_type
      )
    )
    ON CONFLICT DO NOTHING;  -- prevent duplicates
  END IF;
  
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'vehicle_documents') THEN
    DROP TRIGGER IF EXISTS trg_create_citation_from_receipt ON vehicle_documents;
    CREATE TRIGGER trg_create_citation_from_receipt
      AFTER INSERT ON vehicle_documents
      FOR EACH ROW
      WHEN (NEW.amount IS NOT NULL AND NEW.vehicle_id IS NOT NULL)
      EXECUTE FUNCTION create_citation_from_receipt();
  END IF;
END $$;

-- ==========================
-- 9) TRIGGER: Auto-create citations from AI component detections
-- ==========================

DROP FUNCTION IF EXISTS create_citation_from_ai_component() CASCADE;
CREATE OR REPLACE FUNCTION create_citation_from_ai_component()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  -- When AI detects a component with estimated cost, create citation
  IF NEW.component_name IS NOT NULL THEN
    INSERT INTO valuation_citations (
      vehicle_id,
      component_type,
      component_name,
      value_usd,
      value_type,
      submitted_by,
      submitter_role,
      submitted_at,
      evidence_type,
      source_image_id,
      confidence_score,
      verification_status,
      metadata
    )
    SELECT
      vi.vehicle_id,
      'ai_estimate',
      NEW.component_name,
      COALESCE(NEW.estimated_cost_cents / 100.0, 0),
      'price',
      vi.user_id,
      'ai',
      NEW.created_at,
      'ai_extraction',
      vi.id,
      LEAST(100, GREATEST(0, (NEW.confidence * 100)::INTEGER)),
      'unverified',
      jsonb_build_object(
        'ai_model', NEW.ai_model,
        'quadrant', NEW.quadrant,
        'reasoning', NEW.ai_reasoning
      )
    FROM vehicle_images vi
    WHERE vi.id = NEW.vehicle_image_id
    ON CONFLICT DO NOTHING;
  END IF;
  
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ai_component_detections') THEN
    DROP TRIGGER IF EXISTS trg_create_citation_from_ai ON ai_component_detections;
    CREATE TRIGGER trg_create_citation_from_ai
      AFTER INSERT ON ai_component_detections
      FOR EACH ROW
      WHEN (NEW.component_name IS NOT NULL AND NEW.vehicle_image_id IS NOT NULL)
      EXECUTE FUNCTION create_citation_from_ai_component();
  END IF;
END $$;

-- ==========================
-- 10) TRIGGER: Update user accuracy when citation is verified
-- ==========================

DROP FUNCTION IF EXISTS update_user_valuation_accuracy() CASCADE;
CREATE OR REPLACE FUNCTION update_user_valuation_accuracy()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  user_rec RECORD;
BEGIN
  -- Only process when verification status changes to verified or disputed
  IF NEW.verification_status IN ('user_verified', 'peer_verified', 'professional_verified', 'receipt_confirmed') AND
     OLD.verification_status NOT IN ('user_verified', 'peer_verified', 'professional_verified', 'receipt_confirmed') THEN
    
    -- Update user's accuracy record
    INSERT INTO user_valuation_accuracy (user_id)
    VALUES (NEW.submitted_by)
    ON CONFLICT (user_id) DO NOTHING;
    
    UPDATE user_valuation_accuracy
    SET
      total_inputs = (
        SELECT COUNT(*) FROM valuation_citations
        WHERE submitted_by = NEW.submitted_by AND is_user_generated = true
      ),
      verified_inputs = (
        SELECT COUNT(*) FROM valuation_citations
        WHERE submitted_by = NEW.submitted_by 
          AND is_user_generated = true
          AND verification_status IN ('user_verified', 'peer_verified', 'professional_verified', 'receipt_confirmed')
      ),
      disputed_inputs = (
        SELECT COUNT(*) FROM valuation_citations
        WHERE submitted_by = NEW.submitted_by
          AND is_user_generated = true
          AND verification_status = 'disputed'
      ),
      updated_at = NOW()
    WHERE user_id = NEW.submitted_by;
    
    -- Recalculate accuracy rate
    UPDATE user_valuation_accuracy
    SET
      accuracy_rate = CASE
        WHEN total_inputs > 0 THEN (verified_inputs::NUMERIC / total_inputs) * 100
        ELSE 0
      END
    WHERE user_id = NEW.submitted_by;
    
    -- Auto-elevate tier if thresholds met
    SELECT * INTO user_rec FROM user_valuation_accuracy WHERE user_id = NEW.submitted_by;
    
    IF user_rec.accuracy_rate >= 90 AND user_rec.verified_inputs >= 100 THEN
      UPDATE user_valuation_accuracy SET valuation_tier = 'appraiser', tier_achieved_at = NOW() WHERE user_id = NEW.submitted_by;
    ELSIF user_rec.accuracy_rate >= 85 AND user_rec.verified_inputs >= 50 THEN
      UPDATE user_valuation_accuracy SET valuation_tier = 'professional', tier_achieved_at = NOW() WHERE user_id = NEW.submitted_by;
    ELSIF user_rec.accuracy_rate >= 75 AND user_rec.verified_inputs >= 25 THEN
      UPDATE user_valuation_accuracy SET valuation_tier = 'expert', tier_achieved_at = NOW() WHERE user_id = NEW.submitted_by;
    ELSIF user_rec.accuracy_rate >= 60 AND user_rec.verified_inputs >= 10 THEN
      UPDATE user_valuation_accuracy SET valuation_tier = 'trusted', tier_achieved_at = NOW() WHERE user_id = NEW.submitted_by;
    ELSIF user_rec.verified_inputs >= 3 THEN
      UPDATE user_valuation_accuracy SET valuation_tier = 'contributor', tier_achieved_at = NOW() WHERE user_id = NEW.submitted_by;
    END IF;
    
  END IF;
  
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  DROP TRIGGER IF EXISTS trg_update_user_accuracy ON valuation_citations;
  CREATE TRIGGER trg_update_user_accuracy
    AFTER UPDATE OF verification_status ON valuation_citations
    FOR EACH ROW
    EXECUTE FUNCTION update_user_valuation_accuracy();
END $$;

-- ==========================
-- 11) FUNCTION: Generate valuation blanks for vehicle
-- ==========================

DROP FUNCTION IF EXISTS generate_valuation_blanks(UUID) CASCADE;
CREATE OR REPLACE FUNCTION generate_valuation_blanks(p_vehicle_id UUID)
RETURNS TABLE(blank_id UUID, blank_type TEXT, component_name TEXT, impact_usd NUMERIC)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  -- Find untagged parts in images
  INSERT INTO valuation_blanks (vehicle_id, blank_type, component_name, priority, suggested_questions, related_evidence)
  SELECT
    vi.vehicle_id,
    'untagged_part',
    'Visible component',
    'medium',
    ARRAY['What part is visible in this image?', 'Is this an OEM or aftermarket part?', 'Do you have a receipt for this part?'],
    ARRAY[vi.id]
  FROM vehicle_images vi
  LEFT JOIN image_tags it ON it.image_id = vi.id
  WHERE vi.vehicle_id = p_vehicle_id
    AND it.id IS NULL
    AND vi.category IN ('engine', 'suspension', 'brakes', 'interior', 'exterior')
  GROUP BY vi.id, vi.vehicle_id
  LIMIT 20
  ON CONFLICT DO NOTHING;
  
  -- Find tags without receipt links
  INSERT INTO valuation_blanks (vehicle_id, blank_type, component_name, priority, suggested_questions, related_evidence)
  SELECT
    it.vehicle_id,
    'missing_receipt',
    it.tag_name || ' (receipt needed)',
    'high',
    ARRAY['Upload receipt showing purchase of this part', 'What was the part cost?', 'Where was it purchased?'],
    ARRAY[it.image_id]
  FROM image_tags it
  WHERE it.vehicle_id = p_vehicle_id
    AND it.receipt_line_item_id IS NULL
    AND it.tag_type = 'part'
    AND it.estimated_cost_cents > 5000  -- only for parts >$50
  LIMIT 10
  ON CONFLICT DO NOTHING;
  
  -- Find tags with parts but no install labor data
  INSERT INTO valuation_blanks (vehicle_id, blank_type, component_name, priority, suggested_questions, related_evidence)
  SELECT
    it.vehicle_id,
    'unknown_labor_hours',
    it.tag_name || ' (install labor unknown)',
    'medium',
    ARRAY['Who installed this part?', 'How many hours did the install take?', 'What was the labor rate?'],
    ARRAY[it.image_id]
  FROM image_tags it
  WHERE it.vehicle_id = p_vehicle_id
    AND it.install_labor_hours IS NULL
    AND it.tag_type = 'part'
    AND it.estimated_cost_cents > 10000  -- only for parts >$100
  LIMIT 10
  ON CONFLICT DO NOTHING;
  
  -- Return all open blanks
  RETURN QUERY
  SELECT vb.id, vb.blank_type, vb.component_name, vb.impact_on_value_usd
  FROM valuation_blanks vb
  WHERE vb.vehicle_id = p_vehicle_id AND vb.status = 'open'
  ORDER BY
    CASE vb.priority
      WHEN 'critical' THEN 1
      WHEN 'high' THEN 2
      WHEN 'medium' THEN 3
      ELSE 4
    END,
    vb.created_at DESC;
END;
$$;

COMMENT ON FUNCTION generate_valuation_blanks IS 'Creates fillable blanks for missing valuation data (receipts, labor, tags)';

