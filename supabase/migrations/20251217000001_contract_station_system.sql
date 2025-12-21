-- =====================================================
-- CONTRACT STATION SYSTEM
-- =====================================================
-- Allows fintech curators to create custom investment contracts
-- by curating vehicles, organizations, projects, and users
-- into transparent investment packages
-- Date: December 17, 2025
-- =====================================================

-- =====================================================
-- 1. CUSTOM INVESTMENT CONTRACTS
-- =====================================================

CREATE TABLE IF NOT EXISTS custom_investment_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Contract Identity
  contract_name TEXT NOT NULL,
  contract_symbol TEXT UNIQUE NOT NULL CHECK (LENGTH(contract_symbol) >= 2 AND LENGTH(contract_symbol) <= 10),
  contract_description TEXT,
  contract_type TEXT DEFAULT 'etf' CHECK (contract_type IN (
    'etf',           -- Exchange-traded fund (like market funds)
    'bond_fund',     -- Collection of bonds
    'equity_fund',   -- Collection of profit-sharing stakes
    'hybrid',        -- Mix of vehicles, bonds, stakes
    'project_fund',  -- Investment in specific projects
    'organization_fund', -- Investment in organizations
    'custom'         -- Fully custom structure
  )),
  
  -- Curator/Manager
  curator_id UUID NOT NULL REFERENCES auth.users(id),
  manager_id UUID REFERENCES auth.users(id), -- Can delegate management
  curator_name TEXT, -- Display name for curator
  curator_bio TEXT,
  curator_credentials JSONB DEFAULT '[]'::jsonb, -- ["CFA", "Series 7", etc.]
  
  -- Legal Structure
  legal_entity_type TEXT DEFAULT 'limited_partnership' CHECK (legal_entity_type IN (
    'limited_partnership',
    'llc',
    'trust',
    'corporation',
    'spv', -- Special Purpose Vehicle
    'other'
  )),
  legal_entity_name TEXT,
  jurisdiction TEXT DEFAULT 'Delaware, USA',
  regulatory_status TEXT DEFAULT 'private_placement' CHECK (regulatory_status IN (
    'private_placement',
    'reg_d',
    'reg_a',
    'reg_cf',
    'public',
    'other'
  )),
  
  -- Investment Terms
  minimum_investment_cents BIGINT DEFAULT 10000 CHECK (minimum_investment_cents >= 0), -- $100 minimum
  maximum_investment_cents BIGINT,
  share_structure TEXT DEFAULT 'shares' CHECK (share_structure IN ('shares', 'units', 'tokens', 'stakes')),
  total_shares_authorized BIGINT,
  initial_share_price_cents BIGINT,
  current_nav_cents BIGINT DEFAULT 0,
  
  -- Fee Structure
  management_fee_pct DECIMAL(5,2) DEFAULT 0.10 CHECK (management_fee_pct >= 0 AND management_fee_pct <= 10),
  performance_fee_pct DECIMAL(5,2) DEFAULT 0.00 CHECK (performance_fee_pct >= 0 AND performance_fee_pct <= 20),
  performance_fee_hurdle_pct DECIMAL(5,2) DEFAULT 0.00, -- Only charge if return > hurdle
  transaction_fee_pct DECIMAL(5,2) DEFAULT 0.05 CHECK (transaction_fee_pct >= 0 AND transaction_fee_pct <= 5),
  setup_fee_cents BIGINT DEFAULT 0,
  early_exit_fee_pct DECIMAL(5,2) DEFAULT 0.00,
  
  -- Liquidity Terms
  liquidity_type TEXT DEFAULT 'daily' CHECK (liquidity_type IN (
    'daily',
    'weekly',
    'monthly',
    'quarterly',
    'annually',
    'lockup_period', -- Lockup with specific duration
    'at_maturity',
    'illiquid'
  )),
  lockup_period_days INTEGER,
  redemption_frequency TEXT DEFAULT 'daily',
  redemption_notice_days INTEGER DEFAULT 0,
  
  -- Investment Strategy
  investment_strategy TEXT,
  target_returns_pct DECIMAL(5,2),
  risk_level TEXT DEFAULT 'moderate' CHECK (risk_level IN ('conservative', 'moderate', 'aggressive', 'speculative')),
  diversification_rules JSONB DEFAULT '{}'::jsonb, -- {"max_single_asset_pct": 20, "min_assets": 5}
  rebalancing_frequency TEXT DEFAULT 'quarterly',
  
  -- Transparency & Reporting
  transparency_level TEXT DEFAULT 'full' CHECK (transparency_level IN (
    'full',      -- All assets visible, real-time updates
    'partial',   -- Aggregated data, periodic updates
    'minimal'    -- High-level only
  )),
  reporting_frequency TEXT DEFAULT 'monthly',
  audit_required BOOLEAN DEFAULT FALSE,
  custodian_name TEXT,
  
  -- Status & Lifecycle
  status TEXT DEFAULT 'draft' CHECK (status IN (
    'draft',
    'pending_review',
    'approved',
    'active',
    'closed',
    'liquidating',
    'liquidated',
    'suspended',
    'cancelled'
  )),
  approval_required BOOLEAN DEFAULT FALSE,
  approved_by UUID REFERENCES auth.users(id),
  approved_at TIMESTAMPTZ,
  
  -- Dates
  launch_date TIMESTAMPTZ,
  inception_date TIMESTAMPTZ,
  closing_date TIMESTAMPTZ,
  liquidation_date TIMESTAMPTZ,
  
  -- Performance Tracking
  total_assets_under_management_cents BIGINT DEFAULT 0,
  total_investors INTEGER DEFAULT 0,
  total_return_pct DECIMAL(10,4) DEFAULT 0,
  annualized_return_pct DECIMAL(10,4) DEFAULT 0,
  
  -- Metadata
  prospectus_url TEXT,
  legal_documents JSONB DEFAULT '[]'::jsonb, -- [{"type": "prospectus", "url": "...", "version": "1.0"}]
  marketing_materials JSONB DEFAULT '[]'::jsonb,
  tags TEXT[] DEFAULT '{}',
  metadata JSONB DEFAULT '{}'::jsonb,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  published_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_custom_contracts_curator ON custom_investment_contracts(curator_id);
CREATE INDEX IF NOT EXISTS idx_custom_contracts_symbol ON custom_investment_contracts(contract_symbol);
CREATE INDEX IF NOT EXISTS idx_custom_contracts_status ON custom_investment_contracts(status);
CREATE INDEX IF NOT EXISTS idx_custom_contracts_type ON custom_investment_contracts(contract_type);
CREATE INDEX IF NOT EXISTS idx_custom_contracts_tags ON custom_investment_contracts USING GIN(tags);

-- =====================================================
-- 2. CONTRACT ASSETS (What's in each contract)
-- =====================================================

CREATE TABLE IF NOT EXISTS contract_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES custom_investment_contracts(id) ON DELETE CASCADE,
  
  -- Asset Type & Reference
  asset_type TEXT NOT NULL CHECK (asset_type IN (
    'vehicle',
    'organization',
    'project',
    'user',          -- Investment in a user's portfolio
    'bond',          -- Reference to vehicle_bonds
    'stake',         -- Reference to profit_sharing_stakes
    'listing',       -- Reference to vehicle_listings
    'fund',          -- Reference to another fund (fund of funds)
    'other'
  )),
  asset_id UUID NOT NULL, -- References vehicles(id), businesses(id), etc.
  
  -- Allocation
  allocation_pct DECIMAL(5,2) CHECK (allocation_pct >= 0 AND allocation_pct <= 100), -- % of contract value
  allocation_cents BIGINT, -- Fixed dollar amount
  shares_held BIGINT, -- If asset is share-based
  weight DECIMAL(5,2), -- Portfolio weight (can differ from allocation)
  
  -- Entry Details
  entry_date TIMESTAMPTZ DEFAULT NOW(),
  entry_price_cents BIGINT,
  entry_nav_cents BIGINT, -- NAV at time of entry
  
  -- Current Status
  current_value_cents BIGINT,
  current_nav_cents BIGINT,
  unrealized_gain_loss_cents BIGINT,
  unrealized_gain_loss_pct DECIMAL(10,4),
  
  -- Restrictions
  is_locked BOOLEAN DEFAULT FALSE, -- Cannot be removed/rebalanced
  lock_reason TEXT,
  min_hold_period_days INTEGER,
  
  -- Notes
  curator_notes TEXT, -- Why this asset was selected
  metadata JSONB DEFAULT '{}'::jsonb,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Ensure unique asset per contract
  UNIQUE(contract_id, asset_type, asset_id)
);

CREATE INDEX IF NOT EXISTS idx_contract_assets_contract ON contract_assets(contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_assets_type ON contract_assets(asset_type, asset_id);
CREATE INDEX IF NOT EXISTS idx_contract_assets_entry_date ON contract_assets(entry_date);

-- =====================================================
-- 3. CONTRACT INVESTORS (Who owns shares)
-- =====================================================

CREATE TABLE IF NOT EXISTS contract_investors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES custom_investment_contracts(id) ON DELETE CASCADE,
  investor_id UUID NOT NULL REFERENCES auth.users(id),
  
  -- Holdings
  shares_owned DECIMAL(20,8) DEFAULT 0 CHECK (shares_owned >= 0),
  entry_nav_cents BIGINT, -- NAV per share at entry
  current_nav_cents BIGINT, -- Current NAV per share
  total_invested_cents BIGINT DEFAULT 0,
  total_value_cents BIGINT DEFAULT 0,
  unrealized_gain_loss_cents BIGINT DEFAULT 0,
  unrealized_gain_loss_pct DECIMAL(10,4) DEFAULT 0,
  
  -- Entry Details
  first_investment_date TIMESTAMPTZ DEFAULT NOW(),
  last_investment_date TIMESTAMPTZ,
  average_entry_price_cents BIGINT,
  
  -- Status
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'redeemed', 'transferred', 'forfeited')),
  redemption_requested_at TIMESTAMPTZ,
  redemption_completed_at TIMESTAMPTZ,
  
  -- Lockup
  lockup_expires_at TIMESTAMPTZ,
  is_locked BOOLEAN DEFAULT FALSE,
  
  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(contract_id, investor_id)
);

CREATE INDEX IF NOT EXISTS idx_contract_investors_contract ON contract_investors(contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_investors_investor ON contract_investors(investor_id);
CREATE INDEX IF NOT EXISTS idx_contract_investors_status ON contract_investors(status);

-- =====================================================
-- 4. CONTRACT TRANSACTIONS (Investment/Redemption History)
-- =====================================================

CREATE TABLE IF NOT EXISTS contract_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES custom_investment_contracts(id) ON DELETE CASCADE,
  investor_id UUID NOT NULL REFERENCES auth.users(id),
  
  -- Transaction Type
  transaction_type TEXT NOT NULL CHECK (transaction_type IN (
    'subscription',    -- New investment
    'redemption',      -- Withdrawal
    'dividend',        -- Distribution
    'fee',             -- Fee deduction
    'transfer',        -- Transfer between investors
    'rebalance'        -- Portfolio rebalancing
  )),
  
  -- Amounts
  shares_amount DECIMAL(20,8),
  cash_amount_cents BIGINT,
  nav_per_share_cents BIGINT, -- NAV at time of transaction
  
  -- Fees
  transaction_fee_cents BIGINT DEFAULT 0,
  management_fee_cents BIGINT DEFAULT 0,
  performance_fee_cents BIGINT DEFAULT 0,
  total_fees_cents BIGINT DEFAULT 0,
  
  -- Status
  status TEXT DEFAULT 'pending' CHECK (status IN (
    'pending',
    'processing',
    'completed',
    'failed',
    'cancelled',
    'reversed'
  )),
  
  -- Settlement
  settlement_date TIMESTAMPTZ,
  payment_transaction_id UUID, -- Reference to payment_transactions
  
  -- Metadata
  notes TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_contract_transactions_contract ON contract_transactions(contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_transactions_investor ON contract_transactions(investor_id);
CREATE INDEX IF NOT EXISTS idx_contract_transactions_type ON contract_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_contract_transactions_status ON contract_transactions(status);
CREATE INDEX IF NOT EXISTS idx_contract_transactions_date ON contract_transactions(created_at);

-- =====================================================
-- 5. CONTRACT PERFORMANCE METRICS
-- =====================================================

CREATE TABLE IF NOT EXISTS contract_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES custom_investment_contracts(id) ON DELETE CASCADE,
  
  -- Date
  performance_date DATE NOT NULL,
  
  -- NAV Metrics
  nav_per_share_cents BIGINT NOT NULL,
  total_nav_cents BIGINT NOT NULL,
  shares_outstanding DECIMAL(20,8) NOT NULL,
  
  -- Returns
  daily_return_pct DECIMAL(10,4),
  weekly_return_pct DECIMAL(10,4),
  monthly_return_pct DECIMAL(10,4),
  quarterly_return_pct DECIMAL(10,4),
  ytd_return_pct DECIMAL(10,4),
  annualized_return_pct DECIMAL(10,4),
  
  -- Risk Metrics
  volatility_pct DECIMAL(10,4),
  sharpe_ratio DECIMAL(10,4),
  max_drawdown_pct DECIMAL(10,4),
  
  -- Asset Metrics
  total_assets_count INTEGER,
  total_assets_value_cents BIGINT,
  
  -- Investor Metrics
  total_investors INTEGER,
  total_investments_cents BIGINT,
  
  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(contract_id, performance_date)
);

CREATE INDEX IF NOT EXISTS idx_contract_performance_contract ON contract_performance(contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_performance_date ON contract_performance(performance_date DESC);

-- =====================================================
-- 6. HELPER FUNCTIONS
-- =====================================================

-- Calculate contract NAV
CREATE OR REPLACE FUNCTION calculate_contract_nav(p_contract_id UUID)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total_value_cents BIGINT := 0;
  v_asset_value_cents BIGINT;
BEGIN
  -- Sum all asset values
  SELECT COALESCE(SUM(current_value_cents), 0)
  INTO v_total_value_cents
  FROM contract_assets
  WHERE contract_id = p_contract_id;
  
  RETURN v_total_value_cents;
END;
$$;

-- Get contract transparency view (all assets with details)
CREATE OR REPLACE VIEW contract_transparency_view AS
SELECT 
  c.id as contract_id,
  c.contract_name,
  c.contract_symbol,
  c.curator_id,
  c.transparency_level,
  ca.asset_type,
  ca.asset_id,
  ca.allocation_pct,
  ca.current_value_cents,
  -- Vehicle details
  CASE WHEN ca.asset_type = 'vehicle' THEN v.year || ' ' || v.make || ' ' || v.model END as vehicle_name,
  CASE WHEN ca.asset_type = 'vehicle' THEN v.current_value END as vehicle_value,
  CASE WHEN ca.asset_type = 'vehicle' THEN v.location END as vehicle_location,
  -- Organization details
  CASE WHEN ca.asset_type = 'organization' THEN b.name END as organization_name,
  -- Bond details
  CASE WHEN ca.asset_type = 'bond' THEN vb.principal_amount_cents END as bond_principal,
  -- Stake details
  CASE WHEN ca.asset_type = 'stake' THEN ps.total_stake_pct END as stake_percentage,
  ca.curator_notes,
  ca.created_at as asset_added_at
FROM custom_investment_contracts c
JOIN contract_assets ca ON ca.contract_id = c.id
LEFT JOIN vehicles v ON ca.asset_type = 'vehicle' AND ca.asset_id = v.id
LEFT JOIN businesses b ON ca.asset_type = 'organization' AND ca.asset_id = b.id
LEFT JOIN vehicle_bonds vb ON ca.asset_type = 'bond' AND ca.asset_id = vb.id
LEFT JOIN profit_share_stakes ps ON ca.asset_type = 'stake' AND ca.asset_id = ps.id
WHERE c.status IN ('active', 'approved')
  AND c.transparency_level = 'full';

-- =====================================================
-- 7. ROW LEVEL SECURITY
-- =====================================================

ALTER TABLE custom_investment_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_investors ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_performance ENABLE ROW LEVEL SECURITY;

-- Contracts: Public read for active contracts, full access for curator
CREATE POLICY custom_contracts_select_public
  ON custom_investment_contracts FOR SELECT
  USING (status IN ('active', 'approved') OR curator_id = auth.uid());

CREATE POLICY custom_contracts_all_curator
  ON custom_investment_contracts FOR ALL
  USING (curator_id = auth.uid());

-- Contract assets: Public read for active contracts
CREATE POLICY contract_assets_select_public
  ON contract_assets FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM custom_investment_contracts c
      WHERE c.id = contract_assets.contract_id
      AND (c.status IN ('active', 'approved') OR c.curator_id = auth.uid())
    )
  );

CREATE POLICY contract_assets_all_curator
  ON contract_assets FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM custom_investment_contracts c
      WHERE c.id = contract_assets.contract_id
      AND c.curator_id = auth.uid()
    )
  );

-- Contract investors: Users see their own holdings
CREATE POLICY contract_investors_select_own
  ON contract_investors FOR SELECT
  USING (investor_id = auth.uid() OR 
    EXISTS (
      SELECT 1 FROM custom_investment_contracts c
      WHERE c.id = contract_investors.contract_id
      AND c.curator_id = auth.uid()
    )
  );

CREATE POLICY contract_investors_insert_own
  ON contract_investors FOR INSERT
  WITH CHECK (investor_id = auth.uid());

-- Contract transactions: Users see their own transactions
CREATE POLICY contract_transactions_select_own
  ON contract_transactions FOR SELECT
  USING (investor_id = auth.uid() OR 
    EXISTS (
      SELECT 1 FROM custom_investment_contracts c
      WHERE c.id = contract_transactions.contract_id
      AND c.curator_id = auth.uid()
    )
  );

-- Contract performance: Public read for active contracts
CREATE POLICY contract_performance_select_public
  ON contract_performance FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM custom_investment_contracts c
      WHERE c.id = contract_performance.contract_id
      AND c.status IN ('active', 'approved')
    )
  );

-- =====================================================
-- 8. GRANTS
-- =====================================================

GRANT SELECT ON custom_investment_contracts TO anon, authenticated;
GRANT SELECT ON contract_assets TO anon, authenticated;
GRANT SELECT ON contract_investors TO anon, authenticated;
GRANT SELECT ON contract_transactions TO anon, authenticated;
GRANT SELECT ON contract_performance TO anon, authenticated;
GRANT SELECT ON contract_transparency_view TO anon, authenticated;

GRANT INSERT, UPDATE, DELETE ON custom_investment_contracts TO authenticated;
GRANT INSERT, UPDATE, DELETE ON contract_assets TO authenticated;
GRANT INSERT, UPDATE, DELETE ON contract_investors TO authenticated;
GRANT INSERT, UPDATE, DELETE ON contract_transactions TO authenticated;

GRANT EXECUTE ON FUNCTION calculate_contract_nav(UUID) TO authenticated;

COMMENT ON TABLE custom_investment_contracts IS 'Custom investment contracts created by fintech curators';
COMMENT ON TABLE contract_assets IS 'Assets (vehicles, orgs, projects) included in each contract';
COMMENT ON TABLE contract_investors IS 'Investor holdings in custom contracts';
COMMENT ON TABLE contract_transactions IS 'Investment and redemption transactions';
COMMENT ON TABLE contract_performance IS 'Daily performance metrics for contracts';
COMMENT ON VIEW contract_transparency_view IS 'Full transparency view of all contract assets';

