-- Migration for Vehicle Timeline Data Structure
-- This creates the necessary tables for storing vehicle timeline events

-- Vehicle Timeline Events table
CREATE TABLE IF NOT EXISTS vehicle_timeline_events (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL,
  source VARCHAR(100) NOT NULL,
  event_date TIMESTAMP WITH TIME ZONE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  confidence_score INT NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 100),
  metadata JSONB DEFAULT '{}'::jsonb,
  source_url TEXT,
  image_urls TEXT[],
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_vehicle_timeline_vehicle_id ON vehicle_timeline_events(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_timeline_event_type ON vehicle_timeline_events(event_type);
CREATE INDEX IF NOT EXISTS idx_vehicle_timeline_event_date ON vehicle_timeline_events(event_date);

-- View to join vehicle data with timeline events
CREATE OR REPLACE VIEW vehicle_timeline_view AS
SELECT 
  vte.*,
  v.make,
  v.model,
  v.year,
  v.vin
FROM 
  vehicle_timeline_events vte
JOIN 
  vehicles v ON vte.vehicle_id = v.id;

-- Function to create a timeline event
CREATE OR REPLACE FUNCTION create_timeline_event(
  p_vehicle_id UUID,
  p_event_type VARCHAR,
  p_source VARCHAR,
  p_event_date TIMESTAMP WITH TIME ZONE,
  p_title TEXT,
  p_description TEXT DEFAULT NULL,
  p_confidence_score INT DEFAULT 50,
  p_metadata JSONB DEFAULT '{}'::jsonb,
  p_source_url TEXT DEFAULT NULL,
  p_image_urls TEXT[] DEFAULT '{}'
) RETURNS UUID AS $$
DECLARE
  event_id UUID;
BEGIN
  INSERT INTO vehicle_timeline_events (
    vehicle_id,
    event_type,
    source,
    event_date,
    title,
    description,
    confidence_score,
    metadata,
    source_url,
    image_urls
  ) VALUES (
    p_vehicle_id,
    p_event_type,
    p_source,
    p_event_date,
    p_title,
    p_description,
    p_confidence_score,
    p_metadata,
    p_source_url,
    p_image_urls
  ) RETURNING id INTO event_id;
  
  RETURN event_id;
END;
$$ LANGUAGE plpgsql;

-- Add RLS policies for security
ALTER TABLE vehicle_timeline_events ENABLE ROW LEVEL SECURITY;

-- Policy for viewing timeline events (public access for now, can be restricted later)
CREATE POLICY vehicle_timeline_select_policy ON vehicle_timeline_events 
  FOR SELECT USING (true);

-- Policy for inserting timeline events (only authenticated users)
CREATE POLICY vehicle_timeline_insert_policy ON vehicle_timeline_events 
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Policy for updating timeline events (only authenticated users who created the event)
CREATE POLICY vehicle_timeline_update_policy ON vehicle_timeline_events 
  FOR UPDATE USING (auth.role() = 'authenticated');

-- Policy for deleting timeline events (only authenticated users)
CREATE POLICY vehicle_timeline_delete_policy ON vehicle_timeline_events 
  FOR DELETE USING (auth.role() = 'authenticated');

-- Trigger to update the updated_at timestamp
CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_timestamp
BEFORE UPDATE ON vehicle_timeline_events
FOR EACH ROW
EXECUTE FUNCTION trigger_set_timestamp();
