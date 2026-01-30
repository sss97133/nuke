-- ═══════════════════════════════════════════════════════════════════════════════
-- ORGANIZATION INTELLIGENCE SYSTEM
-- Behavior-driven classification, evolution tracking, and investability scoring
-- ═══════════════════════════════════════════════════════════════════════════════

-- PHILOSOPHY:
-- 1. Organizations EARN their badges through demonstrated behavior
-- 2. Types are COMPUTED, not manually assigned
-- 3. Evolution is TRACKED as a first-class metric
-- 4. Everything builds toward INVESTABILITY scoring

-- ═══════════════════════════════════════════════════════════════════════════════
-- PART 1: BEHAVIOR SIGNAL CAPTURE
-- ═══════════════════════════════════════════════════════════════════════════════

-- Raw behavior signals (the "evidence" for classification)
CREATE TABLE IF NOT EXISTS organization_behavior_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,

  -- Signal classification
  signal_type TEXT NOT NULL,
  -- Types: 'vehicle_intake', 'vehicle_sale', 'work_performed', 'auction_hosted',
  --        'consignment_received', 'parts_supplied', 'transport_completed',
  --        'content_created', 'receipt_matched', 'gps_matched', 'mention_detected'

  signal_category TEXT NOT NULL,
  -- Categories: 'transaction', 'service', 'content', 'network', 'financial'

  -- Signal data
  signal_data JSONB NOT NULL DEFAULT '{}',
  -- e.g., {"vehicle_id": "...", "sale_price": 45000, "work_type": "engine_rebuild"}

  -- Confidence and provenance
  confidence NUMERIC(4,2) DEFAULT 0.80,
  source_type TEXT NOT NULL,
  -- Sources: 'org_vehicle_link', 'receipt', 'timeline_event', 'auction_result',
  --          'gps_photo', 'external_mention', 'quickbooks', 'manual'
  source_id UUID,
  source_url TEXT,

  -- Classification impact (which badges/specializations this affects)
  impacts_roles TEXT[] DEFAULT ARRAY[]::TEXT[],
  impacts_specializations TEXT[] DEFAULT ARRAY[]::TEXT[],

  -- Timestamps
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  signal_date DATE,  -- When the actual behavior occurred (may differ from observed_at)
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_org_signals_org ON organization_behavior_signals(organization_id);
CREATE INDEX idx_org_signals_type ON organization_behavior_signals(signal_type);
CREATE INDEX idx_org_signals_date ON organization_behavior_signals(signal_date);
CREATE INDEX idx_org_signals_observed ON organization_behavior_signals(observed_at);

COMMENT ON TABLE organization_behavior_signals IS 'Raw evidence of org behavior - drives all classification';

-- ═══════════════════════════════════════════════════════════════════════════════
-- PART 2: COMPUTED BEHAVIOR SCORES (periodic rollup)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS organization_behavior_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,

  -- Scoring period
  period_type TEXT NOT NULL DEFAULT 'rolling_90d',
  -- Types: 'rolling_30d', 'rolling_90d', 'rolling_365d', 'quarter', 'year', 'all_time'
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,

  -- Role scores (0-100, computed from signal volume/frequency/recency)
  dealer_score INTEGER DEFAULT 0,
  auction_house_score INTEGER DEFAULT 0,
  broker_score INTEGER DEFAULT 0,
  restoration_shop_score INTEGER DEFAULT 0,
  service_shop_score INTEGER DEFAULT 0,
  collector_score INTEGER DEFAULT 0,
  storage_facility_score INTEGER DEFAULT 0,
  transport_score INTEGER DEFAULT 0,
  parts_supplier_score INTEGER DEFAULT 0,
  media_score INTEGER DEFAULT 0,

  -- Specialization scores (granular capabilities)
  specialization_scores JSONB DEFAULT '{}',
  -- e.g., {"paint": 85, "engine": 72, "electrical": 45, "european": 90, "pre_war": 30}

  -- Derived classifications
  primary_role TEXT,  -- Highest scoring role (if above threshold)
  active_roles TEXT[] DEFAULT ARRAY[]::TEXT[],  -- All roles above threshold
  active_specializations TEXT[] DEFAULT ARRAY[]::TEXT[],

  -- Supporting metrics
  total_signals INTEGER DEFAULT 0,
  signal_counts JSONB DEFAULT '{}',  -- {"vehicle_sale": 45, "work_performed": 23, ...}

  -- Confidence in classification
  classification_confidence NUMERIC(4,2) DEFAULT 0.00,
  -- Low confidence = not enough signals to classify reliably

  computed_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(organization_id, period_type, period_start)
);

CREATE INDEX idx_org_scores_org ON organization_behavior_scores(organization_id);
CREATE INDEX idx_org_scores_period ON organization_behavior_scores(period_type, period_end);
CREATE INDEX idx_org_scores_primary_role ON organization_behavior_scores(primary_role);

-- ═══════════════════════════════════════════════════════════════════════════════
-- PART 3: SPECIALIZATION TAXONOMY
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS specialization_taxonomy (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  -- Categories: 'mechanical', 'body', 'electrical', 'interior', 'specialty',
  --             'vehicle_type', 'era', 'brand', 'service_type'

  parent_slug TEXT REFERENCES specialization_taxonomy(slug),

  -- Detection rules
  detection_keywords TEXT[] DEFAULT ARRAY[]::TEXT[],
  detection_event_types TEXT[] DEFAULT ARRAY[]::TEXT[],
  detection_part_categories TEXT[] DEFAULT ARRAY[]::TEXT[],

  -- Market intelligence
  market_demand TEXT DEFAULT 'stable',  -- 'growing', 'stable', 'declining'
  avg_hourly_rate_low NUMERIC(8,2),
  avg_hourly_rate_high NUMERIC(8,2),

  -- Relationships
  often_paired_with TEXT[] DEFAULT ARRAY[]::TEXT[],
  prerequisite_for TEXT[] DEFAULT ARRAY[]::TEXT[],

  display_order INTEGER DEFAULT 100,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed core specializations
INSERT INTO specialization_taxonomy (slug, name, category, detection_keywords, market_demand) VALUES
  -- Mechanical
  ('engine', 'Engine Work', 'mechanical', ARRAY['engine', 'motor', 'rebuild', 'swap'], 'stable'),
  ('engine_rebuild', 'Engine Rebuild', 'mechanical', ARRAY['rebuild', 'machine', 'bore', 'hone'], 'stable'),
  ('engine_swap', 'Engine Swap', 'mechanical', ARRAY['swap', 'ls swap', 'conversion'], 'growing'),
  ('carburetor', 'Carburetor', 'mechanical', ARRAY['carb', 'carburetor', 'weber', 'holley'], 'declining'),
  ('fuel_injection', 'Fuel Injection', 'mechanical', ARRAY['efi', 'injection', 'throttle body'], 'growing'),
  ('forced_induction', 'Turbo/Supercharger', 'mechanical', ARRAY['turbo', 'supercharger', 'boost', 'intercooler'], 'growing'),
  ('transmission', 'Transmission', 'mechanical', ARRAY['transmission', 'trans', 'gearbox', 'clutch'], 'stable'),
  ('suspension', 'Suspension', 'mechanical', ARRAY['suspension', 'coilover', 'spring', 'shock'], 'stable'),
  ('brakes', 'Brakes', 'mechanical', ARRAY['brake', 'rotor', 'caliper', 'pad'], 'stable'),
  ('exhaust', 'Exhaust', 'mechanical', ARRAY['exhaust', 'header', 'muffler', 'catalytic'], 'stable'),

  -- Body
  ('paint', 'Paint', 'body', ARRAY['paint', 'respray', 'basecoat', 'clearcoat', 'booth'], 'stable'),
  ('custom_paint', 'Custom Paint/Graphics', 'body', ARRAY['custom paint', 'graphics', 'stripes', 'flames'], 'stable'),
  ('bodywork', 'Bodywork/Metal', 'body', ARRAY['bodywork', 'dent', 'panel', 'fender', 'quarter'], 'stable'),
  ('rust_repair', 'Rust Repair', 'body', ARRAY['rust', 'rot', 'patch', 'weld'], 'stable'),
  ('fabrication', 'Metal Fabrication', 'body', ARRAY['fabrication', 'fab', 'weld', 'sheet metal'], 'growing'),
  ('fiberglass', 'Fiberglass/Composite', 'body', ARRAY['fiberglass', 'composite', 'carbon fiber'], 'growing'),

  -- Electrical
  ('wiring', 'Wiring/Electrical', 'electrical', ARRAY['wiring', 'harness', 'electrical', 'circuit'], 'stable'),
  ('efi_conversion', 'EFI Conversion', 'electrical', ARRAY['efi', 'conversion', 'sniper', 'holley efi'], 'growing'),
  ('audio', 'Audio/Entertainment', 'electrical', ARRAY['audio', 'stereo', 'speaker', 'radio'], 'stable'),

  -- Interior
  ('upholstery', 'Upholstery', 'interior', ARRAY['upholstery', 'seat', 'leather', 'vinyl'], 'stable'),
  ('carpet', 'Carpet/Headliner', 'interior', ARRAY['carpet', 'headliner', 'door panel'], 'stable'),
  ('dash', 'Dash/Gauges', 'interior', ARRAY['dash', 'gauge', 'instrument', 'cluster'], 'stable'),

  -- Vehicle types
  ('european', 'European Vehicles', 'vehicle_type', ARRAY['porsche', 'ferrari', 'bmw', 'mercedes', 'alfa', 'jaguar'], 'growing'),
  ('american_muscle', 'American Muscle', 'vehicle_type', ARRAY['camaro', 'mustang', 'chevelle', 'cuda', 'charger', 'gto'], 'stable'),
  ('japanese', 'Japanese Classics', 'vehicle_type', ARRAY['datsun', 'toyota', 'honda', 'mazda', 'nissan'], 'growing'),
  ('british', 'British Vehicles', 'vehicle_type', ARRAY['mg', 'triumph', 'austin', 'lotus', 'healey'], 'stable'),
  ('trucks', 'Trucks/4x4', 'vehicle_type', ARRAY['truck', 'pickup', 'bronco', 'blazer', 'scout'], 'growing'),
  ('pre_war', 'Pre-War Vehicles', 'era', ARRAY['pre-war', 'antique', '1930s', '1920s'], 'declining'),
  ('modern_classic', 'Modern Classics (80s-00s)', 'era', ARRAY['80s', '90s', '2000s', 'modern classic'], 'growing'),

  -- Services
  ('auction_prep', 'Auction Preparation', 'service_type', ARRAY['auction prep', 'detail', 'concours'], 'growing'),
  ('ppi', 'Pre-Purchase Inspection', 'service_type', ARRAY['ppi', 'inspection', 'pre-purchase'], 'growing'),
  ('transport', 'Vehicle Transport', 'service_type', ARRAY['transport', 'shipping', 'enclosed', 'flatbed'], 'stable'),
  ('storage', 'Climate Storage', 'service_type', ARRAY['storage', 'climate', 'heated', 'dehumidified'], 'growing')
ON CONFLICT (slug) DO NOTHING;

-- Set parent relationships
UPDATE specialization_taxonomy SET parent_slug = 'engine' WHERE slug IN ('engine_rebuild', 'engine_swap', 'carburetor', 'fuel_injection', 'forced_induction');
UPDATE specialization_taxonomy SET parent_slug = 'paint' WHERE slug = 'custom_paint';

-- ═══════════════════════════════════════════════════════════════════════════════
-- PART 4: EVOLUTION TRACKING
-- ═══════════════════════════════════════════════════════════════════════════════

-- Monthly snapshots for trend analysis
CREATE TABLE IF NOT EXISTS organization_evolution_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,
  snapshot_type TEXT DEFAULT 'monthly',  -- 'monthly', 'quarterly', 'annual'

  -- Classification state
  primary_role TEXT,
  active_roles TEXT[] DEFAULT ARRAY[]::TEXT[],
  role_scores JSONB DEFAULT '{}',
  specializations TEXT[] DEFAULT ARRAY[]::TEXT[],
  specialization_scores JSONB DEFAULT '{}',

  -- Activity metrics
  vehicles_handled INTEGER DEFAULT 0,
  vehicles_sold INTEGER DEFAULT 0,
  vehicles_serviced INTEGER DEFAULT 0,
  total_transactions INTEGER DEFAULT 0,

  -- Financial metrics
  total_revenue NUMERIC(15,2) DEFAULT 0,
  avg_transaction_value NUMERIC(12,2),
  gmv NUMERIC(15,2) DEFAULT 0,  -- Gross Merchandise Value

  -- Quality metrics
  avg_sale_price NUMERIC(12,2),
  avg_days_to_sell NUMERIC(8,2),
  repeat_customer_rate NUMERIC(5,2),

  -- Network metrics
  unique_customers INTEGER DEFAULT 0,
  unique_consigners INTEGER DEFAULT 0,
  org_collaborations INTEGER DEFAULT 0,

  -- Content/engagement metrics
  content_pieces INTEGER DEFAULT 0,
  total_views INTEGER DEFAULT 0,

  UNIQUE(organization_id, snapshot_date, snapshot_type)
);

CREATE INDEX idx_org_evolution_org ON organization_evolution_snapshots(organization_id);
CREATE INDEX idx_org_evolution_date ON organization_evolution_snapshots(snapshot_date DESC);

-- Detected pivots/transitions
CREATE TABLE IF NOT EXISTS organization_pivots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,

  -- Pivot details
  from_primary_role TEXT,
  to_primary_role TEXT,
  from_roles TEXT[] DEFAULT ARRAY[]::TEXT[],
  to_roles TEXT[] DEFAULT ARRAY[]::TEXT[],

  -- Classification
  pivot_type TEXT NOT NULL,
  -- Types: 'expansion' (added capability), 'contraction' (dropped capability),
  --        'pivot' (changed primary), 'specialization' (deepened focus)

  -- Evidence
  trigger_signals JSONB DEFAULT '{}',  -- What signals caused the reclassification
  confidence NUMERIC(4,2) DEFAULT 0.80,

  -- Context
  market_context TEXT,  -- "market correction", "expansion into new segment", etc.

  detected_at TIMESTAMPTZ DEFAULT NOW(),
  pivot_date DATE NOT NULL  -- When the pivot actually occurred
);

CREATE INDEX idx_org_pivots_org ON organization_pivots(organization_id);
CREATE INDEX idx_org_pivots_date ON organization_pivots(pivot_date DESC);

-- Milestones (achievements that matter for investability)
CREATE TABLE IF NOT EXISTS organization_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,

  milestone_type TEXT NOT NULL,
  -- Types: 'first_sale', 'first_six_figure_sale', '100_vehicles_sold', 'earned_badge_X',
  --        'profitability_achieved', 'quickbooks_connected', 'first_repeat_customer',
  --        '10_consigners', 'expansion_new_location', etc.

  milestone_category TEXT NOT NULL,
  -- Categories: 'transaction', 'scale', 'quality', 'financial', 'operational', 'network'

  milestone_data JSONB DEFAULT '{}',
  achieved_at TIMESTAMPTZ DEFAULT NOW(),

  -- Investability impact
  investability_points INTEGER DEFAULT 0,  -- How much this milestone affects investability score

  is_public BOOLEAN DEFAULT true
);

CREATE INDEX idx_org_milestones_org ON organization_milestones(organization_id);
CREATE INDEX idx_org_milestones_type ON organization_milestones(milestone_type);

-- ═══════════════════════════════════════════════════════════════════════════════
-- PART 5: INVESTABILITY FRAMEWORK
-- ═══════════════════════════════════════════════════════════════════════════════

-- Investability score components
CREATE TABLE IF NOT EXISTS organization_investability_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,

  -- Overall score (0-100)
  overall_score INTEGER DEFAULT 0,
  investability_tier TEXT DEFAULT 'seed',
  -- Tiers: 'pre_seed' (0-20), 'seed' (21-40), 'series_a' (41-60),
  --        'growth' (61-80), 'mature' (81-100)

  -- Component scores (each 0-100)

  -- TRACTION (30% weight)
  traction_score INTEGER DEFAULT 0,
  -- Metrics: vehicles handled, transaction volume, growth rate
  traction_details JSONB DEFAULT '{}',

  -- FINANCIAL HEALTH (25% weight)
  financial_score INTEGER DEFAULT 0,
  -- Metrics: revenue trend, margins, profitability, cash position
  financial_details JSONB DEFAULT '{}',

  -- OPERATIONAL EXCELLENCE (20% weight)
  operational_score INTEGER DEFAULT 0,
  -- Metrics: avg days to sell, completion rate, repeat customers, quality signals
  operational_details JSONB DEFAULT '{}',

  -- MARKET POSITION (15% weight)
  market_score INTEGER DEFAULT 0,
  -- Metrics: specialization strength, network position, competitive moat
  market_details JSONB DEFAULT '{}',

  -- DATA COMPLETENESS (10% weight)
  data_score INTEGER DEFAULT 0,
  -- Metrics: QuickBooks connected, receipt capture rate, documentation
  data_details JSONB DEFAULT '{}',

  -- Recommendations for improvement
  improvement_recommendations JSONB DEFAULT '[]',
  -- e.g., [{"category": "financial", "action": "Connect QuickBooks", "impact": "+15 points"}]

  -- Next milestone targets
  next_milestones JSONB DEFAULT '[]',
  -- e.g., [{"milestone": "100_vehicles_sold", "current": 78, "target": 100, "impact": "+5 points"}]

  computed_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(organization_id)
);

-- Investability requirements by tier
CREATE TABLE IF NOT EXISTS investability_tier_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tier TEXT UNIQUE NOT NULL,
  tier_order INTEGER NOT NULL,

  -- Score thresholds
  min_overall_score INTEGER NOT NULL,
  min_traction_score INTEGER DEFAULT 0,
  min_financial_score INTEGER DEFAULT 0,
  min_operational_score INTEGER DEFAULT 0,

  -- Hard requirements
  required_milestones TEXT[] DEFAULT ARRAY[]::TEXT[],
  required_data_connections TEXT[] DEFAULT ARRAY[]::TEXT[],

  -- Display
  display_name TEXT NOT NULL,
  description TEXT,
  typical_raise_range TEXT  -- e.g., "$50K-$250K"
);

INSERT INTO investability_tier_requirements (tier, tier_order, min_overall_score, display_name, description, typical_raise_range, required_milestones) VALUES
  ('pre_seed', 1, 0, 'Pre-Seed', 'Early stage, building foundation', '$0-$50K', ARRAY[]::TEXT[]),
  ('seed', 2, 21, 'Seed Ready', 'Initial traction, ready for angel/seed', '$50K-$250K', ARRAY['first_sale', 'quickbooks_connected']),
  ('series_a', 3, 41, 'Series A Ready', 'Proven model, scaling operations', '$250K-$2M', ARRAY['100_vehicles_sold', 'profitability_achieved', 'first_repeat_customer']),
  ('growth', 4, 61, 'Growth Stage', 'Rapid scaling, market expansion', '$2M-$10M', ARRAY['1000_vehicles_sold', 'multi_location']),
  ('mature', 5, 81, 'Mature', 'Established leader, optimizing', '$10M+', ARRAY['market_leader'])
ON CONFLICT (tier) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════════
-- PART 6: FUNCTIONS TO COMPUTE FROM EXISTING DATA
-- ═══════════════════════════════════════════════════════════════════════════════

-- Function to generate signals from existing organization_vehicles data
CREATE OR REPLACE FUNCTION generate_signals_from_org_vehicles()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  signals_created INTEGER := 0;
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT
      ov.organization_id,
      ov.relationship_type,
      ov.vehicle_id,
      ov.created_at,
      ov.auto_tagged,
      ov.gps_match_confidence,
      v.sale_price,
      v.sale_status,
      v.year,
      v.make,
      v.model
    FROM organization_vehicles ov
    JOIN vehicles v ON v.id = ov.vehicle_id
    WHERE NOT EXISTS (
      SELECT 1 FROM organization_behavior_signals obs
      WHERE obs.organization_id = ov.organization_id
        AND obs.source_id = ov.id
    )
  LOOP
    -- Map relationship types to signal types
    INSERT INTO organization_behavior_signals (
      organization_id,
      signal_type,
      signal_category,
      signal_data,
      confidence,
      source_type,
      source_id,
      impacts_roles,
      observed_at,
      signal_date
    ) VALUES (
      rec.organization_id,
      CASE rec.relationship_type
        WHEN 'consigner' THEN 'consignment_received'
        WHEN 'sold_by' THEN 'vehicle_sale'
        WHEN 'service_provider' THEN 'work_performed'
        WHEN 'owner' THEN 'vehicle_owned'
        WHEN 'seller' THEN 'vehicle_sale'
        WHEN 'buyer' THEN 'vehicle_purchase'
        WHEN 'parts_supplier' THEN 'parts_supplied'
        WHEN 'transport' THEN 'transport_completed'
        WHEN 'storage' THEN 'vehicle_stored'
        ELSE 'vehicle_relationship'
      END,
      CASE rec.relationship_type
        WHEN 'consigner' THEN 'transaction'
        WHEN 'sold_by' THEN 'transaction'
        WHEN 'service_provider' THEN 'service'
        WHEN 'seller' THEN 'transaction'
        WHEN 'buyer' THEN 'transaction'
        ELSE 'network'
      END,
      jsonb_build_object(
        'vehicle_id', rec.vehicle_id,
        'sale_price', rec.sale_price,
        'sale_status', rec.sale_status,
        'vehicle_year', rec.year,
        'vehicle_make', rec.make,
        'vehicle_model', rec.model,
        'auto_tagged', rec.auto_tagged,
        'gps_confidence', rec.gps_match_confidence
      ),
      CASE WHEN rec.auto_tagged THEN COALESCE(rec.gps_match_confidence / 100.0, 0.70) ELSE 0.90 END,
      'org_vehicle_link',
      rec.vehicle_id,
      CASE rec.relationship_type
        WHEN 'consigner' THEN ARRAY['dealer', 'auction_house', 'broker']
        WHEN 'sold_by' THEN ARRAY['dealer', 'auction_house']
        WHEN 'service_provider' THEN ARRAY['service_shop', 'restoration_shop']
        WHEN 'seller' THEN ARRAY['dealer']
        WHEN 'buyer' THEN ARRAY['dealer', 'collector']
        WHEN 'storage' THEN ARRAY['storage_facility']
        WHEN 'transport' THEN ARRAY['transport']
        ELSE ARRAY[]::TEXT[]
      END,
      rec.created_at,
      rec.created_at::DATE
    );

    signals_created := signals_created + 1;
  END LOOP;

  RETURN signals_created;
END;
$$;

-- Function to compute behavior scores for an organization
CREATE OR REPLACE FUNCTION compute_org_behavior_scores(
  p_organization_id UUID,
  p_period_days INTEGER DEFAULT 90
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period_start DATE := CURRENT_DATE - p_period_days;
  v_period_end DATE := CURRENT_DATE;
  v_signal_counts JSONB;
  v_total_signals INTEGER;
  v_dealer_score INTEGER := 0;
  v_auction_score INTEGER := 0;
  v_service_score INTEGER := 0;
  v_collector_score INTEGER := 0;
  v_primary_role TEXT;
  v_active_roles TEXT[] := ARRAY[]::TEXT[];
BEGIN
  -- Count signals by type
  SELECT
    jsonb_object_agg(signal_type, cnt),
    SUM(cnt)
  INTO v_signal_counts, v_total_signals
  FROM (
    SELECT signal_type, COUNT(*) as cnt
    FROM organization_behavior_signals
    WHERE organization_id = p_organization_id
      AND signal_date >= v_period_start
    GROUP BY signal_type
  ) sq;

  -- Compute role scores based on signal types
  -- Dealer score: sales, consignments, inventory
  v_dealer_score := LEAST(100, (
    COALESCE((v_signal_counts->>'vehicle_sale')::INTEGER, 0) * 5 +
    COALESCE((v_signal_counts->>'consignment_received')::INTEGER, 0) * 3 +
    COALESCE((v_signal_counts->>'vehicle_purchase')::INTEGER, 0) * 2
  ));

  -- Auction house score: hosted auctions, high-volume consignments
  v_auction_score := LEAST(100, (
    COALESCE((v_signal_counts->>'auction_hosted')::INTEGER, 0) * 10 +
    COALESCE((v_signal_counts->>'consignment_received')::INTEGER, 0) * 2
  ));

  -- Service shop score: work performed
  v_service_score := LEAST(100, (
    COALESCE((v_signal_counts->>'work_performed')::INTEGER, 0) * 5 +
    COALESCE((v_signal_counts->>'parts_supplied')::INTEGER, 0) * 2
  ));

  -- Collector score: long-term ownership
  v_collector_score := LEAST(100, (
    COALESCE((v_signal_counts->>'vehicle_owned')::INTEGER, 0) * 10
  ));

  -- Determine primary role (highest score above threshold)
  SELECT role INTO v_primary_role
  FROM (
    VALUES
      ('dealer', v_dealer_score),
      ('auction_house', v_auction_score),
      ('service_shop', v_service_score),
      ('collector', v_collector_score)
  ) AS scores(role, score)
  WHERE score >= 20
  ORDER BY score DESC
  LIMIT 1;

  -- Collect active roles (all above threshold)
  SELECT array_agg(role ORDER BY score DESC) INTO v_active_roles
  FROM (
    VALUES
      ('dealer', v_dealer_score),
      ('auction_house', v_auction_score),
      ('service_shop', v_service_score),
      ('collector', v_collector_score)
  ) AS scores(role, score)
  WHERE score >= 20;

  -- Upsert behavior scores
  INSERT INTO organization_behavior_scores (
    organization_id,
    period_type,
    period_start,
    period_end,
    dealer_score,
    auction_house_score,
    service_shop_score,
    collector_score,
    primary_role,
    active_roles,
    total_signals,
    signal_counts,
    classification_confidence,
    computed_at
  ) VALUES (
    p_organization_id,
    'rolling_' || p_period_days || 'd',
    v_period_start,
    v_period_end,
    v_dealer_score,
    v_auction_score,
    v_service_score,
    v_collector_score,
    v_primary_role,
    COALESCE(v_active_roles, ARRAY[]::TEXT[]),
    COALESCE(v_total_signals, 0),
    COALESCE(v_signal_counts, '{}'::JSONB),
    CASE
      WHEN v_total_signals >= 50 THEN 0.95
      WHEN v_total_signals >= 20 THEN 0.80
      WHEN v_total_signals >= 10 THEN 0.60
      WHEN v_total_signals >= 5 THEN 0.40
      ELSE 0.20
    END,
    NOW()
  )
  ON CONFLICT (organization_id, period_type, period_start)
  DO UPDATE SET
    dealer_score = EXCLUDED.dealer_score,
    auction_house_score = EXCLUDED.auction_house_score,
    service_shop_score = EXCLUDED.service_shop_score,
    collector_score = EXCLUDED.collector_score,
    primary_role = EXCLUDED.primary_role,
    active_roles = EXCLUDED.active_roles,
    total_signals = EXCLUDED.total_signals,
    signal_counts = EXCLUDED.signal_counts,
    classification_confidence = EXCLUDED.classification_confidence,
    computed_at = NOW();

  -- Update the businesses table with computed role
  UPDATE businesses
  SET
    business_type = COALESCE(
      CASE v_primary_role
        WHEN 'dealer' THEN 'dealership'
        WHEN 'auction_house' THEN 'auction_house'
        WHEN 'service_shop' THEN 'restoration_shop'
        WHEN 'collector' THEN 'collection'
        ELSE business_type
      END,
      business_type
    ),
    metadata = COALESCE(metadata, '{}'::JSONB) || jsonb_build_object(
      'computed_roles', v_active_roles,
      'primary_role_score', GREATEST(v_dealer_score, v_auction_score, v_service_score, v_collector_score),
      'classification_computed_at', NOW()
    ),
    updated_at = NOW()
  WHERE id = p_organization_id
    AND v_primary_role IS NOT NULL
    AND GREATEST(v_dealer_score, v_auction_score, v_service_score, v_collector_score) >= 30;

END;
$$;

-- Function to compute investability score
CREATE OR REPLACE FUNCTION compute_org_investability_score(p_organization_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_traction_score INTEGER := 0;
  v_financial_score INTEGER := 0;
  v_operational_score INTEGER := 0;
  v_market_score INTEGER := 0;
  v_data_score INTEGER := 0;
  v_overall_score INTEGER := 0;
  v_tier TEXT;
  v_recommendations JSONB := '[]'::JSONB;
  v_vehicle_count INTEGER;
  v_sale_count INTEGER;
  v_total_revenue NUMERIC;
  v_has_quickbooks BOOLEAN;
  v_behavior_scores RECORD;
BEGIN
  -- Get basic counts
  SELECT COUNT(*) INTO v_vehicle_count
  FROM organization_vehicles
  WHERE organization_id = p_organization_id;

  SELECT COUNT(*) INTO v_sale_count
  FROM organization_vehicles ov
  JOIN vehicles v ON v.id = ov.vehicle_id
  WHERE ov.organization_id = p_organization_id
    AND v.sale_status = 'sold';

  SELECT SUM(COALESCE(v.sale_price, 0)) INTO v_total_revenue
  FROM organization_vehicles ov
  JOIN vehicles v ON v.id = ov.vehicle_id
  WHERE ov.organization_id = p_organization_id
    AND v.sale_status = 'sold';

  SELECT COALESCE(metadata->>'quickbooks_connected', 'false')::BOOLEAN INTO v_has_quickbooks
  FROM businesses WHERE id = p_organization_id;

  SELECT * INTO v_behavior_scores
  FROM organization_behavior_scores
  WHERE organization_id = p_organization_id
  ORDER BY computed_at DESC LIMIT 1;

  -- TRACTION SCORE (30% weight)
  v_traction_score := LEAST(100, (
    LEAST(v_vehicle_count, 100) +  -- Up to 100 points for vehicles handled
    LEAST(v_sale_count * 2, 50) +   -- Up to 50 points for sales
    CASE WHEN v_total_revenue > 1000000 THEN 30
         WHEN v_total_revenue > 100000 THEN 20
         WHEN v_total_revenue > 10000 THEN 10
         ELSE 0 END
  ) / 2);

  IF v_traction_score < 30 THEN
    v_recommendations := v_recommendations || jsonb_build_object(
      'category', 'traction',
      'action', 'Increase transaction volume',
      'current', v_vehicle_count,
      'target', 50,
      'impact', '+20 points'
    );
  END IF;

  -- FINANCIAL SCORE (25% weight)
  v_financial_score := CASE
    WHEN v_has_quickbooks THEN 40
    ELSE 10
  END;
  v_financial_score := v_financial_score + CASE
    WHEN v_total_revenue > 500000 THEN 60
    WHEN v_total_revenue > 100000 THEN 40
    WHEN v_total_revenue > 10000 THEN 20
    ELSE 0
  END;
  v_financial_score := LEAST(100, v_financial_score);

  IF NOT v_has_quickbooks THEN
    v_recommendations := v_recommendations || jsonb_build_object(
      'category', 'financial',
      'action', 'Connect QuickBooks for real-time financials',
      'impact', '+30 points'
    );
  END IF;

  -- OPERATIONAL SCORE (20% weight)
  v_operational_score := CASE
    WHEN v_behavior_scores.classification_confidence >= 0.8 THEN 40
    WHEN v_behavior_scores.classification_confidence >= 0.5 THEN 20
    ELSE 10
  END;
  v_operational_score := v_operational_score + LEAST(60, v_sale_count);
  v_operational_score := LEAST(100, v_operational_score);

  -- MARKET SCORE (15% weight)
  v_market_score := CASE
    WHEN v_behavior_scores.primary_role IS NOT NULL THEN 50
    ELSE 20
  END;
  v_market_score := v_market_score + LEAST(50, COALESCE(array_length(v_behavior_scores.active_roles, 1), 0) * 10);
  v_market_score := LEAST(100, v_market_score);

  -- DATA SCORE (10% weight)
  v_data_score := CASE WHEN v_has_quickbooks THEN 50 ELSE 0 END;
  v_data_score := v_data_score + CASE WHEN v_behavior_scores.total_signals >= 20 THEN 50 ELSE v_behavior_scores.total_signals * 2 END;
  v_data_score := LEAST(100, v_data_score);

  -- OVERALL SCORE (weighted average)
  v_overall_score := (
    v_traction_score * 30 +
    v_financial_score * 25 +
    v_operational_score * 20 +
    v_market_score * 15 +
    v_data_score * 10
  ) / 100;

  -- Determine tier
  SELECT tier INTO v_tier
  FROM investability_tier_requirements
  WHERE min_overall_score <= v_overall_score
  ORDER BY tier_order DESC
  LIMIT 1;

  -- Upsert investability score
  INSERT INTO organization_investability_scores (
    organization_id,
    overall_score,
    investability_tier,
    traction_score,
    traction_details,
    financial_score,
    financial_details,
    operational_score,
    operational_details,
    market_score,
    market_details,
    data_score,
    data_details,
    improvement_recommendations,
    computed_at
  ) VALUES (
    p_organization_id,
    v_overall_score,
    COALESCE(v_tier, 'pre_seed'),
    v_traction_score,
    jsonb_build_object('vehicles', v_vehicle_count, 'sales', v_sale_count, 'revenue', v_total_revenue),
    v_financial_score,
    jsonb_build_object('quickbooks_connected', v_has_quickbooks, 'total_revenue', v_total_revenue),
    v_operational_score,
    jsonb_build_object('classification_confidence', v_behavior_scores.classification_confidence),
    v_market_score,
    jsonb_build_object('primary_role', v_behavior_scores.primary_role, 'active_roles', v_behavior_scores.active_roles),
    v_data_score,
    jsonb_build_object('total_signals', v_behavior_scores.total_signals),
    v_recommendations,
    NOW()
  )
  ON CONFLICT (organization_id) DO UPDATE SET
    overall_score = EXCLUDED.overall_score,
    investability_tier = EXCLUDED.investability_tier,
    traction_score = EXCLUDED.traction_score,
    traction_details = EXCLUDED.traction_details,
    financial_score = EXCLUDED.financial_score,
    financial_details = EXCLUDED.financial_details,
    operational_score = EXCLUDED.operational_score,
    operational_details = EXCLUDED.operational_details,
    market_score = EXCLUDED.market_score,
    market_details = EXCLUDED.market_details,
    data_score = EXCLUDED.data_score,
    data_details = EXCLUDED.data_details,
    improvement_recommendations = EXCLUDED.improvement_recommendations,
    computed_at = NOW();

  RETURN v_overall_score;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- PART 7: BATCH PROCESSING
-- ═══════════════════════════════════════════════════════════════════════════════

-- Function to process all organizations
CREATE OR REPLACE FUNCTION recompute_all_org_intelligence()
RETURNS TABLE(organization_id UUID, business_name TEXT, signals INTEGER, investability INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_signals_created INTEGER;
BEGIN
  -- Step 1: Generate signals from existing data
  SELECT generate_signals_from_org_vehicles() INTO v_signals_created;
  RAISE NOTICE 'Generated % new signals from org_vehicles', v_signals_created;

  -- Step 2: Compute scores for each org with signals
  RETURN QUERY
  SELECT
    b.id as organization_id,
    b.business_name,
    (SELECT COUNT(*)::INTEGER FROM organization_behavior_signals obs WHERE obs.organization_id = b.id) as signals,
    compute_org_investability_score(b.id) as investability
  FROM businesses b
  WHERE EXISTS (
    SELECT 1 FROM organization_behavior_signals obs WHERE obs.organization_id = b.id
  )
  ORDER BY signals DESC;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- PART 8: VIEWS FOR ANALYSIS
-- ═══════════════════════════════════════════════════════════════════════════════

-- Comprehensive org profile view
CREATE OR REPLACE VIEW organization_intelligence_profile AS
SELECT
  b.id,
  b.business_name,
  b.business_type as static_type,

  -- Computed classification
  bs.primary_role as computed_role,
  bs.active_roles,
  bs.classification_confidence,

  -- Scores
  bs.dealer_score,
  bs.auction_house_score,
  bs.service_shop_score,
  bs.collector_score,
  bs.total_signals,

  -- Investability
  inv.overall_score as investability_score,
  inv.investability_tier,
  inv.traction_score,
  inv.financial_score,
  inv.operational_score,
  inv.market_score,
  inv.data_score,
  inv.improvement_recommendations,

  -- Basic info
  b.website,
  b.city,
  b.state,
  b.created_at

FROM businesses b
LEFT JOIN organization_behavior_scores bs ON bs.organization_id = b.id
  AND bs.period_type = 'rolling_90d'
LEFT JOIN organization_investability_scores inv ON inv.organization_id = b.id;

COMMENT ON VIEW organization_intelligence_profile IS 'Complete org profile with computed classification and investability';

-- ═══════════════════════════════════════════════════════════════════════════════
-- EXECUTION
-- ═══════════════════════════════════════════════════════════════════════════════

-- Run initial signal generation
SELECT generate_signals_from_org_vehicles();
