-- ============================================
-- COMPREHENSIVE TIMELINE INTEGRATION
-- Ties together: Clients, Tools, Parts, Suppliers, Knowledge, TCI, Social Value
-- ============================================

-- ============================================
-- CLIENT MANAGEMENT & PRIVACY
-- ============================================

CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Basic info
  client_name TEXT NOT NULL,
  company_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  
  -- Privacy controls
  is_private BOOLEAN DEFAULT FALSE,
  blur_level TEXT DEFAULT 'none' CHECK (blur_level IN ('none', 'low', 'medium', 'high')),
  
  -- Relations
  business_entity_id UUID REFERENCES business_entities(id),
  
  -- Tracking
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS client_privacy_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  
  -- What to hide
  hide_name BOOLEAN DEFAULT FALSE,
  hide_contact BOOLEAN DEFAULT TRUE,
  blur_images BOOLEAN DEFAULT FALSE,
  blur_intensity TEXT DEFAULT 'medium' CHECK (blur_intensity IN ('light', 'medium', 'heavy')),
  
  -- Public visibility
  show_in_public_feed BOOLEAN DEFAULT TRUE,
  show_in_search BOOLEAN DEFAULT TRUE,
  
  -- Selective visibility (array of user IDs who can see full info)
  allowed_viewers UUID[] DEFAULT ARRAY[]::UUID[],
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(client_id)
);

-- ============================================
-- LINK TIMELINE EVENTS TO CLIENTS
-- ============================================

ALTER TABLE timeline_events 
  ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id),
  ADD COLUMN IF NOT EXISTS is_monetized BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS work_started TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS work_completed TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_timeline_events_client ON timeline_events(client_id);
CREATE INDEX IF NOT EXISTS idx_timeline_events_monetized ON timeline_events(is_monetized);

-- ============================================
-- FINANCIAL TRACKING (TCI - Total Cost Involved)
-- ============================================

CREATE TABLE IF NOT EXISTS event_financial_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES timeline_events(id) ON DELETE CASCADE,
  
  -- Cost breakdown
  labor_cost DECIMAL(10,2) DEFAULT 0,
  labor_hours DECIMAL(6,2) DEFAULT 0,
  labor_rate DECIMAL(8,2) DEFAULT 0,
  
  parts_cost DECIMAL(10,2) DEFAULT 0,
  supplies_cost DECIMAL(10,2) DEFAULT 0,
  overhead_cost DECIMAL(10,2) DEFAULT 0,
  tool_depreciation_cost DECIMAL(10,2) DEFAULT 0,
  
  -- Totals
  total_cost DECIMAL(10,2) GENERATED ALWAYS AS (
    COALESCE(labor_cost, 0) + 
    COALESCE(parts_cost, 0) + 
    COALESCE(supplies_cost, 0) + 
    COALESCE(overhead_cost, 0) + 
    COALESCE(tool_depreciation_cost, 0)
  ) STORED,
  
  -- Customer pricing
  customer_price DECIMAL(10,2),
  
  -- Profit margin (calculated)
  profit_margin DECIMAL(10,2) GENERATED ALWAYS AS (
    COALESCE(customer_price, 0) - (
      COALESCE(labor_cost, 0) + 
      COALESCE(parts_cost, 0) + 
      COALESCE(supplies_cost, 0) + 
      COALESCE(overhead_cost, 0) + 
      COALESCE(tool_depreciation_cost, 0)
    )
  ) STORED,
  
  profit_margin_percent DECIMAL(6,2),
  
  currency TEXT DEFAULT 'USD',
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(event_id)
);

CREATE INDEX IF NOT EXISTS idx_financial_event ON event_financial_records(event_id);

-- ============================================
-- TOOLS USAGE TRACKING (LINKS TO EXISTING tool_catalog)
-- ============================================

CREATE TABLE IF NOT EXISTS event_tools_used (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES timeline_events(id) ON DELETE CASCADE,
  
  -- Link to existing tool system
  tool_id UUID REFERENCES user_tools(id),  -- From existing comprehensive_tools_schema
  
  -- Usage details
  duration_minutes INTEGER,
  usage_context TEXT, -- 'lift', 'diagnostic', 'assembly', 'disassembly'
  
  -- Check-out/in tracking
  checked_out_at TIMESTAMPTZ,
  checked_in_at TIMESTAMPTZ,
  returned BOOLEAN DEFAULT FALSE,
  
  -- Depreciation cost for this usage
  depreciation_cost DECIMAL(8,2),
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tools_event ON event_tools_used(event_id);
CREATE INDEX IF NOT EXISTS idx_tools_tool ON event_tools_used(tool_id);

-- ============================================
-- PARTS USAGE TRACKING (LINKS TO EXISTING build_line_items)
-- ============================================

CREATE TABLE IF NOT EXISTS event_parts_used (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES timeline_events(id) ON DELETE CASCADE,
  
  -- Link to existing parts/build system
  line_item_id UUID REFERENCES build_line_items(id),
  supplier_id UUID REFERENCES suppliers(id),
  
  -- Part details (if not linked to line item)
  part_number TEXT,
  part_name TEXT NOT NULL,
  quantity INTEGER DEFAULT 1,
  
  -- Pricing
  cost_price DECIMAL(10,2),
  retail_price DECIMAL(10,2),
  markup_percent DECIMAL(6,2),
  
  -- Reception tracking
  reception_id UUID REFERENCES parts_reception(id),
  
  -- Installation timing
  installed_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_parts_event ON event_parts_used(event_id);
CREATE INDEX IF NOT EXISTS idx_parts_supplier ON event_parts_used(supplier_id);

-- ============================================
-- PARTS RECEPTION & TURNAROUND TRACKING
-- ============================================

CREATE TABLE IF NOT EXISTS parts_reception (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Link to supplier and order
  supplier_id UUID NOT NULL REFERENCES suppliers(id),
  po_number TEXT,
  
  -- What was ordered
  part_id UUID, -- Could link to tool_catalog or build_line_items
  part_number TEXT,
  quantity_ordered INTEGER NOT NULL,
  quantity_received INTEGER,
  
  -- Timing (key for turnaround metrics)
  order_date TIMESTAMPTZ NOT NULL,
  expected_delivery_date DATE,
  actual_delivery_date TIMESTAMPTZ,
  
  -- Quality check
  condition_on_arrival TEXT CHECK (condition_on_arrival IN ('excellent', 'good', 'acceptable', 'damaged', 'wrong_item')),
  quality_check_passed BOOLEAN DEFAULT TRUE,
  quality_notes TEXT,
  
  -- Costs
  unit_cost DECIMAL(10,2),
  shipping_cost DECIMAL(10,2),
  total_cost DECIMAL(10,2),
  
  -- Status
  status TEXT DEFAULT 'ordered' CHECK (status IN ('ordered', 'shipped', 'received', 'installed', 'returned')),
  
  notes TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reception_supplier ON parts_reception(supplier_id);
CREATE INDEX IF NOT EXISTS idx_reception_dates ON parts_reception(order_date, actual_delivery_date);

-- ============================================
-- TURNAROUND METRICS (Calculated per Event)
-- ============================================

CREATE TABLE IF NOT EXISTS event_turnaround_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES timeline_events(id) ON DELETE CASCADE,
  
  -- Key timestamps
  parts_ordered_at TIMESTAMPTZ,
  parts_received_at TIMESTAMPTZ,
  work_started_at TIMESTAMPTZ,
  work_completed_at TIMESTAMPTZ,
  
  -- Calculated durations (in hours)
  order_to_delivery_hours DECIMAL(8,2),
  delivery_to_install_hours DECIMAL(8,2),
  work_duration_hours DECIMAL(8,2),
  total_turnaround_hours DECIMAL(8,2),
  
  -- Breakdown details
  timeline_breakdown JSONB, -- Detailed step-by-step timeline
  
  -- Efficiency metrics
  estimated_duration_hours DECIMAL(8,2),
  duration_variance_percent DECIMAL(6,2), -- actual vs estimated
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(event_id)
);

CREATE INDEX IF NOT EXISTS idx_turnaround_event ON event_turnaround_metrics(event_id);

-- ============================================
-- SUPPLIER RATING SYSTEM
-- ============================================

CREATE TABLE IF NOT EXISTS supplier_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  
  -- Scores (0-100)
  quality_score DECIMAL(5,2) DEFAULT 100,
  responsiveness_score DECIMAL(5,2) DEFAULT 100,
  pricing_score DECIMAL(5,2) DEFAULT 100,
  overall_score DECIMAL(5,2),
  
  -- Statistics
  total_orders INTEGER DEFAULT 0,
  on_time_deliveries INTEGER DEFAULT 0,
  quality_issues INTEGER DEFAULT 0,
  
  -- Calculated percentages
  on_time_percentage DECIMAL(5,2) GENERATED ALWAYS AS (
    CASE 
      WHEN total_orders > 0 THEN (on_time_deliveries::DECIMAL / total_orders * 100)
      ELSE 100
    END
  ) STORED,
  
  quality_pass_percentage DECIMAL(5,2) GENERATED ALWAYS AS (
    CASE 
      WHEN total_orders > 0 THEN ((total_orders - quality_issues)::DECIMAL / total_orders * 100)
      ELSE 100
    END
  ) STORED,
  
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(supplier_id)
);

CREATE INDEX IF NOT EXISTS idx_supplier_ratings ON supplier_ratings(supplier_id);

-- ============================================
-- QUALITY INCIDENTS
-- ============================================

CREATE TABLE IF NOT EXISTS supplier_quality_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID NOT NULL REFERENCES suppliers(id),
  reception_id UUID REFERENCES parts_reception(id),
  
  incident_date TIMESTAMPTZ DEFAULT NOW(),
  issue_type TEXT NOT NULL CHECK (issue_type IN ('damaged', 'wrong_part', 'defective', 'missing_items', 'late_delivery')),
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  
  description TEXT NOT NULL,
  resolution TEXT,
  cost_impact DECIMAL(10,2),
  
  -- Supplier response
  supplier_notified_at TIMESTAMPTZ,
  supplier_response TEXT,
  supplier_credited BOOLEAN DEFAULT FALSE,
  credit_amount DECIMAL(10,2),
  
  resolved_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_incidents_supplier ON supplier_quality_incidents(supplier_id);
CREATE INDEX IF NOT EXISTS idx_incidents_date ON supplier_quality_incidents(incident_date);

-- ============================================
-- KNOWLEDGE BASE SYSTEM
-- ============================================

CREATE TABLE IF NOT EXISTS knowledge_base (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Content
  title TEXT NOT NULL,
  category TEXT NOT NULL, -- 'procedure', 'specification', 'common_issue', 'diagnostic', 'reference'
  content TEXT NOT NULL,
  content_markdown TEXT,
  
  -- Applicability
  applicable_to JSONB, -- { "makes": ["GMC", "Chevrolet"], "years": [1973-1991], "models": ["K5", "C10"] }
  
  -- Metadata
  tags TEXT[],
  metadata JSONB,
  
  -- Usage tracking
  times_referenced INTEGER DEFAULT 0,
  helpfulness_score DECIMAL(4,2) DEFAULT 0, -- 0-10 based on user feedback
  
  -- Authorship
  created_by UUID REFERENCES auth.users(id),
  verified_by UUID REFERENCES auth.users(id),
  is_verified BOOLEAN DEFAULT FALSE,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_category ON knowledge_base(category);
CREATE INDEX IF NOT EXISTS idx_knowledge_tags ON knowledge_base USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_knowledge_referenced ON knowledge_base(times_referenced DESC);

-- ============================================
-- PROCEDURE STEPS (Linked to Knowledge Base)
-- ============================================

CREATE TABLE IF NOT EXISTS procedure_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  knowledge_id UUID NOT NULL REFERENCES knowledge_base(id) ON DELETE CASCADE,
  
  step_number INTEGER NOT NULL,
  instruction TEXT NOT NULL,
  warning_level TEXT CHECK (warning_level IN ('none', 'caution', 'warning', 'danger')),
  
  -- Estimates
  estimated_duration_minutes INTEGER,
  
  -- Requirements
  required_tools TEXT[], -- Tool names/IDs
  required_parts TEXT[], -- Part numbers
  required_skills TEXT[], -- 'welding', 'electrical', 'fabrication'
  
  -- Media
  image_urls TEXT[],
  video_url TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_steps_knowledge ON procedure_steps(knowledge_id);

-- ============================================
-- TORQUE SPECIFICATIONS
-- ============================================

CREATE TABLE IF NOT EXISTS torque_specs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  knowledge_id UUID REFERENCES knowledge_base(id) ON DELETE CASCADE,
  
  component TEXT NOT NULL,
  location TEXT,
  
  torque_value DECIMAL(6,2) NOT NULL,
  torque_unit TEXT DEFAULT 'ft-lbs' CHECK (torque_unit IN ('ft-lbs', 'in-lbs', 'nm')),
  
  -- Pattern/sequence
  tightening_pattern TEXT, -- 'crisscross', 'spiral', 'sequential'
  sequence_diagram_url TEXT,
  
  -- Specs
  thread_size TEXT,
  thread_pitch TEXT,
  grade TEXT, -- Bolt grade
  
  notes TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_torque_knowledge ON torque_specs(knowledge_id);

-- ============================================
-- COMMON ISSUES DATABASE
-- ============================================

CREATE TABLE IF NOT EXISTS common_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  knowledge_id UUID REFERENCES knowledge_base(id) ON DELETE CASCADE,
  
  symptom TEXT NOT NULL,
  probable_cause TEXT NOT NULL,
  diagnostic_steps TEXT[],
  solution TEXT NOT NULL,
  
  -- Cost estimates
  typical_labor_hours DECIMAL(5,2),
  typical_parts_cost DECIMAL(10,2),
  typical_total_cost DECIMAL(10,2),
  
  -- Frequency
  times_encountered INTEGER DEFAULT 0,
  severity TEXT CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_issues_knowledge ON common_issues(knowledge_id);
CREATE INDEX IF NOT EXISTS idx_issues_encountered ON common_issues(times_encountered DESC);

-- ============================================
-- KNOWLEDGE APPLIED TO EVENTS
-- ============================================

CREATE TABLE IF NOT EXISTS event_knowledge_applied (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES timeline_events(id) ON DELETE CASCADE,
  knowledge_id UUID NOT NULL REFERENCES knowledge_base(id),
  
  knowledge_type TEXT NOT NULL CHECK (knowledge_type IN ('procedure', 'specification', 'common_issue', 'diagnostic', 'reference')),
  
  -- Feedback
  was_helpful BOOLEAN,
  accuracy_rating INTEGER CHECK (accuracy_rating >= 1 AND accuracy_rating <= 5),
  notes TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_applied_event ON event_knowledge_applied(event_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_applied_kb ON event_knowledge_applied(knowledge_id);

-- ============================================
-- SOCIAL METRICS & MONETIZATION
-- ============================================

CREATE TABLE IF NOT EXISTS event_social_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES timeline_events(id) ON DELETE CASCADE,
  
  -- Engagement stats
  views INTEGER DEFAULT 0,
  likes INTEGER DEFAULT 0,
  comments INTEGER DEFAULT 0,
  shares INTEGER DEFAULT 0,
  saves INTEGER DEFAULT 0,
  
  -- Calculated engagement rate
  engagement_rate DECIMAL(5,2) GENERATED ALWAYS AS (
    CASE 
      WHEN views > 0 THEN ((likes + comments + shares)::DECIMAL / views * 100)
      ELSE 0
    END
  ) STORED,
  
  -- Platform breakdown
  platform_stats JSONB, -- { "instagram": {views: 1000}, "youtube": {views: 500} }
  
  last_calculated TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(event_id)
);

CREATE INDEX IF NOT EXISTS idx_social_event ON event_social_metrics(event_id);

-- ============================================
-- PARTNERSHIP DEALS
-- ============================================

CREATE TABLE IF NOT EXISTS partnership_deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  social_metrics_id UUID NOT NULL REFERENCES event_social_metrics(id) ON DELETE CASCADE,
  
  partner_name TEXT NOT NULL,
  deal_type TEXT NOT NULL CHECK (deal_type IN ('product_placement', 'brand_integration', 'affiliate', 'sponsored_content')),
  
  amount_earned DECIMAL(10,2) NOT NULL,
  currency TEXT DEFAULT 'USD',
  
  -- Contract details
  contract_start_date DATE,
  contract_end_date DATE,
  payment_terms TEXT,
  
  deal_date DATE DEFAULT CURRENT_DATE,
  status TEXT DEFAULT 'active' CHECK (status IN ('pending', 'active', 'completed', 'cancelled')),
  
  notes TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deals_social ON partnership_deals(social_metrics_id);

-- ============================================
-- SPONSORSHIPS
-- ============================================

CREATE TABLE IF NOT EXISTS sponsorships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  social_metrics_id UUID NOT NULL REFERENCES event_social_metrics(id) ON DELETE CASCADE,
  
  sponsor_name TEXT NOT NULL,
  sponsor_logo_url TEXT,
  
  sponsored_amount DECIMAL(10,2) NOT NULL,
  currency TEXT DEFAULT 'USD',
  
  -- Visibility requirements
  visibility_level TEXT CHECK (visibility_level IN ('logo_only', 'mention', 'featured', 'exclusive')),
  placement_requirements TEXT,
  
  start_date DATE NOT NULL,
  end_date DATE,
  
  status TEXT DEFAULT 'active' CHECK (status IN ('pending', 'active', 'completed', 'cancelled')),
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sponsorships_social ON sponsorships(social_metrics_id);

-- ============================================
-- VIEWER PAYMENTS (Tips, Memberships, etc.)
-- ============================================

CREATE TABLE IF NOT EXISTS viewer_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  social_metrics_id UUID NOT NULL REFERENCES event_social_metrics(id) ON DELETE CASCADE,
  
  payment_type TEXT NOT NULL CHECK (payment_type IN ('tip', 'membership', 'super_chat', 'donation', 'pay_per_view')),
  
  amount DECIMAL(10,2) NOT NULL,
  currency TEXT DEFAULT 'USD',
  
  viewer_count INTEGER DEFAULT 1,
  platform TEXT, -- 'youtube', 'patreon', 'buy_me_coffee', etc.
  
  payment_date TIMESTAMPTZ DEFAULT NOW(),
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_social ON viewer_payments(social_metrics_id);
CREATE INDEX IF NOT EXISTS idx_payments_date ON viewer_payments(payment_date);

-- ============================================
-- SOCIAL VALUE CALCULATION (Materialized)
-- ============================================

CREATE MATERIALIZED VIEW event_social_value AS
SELECT 
  esm.event_id,
  esm.id as social_metrics_id,
  
  -- Partnership revenue
  COALESCE(SUM(pd.amount_earned), 0) as partnership_revenue,
  
  -- Sponsorship revenue
  COALESCE(SUM(s.sponsored_amount), 0) as sponsorship_revenue,
  
  -- Viewer revenue
  COALESCE(SUM(vp.amount), 0) as viewer_revenue,
  
  -- Total social value
  COALESCE(SUM(pd.amount_earned), 0) + 
  COALESCE(SUM(s.sponsored_amount), 0) + 
  COALESCE(SUM(vp.amount), 0) as total_social_value,
  
  NOW() as calculated_at
FROM event_social_metrics esm
LEFT JOIN partnership_deals pd ON pd.social_metrics_id = esm.id
LEFT JOIN sponsorships s ON s.social_metrics_id = esm.id
LEFT JOIN viewer_payments vp ON vp.social_metrics_id = esm.id
GROUP BY esm.id, esm.event_id;

CREATE UNIQUE INDEX idx_social_value_event ON event_social_value(event_id);
CREATE INDEX idx_social_value_total ON event_social_value(total_social_value DESC);

-- Refresh function
CREATE OR REPLACE FUNCTION refresh_social_value()
RETURNS TRIGGER AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY event_social_value;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Triggers to auto-refresh on data changes
CREATE TRIGGER refresh_social_value_on_deal
  AFTER INSERT OR UPDATE OR DELETE ON partnership_deals
  FOR EACH STATEMENT
  EXECUTE FUNCTION refresh_social_value();

CREATE TRIGGER refresh_social_value_on_sponsor
  AFTER INSERT OR UPDATE OR DELETE ON sponsorships
  FOR EACH STATEMENT
  EXECUTE FUNCTION refresh_social_value();

CREATE TRIGGER refresh_social_value_on_payment
  AFTER INSERT OR UPDATE OR DELETE ON viewer_payments
  FOR EACH STATEMENT
  EXECUTE FUNCTION refresh_social_value();

-- ============================================
-- FUNCTIONS: Calculate TCI for Event
-- ============================================

CREATE OR REPLACE FUNCTION calculate_event_tci(p_event_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_labor_cost DECIMAL(10,2);
  v_parts_cost DECIMAL(10,2);
  v_supplies_cost DECIMAL(10,2);
  v_overhead_cost DECIMAL(10,2);
  v_tool_cost DECIMAL(10,2);
  v_total_cost DECIMAL(10,2);
  v_customer_price DECIMAL(10,2);
  v_profit_margin DECIMAL(10,2);
  v_result JSONB;
BEGIN
  -- Get or create financial record
  INSERT INTO event_financial_records (event_id)
  VALUES (p_event_id)
  ON CONFLICT (event_id) DO NOTHING;
  
  -- Calculate parts cost from event_parts_used
  SELECT COALESCE(SUM(cost_price * quantity), 0)
  INTO v_parts_cost
  FROM event_parts_used
  WHERE event_id = p_event_id;
  
  -- Calculate tool depreciation from event_tools_used
  SELECT COALESCE(SUM(depreciation_cost), 0)
  INTO v_tool_cost
  FROM event_tools_used
  WHERE event_id = p_event_id;
  
  -- Get existing labor/overhead from financial record
  SELECT 
    labor_cost,
    supplies_cost,
    overhead_cost,
    customer_price
  INTO 
    v_labor_cost,
    v_supplies_cost,
    v_overhead_cost,
    v_customer_price
  FROM event_financial_records
  WHERE event_id = p_event_id;
  
  v_total_cost := COALESCE(v_labor_cost, 0) + COALESCE(v_parts_cost, 0) + 
                  COALESCE(v_supplies_cost, 0) + COALESCE(v_overhead_cost, 0) + 
                  COALESCE(v_tool_cost, 0);
  
  v_profit_margin := COALESCE(v_customer_price, 0) - v_total_cost;
  
  -- Update financial record with calculated values
  UPDATE event_financial_records
  SET 
    parts_cost = v_parts_cost,
    tool_depreciation_cost = v_tool_cost,
    updated_at = NOW()
  WHERE event_id = p_event_id;
  
  -- Build result JSON
  v_result := jsonb_build_object(
    'labor_cost', v_labor_cost,
    'parts_cost', v_parts_cost,
    'supplies_cost', v_supplies_cost,
    'overhead_cost', v_overhead_cost,
    'tool_cost', v_tool_cost,
    'total_cost', v_total_cost,
    'customer_price', v_customer_price,
    'profit_margin', v_profit_margin,
    'profit_margin_percent', CASE WHEN v_customer_price > 0 
                                   THEN (v_profit_margin / v_customer_price * 100) 
                                   ELSE 0 END
  );
  
  RETURN v_result;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- FUNCTIONS: Calculate Turnaround Time
-- ============================================

CREATE OR REPLACE FUNCTION calculate_turnaround_time(p_event_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_parts_ordered TIMESTAMPTZ;
  v_parts_received TIMESTAMPTZ;
  v_work_started TIMESTAMPTZ;
  v_work_completed TIMESTAMPTZ;
  v_order_to_delivery DECIMAL(8,2);
  v_delivery_to_install DECIMAL(8,2);
  v_work_duration DECIMAL(8,2);
  v_total_turnaround DECIMAL(8,2);
  v_result JSONB;
BEGIN
  -- Get earliest parts order date
  SELECT MIN(pr.order_date)
  INTO v_parts_ordered
  FROM parts_reception pr
  JOIN event_parts_used epu ON epu.reception_id = pr.id
  WHERE epu.event_id = p_event_id;
  
  -- Get latest parts received date
  SELECT MAX(pr.actual_delivery_date)
  INTO v_parts_received
  FROM parts_reception pr
  JOIN event_parts_used epu ON epu.reception_id = pr.id
  WHERE epu.event_id = p_event_id;
  
  -- Get work timestamps from timeline_events
  SELECT work_started, work_completed
  INTO v_work_started, v_work_completed
  FROM timeline_events
  WHERE id = p_event_id;
  
  -- Calculate durations in hours
  IF v_parts_ordered IS NOT NULL AND v_parts_received IS NOT NULL THEN
    v_order_to_delivery := EXTRACT(EPOCH FROM (v_parts_received - v_parts_ordered)) / 3600;
  END IF;
  
  IF v_parts_received IS NOT NULL AND v_work_started IS NOT NULL THEN
    v_delivery_to_install := EXTRACT(EPOCH FROM (v_work_started - v_parts_received)) / 3600;
  END IF;
  
  IF v_work_started IS NOT NULL AND v_work_completed IS NOT NULL THEN
    v_work_duration := EXTRACT(EPOCH FROM (v_work_completed - v_work_started)) / 3600;
  END IF;
  
  IF v_parts_ordered IS NOT NULL AND v_work_completed IS NOT NULL THEN
    v_total_turnaround := EXTRACT(EPOCH FROM (v_work_completed - v_parts_ordered)) / 3600;
  END IF;
  
  -- Update or insert metrics
  INSERT INTO event_turnaround_metrics (
    event_id,
    parts_ordered_at,
    parts_received_at,
    work_started_at,
    work_completed_at,
    order_to_delivery_hours,
    delivery_to_install_hours,
    work_duration_hours,
    total_turnaround_hours
  ) VALUES (
    p_event_id,
    v_parts_ordered,
    v_parts_received,
    v_work_started,
    v_work_completed,
    v_order_to_delivery,
    v_delivery_to_install,
    v_work_duration,
    v_total_turnaround
  )
  ON CONFLICT (event_id) DO UPDATE SET
    parts_ordered_at = EXCLUDED.parts_ordered_at,
    parts_received_at = EXCLUDED.parts_received_at,
    work_started_at = EXCLUDED.work_started_at,
    work_completed_at = EXCLUDED.work_completed_at,
    order_to_delivery_hours = EXCLUDED.order_to_delivery_hours,
    delivery_to_install_hours = EXCLUDED.delivery_to_install_hours,
    work_duration_hours = EXCLUDED.work_duration_hours,
    total_turnaround_hours = EXCLUDED.total_turnaround_hours,
    updated_at = NOW();
  
  v_result := jsonb_build_object(
    'parts_ordered_at', v_parts_ordered,
    'parts_received_at', v_parts_received,
    'work_started_at', v_work_started,
    'work_completed_at', v_work_completed,
    'order_to_delivery_hours', v_order_to_delivery,
    'delivery_to_install_hours', v_delivery_to_install,
    'work_duration_hours', v_work_duration,
    'total_turnaround_hours', v_total_turnaround
  );
  
  RETURN v_result;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- FUNCTIONS: Update Supplier Rating
-- ============================================

CREATE OR REPLACE FUNCTION update_supplier_rating(p_supplier_id UUID)
RETURNS VOID AS $$
DECLARE
  v_total_orders INTEGER;
  v_on_time INTEGER;
  v_quality_issues INTEGER;
  v_quality_score DECIMAL(5,2);
  v_responsiveness_score DECIMAL(5,2);
  v_overall_score DECIMAL(5,2);
BEGIN
  -- Count total orders
  SELECT COUNT(*)
  INTO v_total_orders
  FROM parts_reception
  WHERE supplier_id = p_supplier_id;
  
  -- Count on-time deliveries
  SELECT COUNT(*)
  INTO v_on_time
  FROM parts_reception
  WHERE supplier_id = p_supplier_id
    AND actual_delivery_date <= expected_delivery_date;
  
  -- Count quality issues
  SELECT COUNT(*)
  INTO v_quality_issues
  FROM supplier_quality_incidents
  WHERE supplier_id = p_supplier_id;
  
  -- Calculate scores
  IF v_total_orders > 0 THEN
    v_quality_score := ((v_total_orders - v_quality_issues)::DECIMAL / v_total_orders * 100);
    v_responsiveness_score := (v_on_time::DECIMAL / v_total_orders * 100);
  ELSE
    v_quality_score := 100;
    v_responsiveness_score := 100;
  END IF;
  
  -- Overall score (weighted average)
  v_overall_score := (v_quality_score * 0.4) + (v_responsiveness_score * 0.4) + (100 * 0.2); -- 20% for pricing (placeholder)
  
  -- Insert or update rating
  INSERT INTO supplier_ratings (
    supplier_id,
    quality_score,
    responsiveness_score,
    overall_score,
    total_orders,
    on_time_deliveries,
    quality_issues
  ) VALUES (
    p_supplier_id,
    v_quality_score,
    v_responsiveness_score,
    v_overall_score,
    v_total_orders,
    v_on_time,
    v_quality_issues
  )
  ON CONFLICT (supplier_id) DO UPDATE SET
    quality_score = EXCLUDED.quality_score,
    responsiveness_score = EXCLUDED.responsiveness_score,
    overall_score = EXCLUDED.overall_score,
    total_orders = EXCLUDED.total_orders,
    on_time_deliveries = EXCLUDED.on_time_deliveries,
    quality_issues = EXCLUDED.quality_issues,
    last_updated = NOW();
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update supplier rating
CREATE OR REPLACE FUNCTION trigger_update_supplier_rating()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM update_supplier_rating(NEW.supplier_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_rating_on_reception
  AFTER INSERT OR UPDATE ON parts_reception
  FOR EACH ROW
  EXECUTE FUNCTION trigger_update_supplier_rating();

CREATE TRIGGER update_rating_on_incident
  AFTER INSERT OR UPDATE ON supplier_quality_incidents
  FOR EACH ROW
  EXECUTE FUNCTION trigger_update_supplier_rating();

-- ============================================
-- VIEW: Complete Event Summary with All Metrics
-- ============================================

CREATE OR REPLACE VIEW complete_event_summary AS
SELECT 
  te.id as event_id,
  te.title,
  te.event_date,
  te.vehicle_id,
  
  -- Client info (with privacy)
  c.id as client_id,
  CASE 
    WHEN c.is_private = FALSE THEN c.client_name
    WHEN cps.blur_level = 'high' THEN '██████████'
    WHEN cps.blur_level = 'medium' THEN SUBSTRING(c.client_name, 1, 4) || ' █████'
    WHEN cps.blur_level = 'low' THEN SUBSTRING(c.client_name, 1, 1) || '█████'
    ELSE c.client_name
  END as client_display_name,
  c.is_private,
  
  -- Financial (TCI)
  efr.labor_cost,
  efr.parts_cost,
  efr.supplies_cost,
  efr.overhead_cost,
  efr.tool_depreciation_cost,
  efr.total_cost as tci_total,
  efr.customer_price,
  efr.profit_margin,
  efr.profit_margin_percent,
  
  -- Social value
  esv.partnership_revenue,
  esv.sponsorship_revenue,
  esv.viewer_revenue,
  esv.total_social_value,
  
  -- Combined value
  COALESCE(efr.profit_margin, 0) + COALESCE(esv.total_social_value, 0) as combined_profit,
  
  -- Turnaround metrics
  etm.total_turnaround_hours,
  etm.order_to_delivery_hours,
  etm.delivery_to_install_hours,
  etm.work_duration_hours,
  
  -- Engagement
  esm.views,
  esm.likes,
  esm.comments,
  esm.engagement_rate,
  
  -- Tools used count
  (SELECT COUNT(*) FROM event_tools_used WHERE event_id = te.id) as tools_used_count,
  
  -- Parts used count
  (SELECT COUNT(*) FROM event_parts_used WHERE event_id = te.id) as parts_used_count,
  
  -- Knowledge referenced count
  (SELECT COUNT(*) FROM event_knowledge_applied WHERE event_id = te.id) as knowledge_referenced_count
  
FROM timeline_events te
LEFT JOIN clients c ON c.id = te.client_id
LEFT JOIN client_privacy_settings cps ON cps.client_id = c.id
LEFT JOIN event_financial_records efr ON efr.event_id = te.id
LEFT JOIN event_social_metrics esm ON esm.event_id = te.id
LEFT JOIN event_social_value esv ON esv.event_id = te.id
LEFT JOIN event_turnaround_metrics etm ON etm.event_id = te.id;

-- ============================================
-- RLS POLICIES
-- ============================================

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_privacy_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_financial_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_tools_used ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_parts_used ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_base ENABLE ROW LEVEL SECURITY;

-- Clients: Users can see their own clients or non-private clients
CREATE POLICY "clients_read" ON clients
  FOR SELECT TO authenticated
  USING (created_by = auth.uid() OR is_private = FALSE);

CREATE POLICY "clients_create" ON clients
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

-- Privacy settings: Only client creator can manage
CREATE POLICY "privacy_manage" ON client_privacy_settings
  FOR ALL TO authenticated
  USING (client_id IN (SELECT id FROM clients WHERE created_by = auth.uid()))
  WITH CHECK (client_id IN (SELECT id FROM clients WHERE created_by = auth.uid()));

-- Financial records: Only event creators can see financials
CREATE POLICY "financial_read" ON event_financial_records
  FOR SELECT TO authenticated
  USING (
    event_id IN (
      SELECT te.id FROM timeline_events te
      JOIN vehicles v ON v.id = te.vehicle_id
      WHERE v.user_id = auth.uid()
    )
  );

-- Knowledge base: Everyone can read, authenticated can create
CREATE POLICY "knowledge_read_all" ON knowledge_base
  FOR SELECT TO public
  USING (true);

CREATE POLICY "knowledge_create" ON knowledge_base
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON TABLE clients IS 'Client/customer records with privacy controls for work documentation';
COMMENT ON TABLE event_financial_records IS 'TCI (Total Cost Involved) tracking for each timeline event';
COMMENT ON TABLE event_turnaround_metrics IS 'Turnaround time tracking from parts order to work completion';
COMMENT ON TABLE supplier_ratings IS 'Auto-calculated supplier performance ratings';
COMMENT ON TABLE knowledge_base IS 'Shop knowledge database: procedures, specs, common issues';
COMMENT ON VIEW complete_event_summary IS 'Complete event data: TCI, social value, turnaround, engagement';
COMMENT ON FUNCTION calculate_event_tci IS 'Calculate total cost involved for an event';
COMMENT ON FUNCTION calculate_turnaround_time IS 'Calculate end-to-end turnaround time metrics';
COMMENT ON FUNCTION update_supplier_rating IS 'Recalculate supplier performance rating';

