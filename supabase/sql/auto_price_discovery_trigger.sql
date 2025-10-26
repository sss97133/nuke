-- Automatic Price Discovery Trigger
-- Triggers price discovery when a vehicle is added or updated

-- Create table to store price discovery results
CREATE TABLE IF NOT EXISTS vehicle_price_discoveries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  estimated_value NUMERIC,
  confidence INTEGER,
  base_price NUMERIC,
  condition_multiplier NUMERIC DEFAULT 1.0,
  comparable_count INTEGER DEFAULT 0,
  sold_count INTEGER DEFAULT 0,
  asking_count INTEGER DEFAULT 0,
  price_range_low NUMERIC,
  price_range_high NUMERIC,
  sources TEXT[],
  comparables JSONB,
  discovered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add price discovery fields to vehicles table
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS price_confidence INTEGER DEFAULT 0;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS price_last_updated TIMESTAMP WITH TIME ZONE;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS price_sources TEXT[];

-- Create function to trigger price discovery
CREATE OR REPLACE FUNCTION trigger_auto_price_discovery()
RETURNS TRIGGER AS $$
BEGIN
  -- Only trigger for new vehicles or when year/make/model changes
  IF TG_OP = 'INSERT' OR 
     (TG_OP = 'UPDATE' AND (
       OLD.year IS DISTINCT FROM NEW.year OR 
       OLD.make IS DISTINCT FROM NEW.make OR 
       OLD.model IS DISTINCT FROM NEW.model
     )) THEN
    
    -- Call the Edge Function asynchronously (fire and forget)
    PERFORM net.http_post(
      url := current_setting('app.supabase_url') || '/functions/v1/auto-price-discovery',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key')
      ),
      body := jsonb_build_object(
        'vehicle_id', NEW.id::text
      )
    );
    
    -- Log the trigger
    INSERT INTO vehicle_activity_log (vehicle_id, activity_type, details)
    VALUES (NEW.id, 'price_discovery_triggered', 
            jsonb_build_object('year', NEW.year, 'make', NEW.make, 'model', NEW.model));
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create the trigger
DROP TRIGGER IF EXISTS auto_price_discovery_trigger ON vehicles;
CREATE TRIGGER auto_price_discovery_trigger
  AFTER INSERT OR UPDATE ON vehicles
  FOR EACH ROW
  EXECUTE FUNCTION trigger_auto_price_discovery();

-- Create activity log table if it doesn't exist
CREATE TABLE IF NOT EXISTS vehicle_activity_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_vehicle_price_discoveries_vehicle_id ON vehicle_price_discoveries(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_price_discoveries_discovered_at ON vehicle_price_discoveries(discovered_at);
CREATE INDEX IF NOT EXISTS idx_vehicle_activity_log_vehicle_id ON vehicle_activity_log(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_activity_log_type ON vehicle_activity_log(activity_type);

-- Enable RLS
ALTER TABLE vehicle_price_discoveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_activity_log ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view price discoveries for vehicles they can see" ON vehicle_price_discoveries
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM vehicles 
      WHERE vehicles.id = vehicle_price_discoveries.vehicle_id
    )
  );

CREATE POLICY "Users can view activity logs for vehicles they can see" ON vehicle_activity_log
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM vehicles 
      WHERE vehicles.id = vehicle_activity_log.vehicle_id
    )
  );

-- Function to manually trigger price discovery (for testing)
CREATE OR REPLACE FUNCTION manual_price_discovery(p_vehicle_id UUID)
RETURNS JSONB AS $$
DECLARE
  result JSONB;
BEGIN
  -- Call the Edge Function
  SELECT net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/auto-price-discovery',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body := jsonb_build_object(
      'vehicle_id', p_vehicle_id::text
    )
  ) INTO result;
  
  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Success message
DO $$
BEGIN
  RAISE NOTICE 'Auto Price Discovery system installed! 🚀';
  RAISE NOTICE 'Now when vehicles are added, prices will be automatically discovered from BAT, Classic.com, and Hemmings.';
END$$;