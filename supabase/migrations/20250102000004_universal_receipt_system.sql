-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Main receipt record (captures the document itself)
CREATE TABLE IF NOT EXISTS receipts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  file_url TEXT NOT NULL,
  file_name TEXT,
  file_type TEXT, -- pdf, jpg, png, etc
  upload_date TIMESTAMPTZ DEFAULT NOW(),
  processing_status TEXT DEFAULT 'pending', -- pending, processing, completed, failed
  
  -- Extracted metadata (may be null if not found)
  vendor_name TEXT,
  vendor_address TEXT,
  transaction_date DATE,
  transaction_number TEXT,
  total_amount DECIMAL(10,2),
  subtotal DECIMAL(10,2),
  tax_amount DECIMAL(10,2),
  
  -- Raw extraction data (store everything Claude returns)
  raw_extraction JSONB,
  
  -- Quality metrics
  confidence_score DECIMAL(3,2), -- 0.00 to 1.00
  extraction_errors TEXT[],
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Individual line items (tools, parts, services)
CREATE TABLE IF NOT EXISTS line_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  receipt_id UUID NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  
  -- Core item data
  part_number TEXT,
  description TEXT NOT NULL,
  quantity DECIMAL(10,2) DEFAULT 1,
  unit_price DECIMAL(10,2),
  total_price DECIMAL(10,2),
  discount DECIMAL(10,2),
  
  -- Item metadata
  brand TEXT,
  category TEXT, -- auto-categorized or user-defined
  serial_number TEXT,
  warranty_info TEXT,
  
  -- Transaction context
  transaction_date DATE,
  transaction_number TEXT,
  line_type TEXT DEFAULT 'sale', -- 'sale', 'warranty', 'return', 'payment', 'unknown'
  
  -- Flexible storage for varying data
  additional_data JSONB, -- store anything else found
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Payment records (capture all payment info)
CREATE TABLE IF NOT EXISTS payment_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  receipt_id UUID NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  
  payment_date DATE,
  payment_type TEXT, -- RA (receivable account), EC (electronic), cash, card, etc
  amount DECIMAL(10,2),
  transaction_number TEXT,
  
  additional_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- User's tool inventory (consolidated view)
CREATE TABLE IF NOT EXISTS user_tools (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  
  part_number TEXT,
  description TEXT NOT NULL,
  brand TEXT,
  category TEXT,
  
  -- Aggregate data from multiple purchases
  total_quantity INT DEFAULT 1,
  first_purchase_date DATE,
  last_purchase_date DATE,
  total_spent DECIMAL(10,2),
  
  -- Links back to receipts
  receipt_ids UUID[],
  serial_numbers TEXT[],
  
  -- Additional fields for tool management
  image_url TEXT,
  condition TEXT DEFAULT 'good',
  location TEXT,
  notes TEXT,
  metadata JSONB,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_receipts_user ON receipts(user_id);
CREATE INDEX IF NOT EXISTS idx_receipts_vendor ON receipts(vendor_name);
CREATE INDEX IF NOT EXISTS idx_receipts_date ON receipts(transaction_date);
CREATE INDEX IF NOT EXISTS idx_receipts_status ON receipts(processing_status);
CREATE INDEX IF NOT EXISTS idx_line_items_receipt ON line_items(receipt_id);
CREATE INDEX IF NOT EXISTS idx_line_items_user ON line_items(user_id);
CREATE INDEX IF NOT EXISTS idx_line_items_part ON line_items(part_number);
CREATE INDEX IF NOT EXISTS idx_line_items_type ON line_items(line_type);
CREATE INDEX IF NOT EXISTS idx_payment_records_receipt ON payment_records(receipt_id);
CREATE INDEX IF NOT EXISTS idx_user_tools_user ON user_tools(user_id);
CREATE INDEX IF NOT EXISTS idx_user_tools_part ON user_tools(part_number);

-- Row Level Security
ALTER TABLE receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_tools ENABLE ROW LEVEL SECURITY;

-- RLS Policies for receipts
DROP POLICY IF EXISTS "Users can view own receipts" ON receipts;
CREATE POLICY "Users can view own receipts" ON receipts
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create own receipts" ON receipts;
CREATE POLICY "Users can create own receipts" ON receipts
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own receipts" ON receipts;
CREATE POLICY "Users can update own receipts" ON receipts
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own receipts" ON receipts;
CREATE POLICY "Users can delete own receipts" ON receipts
  FOR DELETE USING (auth.uid() = user_id);

-- RLS Policies for line_items
DROP POLICY IF EXISTS "Users can view own line items" ON line_items;
CREATE POLICY "Users can view own line items" ON line_items
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create own line items" ON line_items;
CREATE POLICY "Users can create own line items" ON line_items
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own line items" ON line_items;
CREATE POLICY "Users can update own line items" ON line_items
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own line items" ON line_items;
CREATE POLICY "Users can delete own line items" ON line_items
  FOR DELETE USING (auth.uid() = user_id);

-- RLS Policies for payment_records
DROP POLICY IF EXISTS "Users can view own payment records" ON payment_records;
CREATE POLICY "Users can view own payment records" ON payment_records
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create own payment records" ON payment_records;
CREATE POLICY "Users can create own payment records" ON payment_records
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own payment records" ON payment_records;
CREATE POLICY "Users can update own payment records" ON payment_records
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own payment records" ON payment_records;
CREATE POLICY "Users can delete own payment records" ON payment_records
  FOR DELETE USING (auth.uid() = user_id);

-- RLS Policies for user_tools
DROP POLICY IF EXISTS "Users can view own tools" ON user_tools;
CREATE POLICY "Users can view own tools" ON user_tools
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create own tools" ON user_tools;
CREATE POLICY "Users can create own tools" ON user_tools
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own tools" ON user_tools;
CREATE POLICY "Users can update own tools" ON user_tools
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own tools" ON user_tools;
CREATE POLICY "Users can delete own tools" ON user_tools
  FOR DELETE USING (auth.uid() = user_id);

-- Function to update timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for updated_at
DROP TRIGGER IF EXISTS update_receipts_updated_at ON receipts;
CREATE TRIGGER update_receipts_updated_at BEFORE UPDATE ON receipts
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

DROP TRIGGER IF EXISTS update_user_tools_updated_at ON user_tools;
CREATE TRIGGER update_user_tools_updated_at BEFORE UPDATE ON user_tools
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
