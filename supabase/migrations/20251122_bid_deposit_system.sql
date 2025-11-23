-- Bid Deposit & Payment System
-- Implements deposit holds on bids, automatic releases, and commission processing

-- =====================================================
-- ENHANCE AUCTION_BIDS FOR PAYMENT TRACKING
-- =====================================================

DO $$
BEGIN
  -- Deposit payment tracking
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'auction_bids' AND column_name = 'deposit_payment_intent_id') THEN
    ALTER TABLE auction_bids ADD COLUMN deposit_payment_intent_id TEXT;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'auction_bids' AND column_name = 'deposit_amount_cents') THEN
    ALTER TABLE auction_bids ADD COLUMN deposit_amount_cents BIGINT;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'auction_bids' AND column_name = 'deposit_status') THEN
    ALTER TABLE auction_bids ADD COLUMN deposit_status TEXT CHECK (deposit_status IN 
      ('pending', 'authorized', 'captured', 'released', 'failed')
    ) DEFAULT 'pending';
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'auction_bids' AND column_name = 'deposit_released_at') THEN
    ALTER TABLE auction_bids ADD COLUMN deposit_released_at TIMESTAMPTZ;
  END IF;
  
  -- Final payment tracking
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'auction_bids' AND column_name = 'final_payment_intent_id') THEN
    ALTER TABLE auction_bids ADD COLUMN final_payment_intent_id TEXT;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'auction_bids' AND column_name = 'final_payment_status') THEN
    ALTER TABLE auction_bids ADD COLUMN final_payment_status TEXT CHECK (final_payment_status IN 
      ('pending', 'processing', 'succeeded', 'failed', 'refunded')
    );
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'auction_bids' AND column_name = 'final_payment_captured_at') THEN
    ALTER TABLE auction_bids ADD COLUMN final_payment_captured_at TIMESTAMPTZ;
  END IF;
END $$;

-- =====================================================
-- ENHANCE VEHICLE_LISTINGS FOR COMMISSION TRACKING
-- =====================================================

DO $$
BEGIN
  -- Commission configuration
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'vehicle_listings' AND column_name = 'commission_rate') THEN
    ALTER TABLE vehicle_listings ADD COLUMN commission_rate DECIMAL(5,2) DEFAULT 3.00;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'vehicle_listings' AND column_name = 'deposit_percentage') THEN
    ALTER TABLE vehicle_listings ADD COLUMN deposit_percentage DECIMAL(5,2) DEFAULT 10.00;
  END IF;
  
  -- Financial tracking
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'vehicle_listings' AND column_name = 'commission_cents') THEN
    ALTER TABLE vehicle_listings ADD COLUMN commission_cents BIGINT;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'vehicle_listings' AND column_name = 'seller_payout_cents') THEN
    ALTER TABLE vehicle_listings ADD COLUMN seller_payout_cents BIGINT;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'vehicle_listings' AND column_name = 'payout_status') THEN
    ALTER TABLE vehicle_listings ADD COLUMN payout_status TEXT CHECK (payout_status IN 
      ('pending', 'processing', 'completed', 'failed', 'on_hold')
    );
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'vehicle_listings' AND column_name = 'payout_transfer_id') THEN
    ALTER TABLE vehicle_listings ADD COLUMN payout_transfer_id TEXT;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'vehicle_listings' AND column_name = 'payout_completed_at') THEN
    ALTER TABLE vehicle_listings ADD COLUMN payout_completed_at TIMESTAMPTZ;
  END IF;
END $$;

-- =====================================================
-- STRIPE CUSTOMER TRACKING
-- =====================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'profiles' AND column_name = 'stripe_customer_id') THEN
    ALTER TABLE profiles ADD COLUMN stripe_customer_id TEXT UNIQUE;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'profiles' AND column_name = 'stripe_account_id') THEN
    ALTER TABLE profiles ADD COLUMN stripe_account_id TEXT UNIQUE;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'profiles' AND column_name = 'payment_methods') THEN
    ALTER TABLE profiles ADD COLUMN payment_methods JSONB DEFAULT '[]'::jsonb;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'profiles' AND column_name = 'default_payment_method') THEN
    ALTER TABLE profiles ADD COLUMN default_payment_method TEXT;
  END IF;
END $$;

-- =====================================================
-- PAYMENT TRANSACTIONS TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS payment_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Transaction type
  transaction_type TEXT NOT NULL CHECK (transaction_type IN (
    'bid_deposit',        -- Initial deposit hold
    'deposit_capture',    -- Capturing deposit on win
    'deposit_release',    -- Releasing deposit when outbid
    'final_payment',      -- Remainder payment on win
    'commission',         -- Platform commission
    'seller_payout',      -- Payout to seller
    'refund'             -- Any refunds
  )),
  
  -- Related entities
  listing_id UUID REFERENCES vehicle_listings(id) ON DELETE SET NULL,
  bid_id UUID REFERENCES auction_bids(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  
  -- Stripe tracking
  stripe_payment_intent_id TEXT,
  stripe_charge_id TEXT,
  stripe_transfer_id TEXT,
  stripe_refund_id TEXT,
  
  -- Amounts
  amount_cents BIGINT NOT NULL,
  currency TEXT DEFAULT 'usd',
  
  -- Status
  status TEXT NOT NULL CHECK (status IN (
    'pending', 'authorized', 'processing', 'succeeded', 
    'failed', 'cancelled', 'refunded'
  )),
  
  -- Error handling
  error_code TEXT,
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  
  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_payment_transactions_listing ON payment_transactions(listing_id);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_bid ON payment_transactions(bid_id);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_user ON payment_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_type ON payment_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_status ON payment_transactions(status);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_stripe_pi ON payment_transactions(stripe_payment_intent_id);

-- =====================================================
-- SELLER CONTRACTS TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS seller_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Related entities
  listing_id UUID NOT NULL REFERENCES vehicle_listings(id) ON DELETE CASCADE,
  seller_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  
  -- Contract details
  contract_type TEXT DEFAULT 'consignment' CHECK (contract_type IN ('consignment', 'purchase', 'brokerage')),
  commission_rate DECIMAL(5,2) NOT NULL,
  reserve_price_cents BIGINT,
  
  -- Document tracking
  contract_pdf_url TEXT,
  contract_template_version TEXT,
  
  -- Signature tracking
  docusign_envelope_id TEXT,
  signature_status TEXT DEFAULT 'pending' CHECK (signature_status IN (
    'pending', 'sent', 'viewed', 'signed', 'declined', 'expired'
  )),
  signature_request_sent_at TIMESTAMPTZ,
  signature_completed_at TIMESTAMPTZ,
  signed_document_url TEXT,
  
  -- Vehicle proof of ownership
  title_image_urls JSONB DEFAULT '[]'::jsonb,
  registration_image_urls JSONB DEFAULT '[]'::jsonb,
  ownership_verified BOOLEAN DEFAULT FALSE,
  ownership_verified_at TIMESTAMPTZ,
  
  -- Terms
  terms_accepted BOOLEAN DEFAULT FALSE,
  terms_version TEXT,
  
  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_seller_contracts_listing ON seller_contracts(listing_id);
CREATE INDEX IF NOT EXISTS idx_seller_contracts_seller ON seller_contracts(seller_id);
CREATE INDEX IF NOT EXISTS idx_seller_contracts_vehicle ON seller_contracts(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_seller_contracts_signature_status ON seller_contracts(signature_status);

-- =====================================================
-- HELPER FUNCTIONS
-- =====================================================

-- Calculate deposit amount for a bid
CREATE OR REPLACE FUNCTION calculate_deposit_amount(
  p_bid_amount_cents BIGINT,
  p_listing_id UUID
)
RETURNS BIGINT AS $$
DECLARE
  v_deposit_percentage DECIMAL(5,2);
  v_deposit_amount BIGINT;
BEGIN
  -- Get deposit percentage from listing
  SELECT deposit_percentage INTO v_deposit_percentage
  FROM vehicle_listings
  WHERE id = p_listing_id;
  
  -- Default to 10% if not set
  v_deposit_percentage := COALESCE(v_deposit_percentage, 10.00);
  
  -- Calculate deposit (rounded up)
  v_deposit_amount := CEIL(p_bid_amount_cents * (v_deposit_percentage / 100.0));
  
  RETURN v_deposit_amount;
END;
$$ LANGUAGE plpgsql;

-- Calculate commission and payout amounts
CREATE OR REPLACE FUNCTION calculate_auction_financials(
  p_listing_id UUID,
  p_final_bid_cents BIGINT
)
RETURNS JSONB AS $$
DECLARE
  v_commission_rate DECIMAL(5,2);
  v_commission_cents BIGINT;
  v_seller_payout_cents BIGINT;
BEGIN
  -- Get commission rate from listing
  SELECT commission_rate INTO v_commission_rate
  FROM vehicle_listings
  WHERE id = p_listing_id;
  
  -- Default to 3% if not set
  v_commission_rate := COALESCE(v_commission_rate, 3.00);
  
  -- Calculate commission
  v_commission_cents := FLOOR(p_final_bid_cents * (v_commission_rate / 100.0));
  
  -- Calculate seller payout
  v_seller_payout_cents := p_final_bid_cents - v_commission_cents;
  
  RETURN jsonb_build_object(
    'commission_rate', v_commission_rate,
    'commission_cents', v_commission_cents,
    'seller_payout_cents', v_seller_payout_cents,
    'total_amount_cents', p_final_bid_cents
  );
END;
$$ LANGUAGE plpgsql;

-- Get payment summary for a listing
CREATE OR REPLACE FUNCTION get_listing_payment_summary(p_listing_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'listing_id', l.id,
    'final_bid_cents', l.sold_price_cents,
    'commission_rate', l.commission_rate,
    'commission_cents', l.commission_cents,
    'seller_payout_cents', l.seller_payout_cents,
    'payout_status', l.payout_status,
    'winning_bidder_id', l.buyer_id,
    'deposit_transactions', (
      SELECT jsonb_agg(jsonb_build_object(
        'bid_id', pt.bid_id,
        'amount_cents', pt.amount_cents,
        'status', pt.status,
        'transaction_type', pt.transaction_type
      ))
      FROM payment_transactions pt
      WHERE pt.listing_id = l.id
      AND pt.transaction_type = 'bid_deposit'
    ),
    'total_deposits_held', (
      SELECT COALESCE(SUM(pt.amount_cents), 0)
      FROM payment_transactions pt
      WHERE pt.listing_id = l.id
      AND pt.transaction_type = 'bid_deposit'
      AND pt.status = 'authorized'
    )
  ) INTO v_result
  FROM vehicle_listings l
  WHERE l.id = p_listing_id;
  
  RETURN v_result;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- RLS POLICIES
-- =====================================================

ALTER TABLE payment_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE seller_contracts ENABLE ROW LEVEL SECURITY;

-- Users can view their own payment transactions
CREATE POLICY "view_own_transactions" ON payment_transactions
  FOR SELECT USING (user_id = auth.uid());

-- Users can view transactions for listings they own
CREATE POLICY "view_seller_transactions" ON payment_transactions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM vehicle_listings
      WHERE vehicle_listings.id = payment_transactions.listing_id
      AND vehicle_listings.seller_id = auth.uid()
    )
  );

-- Users can view their own contracts
CREATE POLICY "view_own_contracts" ON seller_contracts
  FOR SELECT USING (seller_id = auth.uid());

-- Users can create contracts for their own listings
CREATE POLICY "create_own_contracts" ON seller_contracts
  FOR INSERT WITH CHECK (seller_id = auth.uid());

-- Users can update their own contracts
CREATE POLICY "update_own_contracts" ON seller_contracts
  FOR UPDATE USING (seller_id = auth.uid());

GRANT EXECUTE ON FUNCTION calculate_deposit_amount(BIGINT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_auction_financials(UUID, BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_listing_payment_summary(UUID) TO authenticated;

COMMENT ON TABLE payment_transactions IS 'Tracks all payment activity for auctions including deposits, captures, releases, and payouts';
COMMENT ON TABLE seller_contracts IS 'Manages consignment agreements and seller contracts for auction listings';
COMMENT ON FUNCTION calculate_deposit_amount IS 'Calculates the deposit amount required for a bid based on listing settings';
COMMENT ON FUNCTION calculate_auction_financials IS 'Calculates commission and payout amounts for an auction';

