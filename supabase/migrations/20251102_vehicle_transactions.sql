-- Vehicle Transaction History
-- Tracks purchase/sale with confidence levels and proof
-- Allows collaborators to log financial data they know

CREATE TABLE IF NOT EXISTS vehicle_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  
  -- Transaction type
  transaction_type TEXT NOT NULL CHECK (transaction_type IN (
    'purchase', 'sale', 'consignment_start', 'consignment_end', 
    'trade_in', 'auction_bid', 'wholesale', 'retail'
  )),
  
  -- Financial details
  amount_usd INTEGER NOT NULL,
  currency TEXT DEFAULT 'USD',
  
  -- Confidence level
  is_estimate BOOLEAN DEFAULT FALSE,        -- "roughly" checkbox
  is_approximate BOOLEAN DEFAULT FALSE,     -- ≈ checkbox (wavy equals)
  confidence_level INTEGER DEFAULT 50,      -- 0-100
  
  -- Date
  transaction_date DATE NOT NULL,
  
  -- Parties involved
  seller_id UUID REFERENCES auth.users(id),
  seller_org_id UUID REFERENCES organizations(id),
  seller_name TEXT,                         -- If not in system
  
  buyer_id UUID REFERENCES auth.users(id),
  buyer_org_id UUID REFERENCES organizations(id),
  buyer_name TEXT,                          -- If not in system
  
  -- Proof/Documentation
  proof_type TEXT CHECK (proof_type IN (
    'bat_listing', 'invoice', 'title', 'bill_of_sale', 
    'auction_results', 'verbal', 'estimate'
  )),
  proof_url TEXT,                           -- BaT listing, document URL
  proof_document_id UUID REFERENCES vehicle_documents(id),
  
  -- Who logged this transaction
  logged_by UUID NOT NULL REFERENCES auth.users(id),
  logged_as TEXT DEFAULT 'collaborator',    -- 'owner', 'collaborator', 'witness'
  
  -- Additional context
  location TEXT,                            -- Where transaction occurred
  notes TEXT,
  metadata JSONB,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vehicle_transactions_vehicle ON vehicle_transactions(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_transactions_type ON vehicle_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_vehicle_transactions_date ON vehicle_transactions(transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_vehicle_transactions_logged_by ON vehicle_transactions(logged_by);

-- View: Vehicle financial summary
CREATE OR REPLACE VIEW vehicle_financial_summary AS
SELECT 
  v.id as vehicle_id,
  v.year,
  v.make,
  v.model,
  
  -- Purchase price (most recent purchase)
  (SELECT vt.amount_usd 
   FROM vehicle_transactions vt 
   WHERE vt.vehicle_id = v.id 
     AND vt.transaction_type = 'purchase'
   ORDER BY vt.transaction_date DESC 
   LIMIT 1) as last_purchase_price,
   
  -- Sale price (most recent sale)
  (SELECT vt.amount_usd 
   FROM vehicle_transactions vt 
   WHERE vt.vehicle_id = v.id 
     AND vt.transaction_type = 'sale'
   ORDER BY vt.transaction_date DESC 
   LIMIT 1) as last_sale_price,
   
  -- Total documented investment (from receipts)
  COALESCE((
    SELECT SUM((r.total_amount_usd)::numeric)
    FROM receipts r
    WHERE r.vehicle_id = v.id
  ), 0) as total_documented_investment,
  
  -- Profit/Loss (if both purchase and sale exist)
  (SELECT vt_sale.amount_usd - vt_purchase.amount_usd
   FROM vehicle_transactions vt_sale
   CROSS JOIN vehicle_transactions vt_purchase
   WHERE vt_sale.vehicle_id = v.id 
     AND vt_sale.transaction_type = 'sale'
     AND vt_purchase.vehicle_id = v.id
     AND vt_purchase.transaction_type = 'purchase'
   ORDER BY vt_sale.transaction_date DESC, vt_purchase.transaction_date DESC
   LIMIT 1) as profit_loss,
   
  -- Transaction count
  (SELECT COUNT(*) FROM vehicle_transactions WHERE vehicle_id = v.id) as total_transactions

FROM vehicles v;

-- Function: Log transaction with automatic timeline event
CREATE OR REPLACE FUNCTION log_vehicle_transaction(
  p_vehicle_id UUID,
  p_transaction_type TEXT,
  p_amount_usd INTEGER,
  p_transaction_date DATE,
  p_logged_by UUID,
  p_is_estimate BOOLEAN DEFAULT FALSE,
  p_is_approximate BOOLEAN DEFAULT FALSE,
  p_proof_type TEXT DEFAULT NULL,
  p_proof_url TEXT DEFAULT NULL,
  p_buyer_name TEXT DEFAULT NULL,
  p_seller_name TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_transaction_id UUID;
  v_vehicle RECORD;
BEGIN
  -- Get vehicle info for timeline
  SELECT * INTO v_vehicle
  FROM vehicles
  WHERE id = p_vehicle_id;
  
  -- Insert transaction
  INSERT INTO vehicle_transactions (
    vehicle_id,
    transaction_type,
    amount_usd,
    transaction_date,
    is_estimate,
    is_approximate,
    proof_type,
    proof_url,
    buyer_name,
    seller_name,
    logged_by
  ) VALUES (
    p_vehicle_id,
    p_transaction_type,
    p_amount_usd,
    p_transaction_date,
    p_is_estimate,
    p_is_approximate,
    p_proof_type,
    p_proof_url,
    p_buyer_name,
    p_seller_name,
    p_logged_by
  )
  RETURNING id INTO v_transaction_id;
  
  -- Create timeline event
  INSERT INTO timeline_events (
    vehicle_id,
    user_id,
    event_type,
    source,
    title,
    event_date,
    metadata
  ) VALUES (
    p_vehicle_id,
    p_logged_by,
    CASE p_transaction_type
      WHEN 'purchase' THEN 'purchase'
      WHEN 'sale' THEN 'sale'
      ELSE 'financial'
    END,
    'transaction_log',
    CASE p_transaction_type
      WHEN 'purchase' THEN CONCAT('Purchased for $', p_amount_usd::text)
      WHEN 'sale' THEN CONCAT('Sold for $', p_amount_usd::text)
      ELSE CONCAT(p_transaction_type, ': $', p_amount_usd::text)
    END,
    p_transaction_date::timestamp,
    jsonb_build_object(
      'transaction_id', v_transaction_id,
      'amount', p_amount_usd,
      'is_estimate', p_is_estimate,
      'is_approximate', p_is_approximate,
      'proof_type', p_proof_type
    )
  );
  
  RETURN v_transaction_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE vehicle_transactions IS 'Purchase/sale history with confidence levels and proof - for dealer inventory tracking';
COMMENT ON COLUMN vehicle_transactions.is_estimate IS 'Rough estimate checkbox';
COMMENT ON COLUMN vehicle_transactions.is_approximate IS 'Wavy equals (≈) - close to actual amount';

