-- QUOTE & CART SYSTEM
-- Enables AI-powered parts recommendations and instant quotes for vehicles

-- Shopping cart items (temporary, per session)
CREATE TABLE IF NOT EXISTS cart_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id TEXT, -- For anonymous users
  part_id UUID REFERENCES catalog_parts(id) ON DELETE CASCADE,
  assembly_id UUID REFERENCES part_assemblies(id), -- If adding full assembly
  quantity INTEGER DEFAULT 1,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Parts quotes (saved quotes for vehicles)
CREATE TABLE IF NOT EXISTS parts_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  quote_name TEXT, -- "Engine Bay Refresh", "Brake System Overhaul", etc.
  
  -- AI-identified needs
  identified_parts JSONB, -- Parts AI recommends based on photos
  source_images UUID[], -- Which images triggered this quote
  
  -- Quote details
  parts JSONB NOT NULL, -- Array of {part_id, part_number, name, quantity, unit_price, supplier}
  
  -- Pricing breakdown
  parts_subtotal NUMERIC NOT NULL,
  shipping_estimate NUMERIC DEFAULT 0,
  tax_estimate NUMERIC DEFAULT 0,
  labor_hours NUMERIC DEFAULT 0,
  labor_rate NUMERIC DEFAULT 0,
  labor_total NUMERIC DEFAULT 0,
  grand_total NUMERIC NOT NULL,
  
  -- Multi-supplier optimization
  supplier_breakdown JSONB, -- {LMC: $150, RockAuto: $75, etc.}
  
  -- Status
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'ordered', 'completed', 'cancelled')),
  approved_at TIMESTAMPTZ,
  ordered_at TIMESTAMPTZ,
  
  -- Metadata
  ai_confidence NUMERIC, -- 0-100 confidence in recommendations
  ai_reasoning TEXT, -- Why these parts were recommended
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Order tracking (when quote becomes actual order)
CREATE TABLE IF NOT EXISTS parts_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID REFERENCES parts_quotes(id),
  user_id UUID REFERENCES auth.users(id),
  vehicle_id UUID REFERENCES vehicles(id),
  
  -- Order details
  order_number TEXT UNIQUE, -- Our internal order #
  supplier_orders JSONB, -- [{supplier: 'LMC', order_id: 'LMC-12345', tracking: '...'}]
  
  -- Totals
  total_amount NUMERIC NOT NULL,
  
  -- Status tracking
  status TEXT DEFAULT 'pending' CHECK (status IN (
    'pending', 'payment_required', 'paid', 'ordered', 
    'partially_shipped', 'shipped', 'delivered', 'cancelled'
  )),
  
  -- Fulfillment
  payment_status TEXT,
  payment_intent_id TEXT,
  ordered_at TIMESTAMPTZ,
  shipped_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- AI part recommendations (cached)
CREATE TABLE IF NOT EXISTS ai_part_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  image_id UUID REFERENCES vehicle_images(id) ON DELETE CASCADE,
  
  -- AI analysis
  identified_issue TEXT, -- "Brake lines show rust/corrosion"
  recommended_parts JSONB, -- [{part_number, reason, priority, confidence}]
  
  -- Matching
  catalog_matches JSONB, -- Matched to actual catalog parts
  estimated_cost NUMERIC,
  
  -- Confidence & priority
  confidence_score NUMERIC, -- 0-100
  priority TEXT CHECK (priority IN ('critical', 'high', 'medium', 'low', 'cosmetic')),
  
  -- Status
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'quoted', 'ordered', 'ignored')),
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_cart_items_user ON cart_items(user_id);
CREATE INDEX IF NOT EXISTS idx_cart_items_session ON cart_items(session_id);
CREATE INDEX IF NOT EXISTS idx_quotes_vehicle ON parts_quotes(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_quotes_user ON parts_quotes(user_id);
CREATE INDEX IF NOT EXISTS idx_quotes_status ON parts_quotes(status);
CREATE INDEX IF NOT EXISTS idx_orders_quote ON parts_orders(quote_id);
CREATE INDEX IF NOT EXISTS idx_recommendations_vehicle ON ai_part_recommendations(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_recommendations_image ON ai_part_recommendations(image_id);

-- RLS
ALTER TABLE cart_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE parts_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE parts_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_part_recommendations ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users manage own cart" ON cart_items
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users view own quotes" ON parts_quotes
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users create own quotes" ON parts_quotes
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users view own orders" ON parts_orders
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users view vehicle recommendations" ON ai_part_recommendations
  FOR SELECT USING (
    auth.uid() IN (SELECT user_id FROM vehicles WHERE id = vehicle_id)
  );

-- Helper function: Calculate quote total
CREATE OR REPLACE FUNCTION calculate_quote_total(quote_uuid UUID)
RETURNS NUMERIC AS $$
DECLARE
  total NUMERIC;
BEGIN
  SELECT 
    parts_subtotal + 
    COALESCE(shipping_estimate, 0) + 
    COALESCE(tax_estimate, 0) + 
    COALESCE(labor_total, 0)
  INTO total
  FROM parts_quotes
  WHERE id = quote_uuid;
  
  RETURN COALESCE(total, 0);
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE parts_quotes IS 'AI-generated or manual parts quotes for vehicle repairs';
COMMENT ON TABLE ai_part_recommendations IS 'AI-identified parts needs from vehicle photos';
COMMENT ON COLUMN parts_quotes.identified_parts IS 'Parts AI recommends based on image analysis';
COMMENT ON COLUMN ai_part_recommendations.priority IS 'critical = safety issue, high = affects function, medium = maintenance, low = nice to have, cosmetic = appearance only';

