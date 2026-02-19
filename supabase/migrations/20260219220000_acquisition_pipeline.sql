-- Acquisition Pipeline: Discovery → Market Proof → Offer → Acquire → Shop → Validate → List
-- Builds on existing: deal_jackets, dealer_inventory, vehicle_offers, shop tables

-- Pipeline stage enum
DO $$ BEGIN
  CREATE TYPE acquisition_stage AS ENUM (
    'discovered',        -- Found on CL/marketplace
    'market_proofed',    -- Comp analysis complete, deal score assigned
    'target',            -- Approved for acquisition pursuit
    'contacted',         -- Seller contacted
    'inspecting',        -- Pre-purchase inspection scheduled/in-progress
    'offer_made',        -- Offer submitted to seller
    'under_contract',    -- Offer accepted, paperwork in progress
    'payment_pending',   -- Payment being processed
    'acquired',          -- Vehicle purchased, title in hand
    'in_transport',      -- Being delivered to partner shop
    'at_shop',           -- At partner shop for inspection/repair
    'validated',         -- Authentication/provenance verified
    'reconditioning',    -- Repairs/prep in progress
    'photography',       -- Professional photos being taken
    'listing_prep',      -- Listing being written
    'listed',            -- Listed for sale (BaT, etc.)
    'under_offer',       -- Buyer offer received on resale
    'sold',              -- Sale complete
    'closed'             -- Deal closed, profit calculated
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Pipeline priority enum
DO $$ BEGIN
  CREATE TYPE acquisition_priority AS ENUM (
    'primary',    -- 1958-1973 muscle/sports cars
    'secondary',  -- 1973-1991
    'opportunistic'  -- Any era, exceptional deal
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Main acquisition pipeline table
CREATE TABLE IF NOT EXISTS acquisition_pipeline (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid REFERENCES vehicles(id),
  organization_id uuid REFERENCES organizations(id),

  -- Discovery
  discovery_source text NOT NULL DEFAULT 'craigslist',  -- craigslist, fbmarketplace, offerup, etc.
  discovery_url text,
  discovery_date timestamptz NOT NULL DEFAULT now(),
  discovered_by text,  -- agent name or user

  -- Vehicle basics (denormalized for quick access)
  year integer,
  make text,
  model text,
  engine text,
  transmission text,
  asking_price numeric,
  location_city text,
  location_state text,
  seller_name text,
  seller_contact text,

  -- Pipeline state
  stage acquisition_stage NOT NULL DEFAULT 'discovered',
  priority acquisition_priority NOT NULL DEFAULT 'primary',
  stage_updated_at timestamptz NOT NULL DEFAULT now(),

  -- Market proof (populated during analysis)
  deal_score integer,  -- 0-100
  market_proof_data jsonb,  -- Full analysis results
  comp_count integer,
  comp_median numeric,
  comp_avg numeric,
  estimated_value numeric,
  estimated_profit numeric,
  confidence_score integer,  -- 0-100

  -- Acquisition details
  offer_amount numeric,
  offer_date timestamptz,
  purchase_price numeric,
  purchase_date timestamptz,
  title_status text,

  -- Shop / validation
  partner_shop_id uuid,  -- references shop tables
  shop_arrival_date timestamptz,
  inspection_report jsonb,
  repair_estimate numeric,
  authentication_result jsonb,
  numbers_matching_verified boolean,

  -- Reconditioning
  reconditioning_cost numeric,
  reconditioning_items jsonb,  -- [{item, cost, vendor, status}]

  -- Resale
  listing_platform text,  -- bat, cab, hagerty, etc.
  listing_url_resale text,
  listing_date timestamptz,
  sale_price numeric,
  sale_date timestamptz,
  buyer_info jsonb,

  -- Financials
  total_investment numeric GENERATED ALWAYS AS (
    COALESCE(purchase_price, 0) + COALESCE(reconditioning_cost, 0) + COALESCE(repair_estimate, 0)
  ) STORED,
  gross_profit numeric GENERATED ALWAYS AS (
    COALESCE(sale_price, 0) - COALESCE(purchase_price, 0) - COALESCE(reconditioning_cost, 0) - COALESCE(repair_estimate, 0)
  ) STORED,

  -- Tracking
  notes text,
  tags text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Stage transition log
CREATE TABLE IF NOT EXISTS acquisition_stage_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id uuid NOT NULL REFERENCES acquisition_pipeline(id) ON DELETE CASCADE,
  from_stage acquisition_stage,
  to_stage acquisition_stage NOT NULL,
  changed_by text,
  notes text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Market proof reports (detailed analysis for each vehicle)
CREATE TABLE IF NOT EXISTS market_proof_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id uuid REFERENCES acquisition_pipeline(id) ON DELETE CASCADE,
  vehicle_id uuid REFERENCES vehicles(id),

  -- Comp data
  comp_vehicle_ids uuid[],
  comp_count integer,
  comp_prices numeric[],
  comp_median numeric,
  comp_avg numeric,
  comp_min numeric,
  comp_max numeric,

  -- Segmented analysis
  segment_analysis jsonb,  -- {by_body, by_transmission, by_nm, by_year, etc.}

  -- Bid analysis
  total_bids_analyzed integer,
  avg_bid_velocity numeric,
  snipe_ratio_avg numeric,
  whale_bidder_count integer,

  -- Comment analysis
  total_comments_analyzed integer,
  sentiment_distribution jsonb,
  expert_comment_count integer,
  key_technical_concerns text[],
  market_sentiment_keywords jsonb,

  -- Valuation
  estimated_value numeric,
  estimated_value_low numeric,
  estimated_value_high numeric,
  hagerty_value numeric,
  asking_price numeric,
  discount_to_market numeric,  -- percentage

  -- Recommendation
  recommendation text,  -- STRONG_BUY, BUY, FAIR, PASS
  risk_factors text[],
  verification_checklist text[],

  report_generated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_acquisition_pipeline_stage ON acquisition_pipeline(stage);
CREATE INDEX IF NOT EXISTS idx_acquisition_pipeline_priority ON acquisition_pipeline(priority);
CREATE INDEX IF NOT EXISTS idx_acquisition_pipeline_vehicle ON acquisition_pipeline(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_acquisition_pipeline_discovery_source ON acquisition_pipeline(discovery_source);
CREATE INDEX IF NOT EXISTS idx_acquisition_pipeline_deal_score ON acquisition_pipeline(deal_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_acquisition_stage_log_pipeline ON acquisition_stage_log(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_market_proof_reports_pipeline ON market_proof_reports(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_market_proof_reports_vehicle ON market_proof_reports(vehicle_id);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_acquisition_pipeline_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  NEW.stage_updated_at = CASE
    WHEN OLD.stage IS DISTINCT FROM NEW.stage THEN now()
    ELSE OLD.stage_updated_at
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_acquisition_pipeline_updated_at ON acquisition_pipeline;
CREATE TRIGGER trg_acquisition_pipeline_updated_at
  BEFORE UPDATE ON acquisition_pipeline
  FOR EACH ROW EXECUTE FUNCTION update_acquisition_pipeline_updated_at();

-- Stage transition logging trigger
CREATE OR REPLACE FUNCTION log_acquisition_stage_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.stage IS DISTINCT FROM NEW.stage THEN
    INSERT INTO acquisition_stage_log (pipeline_id, from_stage, to_stage, changed_by)
    VALUES (NEW.id, OLD.stage, NEW.stage, current_setting('app.current_user', true));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_acquisition_stage_log ON acquisition_pipeline;
CREATE TRIGGER trg_acquisition_stage_log
  BEFORE UPDATE ON acquisition_pipeline
  FOR EACH ROW EXECUTE FUNCTION log_acquisition_stage_change();

-- View: active pipeline deals
CREATE OR REPLACE VIEW acquisition_pipeline_active AS
SELECT
  ap.*,
  v.title as vehicle_title,
  v.vin,
  v.listing_url as original_listing_url
FROM acquisition_pipeline ap
LEFT JOIN vehicles v ON v.id = ap.vehicle_id
WHERE ap.stage NOT IN ('sold', 'closed')
ORDER BY ap.deal_score DESC NULLS LAST, ap.discovery_date DESC;

-- View: pipeline summary stats
CREATE OR REPLACE VIEW acquisition_pipeline_stats AS
SELECT
  stage,
  priority,
  count(*) as count,
  avg(deal_score) as avg_deal_score,
  avg(asking_price) as avg_asking,
  avg(estimated_value) as avg_estimated_value,
  avg(estimated_profit) as avg_estimated_profit,
  sum(CASE WHEN stage = 'sold' THEN gross_profit ELSE 0 END) as total_realized_profit
FROM acquisition_pipeline
GROUP BY stage, priority
ORDER BY stage, priority;

-- RPC: advance pipeline stage
CREATE OR REPLACE FUNCTION advance_acquisition_stage(
  p_pipeline_id uuid,
  p_new_stage acquisition_stage,
  p_notes text DEFAULT NULL,
  p_metadata jsonb DEFAULT NULL
) RETURNS jsonb AS $$
DECLARE
  v_current_stage acquisition_stage;
  v_result jsonb;
BEGIN
  SELECT stage INTO v_current_stage FROM acquisition_pipeline WHERE id = p_pipeline_id;

  IF v_current_stage IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Pipeline entry not found');
  END IF;

  UPDATE acquisition_pipeline
  SET stage = p_new_stage, notes = COALESCE(p_notes, notes)
  WHERE id = p_pipeline_id;

  -- Log with metadata
  INSERT INTO acquisition_stage_log (pipeline_id, from_stage, to_stage, notes, metadata)
  VALUES (p_pipeline_id, v_current_stage, p_new_stage, p_notes, p_metadata);

  RETURN jsonb_build_object(
    'success', true,
    'from_stage', v_current_stage,
    'to_stage', p_new_stage,
    'pipeline_id', p_pipeline_id
  );
END;
$$ LANGUAGE plpgsql;
