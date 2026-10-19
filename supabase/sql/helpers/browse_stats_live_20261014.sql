-- Live on production 2026-10-14 (pg_get_functiondef).
CREATE OR REPLACE FUNCTION public.browse_stats(p_make text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result JSONB;
  v_total BIGINT;
  v_with_images BIGINT;
  v_with_price BIGINT;
  v_avg_price NUMERIC;
  v_by_source JSONB;
  v_by_era JSONB;
  v_by_model JSONB;
BEGIN
  -- If no make provided, return stats for all public vehicles
  IF p_make IS NULL THEN
    SELECT
      count(*),
      count(*) FILTER (WHERE primary_image_url IS NOT NULL),
      count(*) FILTER (WHERE sold_price IS NOT NULL AND sold_price > 0),
      round(avg(sold_price) FILTER (WHERE sold_price IS NOT NULL AND sold_price > 0), 2)
    INTO v_total, v_with_images, v_with_price, v_avg_price
    FROM vehicles
    WHERE is_public = true;
  ELSE
    SELECT
      count(*),
      count(*) FILTER (WHERE primary_image_url IS NOT NULL),
      count(*) FILTER (WHERE sold_price IS NOT NULL AND sold_price > 0),
      round(avg(sold_price) FILTER (WHERE sold_price IS NOT NULL AND sold_price > 0), 2)
    INTO v_total, v_with_images, v_with_price, v_avg_price
    FROM vehicles
    WHERE is_public = true
      AND lower(make) = lower(p_make);
  END IF;

  -- by_source: top 10
  SELECT coalesce(jsonb_agg(row_to_json(s)::jsonb), '[]'::jsonb)
  INTO v_by_source
  FROM (
    SELECT source, count(*) AS count
    FROM vehicles
    WHERE is_public = true
      AND (p_make IS NULL OR lower(make) = lower(p_make))
      AND source IS NOT NULL
    GROUP BY source
    ORDER BY count DESC
    LIMIT 10
  ) s;

  -- by_era
  SELECT coalesce(jsonb_agg(row_to_json(e)::jsonb), '[]'::jsonb)
  INTO v_by_era
  FROM (
    SELECT era, count(*) AS count
    FROM vehicles
    WHERE is_public = true
      AND (p_make IS NULL OR lower(make) = lower(p_make))
      AND era IS NOT NULL
    GROUP BY era
    ORDER BY count DESC
  ) e;

  -- by_model: top 20
  SELECT coalesce(jsonb_agg(row_to_json(m)::jsonb), '[]'::jsonb)
  INTO v_by_model
  FROM (
    SELECT model, count(*) AS count
    FROM vehicles
    WHERE is_public = true
      AND (p_make IS NULL OR lower(make) = lower(p_make))
      AND model IS NOT NULL
    GROUP BY model
    ORDER BY count DESC
    LIMIT 20
  ) m;

  v_result := jsonb_build_object(
    'total', v_total,
    'with_images', v_with_images,
    'with_price', v_with_price,
    'avg_price', v_avg_price,
    'by_source', v_by_source,
    'by_era', v_by_era,
    'by_model', v_by_model
  );

  RETURN v_result;
END;
$function$

;
