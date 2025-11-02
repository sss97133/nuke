-- Create Vehicle Price History Table
-- Track all price changes over time with full audit trail
-- Created: November 1, 2025

CREATE TABLE IF NOT EXISTS vehicle_price_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  price DECIMAL(10,2) NOT NULL,
  price_type TEXT NOT NULL CHECK (price_type IN ('purchase', 'current_value', 'asking_price', 'sale_price', 'msrp')),
  changed_by UUID REFERENCES auth.users(id),
  change_reason TEXT,
  source TEXT NOT NULL CHECK (source IN ('manual_edit', 'expert_agent', 'document_upload', 'initial_value', 'market_update')),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_vehicle_price_history_vehicle 
  ON vehicle_price_history(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_price_history_date 
  ON vehicle_price_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vehicle_price_history_type 
  ON vehicle_price_history(price_type);

-- Enable RLS
ALTER TABLE vehicle_price_history ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view price history for public vehicles" 
  ON vehicle_price_history FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM vehicles v
      WHERE v.id = vehicle_price_history.vehicle_id
      AND v.is_public = true
    )
  );

CREATE POLICY "Owners can view all price history for their vehicles" 
  ON vehicle_price_history FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM vehicles v
      WHERE v.id = vehicle_price_history.vehicle_id
      AND v.user_id = auth.uid()
    )
  );

-- Trigger to automatically track price changes on vehicles table
CREATE OR REPLACE FUNCTION track_vehicle_price_change()
RETURNS TRIGGER AS $$
BEGIN
  -- Track current_value changes
  IF OLD.current_value IS DISTINCT FROM NEW.current_value AND NEW.current_value IS NOT NULL THEN
    INSERT INTO vehicle_price_history (vehicle_id, price, price_type, source, change_reason)
    VALUES (NEW.id, NEW.current_value, 'current_value', 'manual_edit', 'Vehicle current value updated');
  END IF;
  
  -- Track asking_price changes
  IF OLD.asking_price IS DISTINCT FROM NEW.asking_price AND NEW.asking_price IS NOT NULL THEN
    INSERT INTO vehicle_price_history (vehicle_id, price, price_type, source, change_reason)
    VALUES (NEW.id, NEW.asking_price, 'asking_price', 'manual_edit', 'Asking price updated');
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
DROP TRIGGER IF EXISTS vehicle_price_change_trigger ON vehicles;
CREATE TRIGGER vehicle_price_change_trigger
  AFTER UPDATE ON vehicles
  FOR EACH ROW
  EXECUTE FUNCTION track_vehicle_price_change();

-- Backfill initial prices from existing vehicles (purchase prices)
INSERT INTO vehicle_price_history (vehicle_id, price, price_type, source, change_reason, created_at)
SELECT 
  id,
  purchase_price,
  'purchase',
  'initial_value',
  'Initial purchase price',
  COALESCE(purchase_date::timestamptz, created_at)
FROM vehicles
WHERE purchase_price IS NOT NULL
ON CONFLICT DO NOTHING;

-- Backfill current values
INSERT INTO vehicle_price_history (vehicle_id, price, price_type, source, change_reason, created_at)
SELECT 
  id,
  current_value,
  'current_value',
  'initial_value',
  'Initial current value',
  updated_at
FROM vehicles
WHERE current_value IS NOT NULL
AND current_value != purchase_price -- Don't duplicate if same as purchase
ON CONFLICT DO NOTHING;

