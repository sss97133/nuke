-- ============================================
-- FORENSIC DATA ASSIGNMENT SYSTEM
-- ============================================
-- Expert-level system for handling ambiguous, conflicting, and sloppy data
-- Uses multi-signal analysis, evidence hierarchy, and consensus building

-- ============================================
-- 1. DATA SOURCE TRUST HIERARCHY
-- ============================================

CREATE TABLE IF NOT EXISTS data_source_trust_hierarchy (
  source_type TEXT PRIMARY KEY,
  trust_level INTEGER NOT NULL CHECK (trust_level >= 0 AND trust_level <= 100),
  override_rules TEXT[],
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO data_source_trust_hierarchy (source_type, trust_level, override_rules, description) VALUES
  -- Immutable/Authoritative
  ('vin_checksum_valid', 100, ARRAY['overrides_all_except_modifications'], 'VIN with valid checksum - absolute truth for factory specs'),
  ('nhtsa_vin_decode', 100, ARRAY['factory_specs_only'], 'NHTSA VIN decode - authoritative factory data'),
  ('gm_heritage_center', 95, ARRAY['rpo_codes', 'paint_codes', 'production_data'], 'GM Heritage Center - factory documentation'),
  ('factory_service_manual', 95, ARRAY['specifications', 'procedures'], 'Factory service manual - official specs'),
  ('spid_sheet', 90, ARRAY['build_date', 'plant_code', 'options'], 'Service Parts Identification sticker - build sheet'),
  
  -- High confidence
  ('auction_result_bat', 85, ARRAY['sale_price', 'sale_date', 'description'], 'BaT auction result - verified sale data'),
  ('title_document_ocr', 85, ARRAY['owner_name', 'registration_date'], 'Title document OCR - legal document'),
  ('receipts_validated', 80, ARRAY['mileage_at_date', 'work_performed'], 'Validated receipts - proof of work'),
  
  -- Medium confidence  
  ('scraped_listing', 70, ARRAY['asking_price', 'seller_description'], 'Scraped listing - seller-provided data'),
  ('ai_image_analysis', 65, ARRAY['condition', 'visible_parts'], 'AI image analysis - inferred from photos'),
  
  -- Low confidence
  ('user_input_unverified', 50, ARRAY['requires_validation'], 'Unverified user input - needs validation'),
  ('crowdsourced', 40, ARRAY['needs_consensus'], 'Crowdsourced data - requires multiple confirmations'),
  ('inferred_from_pattern', 30, ARRAY['flag_for_review'], 'Pattern inference - statistical guess');

-- ============================================
-- 2. NORMALIZATION RULES
-- ============================================

CREATE TABLE IF NOT EXISTS normalization_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_value TEXT NOT NULL,
  variants TEXT[] NOT NULL,
  field_type TEXT NOT NULL,
  normalization_logic TEXT,
  confidence_boost INTEGER DEFAULT 0, -- How much confidence this normalization adds
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(canonical_value, field_type)
);

CREATE INDEX idx_normalization_field_type ON normalization_rules(field_type);
CREATE INDEX idx_normalization_variants ON normalization_rules USING GIN(variants);

-- Seed normalization rules
INSERT INTO normalization_rules (canonical_value, variants, field_type, normalization_logic, confidence_boost) VALUES
  -- Drivetrain
  ('4WD', ARRAY['4x4', '4×4', 'four wheel drive', '4wd', 'K', 'AWD Part-Time', '4 wheel drive'], 'drivetrain', 'Normalize all to 4WD', 5),
  ('2WD', ARRAY['2wd', '2×2', 'rear wheel', 'rwd', 'C', '4x2', '4×2', 'two wheel drive'], 'drivetrain', 'Normalize all to 2WD', 5),
  ('AWD', ARRAY['all wheel drive', 'awd', 'full-time 4wd'], 'drivetrain', 'Normalize all to AWD', 5),
  ('RWD', ARRAY['rear wheel drive', 'rwd'], 'drivetrain', 'Normalize all to RWD', 5),
  ('FWD', ARRAY['front wheel drive', 'fwd'], 'drivetrain', 'Normalize all to FWD', 5),
  
  -- Transmission
  ('4-Speed Manual', ARRAY['4spd', '4-speed', 'SM465', '4 speed manual', 'four speed', '4spd manual'], 'transmission', 'Common Chevy 4-speed', 10),
  ('3-Speed Automatic', ARRAY['TH350', 'Turbo 350', '3spd auto', 'THM350', '3-speed automatic'], 'transmission', 'Common Chevy auto', 10),
  ('4-Speed Automatic', ARRAY['TH400', 'Turbo 400', '4spd auto', 'THM400', '4-speed automatic'], 'transmission', 'Common Chevy auto', 10),
  
  -- Series (Chevy trucks)
  ('C10', ARRAY['c-10', 'c/k 10', 'ck10', 'C/K10 Series', 'C10 Series'], 'series', '1960-1987 2WD 1/2 ton', 15),
  ('K10', ARRAY['k-10', 'k/k 10', 'kk10', 'K/K10 Series', 'K10 Series'], 'series', '1960-1987 4WD 1/2 ton', 15),
  ('C20', ARRAY['c-20', 'c/k 20', 'ck20', 'C/K20 Series'], 'series', '1960-1987 2WD 3/4 ton', 15),
  ('K20', ARRAY['k-20', 'k/k 20', 'kk20', 'K/K20 Series'], 'series', '1960-1987 4WD 3/4 ton', 15),
  ('C1500', ARRAY['c-1500', 'c/k 1500', 'ck1500'], 'series', '1988+ 2WD 1/2 ton', 15),
  ('K1500', ARRAY['k-1500', 'k/k 1500', 'kk1500'], 'series', '1988+ 4WD 1/2 ton', 15),
  
  -- Trim
  ('Silverado', ARRAY['silverado', 'SILVERADO'], 'trim', 'Top trim 1975-1987', 10),
  ('Cheyenne', ARRAY['cheyenne', 'CHEYENNE'], 'trim', 'Mid trim 1971-1987', 10),
  ('Scottsdale', ARRAY['scottsdale', 'SCOTTSDALE'], 'trim', 'Mid trim 1971-1987', 10),
  ('Custom Deluxe', ARRAY['custom deluxe', 'CUSTOM DELUXE'], 'trim', 'Base trim', 10);

-- ============================================
-- 3. FIELD EVIDENCE TABLE
-- ============================================
-- Tracks all evidence for each field assignment

CREATE TABLE IF NOT EXISTS field_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  
  -- The evidence
  proposed_value TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_confidence INTEGER CHECK (source_confidence >= 0 AND source_confidence <= 100),
  extraction_context TEXT, -- Surrounding text where found
  extracted_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Why we think this is correct
  supporting_signals JSONB DEFAULT '[]'::JSONB, -- Other clues that support this
  contradicting_signals JSONB DEFAULT '[]'::JSONB, -- Conflicting evidence
  
  -- Status
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'conflicted', 'superseded')),
  assigned_at TIMESTAMPTZ,
  assigned_by TEXT, -- 'algorithm', 'manual_review', 'consensus', 'vin_override'
  
  -- Metadata
  raw_extraction_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(vehicle_id, field_name, source_type, proposed_value)
);

CREATE INDEX idx_field_evidence_vehicle ON field_evidence(vehicle_id);
CREATE INDEX idx_field_evidence_field ON field_evidence(vehicle_id, field_name);
CREATE INDEX idx_field_evidence_status ON field_evidence(status) WHERE status = 'pending';
CREATE INDEX idx_field_evidence_source ON field_evidence(source_type);

-- ============================================
-- 4. VEHICLE FIELD PROVENANCE
-- ============================================
-- Current value + full provenance for each field

CREATE TABLE IF NOT EXISTS vehicle_field_provenance (
  vehicle_id UUID NOT NULL,
  field_name TEXT NOT NULL,
  
  -- Current value
  current_value TEXT,
  
  -- Confidence breakdown
  total_confidence INTEGER CHECK (total_confidence >= 0 AND total_confidence <= 100),
  confidence_factors JSONB DEFAULT '{}'::JSONB, -- What contributed to confidence
  
  -- Sources
  primary_source TEXT,      -- Highest trust source
  supporting_sources TEXT[], -- Other sources that agree
  conflicting_sources JSONB DEFAULT '[]'::JSONB, -- Sources that disagree
  
  -- Temporal
  factory_original_value TEXT,  -- From VIN/NHTSA
  modified_value TEXT,          -- If different from factory
  modification_date DATE,       -- When it changed (from timeline)
  
  -- Verification
  last_verified_at TIMESTAMPTZ,
  last_verified_by TEXT,
  
  -- Metadata
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  PRIMARY KEY (vehicle_id, field_name)
);

CREATE INDEX idx_provenance_vehicle ON vehicle_field_provenance(vehicle_id);
CREATE INDEX idx_provenance_confidence ON vehicle_field_provenance(total_confidence) WHERE total_confidence < 70;

-- ============================================
-- 5. FORENSIC ANALYSIS FUNCTIONS
-- ============================================

-- Assign field value with forensic analysis
CREATE OR REPLACE FUNCTION assign_field_forensically(
  p_vehicle_id UUID,
  p_field_name TEXT,
  p_value TEXT,
  p_context TEXT DEFAULT NULL,
  p_source TEXT DEFAULT 'user_input_unverified',
  p_existing_vehicle_data JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_vehicle_data JSONB;
  v_trust_level INTEGER;
  v_normalized_value TEXT;
  v_confidence INTEGER;
  v_reasoning TEXT;
  v_evidence_id UUID;
  v_candidates JSONB := '[]'::JSONB;
BEGIN
  -- Get vehicle data if not provided
  IF p_existing_vehicle_data IS NULL THEN
    SELECT to_jsonb(v.*) INTO v_vehicle_data FROM vehicles v WHERE id = p_vehicle_id;
  ELSE
    v_vehicle_data := p_existing_vehicle_data;
  END IF;
  
  -- Get source trust level
  SELECT trust_level INTO v_trust_level 
  FROM data_source_trust_hierarchy 
  WHERE source_type = p_source;
  
  IF v_trust_level IS NULL THEN
    v_trust_level := 50; -- Default for unknown sources
  END IF;
  
  -- Normalize value
  SELECT canonical_value INTO v_normalized_value
  FROM normalization_rules
  WHERE field_type = p_field_name
    AND LOWER(p_value) = ANY(SELECT LOWER(v) FROM unnest(variants) v)
  LIMIT 1;
  
  IF v_normalized_value IS NULL THEN
    v_normalized_value := p_value;
  END IF;
  
  -- Calculate confidence based on context clues
  v_confidence := v_trust_level;
  v_reasoning := 'Source: ' || p_source || ' (trust: ' || v_trust_level || ')';
  
  -- Context-based confidence boost
  IF p_context IS NOT NULL THEN
    -- Check if context contains field-relevant keywords
    CASE p_field_name
      WHEN 'drivetrain' THEN
        IF p_context ~* '4x4|4×4|four wheel|4wd|k-series|k10|k20|k1500' THEN
          v_confidence := LEAST(100, v_confidence + 10);
          v_reasoning := v_reasoning || '; Context: drivetrain keywords found';
        END IF;
      WHEN 'engine_displacement_cid' THEN
        IF p_context ~* 'engine|motor|displacement|V8|V6' THEN
          v_confidence := LEAST(100, v_confidence + 10);
          v_reasoning := v_reasoning || '; Context: engine keywords found';
        END IF;
      WHEN 'horsepower' THEN
        IF p_context ~* 'HP|horsepower|power|bhp' THEN
          v_confidence := LEAST(100, v_confidence + 10);
          v_reasoning := v_reasoning || '; Context: power keywords found';
        END IF;
    END CASE;
  END IF;
  
  -- Format pattern matching
  IF p_value ~ '^L[A-Z0-9]{2,3}$' THEN
    v_confidence := LEAST(100, v_confidence + 15);
    v_reasoning := v_reasoning || '; Format: GM RPO code pattern (Lxx)';
  END IF;
  
  IF p_value ~ '^M[0-9]{2}$' THEN
    v_confidence := LEAST(100, v_confidence + 15);
    v_reasoning := v_reasoning || '; Format: Transmission RPO pattern (Mxx)';
  END IF;
  
  -- Cross-reference validation
  IF p_field_name = 'drivetrain' AND v_normalized_value = '4WD' THEN
    -- Check if model/series supports 4WD
    IF (v_vehicle_data->>'model') ~ '^K[0-9]' OR (v_vehicle_data->>'series') ~ '^K[0-9]' THEN
      v_confidence := LEAST(100, v_confidence + 20);
      v_reasoning := v_reasoning || '; Cross-ref: K-series confirms 4WD';
    ELSIF (v_vehicle_data->>'model') ~ '^C[0-9]' OR (v_vehicle_data->>'series') ~ '^C[0-9]' THEN
      v_confidence := GREATEST(0, v_confidence - 30);
      v_reasoning := v_reasoning || '; Cross-ref: C-series contradicts 4WD (possible conversion)';
    END IF;
  END IF;
  
  -- Store evidence
  INSERT INTO field_evidence (
    vehicle_id,
    field_name,
    proposed_value,
    source_type,
    source_confidence,
    extraction_context,
    supporting_signals,
    status
  ) VALUES (
    p_vehicle_id,
    p_field_name,
    v_normalized_value,
    p_source,
    v_confidence,
    p_context,
    jsonb_build_object(
      'normalized', v_normalized_value != p_value,
      'context_clues', p_context IS NOT NULL,
      'format_pattern', p_value ~ '^[LM][A-Z0-9]{2,3}$'
    ),
    'pending'
  )
  RETURNING id INTO v_evidence_id;
  
  RETURN jsonb_build_object(
    'evidence_id', v_evidence_id,
    'field', p_field_name,
    'value', v_normalized_value,
    'confidence', v_confidence,
    'reasoning', v_reasoning,
    'source', p_source,
    'normalized', v_normalized_value != p_value
  );
END;
$$;

-- Disambiguate ambiguous values
CREATE OR REPLACE FUNCTION disambiguate_value(
  p_value TEXT,
  p_field_candidates TEXT[],
  p_context TEXT DEFAULT NULL,
  p_existing_vehicle_data JSONB DEFAULT NULL
)
RETURNS TABLE (
  field TEXT,
  confidence INTEGER,
  reasoning TEXT
)
LANGUAGE plpgsql
AS $$
BEGIN
  -- Context: "350 V8" or near "engine" keywords
  IF p_context ~* 'V8|V6|engine|motor|displacement' AND p_value ~ '^\d{3}$' THEN
    RETURN QUERY SELECT 'engine_displacement_cid'::TEXT, 90, 'Near engine keywords + 3-digit number';
    RETURN; -- Found likely match, stop
  END IF;
  
  -- Context: "350 HP" or near "horsepower"
  IF p_context ~* 'HP|horsepower|power|bhp' THEN
    RETURN QUERY SELECT 'horsepower'::TEXT, 95, 'Near horsepower keywords';
    RETURN;
  END IF;
  
  -- Context: "Paint Code 350" or in paint section
  IF p_context ~* 'paint|color code|exterior color' THEN
    RETURN QUERY SELECT 'exterior_color_code'::TEXT, 90, 'Near paint/color keywords';
    RETURN;
  END IF;
  
  -- Format patterns
  IF p_value ~ '^L[A-Z0-9]{2,3}$' THEN
    RETURN QUERY SELECT 'engine_rpo_code'::TEXT, 95, 'Matches GM RPO format (Lxx)';
    RETURN;
  END IF;
  
  IF p_value ~ '^M[0-9]{2}$' THEN
    RETURN QUERY SELECT 'transmission_rpo_code'::TEXT, 95, 'Matches transmission RPO (Mxx)';
    RETURN;
  END IF;
  
  -- No context - use priors based on make/year
  IF p_existing_vehicle_data IS NOT NULL 
     AND (p_existing_vehicle_data->>'make') = 'CHEVROLET' 
     AND (p_existing_vehicle_data->>'year')::INT BETWEEN 1967 AND 1995 
     AND p_value = '350' THEN
    -- 350 was extremely common Chevy engine
    RETURN QUERY SELECT 'engine_displacement_cid'::TEXT, 70, 'Common Chevy 350 engine (prior)';
    RETURN;
  END IF;
  
  -- Default: flag for manual review
  RETURN QUERY SELECT 'ambiguous_' || p_value::TEXT, 30, 'No clear context - needs review';
END;
$$;

-- Detect modifications (current vs factory)
CREATE OR REPLACE FUNCTION detect_modification(
  p_vehicle_id UUID,
  p_field TEXT,
  p_new_value TEXT,
  p_source TEXT DEFAULT 'user_input_unverified'
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_factory_value TEXT;
  v_is_modification BOOLEAN := FALSE;
  v_confidence INTEGER;
BEGIN
  -- Get factory spec from NHTSA
  SELECT 
    CASE p_field
      WHEN 'drivetrain' THEN drivetrain
      WHEN 'engine_type' THEN engine_displacement_liters::TEXT || 'L'
      WHEN 'transmission' THEN transmission
      WHEN 'year' THEN year::TEXT
      WHEN 'make' THEN make
      WHEN 'model' THEN model
    END
  INTO v_factory_value
  FROM vin_decoded_data n
  JOIN vehicles v ON UPPER(v.vin) = n.vin
  WHERE v.id = p_vehicle_id;
  
  -- Compare
  IF v_factory_value IS NOT NULL AND v_factory_value != p_new_value THEN
    v_is_modification := TRUE;
    v_confidence := 95; -- High confidence it's a modification
  ELSIF v_factory_value IS NULL THEN
    v_confidence := 50; -- Can't confirm
  ELSE
    v_confidence := 100; -- Matches factory
  END IF;
  
  -- Return recommendation
  RETURN jsonb_build_object(
    'is_modification', v_is_modification,
    'factory_value', v_factory_value,
    'current_value', p_new_value,
    'confidence', v_confidence,
    'action', CASE 
      WHEN v_is_modification THEN 'create_timeline_event_modification'
      WHEN v_factory_value IS NULL THEN 'populate_from_vin_if_available'
      ELSE 'update_current_spec'
    END
  );
END;
$$;

-- ============================================
-- 6. MULTI-SIGNAL VALIDATION
-- ============================================

CREATE OR REPLACE FUNCTION validate_field_with_multiple_signals(
  p_vehicle_id UUID,
  p_field_name TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_consensus_value TEXT;
  v_consensus_count INTEGER;
  v_total_confidence NUMERIC;
  v_outliers JSONB := '[]'::JSONB;
  v_evidence RECORD;
  v_signals JSONB := '[]'::JSONB;
BEGIN
  -- Collect all evidence for this field
  FOR v_evidence IN 
    SELECT * FROM field_evidence
    WHERE vehicle_id = p_vehicle_id
      AND field_name = p_field_name
      AND status IN ('pending', 'accepted')
    ORDER BY source_confidence DESC
  LOOP
    v_signals := v_signals || jsonb_build_object(
      'source', v_evidence.source_type,
      'value', v_evidence.proposed_value,
      'confidence', v_evidence.source_confidence,
      'evidence_id', v_evidence.id
    );
  END LOOP;
  
  IF jsonb_array_length(v_signals) = 0 THEN
    RETURN jsonb_build_object(
      'field', p_field_name,
      'status', 'no_evidence',
      'action', 'collect_evidence'
    );
  END IF;
  
  -- Calculate consensus
  SELECT 
    proposed_value,
    COUNT(*),
    SUM(source_confidence)
  INTO v_consensus_value, v_consensus_count, v_total_confidence
  FROM field_evidence
  WHERE vehicle_id = p_vehicle_id
    AND field_name = p_field_name
    AND status IN ('pending', 'accepted')
  GROUP BY proposed_value
  ORDER BY SUM(source_confidence) DESC, COUNT(*) DESC
  LIMIT 1;
  
  -- Find outliers
  SELECT jsonb_agg(
    jsonb_build_object(
      'source', source_type,
      'value', proposed_value,
      'confidence', source_confidence,
      'evidence_id', id
    )
  ) INTO v_outliers
  FROM field_evidence
  WHERE vehicle_id = p_vehicle_id
    AND field_name = p_field_name
    AND proposed_value != v_consensus_value
    AND status IN ('pending', 'accepted');
  
  RETURN jsonb_build_object(
    'field', p_field_name,
    'consensus_value', v_consensus_value,
    'consensus_confidence', ROUND((v_total_confidence / NULLIF(v_consensus_count, 0))::NUMERIC, 1),
    'sources_agreeing', v_consensus_count,
    'total_signals', jsonb_array_length(v_signals),
    'outliers', COALESCE(v_outliers, '[]'::JSONB),
    'action', CASE 
      WHEN v_consensus_count >= 3 THEN 'use_consensus'
      WHEN (v_total_confidence / NULLIF(v_consensus_count, 0)) >= 90 THEN 'use_consensus'
      WHEN jsonb_array_length(COALESCE(v_outliers, '[]'::JSONB)) > 0 THEN 'flag_for_review'
      ELSE 'insufficient_data'
    END,
    'signals', v_signals
  );
END;
$$;

-- ============================================
-- 7. ANOMALY DETECTION
-- ============================================

CREATE OR REPLACE FUNCTION detect_data_anomalies(p_vehicle_id UUID)
RETURNS TABLE (
  field TEXT,
  anomaly TEXT,
  severity TEXT,
  recommendation TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_vehicle RECORD;
  v_nhtsa RECORD;
BEGIN
  SELECT * INTO v_vehicle FROM vehicles WHERE id = p_vehicle_id;
  IF v_vehicle IS NULL THEN RETURN; END IF;
  
  -- Get NHTSA data if available
  SELECT * INTO v_nhtsa FROM vin_decoded_data WHERE vin = UPPER(v_vehicle.vin);
  
  -- Impossible combinations
  IF v_vehicle.drivetrain = '2WD' AND (v_vehicle.model ~ '^K[0-9]' OR v_vehicle.series ~ '^K[0-9]') THEN
    RETURN QUERY SELECT 
      'drivetrain'::TEXT,
      'K-series must be 4WD by definition'::TEXT,
      'critical'::TEXT,
      'Either drivetrain is wrong (should be 4WD) or series/model is wrong'::TEXT;
  END IF;
  
  IF v_vehicle.drivetrain = '4WD' AND (v_vehicle.model ~ '^C[0-9]' OR v_vehicle.series ~ '^C[0-9]') THEN
    RETURN QUERY SELECT 
      'drivetrain'::TEXT,
      'C-series is 2WD by definition (unless converted)'::TEXT,
      'warning'::TEXT,
      'Verify if this is a 4WD conversion or data error'::TEXT;
  END IF;
  
  -- Temporal impossibilities
  IF v_vehicle.year < 1988 AND (v_vehicle.model ~ 'C1500|K1500' OR v_vehicle.series ~ '1500') THEN
    RETURN QUERY SELECT 
      'model'::TEXT,
      'C1500/K1500 designation started in 1988'::TEXT,
      'error'::TEXT,
      'Should be C10/K10 for pre-1988 vehicles'::TEXT;
  END IF;
  
  IF v_vehicle.year >= 1988 AND (v_vehicle.model ~ '^C10$|^K10$' OR v_vehicle.series ~ '^C10$|^K10$') THEN
    RETURN QUERY SELECT 
      'model'::TEXT,
      'C10/K10 designation ended in 1987'::TEXT,
      'error'::TEXT,
      'Should be C1500/K1500 for 1988+ vehicles'::TEXT;
  END IF;
  
  -- VIN conflicts
  IF v_nhtsa IS NOT NULL THEN
    IF v_vehicle.year IS NOT NULL AND v_nhtsa.year IS NOT NULL AND v_vehicle.year != v_nhtsa.year THEN
      RETURN QUERY SELECT 
        'year'::TEXT,
        'Year conflicts with VIN decode (' || v_vehicle.year || ' vs ' || v_nhtsa.year || ')'::TEXT,
        'critical'::TEXT,
        'VIN year is authoritative - user year may be wrong'::TEXT;
    END IF;
    
    IF v_vehicle.drivetrain IS NOT NULL AND v_nhtsa.drivetrain IS NOT NULL 
       AND UPPER(v_vehicle.drivetrain) != UPPER(v_nhtsa.drivetrain) THEN
      RETURN QUERY SELECT 
        'drivetrain'::TEXT,
        'Drivetrain differs from VIN (' || v_vehicle.drivetrain || ' vs ' || v_nhtsa.drivetrain || ')'::TEXT,
        'warning'::TEXT,
        'May be a modification - check timeline events'::TEXT;
    END IF;
  END IF;
  
  -- Statistical outliers (if we have enough data)
  IF v_vehicle.mileage IS NOT NULL AND v_vehicle.year IS NOT NULL AND v_vehicle.make IS NOT NULL THEN
    -- This would require a more complex query with window functions
    -- For now, just flag extremely high mileage
    IF v_vehicle.mileage > 500000 THEN
      RETURN QUERY SELECT 
        'mileage'::TEXT,
        'Extremely high mileage (>500k)'::TEXT,
        'warning'::TEXT,
        'Verify this is correct - may be odometer rollover or error'::TEXT;
    END IF;
  END IF;
  
  RETURN;
END;
$$;

-- ============================================
-- 8. AUTOMATED EVIDENCE COLLECTION TRIGGER
-- ============================================
-- When vehicle data is updated, collect evidence automatically

CREATE OR REPLACE FUNCTION auto_collect_field_evidence()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_field TEXT;
  v_new_value TEXT;
  v_source TEXT := 'system_update';
BEGIN
  -- For each changed field, create evidence
  IF TG_OP = 'UPDATE' THEN
    -- Check common fields
    FOR v_field IN SELECT unnest(ARRAY['vin', 'year', 'make', 'model', 'drivetrain', 'transmission', 'engine_type', 'series', 'trim']) LOOP
      v_new_value := (NEW::JSONB ->> v_field);
      
      IF (OLD::JSONB ->> v_field) IS DISTINCT FROM v_new_value AND v_new_value IS NOT NULL THEN
        -- Create evidence record
        INSERT INTO field_evidence (
          vehicle_id,
          field_name,
          proposed_value,
          source_type,
          source_confidence,
          status,
          assigned_by
        ) VALUES (
          NEW.id,
          v_field,
          v_new_value,
          v_source,
          60, -- Medium confidence for system updates
          'accepted',
          'system_trigger'
        )
        ON CONFLICT (vehicle_id, field_name, source_type, proposed_value) DO NOTHING;
        
        -- Update provenance
        INSERT INTO vehicle_field_provenance (
          vehicle_id,
          field_name,
          current_value,
          total_confidence,
          primary_source,
          updated_at
        ) VALUES (
          NEW.id,
          v_field,
          v_new_value,
          60,
          v_source,
          NOW()
        )
        ON CONFLICT (vehicle_id, field_name) 
        DO UPDATE SET
          current_value = EXCLUDED.current_value,
          total_confidence = EXCLUDED.total_confidence,
          primary_source = EXCLUDED.primary_source,
          updated_at = NOW();
      END IF;
    END LOOP;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger (only on specific columns to avoid infinite loops)
-- We'll be selective about which fields trigger evidence collection
-- This is a lightweight trigger that only fires on key field changes

-- ============================================
-- 9. CONSENSUS BUILDING FUNCTION
-- ============================================
-- Analyzes all evidence and assigns best value

CREATE OR REPLACE FUNCTION build_field_consensus(
  p_vehicle_id UUID,
  p_field_name TEXT,
  p_auto_assign BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_validation JSONB;
  v_consensus_value TEXT;
  v_consensus_confidence INTEGER;
  v_action TEXT;
  v_evidence_ids UUID[];
BEGIN
  -- Get multi-signal validation
  v_validation := validate_field_with_multiple_signals(p_vehicle_id, p_field_name);
  
  v_consensus_value := v_validation->>'consensus_value';
  v_consensus_confidence := (v_validation->>'consensus_confidence')::INTEGER;
  v_action := v_validation->>'action';
  
  -- If consensus is strong enough, auto-assign
  IF p_auto_assign AND v_action IN ('use_consensus', 'insufficient_data') AND v_consensus_confidence >= 80 THEN
    -- Mark accepted evidence
    UPDATE field_evidence
    SET status = 'accepted',
        assigned_at = NOW(),
        assigned_by = 'consensus_algorithm'
    WHERE vehicle_id = p_vehicle_id
      AND field_name = p_field_name
      AND proposed_value = v_consensus_value
      AND status = 'pending';
    
    -- Mark conflicting evidence as rejected
    UPDATE field_evidence
    SET status = 'rejected',
        assigned_at = NOW(),
        assigned_by = 'consensus_algorithm'
    WHERE vehicle_id = p_vehicle_id
      AND field_name = p_field_name
      AND proposed_value != v_consensus_value
      AND status = 'pending';
    
    -- Update vehicle field
    EXECUTE format('UPDATE vehicles SET %I = $1 WHERE id = $2', p_field_name)
    USING v_consensus_value, p_vehicle_id;
    
    -- Update provenance
    INSERT INTO vehicle_field_provenance (
      vehicle_id,
      field_name,
      current_value,
      total_confidence,
      primary_source,
      supporting_sources,
      updated_at
    )
    SELECT 
      p_vehicle_id,
      p_field_name,
      v_consensus_value,
      v_consensus_confidence,
      (SELECT source_type FROM field_evidence 
       WHERE vehicle_id = p_vehicle_id 
         AND field_name = p_field_name 
         AND proposed_value = v_consensus_value
       ORDER BY source_confidence DESC LIMIT 1),
      ARRAY(SELECT DISTINCT source_type FROM field_evidence 
            WHERE vehicle_id = p_vehicle_id 
              AND field_name = p_field_name 
              AND proposed_value = v_consensus_value
              AND status = 'accepted'),
      NOW()
    ON CONFLICT (vehicle_id, field_name)
    DO UPDATE SET
      current_value = EXCLUDED.current_value,
      total_confidence = EXCLUDED.total_confidence,
      primary_source = EXCLUDED.primary_source,
      supporting_sources = EXCLUDED.supporting_sources,
      updated_at = NOW();
  END IF;
  
  RETURN v_validation || jsonb_build_object(
    'auto_assigned', p_auto_assign AND v_action = 'use_consensus' AND v_consensus_confidence >= 80,
    'recommendation', CASE
      WHEN v_consensus_confidence >= 90 THEN 'high_confidence_assign'
      WHEN v_consensus_confidence >= 70 THEN 'medium_confidence_assign'
      WHEN v_consensus_confidence >= 50 THEN 'low_confidence_review'
      ELSE 'manual_review_required'
    END
  );
END;
$$;

-- ============================================
-- 10. VIEWS FOR MONITORING
-- ============================================

CREATE OR REPLACE VIEW forensic_evidence_dashboard AS
SELECT 
  v.id as vehicle_id,
  v.year || ' ' || v.make || ' ' || v.model as vehicle_identity,
  COUNT(DISTINCT fe.field_name) as fields_with_evidence,
  COUNT(DISTINCT fe.id) FILTER (WHERE fe.status = 'pending') as pending_evidence,
  COUNT(DISTINCT fe.id) FILTER (WHERE fe.status = 'conflicted') as conflicted_evidence,
  AVG(fe.source_confidence) FILTER (WHERE fe.status = 'accepted') as avg_confidence,
  COUNT(DISTINCT vfp.field_name) FILTER (WHERE vfp.total_confidence < 70) as low_confidence_fields
FROM vehicles v
LEFT JOIN field_evidence fe ON v.id = fe.vehicle_id
LEFT JOIN vehicle_field_provenance vfp ON v.id = vfp.vehicle_id
GROUP BY v.id, v.year, v.make, v.model;

CREATE OR REPLACE VIEW vehicles_needing_forensic_review AS
SELECT 
  v.id,
  v.year || ' ' || v.make || ' ' || v.model as vehicle_identity,
  COUNT(*) FILTER (WHERE fe.status = 'conflicted') as conflicts,
  COUNT(*) FILTER (WHERE fe.status = 'pending' AND fe.source_confidence < 60) as low_confidence_pending,
  ARRAY_AGG(DISTINCT fe.field_name) FILTER (WHERE fe.status IN ('conflicted', 'pending')) as fields_needing_review
FROM vehicles v
JOIN field_evidence fe ON v.id = fe.vehicle_id
WHERE fe.status IN ('conflicted', 'pending')
GROUP BY v.id, v.year, v.make, v.model
HAVING COUNT(*) FILTER (WHERE fe.status = 'conflicted') > 0
    OR COUNT(*) FILTER (WHERE fe.status = 'pending' AND fe.source_confidence < 60) > 2;

-- ============================================
-- 11. RLS POLICIES
-- ============================================

ALTER TABLE data_source_trust_hierarchy ENABLE ROW LEVEL SECURITY;
ALTER TABLE normalization_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE field_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_field_provenance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view trust hierarchy" ON data_source_trust_hierarchy FOR SELECT USING (true);
CREATE POLICY "Service role manages trust hierarchy" ON data_source_trust_hierarchy FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Anyone can view normalization rules" ON normalization_rules FOR SELECT USING (true);
CREATE POLICY "Service role manages normalization rules" ON normalization_rules FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Anyone can view evidence" ON field_evidence FOR SELECT USING (true);
CREATE POLICY "Service role manages evidence" ON field_evidence FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Anyone can view provenance" ON vehicle_field_provenance FOR SELECT USING (true);
CREATE POLICY "Service role manages provenance" ON vehicle_field_provenance FOR ALL USING (true) WITH CHECK (true);

-- ============================================
-- 12. COMMENTS
-- ============================================

COMMENT ON TABLE data_source_trust_hierarchy IS 'Trust levels for different data sources - determines which source wins in conflicts';
COMMENT ON TABLE normalization_rules IS 'Rules for normalizing variant spellings/forms to canonical values';
COMMENT ON TABLE field_evidence IS 'All evidence collected for each field assignment - tracks provenance and confidence';
COMMENT ON TABLE vehicle_field_provenance IS 'Current value + full provenance for each vehicle field';
COMMENT ON FUNCTION assign_field_forensically IS 'Assigns a field value with forensic analysis - context clues, format patterns, cross-validation';
COMMENT ON FUNCTION disambiguate_value IS 'Disambiguates ambiguous values (e.g., "350" could be engine, HP, or paint code)';
COMMENT ON FUNCTION detect_modification IS 'Detects if current value differs from factory (VIN) - indicates modification';
COMMENT ON FUNCTION validate_field_with_multiple_signals IS 'Validates field using multiple evidence sources - builds consensus';
COMMENT ON FUNCTION detect_data_anomalies IS 'Detects impossible combinations, temporal errors, and statistical outliers';
COMMENT ON FUNCTION build_field_consensus IS 'Analyzes all evidence and assigns best value based on consensus';

