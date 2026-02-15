-- RPC: Given an array of listing URLs, return matched vehicle IDs + data
-- Used by bat-snapshot-parser to batch-match snapshot URLs to vehicles
CREATE OR REPLACE FUNCTION match_vehicles_by_urls(urls text[])
RETURNS TABLE(
  listing_url text,
  vehicle_id uuid,
  vin text,
  mileage integer,
  engine_type text,
  transmission text,
  color text,
  interior_color text,
  sale_price integer,
  origin_metadata jsonb
) LANGUAGE sql STABLE AS $$
  SELECT DISTINCT ON (u.url)
    u.url as listing_url,
    v.id as vehicle_id,
    v.vin,
    v.mileage,
    v.engine_type,
    v.transmission,
    v.color,
    v.interior_color,
    v.sale_price,
    v.origin_metadata
  FROM unnest(urls) AS u(url)
  JOIN vehicles v ON (
    v.listing_url = rtrim(u.url, '/')
    OR v.listing_url = u.url
  )
  WHERE v.deleted_at IS NULL
  ORDER BY u.url, v.created_at DESC;
$$;

-- Cron: process BaT snapshots every 2 minutes
SELECT cron.schedule(
  'bat-snapshot-parser-continuous',
  '*/2 * * * *',
  $$ SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/bat-snapshot-parser',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || get_service_role_key_for_cron()
    ),
    body := '{"mode":"process","limit":100}'::jsonb,
    timeout_milliseconds := 120000
  ); $$
);
