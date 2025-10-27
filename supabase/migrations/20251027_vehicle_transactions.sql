-- Vehicle Transaction Facilitation System
-- For facilitating private party vehicle sales with auto-generated paperwork

-- Main transactions table
CREATE TABLE IF NOT EXISTS vehicle_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Parties
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  buyer_id UUID REFERENCES auth.users(id),
  seller_id UUID REFERENCES auth.users(id),
  
  -- Pricing
  sale_price NUMERIC(10,2) NOT NULL,
  facilitation_fee_pct NUMERIC(4,2) DEFAULT 2.0,
  facilitation_fee_amount NUMERIC(10,2) NOT NULL,
  
  -- Payment tracking
  stripe_session_id TEXT,
  stripe_payment_id TEXT,
  fee_paid_at TIMESTAMPTZ,
  
  -- Contact info (for SMS)
  buyer_phone TEXT,
  buyer_email TEXT,
  seller_phone TEXT,
  seller_email TEXT,
  
  -- Documents
  purchase_agreement_url TEXT,
  bill_of_sale_url TEXT,
  payment_instructions TEXT,
  
  -- Signatures
  buyer_signed_at TIMESTAMPTZ,
  seller_signed_at TIMESTAMPTZ,
  buyer_signature_data TEXT, -- base64 image
  seller_signature_data TEXT, -- base64 image
  buyer_signature_ip TEXT,
  seller_signature_ip TEXT,
  
  -- Unique signing tokens (secure links)
  buyer_sign_token UUID DEFAULT gen_random_uuid(),
  seller_sign_token UUID DEFAULT gen_random_uuid(),
  
  -- Status tracking
  status TEXT DEFAULT 'pending_fee_payment',
  -- pending_fee_payment → pending_signatures → fully_signed → funds_transferred → completed
  
  -- SMS tracking
  buyer_sms_sent_at TIMESTAMPTZ,
  seller_sms_sent_at TIMESTAMPTZ,
  completion_sms_sent_at TIMESTAMPTZ,
  
  -- Shipping integration (Central Dispatch)
  shipping_listing_id TEXT,
  shipping_status TEXT, -- pending_listing → listed → carrier_assigned → picked_up → in_transit → delivered
  shipping_carrier_name TEXT,
  shipping_carrier_phone TEXT,
  shipping_carrier_email TEXT,
  shipping_pickup_date DATE,
  shipping_delivery_date DATE,
  shipping_estimated_cost NUMERIC(10,2),
  shipping_actual_cost NUMERIC(10,2),
  shipping_tracking_url TEXT,
  
  -- Addresses for shipping
  pickup_address JSONB, -- seller address
  delivery_address JSONB, -- buyer address
  
  -- Metadata
  vehicle_details JSONB, -- cached vehicle info
  metadata JSONB,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Shipping events log (for Central Dispatch webhook events)
CREATE TABLE IF NOT EXISTS shipping_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID REFERENCES vehicle_transactions(id) ON DELETE CASCADE,
  listing_id TEXT,
  event_type TEXT NOT NULL, -- carrier_assigned, picked_up, in_transit, delivered, cancelled
  event_data JSONB,
  carrier_info JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_shipping_events_transaction ON shipping_events(transaction_id);
CREATE INDEX idx_shipping_events_listing ON shipping_events(listing_id);
CREATE INDEX idx_shipping_events_type ON shipping_events(event_type);

-- Indexes
CREATE INDEX idx_vehicle_transactions_vehicle ON vehicle_transactions(vehicle_id);
CREATE INDEX idx_vehicle_transactions_buyer ON vehicle_transactions(buyer_id);
CREATE INDEX idx_vehicle_transactions_seller ON vehicle_transactions(seller_id);
CREATE INDEX idx_vehicle_transactions_status ON vehicle_transactions(status);
CREATE INDEX idx_vehicle_transactions_buyer_token ON vehicle_transactions(buyer_sign_token);
CREATE INDEX idx_vehicle_transactions_seller_token ON vehicle_transactions(seller_sign_token);

-- RLS Policies
ALTER TABLE vehicle_transactions ENABLE ROW LEVEL SECURITY;

-- Buyers can see their transactions
CREATE POLICY "Buyers can view their transactions"
  ON vehicle_transactions
  FOR SELECT
  TO authenticated
  USING (buyer_id = auth.uid());

-- Sellers can see their transactions
CREATE POLICY "Sellers can view their transactions"
  ON vehicle_transactions
  FOR SELECT
  TO authenticated
  USING (seller_id = auth.uid());

-- Buyers can update their signatures
CREATE POLICY "Buyers can sign their documents"
  ON vehicle_transactions
  FOR UPDATE
  TO authenticated
  USING (buyer_id = auth.uid())
  WITH CHECK (buyer_id = auth.uid());

-- Sellers can update their signatures
CREATE POLICY "Sellers can sign their documents"
  ON vehicle_transactions
  FOR UPDATE
  TO authenticated
  USING (seller_id = auth.uid())
  WITH CHECK (seller_id = auth.uid());

-- Service role can do anything
CREATE POLICY "Service role full access"
  ON vehicle_transactions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Function to update timestamp
CREATE OR REPLACE FUNCTION update_vehicle_transaction_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER vehicle_transactions_updated_at
  BEFORE UPDATE ON vehicle_transactions
  FOR EACH ROW
  EXECUTE FUNCTION update_vehicle_transaction_timestamp();

-- Transaction notifications log
CREATE TABLE IF NOT EXISTS transaction_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID REFERENCES vehicle_transactions(id) ON DELETE CASCADE,
  recipient_type TEXT NOT NULL, -- 'buyer' or 'seller'
  notification_type TEXT NOT NULL, -- 'sign_request', 'completion', etc
  phone_number TEXT,
  message_body TEXT,
  twilio_sid TEXT,
  status TEXT, -- 'sent', 'delivered', 'failed'
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  delivered_at TIMESTAMPTZ,
  error_message TEXT
);

CREATE INDEX idx_transaction_notifications_transaction ON transaction_notifications(transaction_id);

-- RLS for notifications
ALTER TABLE transaction_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage notifications"
  ON transaction_notifications
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

