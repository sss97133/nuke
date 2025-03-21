-- Manual Vehicle Timeline Database Setup
-- Copy and paste this into the Supabase SQL Editor to set up the vehicle timeline tables

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create the vehicle_timeline_events table
CREATE TABLE IF NOT EXISTS vehicle_timeline_events (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  vehicle_id UUID NOT NULL,
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

-- Create an index for faster lookups by vehicle_id
CREATE INDEX IF NOT EXISTS vehicle_timeline_events_vehicle_id_idx ON vehicle_timeline_events(vehicle_id);

-- Create an index for faster event_date sorting
CREATE INDEX IF NOT EXISTS vehicle_timeline_events_event_date_idx ON vehicle_timeline_events(event_date);

-- Set up RLS (Row Level Security)
ALTER TABLE vehicle_timeline_events ENABLE ROW LEVEL SECURITY;

-- Create a policy that allows all authenticated users to select events
CREATE POLICY "Allow public read of timeline events" 
  ON vehicle_timeline_events
  FOR SELECT 
  USING (true);

-- Create a policy that allows authorized users to insert events
CREATE POLICY "Allow authorized users to insert timeline events" 
  ON vehicle_timeline_events
  FOR INSERT 
  TO authenticated
  WITH CHECK (true);

-- Create a policy for vehicle owners to update their vehicle's events
CREATE POLICY "Allow vehicle owners to update their timeline events" 
  ON vehicle_timeline_events
  FOR UPDATE 
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM vehicles v
      WHERE v.id = vehicle_timeline_events.vehicle_id
      AND v.user_id = auth.uid()
    )
  );

-- Function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update the updated_at field
CREATE TRIGGER set_timestamp
BEFORE UPDATE ON vehicle_timeline_events
FOR EACH ROW
EXECUTE FUNCTION update_modified_column();

-- Create an admin function to seed timeline events for testing
-- This bypasses RLS to allow direct event creation without vehicle ownership checks
CREATE OR REPLACE FUNCTION public.admin_create_timeline_events(
  test_events JSONB,
  test_vehicle_id UUID DEFAULT '11111111-1111-1111-1111-111111111111'::UUID
)
RETURNS SETOF UUID
LANGUAGE plpgsql
SECURITY DEFINER -- This runs with administrator privileges to bypass RLS
AS $$
DECLARE
  event_id UUID;
  event_data JSONB;
  event_json JSONB;
  default_vehicle_id UUID := '11111111-1111-1111-1111-111111111111'::UUID;
BEGIN
  -- If no events provided, create some default test events
  IF test_events IS NULL OR jsonb_array_length(test_events) = 0 THEN
    -- First clear any existing events for this vehicle id
    DELETE FROM vehicle_timeline_events WHERE vehicle_id = test_vehicle_id;
    
    -- Create default timeline events for testing
    INSERT INTO vehicle_timeline_events (
      id, vehicle_id, event_type, source, event_date, title, description,
      confidence_score, metadata, source_url, image_urls, created_at, updated_at
    ) VALUES (
      uuid_generate_v4(),
      test_vehicle_id,
      'manufacture',
      'vin_database',
      '2022-01-15T00:00:00Z',
      'Vehicle Manufactured',
      'Vehicle manufactured at production facility',
      95,
      '{"plant_code": "MAP-1", "assembly_line": "A3"}'::jsonb,
      'https://example.com/vin/records',
      ARRAY['https://example.com/images/manufacturing.jpg'],
      now(),
      now()
    )
    RETURNING id INTO event_id;
    RETURN NEXT event_id;
    
    INSERT INTO vehicle_timeline_events (
      id, vehicle_id, event_type, source, event_date, title, description,
      confidence_score, metadata, source_url, image_urls, created_at, updated_at
    ) VALUES (
      uuid_generate_v4(),
      test_vehicle_id,
      'sale',
      'dealership_records',
      '2022-03-10T00:00:00Z',
      'Initial Sale',
      'Vehicle sold to first owner',
      90,
      '{"dealer_id": "D-12345", "sale_price": 45000}'::jsonb,
      'https://example.com/sales/records',
      ARRAY['https://example.com/images/dealership.jpg'],
      now(),
      now()
    )
    RETURNING id INTO event_id;
    RETURN NEXT event_id;
    
    INSERT INTO vehicle_timeline_events (
      id, vehicle_id, event_type, source, event_date, title, description,
      confidence_score, metadata, source_url, image_urls, created_at, updated_at
    ) VALUES (
      uuid_generate_v4(),
      test_vehicle_id,
      'service',
      'service_records',
      '2022-06-22T00:00:00Z',
      'Regular Maintenance',
      'Oil change and routine inspection',
      85,
      '{"service_id": "S-98765", "mileage": 5000, "services_performed": ["oil_change", "tire_rotation", "inspection"]}'::jsonb,
      'https://example.com/service/records',
      ARRAY[]::text[],
      now(),
      now()
    )
    RETURNING id INTO event_id;
    RETURN NEXT event_id;
    
    RETURN;
  END IF;
  
  -- Process each event in the provided JSON array
  FOR event_json IN SELECT * FROM jsonb_array_elements(test_events)
  LOOP
    -- Insert the timeline event using the JSON data
    INSERT INTO vehicle_timeline_events (
      id,
      vehicle_id,
      event_type,
      source,
      event_date,
      title,
      description,
      confidence_score,
      metadata,
      source_url,
      image_urls,
      created_at,
      updated_at
    ) VALUES (
      uuid_generate_v4(),
      COALESCE((event_json->>'vehicle_id')::UUID, test_vehicle_id),
      event_json->>'event_type',
      event_json->>'source',
      (event_json->>'event_date')::TIMESTAMP WITH TIME ZONE,
      event_json->>'title',
      event_json->>'description',
      (event_json->>'confidence_score')::INT,
      COALESCE(event_json->'metadata', '{}'::jsonb),
      event_json->>'source_url',
      COALESCE((event_json->'image_urls')::TEXT[], ARRAY[]::TEXT[]),
      now(),
      now()
    )
    RETURNING id INTO event_id;
    
    RETURN NEXT event_id;
  END LOOP;
  
  RETURN;
END;
$$;

-- Grant execute permission to authenticated users and anon
GRANT EXECUTE ON FUNCTION public.admin_create_timeline_events TO authenticated, anon;
