-- Spec context reader: returns what a spec value means and how it compares.
-- When drilling into a spec (e.g., "455" engine), this provides:
--   1. OEM context (displacement, config, hp) from oem_vehicle_specs if available
--   2. Count of other vehicles with this value
--   3. Sales data when available

CREATE OR REPLACE FUNCTION public.get_spec_context(
  p_vehicle_id uuid,
  p_field text,
  p_value text
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = ''
AS $function$
WITH vehicle AS (
  SELECT v.id, v.year, v.make, v.model, v.engine_type, v.engine_size,
         v.transmission, v.drivetrain, v.body_style, v.color, v.interior_color
  FROM public.vehicles v
  WHERE v.id = p_vehicle_id
    AND v.deleted_at IS NULL
    AND (v.is_public = true OR auth.uid() IN (v.user_id, v.owner_id, v.uploaded_by))
),

-- OEM context: find matching spec from oem_vehicle_specs
oem_context AS (
  SELECT
    os.engine_size AS oem_engine_size,
    os.engine_displacement_liters,
    os.engine_displacement_cid,
    os.engine_config,
    os.horsepower,
    os.torque_ft_lbs,
    os.transmission AS oem_transmission,
    os.drivetrain AS oem_drivetrain,
    os.fuel_type,
    os.year_start,
    os.year_end,
    os.body_style AS oem_body_style,
    os.source AS oem_source
  FROM public.oem_vehicle_specs os, vehicle v
  WHERE os.make = v.make
    AND os.model = v.model
    AND v.year BETWEEN os.year_start AND COALESCE(os.year_end, os.year_start)
  LIMIT 1
),

-- Similar vehicles: count others with the same field value
similar_count AS (
  SELECT COUNT(*) AS cnt
  FROM public.vehicles other, vehicle v
  WHERE other.id != v.id
    AND other.deleted_at IS NULL
    AND other.is_public = true
    AND CASE p_field
      WHEN 'engine_type' THEN other.engine_type = p_value
      WHEN 'engine_size' THEN other.engine_size = p_value
      WHEN 'transmission' THEN other.transmission = p_value
      WHEN 'drivetrain' THEN other.drivetrain = p_value
      WHEN 'body_style' THEN other.body_style = p_value
      WHEN 'color' THEN other.color = p_value
      WHEN 'interior_color' THEN other.interior_color = p_value
      WHEN 'fuel_type' THEN other.fuel_type = p_value
      ELSE false
    END
),

-- Sales stats for vehicles with this spec value (if available)
sales_stats AS (
  SELECT
    COUNT(*) AS sales_count,
    AVG(ve.sale_price) AS avg_sale_price,
    MIN(ve.sale_price) AS min_sale_price,
    MAX(ve.sale_price) AS max_sale_price
  FROM public.vehicle_events ve
  JOIN public.vehicles other ON other.id = ve.vehicle_id
  WHERE ve.event_type = 'sale'
    AND ve.sale_price IS NOT NULL
    AND ve.sale_price > 0
    AND other.is_public = true
    AND other.deleted_at IS NULL
    AND CASE p_field
      WHEN 'engine_type' THEN other.engine_type = p_value
      WHEN 'engine_size' THEN other.engine_size = p_value
      WHEN 'transmission' THEN other.transmission = p_value
      WHEN 'drivetrain' THEN other.drivetrain = p_value
      WHEN 'color' THEN other.color = p_value
      ELSE false
    END
)

SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM vehicle) THEN NULL ELSE
  jsonb_build_object(
    'field', p_field,
    'value', p_value,
    'oem', CASE WHEN EXISTS (SELECT 1 FROM oem_context) THEN (
      SELECT jsonb_build_object(
        'engine_size', oem_engine_size,
        'displacement_liters', engine_displacement_liters,
        'displacement_cid', engine_displacement_cid,
        'engine_config', engine_config,
        'horsepower', horsepower,
        'torque_ft_lbs', torque_ft_lbs,
        'transmission', oem_transmission,
        'drivetrain', oem_drivetrain,
        'fuel_type', fuel_type,
        'year_range', CASE
          WHEN year_end IS NOT NULL AND year_end != year_start
          THEN year_start || '-' || year_end
          ELSE year_start::text
        END,
        'source', oem_source
      ) FROM oem_context
    ) ELSE NULL END,
    'similar_count', (SELECT cnt FROM similar_count),
    'sales', CASE WHEN (SELECT sales_count FROM sales_stats) > 0 THEN (
      SELECT jsonb_build_object(
        'count', sales_count,
        'avg_price', ROUND(avg_sale_price),
        'min_price', min_sale_price,
        'max_price', max_sale_price
      ) FROM sales_stats
    ) ELSE NULL END
  )
END
$function$;

-- Grant to anon and authenticated for public vehicle reads
GRANT EXECUTE ON FUNCTION public.get_spec_context(uuid, text, text) TO anon, authenticated;

COMMENT ON FUNCTION public.get_spec_context IS
'Returns context and relativity for a vehicle spec field value.
Called from iOS FieldProvenanceSheet to show what a value means (OEM specs)
and how it compares (count of similar vehicles, sales data).';
