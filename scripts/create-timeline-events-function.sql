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
