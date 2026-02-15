-- Vehicle segments for treemap categorization
-- Existing table uses display_name instead of name; add sort_order + broader category segments

-- Add sort_order if not exists
ALTER TABLE vehicle_segments ADD COLUMN IF NOT EXISTS sort_order int DEFAULT 0;

-- Insert broader top-level segments (skip if slug already exists)
INSERT INTO vehicle_segments (slug, display_name, sort_order) VALUES
  ('sports-cars', 'Sports Cars', 1),
  ('muscle-cars', 'Muscle Cars', 2),
  ('luxury-gt', 'Luxury & GT', 3),
  ('supercars', 'Supercars & Exotics', 4),
  ('off-road-trucks', 'Off-Road & Trucks', 5),
  ('japanese-classics', 'Japanese Classics', 6),
  ('german-engineering', 'German Engineering', 7),
  ('british-classics', 'British Classics', 8),
  ('american-classics', 'American Classics', 9),
  ('vintage-prewar', 'Vintage & Pre-War', 10),
  ('racing-heritage', 'Racing Heritage', 11),
  ('convertibles', 'Convertibles & Roadsters', 12),
  ('wagons-vans', 'Wagons & Vans', 13),
  ('microcars-oddities', 'Microcars & Oddities', 14),
  ('modern-performance', 'Modern Performance', 15)
ON CONFLICT (slug) DO UPDATE SET display_name = EXCLUDED.display_name, sort_order = EXCLUDED.sort_order;

-- Ensure index exists
CREATE INDEX IF NOT EXISTS idx_vehicles_segment ON vehicles(segment_slug);

-- Segment-level treemap aggregation (uses display_name)
CREATE OR REPLACE FUNCTION treemap_by_segment()
RETURNS TABLE(name text, count bigint, value bigint)
LANGUAGE sql STABLE
AS $$
  SELECT
    vs.display_name,
    COUNT(*)::bigint as count,
    SUM(COALESCE(v.sale_price, v.sold_price))::bigint as value
  FROM vehicles v
  JOIN vehicle_segments vs ON v.segment_slug = vs.slug
  WHERE v.deleted_at IS NULL
    AND (v.sale_price > 0 OR v.sold_price > 0)
    AND COALESCE(v.sale_price, v.sold_price) < 100000000
    AND v.make IS NOT NULL
    AND LENGTH(v.make) > 2
  GROUP BY vs.display_name
  ORDER BY value DESC;
$$;

-- Makes within a segment (by display_name)
CREATE OR REPLACE FUNCTION treemap_makes_by_segment(p_segment text)
RETURNS TABLE(name text, count bigint, value bigint)
LANGUAGE sql STABLE
AS $$
  WITH make_agg AS (
    SELECT
      CASE
        WHEN LOWER(v.make) = 'bmw' THEN 'BMW'
        WHEN LOWER(v.make) = 'gmc' THEN 'GMC'
        WHEN LOWER(v.make) = 'mg' THEN 'MG'
        WHEN LOWER(v.make) = 'tvr' THEN 'TVR'
        WHEN LOWER(v.make) IN ('alfa romeo', 'alfa') THEN 'Alfa Romeo'
        WHEN LOWER(v.make) IN ('aston martin', 'aston') THEN 'Aston Martin'
        WHEN LOWER(v.make) IN ('mercedes-benz', 'mercedes') THEN 'Mercedes-Benz'
        WHEN LOWER(v.make) IN ('rolls-royce', 'rolls royce') THEN 'Rolls-Royce'
        WHEN LOWER(v.make) IN ('land rover', 'land', 'landrover') THEN 'Land Rover'
        WHEN LOWER(v.make) IN ('mclaren', 'mc laren') THEN 'McLaren'
        WHEN LOWER(v.make) IN ('de tomaso', 'detomaso') THEN 'De Tomaso'
        WHEN LOWER(v.make) = 'am general' THEN 'AM General'
        ELSE INITCAP(v.make)
      END as normalized_make,
      COALESCE(v.sale_price, v.sold_price) as price
    FROM vehicles v
    JOIN vehicle_segments vs ON v.segment_slug = vs.slug
    WHERE v.deleted_at IS NULL
      AND (v.sale_price > 0 OR v.sold_price > 0)
      AND COALESCE(v.sale_price, v.sold_price) < 100000000
      AND v.make IS NOT NULL
      AND LENGTH(v.make) > 2
      AND vs.display_name = p_segment
  )
  SELECT normalized_make as name, COUNT(*)::bigint as count, SUM(price)::bigint as value
  FROM make_agg
  GROUP BY normalized_make
  ORDER BY value DESC;
$$;

-- Nested treemap: returns 2 levels in one call for segment view
CREATE OR REPLACE FUNCTION treemap_nested(p_view text DEFAULT 'segment', p_filter text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  result jsonb;
BEGIN
  IF p_view = 'segment' AND p_filter IS NULL THEN
    -- Segments with their top makes
    WITH segment_data AS (
      SELECT
        vs.display_name as seg_name,
        vs.slug as seg_slug,
        SUM(COALESCE(v.sale_price, v.sold_price))::bigint as seg_value,
        COUNT(*)::bigint as seg_count
      FROM vehicles v
      JOIN vehicle_segments vs ON v.segment_slug = vs.slug
      WHERE v.deleted_at IS NULL
        AND (v.sale_price > 0 OR v.sold_price > 0)
        AND COALESCE(v.sale_price, v.sold_price) < 100000000
        AND v.make IS NOT NULL
        AND LENGTH(v.make) > 2
      GROUP BY vs.display_name, vs.slug
      HAVING SUM(COALESCE(v.sale_price, v.sold_price)) > 0
      ORDER BY seg_value DESC
    ),
    make_data AS (
      SELECT
        v.segment_slug,
        CASE
          WHEN LOWER(v.make) = 'bmw' THEN 'BMW'
          WHEN LOWER(v.make) = 'gmc' THEN 'GMC'
          WHEN LOWER(v.make) = 'mg' THEN 'MG'
          WHEN LOWER(v.make) = 'tvr' THEN 'TVR'
          WHEN LOWER(v.make) IN ('alfa romeo', 'alfa') THEN 'Alfa Romeo'
          WHEN LOWER(v.make) IN ('aston martin', 'aston') THEN 'Aston Martin'
          WHEN LOWER(v.make) IN ('mercedes-benz', 'mercedes') THEN 'Mercedes-Benz'
          WHEN LOWER(v.make) IN ('rolls-royce', 'rolls royce') THEN 'Rolls-Royce'
          WHEN LOWER(v.make) IN ('land rover', 'land', 'landrover') THEN 'Land Rover'
          WHEN LOWER(v.make) IN ('mclaren', 'mc laren') THEN 'McLaren'
          WHEN LOWER(v.make) IN ('de tomaso', 'detomaso') THEN 'De Tomaso'
          WHEN LOWER(v.make) = 'am general' THEN 'AM General'
          ELSE INITCAP(v.make)
        END as normalized_make,
        COALESCE(v.sale_price, v.sold_price) as price
      FROM vehicles v
      WHERE v.deleted_at IS NULL
        AND (v.sale_price > 0 OR v.sold_price > 0)
        AND COALESCE(v.sale_price, v.sold_price) < 100000000
        AND v.make IS NOT NULL
        AND LENGTH(v.make) > 2
        AND v.segment_slug IS NOT NULL
    ),
    make_agg AS (
      SELECT
        segment_slug,
        normalized_make,
        COUNT(*)::bigint as make_count,
        SUM(price)::bigint as make_value
      FROM make_data
      GROUP BY segment_slug, normalized_make
    )
    SELECT jsonb_build_object(
      'name', 'All Segments',
      'children', COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'name', sd.seg_name,
            'value', sd.seg_value,
            'count', sd.seg_count,
            'children', COALESCE((
              SELECT jsonb_agg(
                jsonb_build_object(
                  'name', ma.normalized_make,
                  'value', ma.make_value,
                  'count', ma.make_count
                ) ORDER BY ma.make_value DESC
              )
              FROM make_agg ma
              WHERE ma.segment_slug = sd.seg_slug
            ), '[]'::jsonb)
          ) ORDER BY sd.seg_value DESC
        )
        FROM segment_data sd
      ), '[]'::jsonb)
    ) INTO result;

  ELSIF p_view = 'brand' AND p_filter IS NULL THEN
    -- Brands with their top models
    WITH brand_data AS (
      SELECT
        CASE
          WHEN LOWER(make) = 'bmw' THEN 'BMW'
          WHEN LOWER(make) = 'gmc' THEN 'GMC'
          WHEN LOWER(make) = 'mg' THEN 'MG'
          WHEN LOWER(make) = 'tvr' THEN 'TVR'
          WHEN LOWER(make) IN ('alfa romeo', 'alfa') THEN 'Alfa Romeo'
          WHEN LOWER(make) IN ('aston martin', 'aston') THEN 'Aston Martin'
          WHEN LOWER(make) IN ('mercedes-benz', 'mercedes') THEN 'Mercedes-Benz'
          WHEN LOWER(make) IN ('rolls-royce', 'rolls royce') THEN 'Rolls-Royce'
          WHEN LOWER(make) IN ('land rover', 'land', 'landrover') THEN 'Land Rover'
          WHEN LOWER(make) IN ('mclaren', 'mc laren') THEN 'McLaren'
          WHEN LOWER(make) IN ('de tomaso', 'detomaso') THEN 'De Tomaso'
          WHEN LOWER(make) = 'am general' THEN 'AM General'
          ELSE INITCAP(make)
        END as normalized_make,
        model,
        COALESCE(sale_price, sold_price) as price
      FROM vehicles
      WHERE deleted_at IS NULL
        AND (sale_price > 0 OR sold_price > 0)
        AND COALESCE(sale_price, sold_price) < 100000000
        AND make IS NOT NULL
        AND LENGTH(make) > 2
        AND make !~* '^[0-9]'
        AND make !~* 'mile|owner|reserve|unknown|other|n/a|none|tbd'
    ),
    brand_agg AS (
      SELECT
        normalized_make,
        COUNT(*)::bigint as brand_count,
        SUM(price)::bigint as brand_value
      FROM brand_data
      GROUP BY normalized_make
      HAVING SUM(price) >= 1000000
    ),
    model_agg AS (
      SELECT
        normalized_make,
        model,
        COUNT(*)::bigint as model_count,
        SUM(price)::bigint as model_value
      FROM brand_data
      WHERE model IS NOT NULL
      GROUP BY normalized_make, model
    )
    SELECT jsonb_build_object(
      'name', 'All Brands',
      'children', COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'name', ba.normalized_make,
            'value', ba.brand_value,
            'count', ba.brand_count,
            'children', COALESCE((
              SELECT jsonb_agg(
                jsonb_build_object(
                  'name', ma.model,
                  'value', ma.model_value,
                  'count', ma.model_count
                ) ORDER BY ma.model_value DESC
              )
              FROM model_agg ma
              WHERE ma.normalized_make = ba.normalized_make
            ), '[]'::jsonb)
          ) ORDER BY ba.brand_value DESC
        )
        FROM brand_agg ba
      ), '[]'::jsonb)
    ) INTO result;

  ELSE
    result := jsonb_build_object('name', 'Unknown', 'children', '[]'::jsonb);
  END IF;

  RETURN COALESCE(result, jsonb_build_object('name', 'Empty', 'children', '[]'::jsonb));
END;
$$;

COMMENT ON FUNCTION treemap_by_segment() IS 'Treemap aggregation by vehicle segment';
COMMENT ON FUNCTION treemap_makes_by_segment(text) IS 'Treemap makes within a segment';
COMMENT ON FUNCTION treemap_nested(text, text) IS 'Nested treemap data - 2 levels in one call';
