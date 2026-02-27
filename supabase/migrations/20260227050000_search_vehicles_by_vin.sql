-- Function to search vehicles by partial VIN using the trigram index
-- Uses lower(vin) LIKE lower('%...%') which correctly hits vehicles_vin_trgm_idx
-- (unlike ILIKE which causes btree scan → statement timeout on large tables)
CREATE OR REPLACE FUNCTION search_vehicles_by_partial_vin(partial_vin text, row_limit int DEFAULT 10)
RETURNS TABLE (
  id uuid,
  year int,
  make text,
  model text,
  "trim" text,
  series text,
  vin text,
  mileage int,
  color text,
  interior_color text,
  transmission text,
  engine_type text,
  drivetrain text,
  body_style text,
  sale_price numeric,
  is_public boolean,
  created_at timestamptz,
  updated_at timestamptz,
  primary_image_url text,
  discovery_url text
) LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    v.id, v.year, v.make, v.model, v.trim, v.series, v.vin, v.mileage,
    v.color, v.interior_color, v.transmission, v.engine_type,
    v.drivetrain, v.body_style, v.sale_price, v.is_public,
    v.created_at, v.updated_at, v.primary_image_url, v.discovery_url
  FROM vehicles v
  WHERE lower(v.vin) LIKE lower('%' || partial_vin || '%')
    AND v.is_public = true
  LIMIT row_limit;
$$;

GRANT EXECUTE ON FUNCTION search_vehicles_by_partial_vin(text, int) TO anon, authenticated, service_role;
