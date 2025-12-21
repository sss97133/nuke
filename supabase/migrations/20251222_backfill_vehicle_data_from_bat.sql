-- Backfill missing vehicle data from BaT raw_data
-- This addresses 740 vehicles with missing trim, engine, drivetrain, mileage, color

CREATE OR REPLACE FUNCTION backfill_vehicle_data_from_bat()
RETURNS TABLE(
  vehicle_id UUID,
  updated_fields TEXT[]
) AS $$
DECLARE
  v_listing RECORD;
  v_raw_data JSONB;
  v_updated_fields TEXT[] := '{}';
  v_trim TEXT;
  v_engine_size TEXT;
  v_displacement TEXT;
  v_drivetrain TEXT;
  v_mileage INTEGER;
  v_color TEXT;
  v_year INTEGER;
  v_make TEXT;
  v_model TEXT;
BEGIN
  FOR v_listing IN
    SELECT
      bl.vehicle_id,
      bl.raw_data,
      v.trim,
      v.engine_size,
      v.displacement,
      v.drivetrain,
      v.mileage,
      v.color,
      v.year,
      v.make,
      v.model
    FROM bat_listings bl
    JOIN vehicles v ON v.id = bl.vehicle_id
    WHERE bl.vehicle_id IS NOT NULL
      AND bl.raw_data IS NOT NULL
  LOOP
    v_raw_data := v_listing.raw_data;
    v_updated_fields := '{}';

    -- Extract fields from raw_data
    v_year := (v_raw_data->>'year')::INTEGER;
    v_make := v_raw_data->>'make';
    v_model := v_raw_data->>'model';
    v_trim := v_raw_data->>'trim';
    v_engine_size := COALESCE(v_raw_data->>'engine', v_raw_data->>'engine_size');
    v_displacement := v_raw_data->>'displacement';
    v_drivetrain := COALESCE(v_raw_data->>'drivetrain', v_raw_data->>'drive');
    v_mileage := CASE 
      WHEN v_raw_data->>'mileage' ~ '^\d+$' THEN (v_raw_data->>'mileage')::INTEGER
      WHEN v_raw_data->>'odometer' ~ '^\d+$' THEN (v_raw_data->>'odometer')::INTEGER
      ELSE NULL
    END;
    v_color := COALESCE(
      v_raw_data->>'color',
      v_raw_data->>'exterior_color',
      v_raw_data->>'paint_color'
    );

    -- Build updated_fields array
    IF v_listing.trim IS NULL AND v_trim IS NOT NULL THEN
      v_updated_fields := array_append(v_updated_fields, 'trim');
    END IF;
    IF v_listing.engine_size IS NULL AND v_engine_size IS NOT NULL THEN
      v_updated_fields := array_append(v_updated_fields, 'engine_size');
    END IF;
    IF v_listing.displacement IS NULL AND v_displacement IS NOT NULL THEN
      v_updated_fields := array_append(v_updated_fields, 'displacement');
    END IF;
    IF v_listing.drivetrain IS NULL AND v_drivetrain IS NOT NULL THEN
      v_updated_fields := array_append(v_updated_fields, 'drivetrain');
    END IF;
    IF v_listing.mileage IS NULL AND v_mileage IS NOT NULL THEN
      v_updated_fields := array_append(v_updated_fields, 'mileage');
    END IF;
    IF v_listing.color IS NULL AND v_color IS NOT NULL THEN
      v_updated_fields := array_append(v_updated_fields, 'color');
    END IF;
    IF v_listing.year IS NULL AND v_year IS NOT NULL THEN
      v_updated_fields := array_append(v_updated_fields, 'year');
    END IF;
    IF v_listing.make IS NULL AND v_make IS NOT NULL THEN
      v_updated_fields := array_append(v_updated_fields, 'make');
    END IF;
    IF v_listing.model IS NULL AND v_model IS NOT NULL THEN
      v_updated_fields := array_append(v_updated_fields, 'model');
    END IF;

    -- Only update if there are fields to update
    IF array_length(v_updated_fields, 1) > 0 THEN
      UPDATE vehicles
      SET
        trim = COALESCE(trim, v_trim),
        engine_size = COALESCE(engine_size, v_engine_size),
        displacement = COALESCE(displacement, v_displacement),
        drivetrain = COALESCE(drivetrain, v_drivetrain),
        mileage = COALESCE(mileage, v_mileage),
        color = COALESCE(color, v_color),
        year = COALESCE(year, v_year),
        make = COALESCE(make, v_make),
        model = COALESCE(model, v_model),
        updated_at = NOW()
      WHERE id = v_listing.vehicle_id;
    END IF;

    RETURN QUERY SELECT v_listing.vehicle_id, v_updated_fields;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Run the backfill
SELECT 
  COUNT(*) as total_updated,
  COUNT(CASE WHEN array_length(updated_fields, 1) > 0 THEN 1 END) as vehicles_with_updates
FROM backfill_vehicle_data_from_bat();

