-- Dealer Inventory & Sales System
-- For dealers like Viva! Las Vegas Autos - focus on buy/sell/trade, not labor

-- ============================================================================
-- DEALER INVENTORY - Track vehicle status for dealers
-- ============================================================================

CREATE TABLE IF NOT EXISTS dealer_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_id UUID REFERENCES businesses(id) ON DELETE CASCADE NOT NULL,
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'in_stock',           -- Available for sale
    'consignment',        -- Consigned by owner, dealer sells on commission
    'sold',               -- Sold (historical)
    'pending_sale',       -- Deal in progress
    'maintenance',        -- Customer vehicle in for service
    'trade_in',           -- Just traded in, being prepped
    'wholesale',          -- Will be wholesaled, not retail
    'reserved'            -- Reserved by buyer
  )),
  acquisition_type TEXT CHECK (acquisition_type IN (
    'purchase',           -- Dealer bought it
    'consignment',        -- Owner consigned it
    'trade_in',           -- Customer traded it in
    'wholesale'           -- Bought at auction/wholesale
  )),
  acquisition_date DATE,
  acquisition_cost DECIMAL(10,2),
  asking_price DECIMAL(10,2),
  sale_price DECIMAL(10,2),
  sale_date DATE,
  consignment_percentage DECIMAL(5,2), -- Commission % if consignment
  days_in_inventory INTEGER, -- Calculated via trigger or application
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(dealer_id, vehicle_id)
);

CREATE INDEX idx_dealer_inventory_dealer ON dealer_inventory(dealer_id);
CREATE INDEX idx_dealer_inventory_vehicle ON dealer_inventory(vehicle_id);
CREATE INDEX idx_dealer_inventory_status ON dealer_inventory(status);

-- RLS
ALTER TABLE dealer_inventory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can view dealer inventory" ON dealer_inventory;
CREATE POLICY "Public can view dealer inventory" ON dealer_inventory
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Dealer members can manage inventory" ON dealer_inventory;
CREATE POLICY "Dealer members can manage inventory" ON dealer_inventory
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM business_user_roles
      WHERE business_id = dealer_id
        AND user_id = auth.uid()
    )
  );

-- ============================================================================
-- DEALER SALES TRANSACTIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS dealer_sales_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_id UUID REFERENCES businesses(id) ON DELETE CASCADE NOT NULL,
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE NOT NULL,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN (
    'purchase',     -- Dealer bought vehicle
    'sale',         -- Dealer sold vehicle
    'consignment',  -- Consignment agreement
    'trade'         -- Trade-in
  )),
  transaction_date DATE NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  buyer_id UUID REFERENCES auth.users(id),
  seller_id UUID REFERENCES auth.users(id),
  commission_amount DECIMAL(10,2),
  profit_amount DECIMAL(10,2),
  payment_method TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_dealer_sales_dealer ON dealer_sales_transactions(dealer_id);
CREATE INDEX idx_dealer_sales_vehicle ON dealer_sales_transactions(vehicle_id);
CREATE INDEX idx_dealer_sales_date ON dealer_sales_transactions(transaction_date);

-- RLS
ALTER TABLE dealer_sales_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can view sales transactions" ON dealer_sales_transactions;
CREATE POLICY "Public can view sales transactions" ON dealer_sales_transactions
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Dealer members can manage transactions" ON dealer_sales_transactions;
CREATE POLICY "Dealer members can manage transactions" ON dealer_sales_transactions
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM business_user_roles
      WHERE business_id = dealer_id
        AND user_id = auth.uid()
    )
  );

-- ============================================================================
-- HELPER FUNCTIONS FOR DEALER OPERATIONS
-- ============================================================================

-- Get current inventory summary
CREATE OR REPLACE FUNCTION get_dealer_inventory_summary(dealer_org_id UUID)
RETURNS TABLE (
  in_stock_count INTEGER,
  in_stock_value DECIMAL(10,2),
  consignment_count INTEGER,
  consignment_value DECIMAL(10,2),
  maintenance_count INTEGER,
  sold_this_month INTEGER,
  revenue_this_month DECIMAL(10,2),
  avg_days_to_sell DECIMAL(10,2)
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(CASE WHEN status = 'in_stock' THEN 1 END)::INTEGER,
    SUM(CASE WHEN status = 'in_stock' THEN asking_price ELSE 0 END)::DECIMAL(10,2),
    COUNT(CASE WHEN status = 'consignment' THEN 1 END)::INTEGER,
    SUM(CASE WHEN status = 'consignment' THEN asking_price ELSE 0 END)::DECIMAL(10,2),
    COUNT(CASE WHEN status = 'maintenance' THEN 1 END)::INTEGER,
    COUNT(CASE WHEN status = 'sold' AND sale_date >= DATE_TRUNC('month', CURRENT_DATE) THEN 1 END)::INTEGER,
    SUM(CASE WHEN status = 'sold' AND sale_date >= DATE_TRUNC('month', CURRENT_DATE) THEN sale_price ELSE 0 END)::DECIMAL(10,2),
    AVG(CASE WHEN status = 'sold' THEN days_in_inventory END)::DECIMAL(10,2)
  FROM dealer_inventory
  WHERE dealer_id = dealer_org_id;
END;
$$;

-- Get dealer sales performance
CREATE OR REPLACE FUNCTION get_dealer_sales_performance(
  dealer_org_id UUID,
  start_date DATE DEFAULT NULL,
  end_date DATE DEFAULT NULL
)
RETURNS TABLE (
  total_sales DECIMAL(10,2),
  total_purchases DECIMAL(10,2),
  gross_profit DECIMAL(10,2),
  vehicles_sold INTEGER,
  vehicles_purchased INTEGER,
  avg_sale_price DECIMAL(10,2),
  commission_earned DECIMAL(10,2)
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    SUM(CASE WHEN transaction_type = 'sale' THEN amount ELSE 0 END)::DECIMAL(10,2),
    SUM(CASE WHEN transaction_type = 'purchase' THEN amount ELSE 0 END)::DECIMAL(10,2),
    SUM(CASE WHEN transaction_type = 'sale' THEN profit_amount ELSE 0 END)::DECIMAL(10,2),
    COUNT(CASE WHEN transaction_type = 'sale' THEN 1 END)::INTEGER,
    COUNT(CASE WHEN transaction_type = 'purchase' THEN 1 END)::INTEGER,
    AVG(CASE WHEN transaction_type = 'sale' THEN amount END)::DECIMAL(10,2),
    SUM(COALESCE(commission_amount, 0))::DECIMAL(10,2)
  FROM dealer_sales_transactions
  WHERE dealer_id = dealer_org_id
    AND (start_date IS NULL OR transaction_date >= start_date)
    AND (end_date IS NULL OR transaction_date <= end_date);
END;
$$;

-- Update organization_vehicles relationship types for dealers
DO $$
BEGIN
  -- Add 'consignment' to allowed relationship types if not exists
  ALTER TABLE organization_vehicles DROP CONSTRAINT IF EXISTS organization_vehicles_relationship_type_check;
  
  ALTER TABLE organization_vehicles ADD CONSTRAINT organization_vehicles_relationship_type_check
  CHECK (relationship_type IN (
    'owner',
    'consigner',
    'service_provider',
    'work_location',
    'seller',
    'buyer',
    'parts_supplier',
    'fabricator',
    'painter',
    'upholstery',
    'transport',
    'storage',
    'inspector',
    'collaborator',
    'current_consignment',    -- NEW: Currently consigned
    'past_consignment',       -- NEW: Previously consigned
    'sold_by',                -- NEW: Dealer sold this
    'purchased_from'          -- NEW: Dealer bought from
  ));
END $$;

COMMENT ON TABLE dealer_inventory IS 'Dealer-specific inventory tracking with status, pricing, and sales data';
COMMENT ON TABLE dealer_sales_transactions IS 'Complete sales transaction history for dealers';

