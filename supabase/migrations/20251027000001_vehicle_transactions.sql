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
  pickup_address JSONB DEFAULT '{}'::jsonb, -- seller address
  delivery_address JSONB DEFAULT '{}'::jsonb, -- buyer address
  
  -- Metadata
  vehicle_details JSONB DEFAULT '{}'::jsonb, -- cached vehicle info
  metadata JSONB DEFAULT '{}'::jsonb,
  
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

CREATE INDEX IF NOT EXISTS idx_shipping_events_transaction ON shipping_events(transaction_id);
CREATE INDEX IF NOT EXISTS idx_shipping_events_listing ON shipping_events(listing_id);
CREATE INDEX IF NOT EXISTS idx_shipping_events_type ON shipping_events(event_type);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_vehicle_transactions_vehicle ON vehicle_transactions(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_transactions_buyer ON vehicle_transactions(buyer_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_transactions_seller ON vehicle_transactions(seller_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_transactions_status ON vehicle_transactions(status);
CREATE INDEX IF NOT EXISTS idx_vehicle_transactions_buyer_token ON vehicle_transactions(buyer_sign_token);
CREATE INDEX IF NOT EXISTS idx_vehicle_transactions_seller_token ON vehicle_transactions(seller_sign_token);

-- RLS Policies
DO $$
DECLARE
  has_admin_table BOOLEAN := to_regclass('public.admin_users') IS NOT NULL;
  service_check TEXT := '(auth.role() = ''service_role'')';
BEGIN
  IF to_regclass('public.vehicle_transactions') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.vehicle_transactions ENABLE ROW LEVEL SECURITY';

    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'vehicle_transactions' AND policyname = 'Buyers can view their transactions'
    ) THEN
      EXECUTE 'DROP POLICY "Buyers can view their transactions" ON public.vehicle_transactions';
    END IF;
    EXECUTE 'CREATE POLICY "Buyers can view their transactions" ON public.vehicle_transactions FOR SELECT TO authenticated USING (buyer_id = auth.uid())';

    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'vehicle_transactions' AND policyname = 'Sellers can view their transactions'
    ) THEN
      EXECUTE 'DROP POLICY "Sellers can view their transactions" ON public.vehicle_transactions';
    END IF;
    EXECUTE 'CREATE POLICY "Sellers can view their transactions" ON public.vehicle_transactions FOR SELECT TO authenticated USING (seller_id = auth.uid())';

    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'vehicle_transactions' AND policyname = 'Buyers can sign their documents'
    ) THEN
      EXECUTE 'DROP POLICY "Buyers can sign their documents" ON public.vehicle_transactions';
    END IF;
    EXECUTE 'CREATE POLICY "Buyers can sign their documents" ON public.vehicle_transactions FOR UPDATE TO authenticated USING (buyer_id = auth.uid()) WITH CHECK (buyer_id = auth.uid())';

    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'vehicle_transactions' AND policyname = 'Sellers can sign their documents'
    ) THEN
      EXECUTE 'DROP POLICY "Sellers can sign their documents" ON public.vehicle_transactions';
    END IF;
    EXECUTE 'CREATE POLICY "Sellers can sign their documents" ON public.vehicle_transactions FOR UPDATE TO authenticated USING (seller_id = auth.uid()) WITH CHECK (seller_id = auth.uid())';

    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'vehicle_transactions' AND policyname = 'Service role full access'
    ) THEN
      EXECUTE 'DROP POLICY "Service role full access" ON public.vehicle_transactions';
    END IF;
    EXECUTE format(
      'CREATE POLICY "Service role full access" ON public.vehicle_transactions FOR ALL TO service_role USING (%s) WITH CHECK (%s)',
      service_check,
      service_check
    );
  ELSE
    RAISE NOTICE 'Skipping RLS for vehicle_transactions: table does not exist.';
  END IF;
END
$$;

-- Function to update timestamp
CREATE OR REPLACE FUNCTION update_vehicle_transaction_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = public;

DROP TRIGGER IF EXISTS vehicle_transactions_updated_at ON vehicle_transactions;
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

CREATE INDEX IF NOT EXISTS idx_transaction_notifications_transaction ON transaction_notifications(transaction_id);

-- RLS for notifications
DO $$
BEGIN
  IF to_regclass('public.transaction_notifications') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.transaction_notifications ENABLE ROW LEVEL SECURITY';

    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'transaction_notifications' AND policyname = 'Service role can manage notifications'
    ) THEN
      EXECUTE 'DROP POLICY "Service role can manage notifications" ON public.transaction_notifications';
    END IF;
    EXECUTE 'CREATE POLICY "Service role can manage notifications" ON public.transaction_notifications FOR ALL TO service_role USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')';
  ELSE
    RAISE NOTICE 'Skipping RLS for transaction_notifications: table does not exist.';
  END IF;
END
$$;

