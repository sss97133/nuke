-- ===================================================================
-- COMPREHENSIVE BACKEND FIX
-- Ensures all critical tables, RLS policies, and functions exist
-- ===================================================================

-- Fix the completion trigger first (non-blocking)
CREATE OR REPLACE FUNCTION update_vehicle_completion()
RETURNS TRIGGER AS $$
DECLARE
  completion_data JSONB;
BEGIN
  BEGIN
    completion_data := calculate_vehicle_completion_algorithmic(NEW.id);
    IF completion_data IS NOT NULL AND completion_data->>'completion_percentage' IS NOT NULL THEN
      NEW.completion_percentage := (completion_data->>'completion_percentage')::INTEGER;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Failed to calculate completion for vehicle %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ===================================================================
-- CORE TABLES - Ensure they exist
-- ===================================================================

-- Profiles (should exist from auth, but ensure columns)
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'profiles' AND column_name = 'avatar_url') THEN
    ALTER TABLE profiles ADD COLUMN avatar_url TEXT;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'profiles' AND column_name = 'bio') THEN
    ALTER TABLE profiles ADD COLUMN bio TEXT;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'profiles' AND column_name = 'location') THEN
    ALTER TABLE profiles ADD COLUMN location TEXT;
  END IF;
END $$;

-- Vehicle Timeline Events (rename from timeline_events if needed)
CREATE TABLE IF NOT EXISTS vehicle_timeline_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  event_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  title TEXT NOT NULL,
  description TEXT,
  image_urls TEXT[],
  metadata JSONB DEFAULT '{}',
  source TEXT DEFAULT 'manual',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vehicle_timeline_vehicle_id ON vehicle_timeline_events(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_timeline_user_id ON vehicle_timeline_events(user_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_timeline_event_date ON vehicle_timeline_events(event_date);

-- Work Sessions
CREATE TABLE IF NOT EXISTS work_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_date DATE NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 0,
  work_description TEXT,
  session_type TEXT DEFAULT 'manual' CHECK (session_type IN ('manual', 'captured', 'inferred')),
  confidence_score NUMERIC(3,2) DEFAULT 0.9,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_work_sessions_vehicle_id ON work_sessions(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_work_sessions_user_id ON work_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_work_sessions_date ON work_sessions(session_date);

-- Receipts
CREATE TABLE IF NOT EXISTS receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  file_url TEXT NOT NULL,
  file_type TEXT NOT NULL,
  vendor_name TEXT,
  purchase_date DATE,
  total_amount NUMERIC(10,2),
  tax_amount NUMERIC(10,2),
  metadata JSONB DEFAULT '{}',
  confidence_score NUMERIC(3,2) DEFAULT 0.9,
  processing_status TEXT DEFAULT 'pending' CHECK (processing_status IN ('pending', 'processing', 'completed', 'failed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_receipts_user_id ON receipts(user_id);
CREATE INDEX IF NOT EXISTS idx_receipts_vehicle_id ON receipts(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_receipts_purchase_date ON receipts(purchase_date);

-- Receipt Line Items
CREATE TABLE IF NOT EXISTS receipt_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id UUID NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  line_type TEXT NOT NULL CHECK (line_type IN ('sale', 'payment', 'tax', 'discount', 'subtotal')),
  description TEXT NOT NULL,
  part_number TEXT,
  brand TEXT,
  quantity INTEGER DEFAULT 1,
  unit_price NUMERIC(10,2),
  line_total NUMERIC(10,2) NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_receipt_line_items_receipt_id ON receipt_line_items(receipt_id);

-- User Tools
CREATE TABLE IF NOT EXISTS user_tools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  part_number TEXT,
  description TEXT NOT NULL,
  brand TEXT,
  category TEXT,
  total_quantity INTEGER DEFAULT 1,
  first_purchase_date DATE,
  last_purchase_date DATE,
  total_spent NUMERIC(10,2) DEFAULT 0,
  receipt_ids UUID[],
  serial_numbers TEXT[],
  image_url TEXT,
  condition TEXT,
  location TEXT,
  notes TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_tools_user_id ON user_tools(user_id);
CREATE INDEX IF NOT EXISTS idx_user_tools_brand ON user_tools(brand);

-- ===================================================================
-- CREDITS SYSTEM TABLES
-- ===================================================================

-- User credits balance
CREATE TABLE IF NOT EXISTS user_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  balance INTEGER DEFAULT 0 CHECK (balance >= 0),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_credits_user_id ON user_credits(user_id);

-- Credit transactions
CREATE TABLE IF NOT EXISTS credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('purchase', 'allocation', 'refund', 'payout')),
  reference_id UUID,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_id ON credit_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_created_at ON credit_transactions(created_at);

-- Vehicle support
CREATE TABLE IF NOT EXISTS vehicle_support (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  supporter_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  credits_allocated INTEGER NOT NULL CHECK (credits_allocated > 0),
  message TEXT,
  is_anonymous BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(vehicle_id, supporter_id)
);

CREATE INDEX IF NOT EXISTS idx_vehicle_support_vehicle_id ON vehicle_support(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_support_supporter_id ON vehicle_support(supporter_id);

-- Builder payouts
CREATE TABLE IF NOT EXISTS builder_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  amount_credits INTEGER NOT NULL CHECK (amount_credits > 0),
  amount_usd NUMERIC(10,2) NOT NULL,
  platform_fee_credits INTEGER NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'paid', 'failed')),
  stripe_payout_id TEXT,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_builder_payouts_user_id ON builder_payouts(user_id);
CREATE INDEX IF NOT EXISTS idx_builder_payouts_status ON builder_payouts(status);

-- ===================================================================
-- RLS POLICIES
-- ===================================================================

-- Enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_timeline_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipt_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_tools ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_support ENABLE ROW LEVEL SECURITY;
ALTER TABLE builder_payouts ENABLE ROW LEVEL SECURITY;

-- Profiles policies
DROP POLICY IF EXISTS "Users can view all profiles" ON profiles;
CREATE POLICY "Users can view all profiles" ON profiles FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);

-- Vehicle Timeline Events policies
DROP POLICY IF EXISTS "Anyone can view timeline events" ON vehicle_timeline_events;
CREATE POLICY "Anyone can view timeline events" ON vehicle_timeline_events FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can create timeline events" ON vehicle_timeline_events;
CREATE POLICY "Users can create timeline events" ON vehicle_timeline_events FOR INSERT 
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own timeline events" ON vehicle_timeline_events;
CREATE POLICY "Users can update own timeline events" ON vehicle_timeline_events FOR UPDATE 
USING (auth.uid() = user_id);

-- Work Sessions policies
DROP POLICY IF EXISTS "Users can view work sessions for vehicles they have access to" ON work_sessions;
CREATE POLICY "Users can view work sessions for vehicles they have access to" ON work_sessions FOR SELECT 
USING (
  auth.uid() = user_id 
  OR EXISTS (
    SELECT 1 FROM vehicles v 
    WHERE v.id = work_sessions.vehicle_id 
    AND v.owner_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Users can create own work sessions" ON work_sessions;
CREATE POLICY "Users can create own work sessions" ON work_sessions FOR INSERT 
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own work sessions" ON work_sessions;
CREATE POLICY "Users can update own work sessions" ON work_sessions FOR UPDATE 
USING (auth.uid() = user_id);

-- Receipts policies
DROP POLICY IF EXISTS "Users can view own receipts" ON receipts;
CREATE POLICY "Users can view own receipts" ON receipts FOR SELECT 
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create own receipts" ON receipts;
CREATE POLICY "Users can create own receipts" ON receipts FOR INSERT 
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own receipts" ON receipts;
CREATE POLICY "Users can update own receipts" ON receipts FOR UPDATE 
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own receipts" ON receipts;
CREATE POLICY "Users can delete own receipts" ON receipts FOR DELETE 
USING (auth.uid() = user_id);

-- Receipt Line Items policies
DROP POLICY IF EXISTS "Users can view line items for their receipts" ON receipt_line_items;
CREATE POLICY "Users can view line items for their receipts" ON receipt_line_items FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM receipts r 
    WHERE r.id = receipt_line_items.receipt_id 
    AND r.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Users can insert line items for their receipts" ON receipt_line_items;
CREATE POLICY "Users can insert line items for their receipts" ON receipt_line_items FOR INSERT 
WITH CHECK (
  EXISTS (
    SELECT 1 FROM receipts r 
    WHERE r.id = receipt_line_items.receipt_id 
    AND r.user_id = auth.uid()
  )
);

-- User Tools policies
DROP POLICY IF EXISTS "Users can view own tools" ON user_tools;
CREATE POLICY "Users can view own tools" ON user_tools FOR SELECT 
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create own tools" ON user_tools;
CREATE POLICY "Users can create own tools" ON user_tools FOR INSERT 
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own tools" ON user_tools;
CREATE POLICY "Users can update own tools" ON user_tools FOR UPDATE 
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own tools" ON user_tools;
CREATE POLICY "Users can delete own tools" ON user_tools FOR DELETE 
USING (auth.uid() = user_id);

-- Credits policies
DROP POLICY IF EXISTS "Users can view own credits" ON user_credits;
CREATE POLICY "Users can view own credits" ON user_credits FOR SELECT 
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view own transactions" ON credit_transactions;
CREATE POLICY "Users can view own transactions" ON credit_transactions FOR SELECT 
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Anyone can view vehicle support" ON vehicle_support;
CREATE POLICY "Anyone can view vehicle support" ON vehicle_support FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can support vehicles" ON vehicle_support;
CREATE POLICY "Users can support vehicles" ON vehicle_support FOR INSERT 
WITH CHECK (auth.uid() = supporter_id);

DROP POLICY IF EXISTS "Users can update own support" ON vehicle_support;
CREATE POLICY "Users can update own support" ON vehicle_support FOR UPDATE 
USING (auth.uid() = supporter_id);

DROP POLICY IF EXISTS "Users can view own payouts" ON builder_payouts;
CREATE POLICY "Users can view own payouts" ON builder_payouts FOR SELECT 
USING (auth.uid() = user_id);

-- ===================================================================
-- HELPER FUNCTIONS
-- ===================================================================

-- Get user credit balance
CREATE OR REPLACE FUNCTION get_user_credit_balance(p_user_id UUID)
RETURNS INTEGER AS $$
DECLARE
  balance INTEGER;
BEGIN
  SELECT COALESCE(user_credits.balance, 0) INTO balance
  FROM user_credits
  WHERE user_id = p_user_id;
  
  RETURN COALESCE(balance, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add credits to user (used by webhook)
CREATE OR REPLACE FUNCTION add_credits_to_user(p_user_id UUID, p_credits INTEGER)
RETURNS VOID AS $$
BEGIN
  INSERT INTO user_credits (user_id, balance)
  VALUES (p_user_id, p_credits)
  ON CONFLICT (user_id) 
  DO UPDATE SET 
    balance = user_credits.balance + p_credits,
    updated_at = NOW();
  
  INSERT INTO credit_transactions (user_id, amount, transaction_type)
  VALUES (p_user_id, p_credits, 'purchase');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Allocate credits to vehicle
CREATE OR REPLACE FUNCTION allocate_credits_to_vehicle(
  p_vehicle_id UUID,
  p_credits INTEGER,
  p_message TEXT DEFAULT NULL,
  p_anonymous BOOLEAN DEFAULT FALSE
)
RETURNS BOOLEAN AS $$
DECLARE
  current_balance INTEGER;
BEGIN
  current_balance := get_user_credit_balance(auth.uid());
  
  IF current_balance < p_credits THEN
    RAISE EXCEPTION 'Insufficient credits (have %, need %)', current_balance, p_credits;
  END IF;
  
  UPDATE user_credits
  SET balance = balance - p_credits,
      updated_at = NOW()
  WHERE user_id = auth.uid();
  
  INSERT INTO credit_transactions (user_id, amount, transaction_type, reference_id)
  VALUES (auth.uid(), -p_credits, 'allocation', p_vehicle_id);
  
  INSERT INTO vehicle_support (vehicle_id, supporter_id, credits_allocated, message, is_anonymous)
  VALUES (p_vehicle_id, auth.uid(), p_credits, p_message, p_anonymous)
  ON CONFLICT (vehicle_id, supporter_id)
  DO UPDATE SET
    credits_allocated = vehicle_support.credits_allocated + p_credits,
    message = COALESCE(EXCLUDED.message, vehicle_support.message),
    created_at = NOW();
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ===================================================================
-- VEHICLE IMAGE RLS FIX
-- ===================================================================

-- Ensure vehicle_images table has proper RLS
DO $$
BEGIN
  -- Enable RLS if not already enabled
  ALTER TABLE vehicle_images ENABLE ROW LEVEL SECURITY;
  
  -- Drop old policies
  DROP POLICY IF EXISTS "Anyone can view vehicle images" ON vehicle_images;
  DROP POLICY IF EXISTS "Users can upload images to their vehicles" ON vehicle_images;
  DROP POLICY IF EXISTS "Contributors can upload images" ON vehicle_images;
  DROP POLICY IF EXISTS "Vehicle owners can manage images" ON vehicle_images;
  
  -- Create new comprehensive policies
  -- SELECT: Anyone can view
  CREATE POLICY "Anyone can view vehicle images" 
  ON vehicle_images FOR SELECT 
  USING (true);
  
  -- INSERT: Owner or contributors can upload
  CREATE POLICY "Users can upload images to vehicles" 
  ON vehicle_images FOR INSERT 
  WITH CHECK (
    auth.uid() = user_id
    AND (
      -- Vehicle owner
      EXISTS (
        SELECT 1 FROM vehicles v 
        WHERE v.id = vehicle_images.vehicle_id 
        AND v.owner_id = auth.uid()
      )
      -- OR contributor
      OR EXISTS (
        SELECT 1 FROM vehicle_contributor_roles vcr
        WHERE vcr.vehicle_id = vehicle_images.vehicle_id
        AND vcr.user_id = auth.uid()
      )
    )
  );
  
  -- UPDATE: Owner or uploader can edit
  CREATE POLICY "Users can update own images" 
  ON vehicle_images FOR UPDATE 
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM vehicles v 
      WHERE v.id = vehicle_images.vehicle_id 
      AND v.owner_id = auth.uid()
    )
  );
  
  -- DELETE: Owner or uploader can delete
  CREATE POLICY "Users can delete images" 
  ON vehicle_images FOR DELETE 
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM vehicles v 
      WHERE v.id = vehicle_images.vehicle_id 
      AND v.owner_id = auth.uid()
    )
  );
  
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Error setting up vehicle_images RLS: %', SQLERRM;
END $$;

COMMENT ON TABLE vehicle_timeline_events IS 'Timeline events for vehicles - photos, work sessions, modifications, etc.';
COMMENT ON TABLE work_sessions IS 'Manual and automatic tracking of work sessions on vehicles';
COMMENT ON TABLE receipts IS 'Receipt uploads and parsed data for parts and tools';
COMMENT ON TABLE user_tools IS 'User tool inventory aggregated from receipts';
COMMENT ON TABLE user_credits IS 'User credit balances for supporting vehicles';
COMMENT ON TABLE vehicle_support IS 'Credits allocated by users to support specific vehicles';

