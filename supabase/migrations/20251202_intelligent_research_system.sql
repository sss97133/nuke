-- Intelligent Research System - Auto-Acquire Reference Data
-- Enables AI to autonomously search for and index missing reference data
-- Connects reference acquisition → component ID → repair cost estimation

-- ============================================
-- DATA SOURCE REGISTRY
-- ============================================

CREATE TABLE IF NOT EXISTS data_source_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- SOURCE IDENTITY
  source_name TEXT NOT NULL UNIQUE,
  source_url TEXT NOT NULL,
  source_type TEXT NOT NULL, -- 'parts_supplier', 'manufacturer_archive', 'community_forum', 'document_library'
  
  -- AUTHORITY & RELIABILITY
  authority_level INTEGER DEFAULT 5 CHECK (authority_level >= 1 AND authority_level <= 10),
  reliability_score DECIMAL DEFAULT 0.7 CHECK (reliability_score >= 0 AND reliability_score <= 1),
  
  -- CAPABILITIES
  has_parts_catalog BOOLEAN DEFAULT FALSE,
  has_pricing BOOLEAN DEFAULT FALSE,
  has_technical_docs BOOLEAN DEFAULT FALSE,
  has_visual_references BOOLEAN DEFAULT FALSE,
  
  -- SCRAPING STRATEGY
  crawl_strategy TEXT, -- 'firecrawl', 'playwright', 'api', 'manual'
  requires_auth BOOLEAN DEFAULT FALSE,
  rate_limit_per_hour INTEGER,
  
  -- COVERAGE
  makes_covered TEXT[],
  years_covered INT4RANGE,
  specialization TEXT, -- 'GM trucks', 'Corvette', 'all GM', 'universal'
  
  -- INDEXING STATUS
  last_indexed TIMESTAMPTZ,
  indexed_page_count INTEGER DEFAULT 0,
  index_completeness INTEGER DEFAULT 0 CHECK (index_completeness >= 0 AND index_completeness <= 100),
  
  -- METADATA
  api_endpoint TEXT,
  api_key_required BOOLEAN DEFAULT FALSE,
  notes TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed known sources
INSERT INTO data_source_registry (source_name, source_url, source_type, authority_level, has_parts_catalog, has_pricing, has_technical_docs, has_visual_references, crawl_strategy, makes_covered, specialization) VALUES
  ('LMC Truck', 'https://lmctruck.com', 'parts_supplier', 8, TRUE, TRUE, TRUE, TRUE, 'firecrawl', ARRAY['Chevrolet', 'GMC'], 'GM trucks 1947-1998'),
  ('GM Heritage Center', 'https://www.gmheritagecenter.com', 'manufacturer_archive', 10, FALSE, FALSE, TRUE, TRUE, 'manual', ARRAY['Chevrolet', 'GMC', 'Pontiac', 'Oldsmobile', 'Buick', 'Cadillac'], 'All GM vehicles'),
  ('Classic Industries', 'https://classicindustries.com', 'parts_supplier', 7, TRUE, TRUE, FALSE, TRUE, 'firecrawl', ARRAY['Chevrolet', 'GMC'], 'GM trucks and muscle cars'),
  ('The Truck Shop', 'https://thetruckshop.com', 'parts_supplier', 7, TRUE, TRUE, FALSE, FALSE, 'firecrawl', ARRAY['Chevrolet', 'GMC'], '1973-1987 GM trucks'),
  ('67-72 Chevy Trucks', 'https://67-72chevytrucks.com', 'community_forum', 6, FALSE, FALSE, TRUE, TRUE, 'manual', ARRAY['Chevrolet'], '1967-1972 C/K trucks'),
  ('The 1947 Present', 'https://67-72chevytrucks.com/vboard', 'community_forum', 6, FALSE, FALSE, TRUE, TRUE, 'manual', ARRAY['Chevrolet', 'GMC'], 'All GM trucks'),
  ('RockAuto', 'https://rockauto.com', 'parts_supplier', 7, TRUE, TRUE, FALSE, FALSE, 'api', ARRAY['Chevrolet', 'GMC', 'Ford', 'Dodge'], 'Universal parts'),
  ('Helm Inc', 'https://helminc.com', 'document_library', 10, FALSE, FALSE, TRUE, FALSE, 'manual', ARRAY['Chevrolet', 'GMC'], 'Factory service manuals')
ON CONFLICT (source_name) DO NOTHING;

-- ============================================
-- RESEARCH REQUESTS
-- ============================================

CREATE TABLE IF NOT EXISTS research_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- TRIGGER CONTEXT
  triggered_by_analysis_id UUID REFERENCES image_analysis_records(id),
  triggered_by_gap_id UUID REFERENCES knowledge_gaps(id),
  triggered_by_user_id UUID REFERENCES auth.users(id),
  
  -- VEHICLE CONTEXT
  vehicle_id UUID REFERENCES vehicles(id),
  vehicle_context JSONB NOT NULL, -- {year, make, model, series}
  
  -- THE SEARCH
  search_type TEXT NOT NULL, -- 'component_identification', 'trim_package_content', 'part_number_lookup', 'paint_code_decode', 'repair_procedure'
  search_query TEXT NOT NULL,
  component_types TEXT[], -- Components this research would help identify
  
  -- SEARCH STRATEGY
  target_sources TEXT[], -- Which sources to search (from registry)
  search_strategy JSONB, -- Detailed search plan
  priority INTEGER DEFAULT 5,
  
  -- EXECUTION
  status TEXT DEFAULT 'pending', -- 'pending', 'searching', 'found', 'not_found', 'failed'
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  
  -- RESULTS
  results_found INTEGER DEFAULT 0,
  sources_searched TEXT[],
  sources_successful TEXT[],
  
  -- EXTRACTED REFERENCES
  reference_documents_created UUID[], -- New library_documents created
  component_definitions_created UUID[], -- New component_definitions created
  parts_pricing_added INTEGER DEFAULT 0,
  
  -- ERROR HANDLING
  error_log JSONB,
  retry_count INTEGER DEFAULT 0,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_research_requests_status ON research_requests(status) WHERE status IN ('pending', 'searching');
CREATE INDEX idx_research_requests_priority ON research_requests(priority DESC);
CREATE INDEX idx_research_requests_vehicle ON research_requests(vehicle_id);
CREATE INDEX idx_research_requests_gap ON research_requests(triggered_by_gap_id);

-- ============================================
-- PARTS PRICING DATABASE
-- ============================================

CREATE TABLE IF NOT EXISTS parts_pricing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- COMPONENT LINK
  component_definition_id UUID REFERENCES component_definitions(id),
  component_type TEXT NOT NULL,
  component_name TEXT NOT NULL,
  
  -- APPLICABILITY
  year_range_start INTEGER NOT NULL,
  year_range_end INTEGER NOT NULL,
  make TEXT NOT NULL,
  model_family TEXT,
  series TEXT[],
  
  -- PART INFO
  part_number TEXT, -- Supplier's part number
  oem_part_number TEXT, -- Original GM part number
  part_description TEXT,
  
  -- SUPPLIER
  supplier_source_id UUID REFERENCES data_source_registry(id),
  supplier_name TEXT NOT NULL,
  supplier_url TEXT, -- Direct link to product page
  
  -- PRICING
  price DECIMAL NOT NULL,
  currency TEXT DEFAULT 'USD',
  price_as_of TIMESTAMPTZ DEFAULT NOW(),
  
  -- QUALITY/TYPE
  part_type TEXT, -- 'OEM', 'OE_quality', 'aftermarket', 'economy'
  brand TEXT,
  warranty_info TEXT,
  
  -- AVAILABILITY
  in_stock BOOLEAN DEFAULT TRUE,
  lead_time_days INTEGER,
  
  -- METADATA
  specifications JSONB, -- Dimensions, weight, materials, etc.
  includes TEXT[], -- What comes with it
  requires TEXT[], -- Additional parts needed
  installation_difficulty INTEGER, -- 1-10
  estimated_labor_hours DECIMAL,
  
  -- INDEXING
  indexed_at TIMESTAMPTZ DEFAULT NOW(),
  last_verified TIMESTAMPTZ DEFAULT NOW(),
  verification_status TEXT DEFAULT 'auto', -- 'auto', 'verified', 'outdated'
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_parts_pricing_component ON parts_pricing(component_type);
CREATE INDEX idx_parts_pricing_ymm ON parts_pricing(year_range_start, year_range_end, make, model_family);
CREATE INDEX idx_parts_pricing_supplier ON parts_pricing(supplier_source_id);
CREATE INDEX idx_parts_pricing_price ON parts_pricing(price);
CREATE INDEX idx_parts_pricing_fresh ON parts_pricing(price_as_of DESC);

-- ============================================
-- SEARCH RESULT CACHE
-- ============================================

CREATE TABLE IF NOT EXISTS reference_search_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- QUERY
  search_query TEXT NOT NULL,
  search_type TEXT NOT NULL,
  source_id UUID REFERENCES data_source_registry(id),
  vehicle_context JSONB, -- For context-specific caching
  
  -- RESULTS
  results_json JSONB NOT NULL,
  result_count INTEGER DEFAULT 0,
  
  -- CACHE MANAGEMENT
  cached_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '7 days',
  hit_count INTEGER DEFAULT 0,
  last_hit TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT unique_search_cache UNIQUE (search_query, source_id, (vehicle_context->>'year'))
);

CREATE INDEX idx_search_cache_query ON reference_search_cache(search_query);
CREATE INDEX idx_search_cache_valid ON reference_search_cache(expires_at) WHERE expires_at > NOW();

-- ============================================
-- REPAIR COST ESTIMATES
-- ============================================

CREATE TABLE IF NOT EXISTS repair_cost_estimates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- VEHICLE & COMPONENT
  vehicle_id UUID REFERENCES vehicles(id),
  component_identification_id UUID REFERENCES component_identifications(id),
  component_type TEXT NOT NULL,
  
  -- PARTS COSTS
  parts_quoted JSONB, -- Array of {part, supplier, price, part_number}
  parts_total DECIMAL,
  
  -- LABOR COSTS
  estimated_labor_hours DECIMAL,
  labor_rate DECIMAL DEFAULT 125.00, -- $/hour
  labor_total DECIMAL,
  
  -- TOTAL
  total_estimate DECIMAL,
  
  -- SOURCING
  based_on_parts_pricing_ids UUID[],
  price_snapshot_date TIMESTAMPTZ DEFAULT NOW(),
  
  -- CONFIDENCE
  estimate_confidence INTEGER, -- 0-100
  confidence_factors JSONB, -- Why this confidence level
  
  -- NOTES
  repair_notes TEXT,
  alternative_options JSONB, -- Other repair approaches with costs
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_repair_estimates_vehicle ON repair_cost_estimates(vehicle_id);
CREATE INDEX idx_repair_estimates_component ON repair_cost_estimates(component_type);

-- ============================================
-- FUNCTIONS
-- ============================================

-- Queue a research request
CREATE OR REPLACE FUNCTION queue_research_request(
  p_analysis_id UUID,
  p_vehicle_id UUID,
  p_search_type TEXT,
  p_search_query TEXT,
  p_component_types TEXT[]
)
RETURNS UUID AS $$
DECLARE
  v_vehicle RECORD;
  v_request_id UUID;
  v_target_sources TEXT[];
BEGIN
  SELECT year, make, model, series INTO v_vehicle
  FROM vehicles WHERE id = p_vehicle_id;
  
  -- Determine target sources based on search type
  v_target_sources := CASE p_search_type
    WHEN 'component_identification' THEN ARRAY['lmc_truck', 'gm_heritage']
    WHEN 'trim_package_content' THEN ARRAY['gm_heritage', 'lmc_truck']
    WHEN 'part_number_lookup' THEN ARRAY['lmc_truck', 'rockauto']
    WHEN 'paint_code_decode' THEN ARRAY['gm_heritage', 'perplexity']
    WHEN 'repair_procedure' THEN ARRAY['lmc_truck', 'forums']
    ELSE ARRAY['perplexity']
  END;
  
  INSERT INTO research_requests (
    triggered_by_analysis_id,
    vehicle_id,
    vehicle_context,
    search_type,
    search_query,
    component_types,
    target_sources,
    priority
  ) VALUES (
    p_analysis_id,
    p_vehicle_id,
    jsonb_build_object('year', v_vehicle.year, 'make', v_vehicle.make, 'model', v_vehicle.model, 'series', v_vehicle.series),
    p_search_type,
    p_search_query,
    p_component_types,
    v_target_sources,
    CASE 
      WHEN array_length(p_component_types, 1) > 5 THEN 8 -- High impact
      WHEN array_length(p_component_types, 1) > 2 THEN 6 -- Medium impact
      ELSE 4 -- Low impact
    END
  )
  RETURNING id INTO v_request_id;
  
  RETURN v_request_id;
END;
$$ LANGUAGE plpgsql;

-- Get price quote for a component
CREATE OR REPLACE FUNCTION get_component_price_quote(
  p_vehicle_id UUID,
  p_component_type TEXT
)
RETURNS TABLE(
  part_description TEXT,
  supplier TEXT,
  part_number TEXT,
  price DECIMAL,
  in_stock BOOLEAN,
  supplier_url TEXT,
  authority_level INTEGER
) AS $$
DECLARE
  v_vehicle RECORD;
BEGIN
  SELECT year, make, model, series INTO v_vehicle
  FROM vehicles WHERE id = p_vehicle_id;
  
  RETURN QUERY
  SELECT 
    pp.part_description,
    pp.supplier_name,
    pp.part_number,
    pp.price,
    pp.in_stock,
    pp.supplier_url,
    dsr.authority_level
  FROM parts_pricing pp
  JOIN data_source_registry dsr ON dsr.id = pp.supplier_source_id
  WHERE pp.component_type = p_component_type
    AND pp.make = v_vehicle.make
    AND v_vehicle.year >= pp.year_range_start
    AND v_vehicle.year <= pp.year_range_end
    AND (pp.model_family = v_vehicle.model OR pp.model_family IS NULL)
    AND pp.verification_status != 'outdated'
  ORDER BY 
    dsr.authority_level DESC,
    pp.price ASC;
END;
$$ LANGUAGE plpgsql;

-- Generate repair estimate for identified component
CREATE OR REPLACE FUNCTION generate_repair_estimate(
  p_vehicle_id UUID,
  p_component_id UUID
)
RETURNS UUID AS $$
DECLARE
  v_component RECORD;
  v_parts JSONB;
  v_parts_total DECIMAL := 0;
  v_labor_hours DECIMAL := 2.0; -- Default
  v_labor_total DECIMAL;
  v_estimate_id UUID;
BEGIN
  -- Get component identification
  SELECT * INTO v_component
  FROM component_identifications
  WHERE id = p_component_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Component not found';
  END IF;
  
  -- Get pricing for this component
  SELECT jsonb_agg(
    jsonb_build_object(
      'part', part_description,
      'supplier', supplier_name,
      'part_number', part_number,
      'price', price,
      'url', supplier_url
    )
  ) INTO v_parts
  FROM parts_pricing
  WHERE component_type = v_component.component_type
    AND make = (SELECT make FROM vehicles WHERE id = p_vehicle_id)
    AND (SELECT year FROM vehicles WHERE id = p_vehicle_id) BETWEEN year_range_start AND year_range_end
  ORDER BY price ASC
  LIMIT 3;
  
  -- Calculate totals
  SELECT COALESCE(MIN((item->>'price')::DECIMAL), 0) INTO v_parts_total
  FROM jsonb_array_elements(v_parts) item;
  
  v_labor_total := v_labor_hours * 125.00;
  
  -- Create estimate
  INSERT INTO repair_cost_estimates (
    vehicle_id,
    component_identification_id,
    component_type,
    parts_quoted,
    parts_total,
    estimated_labor_hours,
    labor_rate,
    labor_total,
    total_estimate,
    estimate_confidence,
    confidence_factors
  ) VALUES (
    p_vehicle_id,
    p_component_id,
    v_component.component_type,
    v_parts,
    v_parts_total,
    v_labor_hours,
    125.00,
    v_labor_total,
    v_parts_total + v_labor_total,
    CASE 
      WHEN v_component.status = 'confirmed' THEN 85
      WHEN v_component.status = 'inferred' THEN 60
      ELSE 30
    END,
    jsonb_build_object(
      'component_status', v_component.status,
      'component_confidence', v_component.confidence,
      'parts_available', jsonb_array_length(v_parts),
      'labor_estimated', TRUE
    )
  )
  RETURNING id INTO v_estimate_id;
  
  RETURN v_estimate_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- RLS POLICIES
-- ============================================

ALTER TABLE data_source_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE parts_pricing ENABLE ROW LEVEL SECURITY;
ALTER TABLE reference_search_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE repair_cost_estimates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sources_read_all" ON data_source_registry FOR SELECT TO public USING (true);
CREATE POLICY "sources_admin_write" ON data_source_registry FOR ALL TO authenticated 
  USING (auth.uid() IN (SELECT id FROM auth.users WHERE raw_user_meta_data->>'role' = 'admin'))
  WITH CHECK (auth.uid() IN (SELECT id FROM auth.users WHERE raw_user_meta_data->>'role' = 'admin'));

CREATE POLICY "research_read_all" ON research_requests FOR SELECT TO authenticated USING (true);
CREATE POLICY "research_create" ON research_requests FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "pricing_read_all" ON parts_pricing FOR SELECT TO public USING (true);
CREATE POLICY "pricing_auth_create" ON parts_pricing FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "cache_read_all" ON reference_search_cache FOR SELECT TO authenticated USING (true);
CREATE POLICY "cache_create" ON reference_search_cache FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "estimates_read_owner" ON repair_cost_estimates 
  FOR SELECT TO authenticated 
  USING (
    vehicle_id IN (SELECT id FROM vehicles WHERE user_id = auth.uid() OR is_public = true)
  );

CREATE POLICY "estimates_create" ON repair_cost_estimates FOR INSERT TO authenticated WITH CHECK (true);

-- ============================================
-- VIEWS
-- ============================================

-- Pending research queue
CREATE OR REPLACE VIEW research_queue AS
SELECT 
  rr.id,
  rr.search_type,
  rr.search_query,
  rr.priority,
  rr.vehicle_context->>'year' as year,
  rr.vehicle_context->>'make' as make,
  rr.component_types,
  rr.target_sources,
  rr.status,
  rr.created_at,
  kg.description as gap_description,
  kg.impact_count
FROM research_requests rr
LEFT JOIN knowledge_gaps kg ON kg.id = rr.triggered_by_gap_id
WHERE rr.status IN ('pending', 'searching')
ORDER BY rr.priority DESC, kg.impact_count DESC NULLS LAST, rr.created_at ASC;

-- Parts availability for a vehicle
CREATE OR REPLACE VIEW vehicle_parts_available AS
SELECT 
  v.id as vehicle_id,
  v.year,
  v.make,
  v.model,
  pp.component_type,
  COUNT(DISTINCT pp.id) as suppliers_count,
  MIN(pp.price) as lowest_price,
  MAX(pp.price) as highest_price,
  AVG(pp.price) as avg_price,
  jsonb_agg(
    jsonb_build_object(
      'supplier', pp.supplier_name,
      'price', pp.price,
      'part_number', pp.part_number,
      'in_stock', pp.in_stock
    ) ORDER BY pp.price ASC
  ) as options
FROM vehicles v
CROSS JOIN parts_pricing pp
WHERE v.make = pp.make
  AND v.year >= pp.year_range_start
  AND v.year <= pp.year_range_end
GROUP BY v.id, v.year, v.make, v.model, pp.component_type;

-- ============================================
-- GRANTS
-- ============================================

GRANT SELECT ON data_source_registry TO authenticated, anon;
GRANT SELECT ON research_requests TO authenticated, anon;
GRANT SELECT ON parts_pricing TO authenticated, anon;
GRANT SELECT ON reference_search_cache TO authenticated;
GRANT SELECT ON repair_cost_estimates TO authenticated, anon;

GRANT ALL ON data_source_registry TO service_role;
GRANT ALL ON research_requests TO service_role;
GRANT ALL ON parts_pricing TO service_role;
GRANT ALL ON reference_search_cache TO service_role;
GRANT ALL ON repair_cost_estimates TO service_role;

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON TABLE data_source_registry IS 'Registry of known data sources (LMC, GM Heritage, forums) with authority scoring';
COMMENT ON TABLE research_requests IS 'Queue of research requests triggered when analysis finds knowledge gaps';
COMMENT ON TABLE parts_pricing IS 'Parts pricing database indexed from suppliers like LMC Truck';
COMMENT ON TABLE reference_search_cache IS 'Cache of search results to avoid redundant lookups';
COMMENT ON TABLE repair_cost_estimates IS 'Repair cost estimates linking component IDs to parts pricing';

COMMENT ON FUNCTION queue_research_request IS 'Queue a research request when knowledge gap is discovered';
COMMENT ON FUNCTION get_component_price_quote IS 'Get current pricing for a component from indexed suppliers';
COMMENT ON FUNCTION generate_repair_estimate IS 'Generate repair cost estimate for an identified component';

