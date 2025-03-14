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
      AND v.owner_id = auth.uid()
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
