-- Merge Vehicle Profiles with Full Attribution
-- Merges 92cee14e-d256-4bce-a2b7-46807a60e7e4 into b5a0c58a-6915-499b-ba5d-63c42fb6a91f
-- Extracts BaT data and records all attribution

DO $$
DECLARE
  v_primary_vehicle_id UUID := 'b5a0c58a-6915-499b-ba5d-63c42fb6a91f';
  v_merge_vehicle_id UUID := '92cee14e-d256-4bce-a2b7-46807a60e7e4';
  v_org_id UUID := 'c433d27e-2159-4f8c-b4ae-32a5e44a77cf';
  v_user_id UUID := '0b9f107a-d124-49de-9ded-94698f63c1c4';
  v_bat_url TEXT := 'https://bringatrailer.com/listing/1985-chevrolet-suburban-11/';
  v_field_value TEXT;
  v_existing_value TEXT;
BEGIN
  -- ========================================================================
  -- STEP 1: Record attribution for existing data in primary vehicle
  -- ========================================================================
  
  -- Record VIN attribution (from primary vehicle)
  INSERT INTO vehicle_field_sources (
    vehicle_id, field_name, field_value, source_type, 
    source_url, extraction_method, confidence_score, user_id, metadata
  )
  SELECT 
    v_primary_vehicle_id, 'vin', v.vin, 'user_input',
    v.bat_auction_url, 'manual_entry', 95, v.uploaded_by,
    jsonb_build_object('original_source', 'vehicle_creation', 'source_vehicle', v_primary_vehicle_id)
  FROM vehicles v
  WHERE v.id = v_primary_vehicle_id
    AND v.vin IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM vehicle_field_sources vfs 
      WHERE vfs.vehicle_id = v_primary_vehicle_id 
        AND vfs.field_name = 'vin'
        AND vfs.field_value = v.vin
    );

  -- Record mileage attribution
  INSERT INTO vehicle_field_sources (
    vehicle_id, field_name, field_value, source_type,
    source_url, extraction_method, confidence_score, user_id, metadata
  )
  SELECT 
    v_primary_vehicle_id, 'mileage', v.mileage::TEXT, 'user_input',
    v.bat_auction_url, 'manual_entry', 90, v.uploaded_by,
    jsonb_build_object('original_source', 'vehicle_creation', 'source_vehicle', v_primary_vehicle_id)
  FROM vehicles v
  WHERE v.id = v_primary_vehicle_id
    AND v.mileage IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM vehicle_field_sources vfs 
      WHERE vfs.vehicle_id = v_primary_vehicle_id 
        AND vfs.field_name = 'mileage'
        AND vfs.field_value = v.mileage::TEXT
    );

  -- Record color attribution
  INSERT INTO vehicle_field_sources (
    vehicle_id, field_name, field_value, source_type,
    source_url, extraction_method, confidence_score, user_id, metadata
  )
  SELECT 
    v_primary_vehicle_id, 'color', v.color, 'user_input',
    v.bat_auction_url, 'manual_entry', 90, v.uploaded_by,
    jsonb_build_object('original_source', 'vehicle_creation', 'source_vehicle', v_primary_vehicle_id)
  FROM vehicles v
  WHERE v.id = v_primary_vehicle_id
    AND v.color IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM vehicle_field_sources vfs 
      WHERE vfs.vehicle_id = v_primary_vehicle_id 
        AND vfs.field_name = 'color'
        AND vfs.field_value = v.color
    );

  -- Record sale_price attribution
  INSERT INTO vehicle_field_sources (
    vehicle_id, field_name, field_value, source_type,
    source_url, extraction_method, confidence_score, user_id, metadata
  )
  SELECT 
    v_primary_vehicle_id, 'sale_price', v.sale_price::TEXT, 'ai_scraped',
    v.bat_auction_url, 'url_scraping', 95, v.uploaded_by,
    jsonb_build_object('source', 'BaT_auction', 'auction_url', v.bat_auction_url)
  FROM vehicles v
  WHERE v.id = v_primary_vehicle_id
    AND v.sale_price IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM vehicle_field_sources vfs 
      WHERE vfs.vehicle_id = v_primary_vehicle_id 
        AND vfs.field_name = 'sale_price'
        AND vfs.field_value = v.sale_price::TEXT
    );

  -- ========================================================================
  -- STEP 2: Merge data from secondary vehicle with attribution
  -- ========================================================================
  
  -- Record make/model from secondary vehicle (dropbox import)
  INSERT INTO vehicle_field_sources (
    vehicle_id, field_name, field_value, source_type,
    extraction_method, confidence_score, user_id, metadata
  )
  SELECT 
    v_primary_vehicle_id, 'make', v.make, 'ai_scraped',
    'dropbox_bulk_import', 85, v.uploaded_by,
    jsonb_build_object('original_source', 'dropbox_bulk_import', 'source_vehicle', v_merge_vehicle_id, 'merged_at', NOW())
  FROM vehicles v
  WHERE v.id = v_merge_vehicle_id
    AND v.make IS NOT NULL
    AND v.make != (SELECT make FROM vehicles WHERE id = v_primary_vehicle_id)
    AND NOT EXISTS (
      SELECT 1 FROM vehicle_field_sources vfs 
      WHERE vfs.vehicle_id = v_primary_vehicle_id 
        AND vfs.field_name = 'make'
        AND vfs.field_value = v.make
        AND vfs.metadata->>'source_vehicle' = v_merge_vehicle_id::TEXT
    );

  INSERT INTO vehicle_field_sources (
    vehicle_id, field_name, field_value, source_type,
    extraction_method, confidence_score, user_id, metadata
  )
  SELECT 
    v_primary_vehicle_id, 'model', v.model, 'ai_scraped',
    'dropbox_bulk_import', 85, v.uploaded_by,
    jsonb_build_object('original_source', 'dropbox_bulk_import', 'source_vehicle', v_merge_vehicle_id, 'merged_at', NOW())
  FROM vehicles v
  WHERE v.id = v_merge_vehicle_id
    AND v.model IS NOT NULL
    AND v.model != (SELECT model FROM vehicles WHERE id = v_primary_vehicle_id)
    AND NOT EXISTS (
      SELECT 1 FROM vehicle_field_sources vfs 
      WHERE vfs.vehicle_id = v_primary_vehicle_id 
        AND vfs.field_name = 'model'
        AND vfs.field_value = v.model
        AND vfs.metadata->>'source_vehicle' = v_merge_vehicle_id::TEXT
    );

  -- Record current_value from secondary vehicle
  INSERT INTO vehicle_field_sources (
    vehicle_id, field_name, field_value, source_type,
    extraction_method, confidence_score, user_id, metadata
  )
  SELECT 
    v_primary_vehicle_id, 'current_value', v.current_value::TEXT, 'ai_scraped',
    'dropbox_bulk_import', 90, v.uploaded_by,
    jsonb_build_object('original_source', 'dropbox_bulk_import', 'source_vehicle', v_merge_vehicle_id, 'merged_at', NOW())
  FROM vehicles v
  WHERE v.id = v_merge_vehicle_id
    AND v.current_value IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM vehicle_field_sources vfs 
      WHERE vfs.vehicle_id = v_primary_vehicle_id 
        AND vfs.field_name = 'current_value'
        AND vfs.field_value = v.current_value::TEXT
        AND vfs.metadata->>'source_vehicle' = v_merge_vehicle_id::TEXT
    );

  -- ========================================================================
  -- STEP 3: Extract and record BaT listing data with attribution
  -- ========================================================================
  
  -- BaT Data extracted from listing:
  -- Year: 1985, Make: Chevrolet, Model: K10 Suburban Silverado
  -- Mileage: 79k miles (79,000)
  -- VIN: (extracted if found in listing)
  -- Engine: 5.7L V8
  -- Transmission: 4-speed automatic
  -- Color: Apple Red and Doeskin Tan
  -- Sale Price: $34,000
  -- Sold Date: May 5, 2025
  -- Seller: VivaLasVegasAutos
  -- Location: Nevada
  -- Lot #: 190280

  -- Record BaT-extracted year (1985)
  INSERT INTO vehicle_field_sources (
    vehicle_id, field_name, field_value, source_type,
    source_url, extraction_method, confidence_score, user_id, metadata
  )
  VALUES (
    v_primary_vehicle_id, 'year', '1985', 'ai_scraped',
    v_bat_url, 'url_scraping', 100, v_user_id,
    jsonb_build_object('source', 'BaT_listing', 'extracted_at', NOW(), 'lot_number', '190280')
  )
  ON CONFLICT DO NOTHING;

  -- Record BaT-extracted make (Chevrolet - confirming existing)
  INSERT INTO vehicle_field_sources (
    vehicle_id, field_name, field_value, source_type,
    source_url, extraction_method, confidence_score, user_id, metadata
  )
  VALUES (
    v_primary_vehicle_id, 'make', 'Chevrolet', 'ai_scraped',
    v_bat_url, 'url_scraping', 100, v_user_id,
    jsonb_build_object('source', 'BaT_listing', 'extracted_at', NOW(), 'lot_number', '190280', 'confirms_existing', true)
  )
  ON CONFLICT DO NOTHING;

  -- Record BaT-extracted model (K10 Suburban Silverado)
  INSERT INTO vehicle_field_sources (
    vehicle_id, field_name, field_value, source_type,
    source_url, extraction_method, confidence_score, user_id, metadata
  )
  VALUES (
    v_primary_vehicle_id, 'model', 'K10 Suburban Silverado', 'ai_scraped',
    v_bat_url, 'url_scraping', 100, v_user_id,
    jsonb_build_object('source', 'BaT_listing', 'extracted_at', NOW(), 'lot_number', '190280', 'full_model', '1985 Chevrolet K10 Suburban Silverado 5.7L 4×4')
  )
  ON CONFLICT DO NOTHING;

  -- Record BaT-extracted mileage (79k miles)
  INSERT INTO vehicle_field_sources (
    vehicle_id, field_name, field_value, source_type,
    source_url, extraction_method, confidence_score, user_id, metadata
  )
  VALUES (
    v_primary_vehicle_id, 'mileage', '79000', 'ai_scraped',
    v_bat_url, 'url_scraping', 95, v_user_id,
    jsonb_build_object('source', 'BaT_listing', 'extracted_at', NOW(), 'lot_number', '190280', 'original_text', '79k miles')
  )
  ON CONFLICT DO NOTHING;

  -- Record BaT-extracted engine (5.7L V8)
  INSERT INTO vehicle_field_sources (
    vehicle_id, field_name, field_value, source_type,
    source_url, extraction_method, confidence_score, user_id, metadata
  )
  VALUES (
    v_primary_vehicle_id, 'engine', '5.7L V8', 'ai_scraped',
    v_bat_url, 'url_scraping', 100, v_user_id,
    jsonb_build_object('source', 'BaT_listing', 'extracted_at', NOW(), 'lot_number', '190280', 'engine_details', jsonb_build_object('displacement', '5.7L', 'configuration', 'V8', 'carburetor', 'four-barrel'))
  )
  ON CONFLICT DO NOTHING;

  -- Record BaT-extracted transmission (4-speed automatic)
  INSERT INTO vehicle_field_sources (
    vehicle_id, field_name, field_value, source_type,
    source_url, extraction_method, confidence_score, user_id, metadata
  )
  VALUES (
    v_primary_vehicle_id, 'transmission', '4-speed automatic', 'ai_scraped',
    v_bat_url, 'url_scraping', 100, v_user_id,
    jsonb_build_object('source', 'BaT_listing', 'extracted_at', NOW(), 'lot_number', '190280', 'transfer_case', 'dual-range')
  )
  ON CONFLICT DO NOTHING;

  -- Record BaT-extracted color (Apple Red and Doeskin Tan)
  INSERT INTO vehicle_field_sources (
    vehicle_id, field_name, field_value, source_type,
    source_url, extraction_method, confidence_score, user_id, metadata
  )
  VALUES (
    v_primary_vehicle_id, 'color', 'Apple Red and Doeskin Tan', 'ai_scraped',
    v_bat_url, 'url_scraping', 95, v_user_id,
    jsonb_build_object('source', 'BaT_listing', 'extracted_at', NOW(), 'lot_number', '190280', 'paint_notes', 'Repainted under current ownership')
  )
  ON CONFLICT DO NOTHING;

  -- Record BaT sale price ($34,000)
  INSERT INTO vehicle_field_sources (
    vehicle_id, field_name, field_value, source_type,
    source_url, extraction_method, confidence_score, user_id, metadata
  )
  VALUES (
    v_primary_vehicle_id, 'sale_price', '34000', 'ai_scraped',
    v_bat_url, 'url_scraping', 100, v_user_id,
    jsonb_build_object('source', 'BaT_listing', 'extracted_at', NOW(), 'lot_number', '190280', 'sold_date', '2025-05-05', 'sold_to', 'AKracing')
  )
  ON CONFLICT DO NOTHING;

  -- Record BaT lot number
  INSERT INTO vehicle_field_sources (
    vehicle_id, field_name, field_value, source_type,
    source_url, extraction_method, confidence_score, user_id, metadata
  )
  VALUES (
    v_primary_vehicle_id, 'bat_lot_number', '190280', 'ai_scraped',
    v_bat_url, 'url_scraping', 100, v_user_id,
    jsonb_build_object('source', 'BaT_listing', 'extracted_at', NOW())
  )
  ON CONFLICT DO NOTHING;

  -- Record BaT seller (VivaLasVegasAutos)
  INSERT INTO vehicle_field_sources (
    vehicle_id, field_name, field_value, source_type,
    source_url, extraction_method, confidence_score, user_id, metadata
  )
  VALUES (
    v_primary_vehicle_id, 'bat_seller', 'VivaLasVegasAutos', 'ai_scraped',
    v_bat_url, 'url_scraping', 100, v_user_id,
    jsonb_build_object('source', 'BaT_listing', 'extracted_at', NOW(), 'lot_number', '190280', 'organization_id', v_org_id)
  )
  ON CONFLICT DO NOTHING;

  -- Record BaT location (Nevada)
  INSERT INTO vehicle_field_sources (
    vehicle_id, field_name, field_value, source_type,
    source_url, extraction_method, confidence_score, user_id, metadata
  )
  VALUES (
    v_primary_vehicle_id, 'location', 'Nevada, United States', 'ai_scraped',
    v_bat_url, 'url_scraping', 95, v_user_id,
    jsonb_build_object('source', 'BaT_listing', 'extracted_at', NOW(), 'lot_number', '190280')
  )
  ON CONFLICT DO NOTHING;

  -- ========================================================================
  -- STEP 4: Update primary vehicle with best data
  -- ========================================================================
  
  UPDATE vehicles
  SET
    -- Use BaT model if more specific
    model = COALESCE(
      (SELECT field_value FROM vehicle_field_sources 
       WHERE vehicle_id = v_primary_vehicle_id 
         AND field_name = 'model' 
         AND metadata->>'source' = 'BaT_listing'
       ORDER BY created_at DESC LIMIT 1),
      model
    ),
    -- Update mileage if BaT has more recent/accurate data
    mileage = COALESCE(
      (SELECT field_value::INTEGER FROM vehicle_field_sources 
       WHERE vehicle_id = v_primary_vehicle_id 
         AND field_name = 'mileage' 
         AND metadata->>'source' = 'BaT_listing'
       ORDER BY created_at DESC LIMIT 1),
      mileage
    ),
    -- Update color with BaT data
    color = COALESCE(
      (SELECT field_value FROM vehicle_field_sources 
       WHERE vehicle_id = v_primary_vehicle_id 
         AND field_name = 'color' 
         AND metadata->>'source' = 'BaT_listing'
       ORDER BY created_at DESC LIMIT 1),
      color
    ),
    -- Update engine
    engine = COALESCE(
      (SELECT field_value FROM vehicle_field_sources 
       WHERE vehicle_id = v_primary_vehicle_id 
         AND field_name = 'engine'
       ORDER BY created_at DESC LIMIT 1),
      engine
    ),
    -- Update transmission
    transmission = COALESCE(
      (SELECT field_value FROM vehicle_field_sources 
       WHERE vehicle_id = v_primary_vehicle_id 
         AND field_name = 'transmission'
       ORDER BY created_at DESC LIMIT 1),
      transmission
    ),
    -- Ensure BaT URL is set
    bat_auction_url = COALESCE(bat_auction_url, v_bat_url),
    bat_listing_title = COALESCE(
      bat_listing_title,
      '1985 Chevrolet K10 Suburban Silverado 5.7L 4×4'
    ),
    -- Update sale_price if BaT confirms
    sale_price = COALESCE(
      (SELECT field_value::NUMERIC FROM vehicle_field_sources 
       WHERE vehicle_id = v_primary_vehicle_id 
         AND field_name = 'sale_price' 
         AND metadata->>'source' = 'BaT_listing'
       ORDER BY created_at DESC LIMIT 1),
      sale_price
    ),
    updated_at = NOW()
  WHERE id = v_primary_vehicle_id;

  -- ========================================================================
  -- STEP 5: Transfer related data (images, timeline events)
  -- ========================================================================
  
  -- Transfer images from merge vehicle to primary
  UPDATE vehicle_images
  SET vehicle_id = v_primary_vehicle_id,
      updated_at = NOW()
  WHERE vehicle_id = v_merge_vehicle_id;

  -- Transfer timeline events
  UPDATE timeline_events
  SET vehicle_id = v_primary_vehicle_id,
      updated_at = NOW(),
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'merged_from_vehicle', v_merge_vehicle_id,
        'merged_at', NOW()::TEXT
      )
  WHERE vehicle_id = v_merge_vehicle_id;

  -- Transfer vehicle_contributors
  UPDATE vehicle_contributors
  SET vehicle_id = v_primary_vehicle_id,
      updated_at = NOW()
  WHERE vehicle_id = v_merge_vehicle_id
    AND NOT EXISTS (
      SELECT 1 FROM vehicle_contributors vc2
      WHERE vc2.vehicle_id = v_primary_vehicle_id
        AND vc2.user_id = vehicle_contributors.user_id
        AND vc2.role = vehicle_contributors.role
    );

  -- Transfer discovered_vehicles entries
  UPDATE discovered_vehicles
  SET vehicle_id = v_primary_vehicle_id,
      updated_at = NOW()
  WHERE vehicle_id = v_merge_vehicle_id
    AND NOT EXISTS (
      SELECT 1 FROM discovered_vehicles dv2
      WHERE dv2.vehicle_id = v_primary_vehicle_id
        AND dv2.user_id = discovered_vehicles.user_id
    );

  -- ========================================================================
  -- STEP 6: Update organization link
  -- ========================================================================
  
  -- Ensure primary vehicle is linked to VivaLasVegasAutos as consigner (since they sold it on BaT)
  INSERT INTO organization_vehicles (
    organization_id, vehicle_id, relationship_type, status, created_at
  )
  VALUES (
    v_org_id, v_primary_vehicle_id, 'consigner', 'active', NOW()
  )
  ON CONFLICT (organization_id, vehicle_id) 
  DO UPDATE SET
    relationship_type = 'consigner',
    status = 'active',
    updated_at = NOW();

  -- ========================================================================
  -- STEP 7: Create merge record for audit trail
  -- ========================================================================
  
  INSERT INTO timeline_events (
    vehicle_id, event_type, title, description, event_date, created_by, metadata
  )
  VALUES (
    v_primary_vehicle_id,
    'profile_merge',
    'Vehicle Profile Merged',
    'Merged vehicle profile ' || v_merge_vehicle_id || ' into this profile. All data points preserved with full attribution.',
    NOW(),
    v_user_id,
    jsonb_build_object(
      'merged_vehicle_id', v_merge_vehicle_id,
      'merge_reason', 'duplicate_profiles',
      'data_sources', jsonb_build_array(
        jsonb_build_object('source', 'primary_vehicle', 'vehicle_id', v_primary_vehicle_id),
        jsonb_build_object('source', 'merged_vehicle', 'vehicle_id', v_merge_vehicle_id, 'source_type', 'dropbox_bulk_import'),
        jsonb_build_object('source', 'BaT_listing', 'url', v_bat_url, 'lot_number', '190280')
      )
    )
  );

  -- ========================================================================
  -- STEP 8: Mark merge vehicle as merged (soft delete)
  -- ========================================================================
  
  UPDATE vehicles
  SET 
    is_public = false,
    description = COALESCE(description, '') || E'\n\n[MERGED INTO: ' || v_primary_vehicle_id || ']',
    updated_at = NOW()
  WHERE id = v_merge_vehicle_id;

  RAISE NOTICE 'Successfully merged vehicle % into %', v_merge_vehicle_id, v_primary_vehicle_id;
  RAISE NOTICE 'All data points attributed and BaT listing data extracted';

END $$;

