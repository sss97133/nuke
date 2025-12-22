-- ==========================================================================
-- IMPORT MISSING VEHICLES FROM BaT LISTINGS
-- ==========================================================================
-- Purpose: Create vehicles for all BaT listings that don't have vehicle_id
--          Parse bat_listing_title to extract year/make/model
--          Link to organizations and users
-- ==========================================================================

-- Function to parse year, make, model from bat_listing_title
CREATE OR REPLACE FUNCTION parse_vehicle_from_bat_title(title TEXT)
RETURNS TABLE(
  year INTEGER,
  make TEXT,
  model TEXT
) AS $$
DECLARE
  v_year INTEGER;
  v_make TEXT;
  v_model TEXT;
  v_title_lower TEXT;
BEGIN
  v_title_lower := LOWER(COALESCE(title, ''));
  
  -- Extract year (4 digits at start)
  v_year := (regexp_match(v_title_lower, '^(\d{4})'))[1]::INTEGER;
  IF v_year IS NULL OR v_year < 1900 OR v_year > EXTRACT(YEAR FROM NOW()) + 1 THEN
    v_year := NULL;
  END IF;
  
  -- Extract make/model - common patterns:
  -- "2003 Mercedes-Benz S55 AMG" -> make: mercedes-benz, model: s55 amg
  -- "1966 Ford Mustang GT Fastback" -> make: ford, model: mustang gt fastback
  -- Pattern: year make-model
  IF v_year IS NOT NULL THEN
    -- Remove year prefix
    v_title_lower := regexp_replace(v_title_lower, '^' || v_year || '[- ]+', '');
    
    -- Try to split on hyphen or space after make
    -- Common makes: mercedes-benz, bmw, ford, chevrolet, porsche, etc.
    -- Look for hyphenated makes first
    IF v_title_lower ~ '^mercedes-benz' THEN
      v_make := 'mercedes-benz';
      v_model := regexp_replace(v_title_lower, '^mercedes-benz[- ]+', '');
    ELSIF v_title_lower ~ '^land-rover' THEN
      v_make := 'land-rover';
      v_model := regexp_replace(v_title_lower, '^land-rover[- ]+', '');
    ELSE
      -- Split on first space or hyphen
      v_make := (regexp_split_to_array(v_title_lower, '[- ]+'))[1];
      v_model := array_to_string((regexp_split_to_array(v_title_lower, '[- ]+'))[2:], ' ');
    END IF;
    
    -- Clean up model (remove common suffixes like "K-Code", "4-Speed", etc.)
    v_model := regexp_replace(v_model, '\s+(K-Code|4-Speed|6-Speed|Automatic|Manual).*$', '', 'i');
    v_model := trim(v_model);
  END IF;
  
  RETURN QUERY SELECT v_year, v_make, v_model;
END;
$$ LANGUAGE plpgsql;

-- Function to create vehicles from bat_listings without vehicle_id
CREATE OR REPLACE FUNCTION import_missing_bat_vehicles()
RETURNS TABLE(
  bat_listing_id UUID,
  vehicle_id UUID,
  created BOOLEAN,
  parsed_year INTEGER,
  parsed_make TEXT,
  parsed_model TEXT
) AS $$
DECLARE
  v_listing RECORD;
  v_vehicle_id UUID;
  v_year INTEGER;
  v_make TEXT;
  v_model TEXT;
  v_parsed RECORD;
  v_user_id UUID;
BEGIN
  FOR v_listing IN
    SELECT 
      bl.id,
      bl.bat_listing_url,
      bl.bat_listing_title,
      bl.seller_username,
      bl.buyer_username,
      bl.seller_external_identity_id,
      bl.buyer_external_identity_id,
      bl.organization_id,
      bl.sale_price,
      bl.sale_date,
      bl.auction_end_date,
      bl.listing_status,
      bl.final_bid
    FROM bat_listings bl
    WHERE bl.vehicle_id IS NULL
      AND bl.bat_listing_title IS NOT NULL
  LOOP
    -- Parse title
    SELECT * INTO v_parsed FROM parse_vehicle_from_bat_title(v_listing.bat_listing_title);
    v_year := v_parsed.year;
    v_make := v_parsed.make;
    v_model := v_parsed.model;
    
    -- Only proceed if we have at least year and make
    IF v_year IS NULL OR v_make IS NULL THEN
      CONTINUE;
    END IF;
    
    -- Try to find existing vehicle by URL first
    SELECT id INTO v_vehicle_id
    FROM vehicles
    WHERE listing_url = v_listing.bat_listing_url
       OR bat_auction_url = v_listing.bat_listing_url
       OR discovery_url = v_listing.bat_listing_url
    LIMIT 1;
    
    -- If not found, create new vehicle
    IF v_vehicle_id IS NULL THEN
      INSERT INTO vehicles (
        year,
        make,
        model,
        sale_price,
        sale_date,
        auction_end_date,
        auction_outcome,
        bat_auction_url,
        listing_url,
        discovery_url,
        profile_origin,
        discovery_source,
        bat_seller,
        description,
        is_public,
        origin_metadata
      )
      VALUES (
        v_year,
        LOWER(v_make),
        LOWER(v_model),
        v_listing.sale_price,
        v_listing.sale_date,
        v_listing.auction_end_date,
        CASE 
          WHEN v_listing.listing_status = 'sold' AND v_listing.sale_price > 0 THEN 'sold'
          WHEN v_listing.listing_status = 'sold' THEN 'reserve_not_met'
          ELSE NULL
        END,
        v_listing.bat_listing_url,
        v_listing.bat_listing_url,
        v_listing.bat_listing_url,
        'bat_import',
        'bat_import',
        v_listing.seller_username,
        COALESCE(
          CASE WHEN v_listing.sale_price > 0 
            THEN 'Sold on Bring a Trailer for $' || v_listing.sale_price::TEXT
            ELSE 'Listed on Bring a Trailer'
          END,
          v_listing.bat_listing_title
        ),
        true,
        jsonb_build_object(
          'source', 'bat_import',
          'bat_url', v_listing.bat_listing_url,
          'bat_listing_title', v_listing.bat_listing_title,
          'seller_username', v_listing.seller_username,
          'buyer_username', v_listing.buyer_username,
          'imported_from_bat_listing', true,
          'imported_at', NOW()
        )
      )
      RETURNING id INTO v_vehicle_id;
    END IF;
    
    -- Link to bat_listing
    UPDATE bat_listings
    SET vehicle_id = v_vehicle_id
    WHERE id = v_listing.id;
    
    -- Link to organization if exists
    IF v_listing.organization_id IS NOT NULL THEN
      INSERT INTO organization_vehicles (
        organization_id,
        vehicle_id,
        relationship_type,
        listing_status,
        sale_price,
        sale_date
      )
      VALUES (
        v_listing.organization_id,
        v_vehicle_id,
        'sold_by',
        COALESCE(v_listing.listing_status, 'ended'),
        v_listing.sale_price,
        v_listing.sale_date
      )
      ON CONFLICT (organization_id, vehicle_id, relationship_type) DO UPDATE SET
        listing_status = COALESCE(EXCLUDED.listing_status, organization_vehicles.listing_status),
        sale_price = COALESCE(EXCLUDED.sale_price, organization_vehicles.sale_price),
        sale_date = COALESCE(EXCLUDED.sale_date, organization_vehicles.sale_date);
    END IF;
    
    -- Link seller to vehicle if user has claimed identity
    IF v_listing.seller_external_identity_id IS NOT NULL THEN
      SELECT claimed_by_user_id INTO v_user_id
      FROM external_identities
      WHERE id = v_listing.seller_external_identity_id;
      
      IF v_user_id IS NOT NULL THEN
        -- Update vehicle uploaded_by if not set
        UPDATE vehicles
        SET uploaded_by = v_user_id
        WHERE id = v_vehicle_id
          AND uploaded_by IS NULL;
      END IF;
    END IF;
    
    RETURN QUERY SELECT 
      v_listing.id,
      v_vehicle_id,
      true,
      v_year,
      v_make,
      v_model;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

COMMENT ON FUNCTION parse_vehicle_from_bat_title IS 'Parse year, make, model from BaT listing title';
COMMENT ON FUNCTION import_missing_bat_vehicles IS 'Create vehicles for bat_listings that don''t have vehicle_id and link them to orgs/users';

