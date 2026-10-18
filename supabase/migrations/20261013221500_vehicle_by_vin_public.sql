-- vehicle_by_vin_public: the vehicle a VIN names, for a search box used logged out.
--
-- Measured 2026-10-13 22:07Z: the search page's own suggested VIN query answered "Search failed." after
-- 60 s, because universal-search filters vehicles with `ilike` on vin, which no index serves under the
-- anon row policies (a non-leakproof qual cannot run ahead of the policies, so the scan is sequential);
-- a REST `vin=eq.` hit the 15 s statement timeout the same way, and find_vehicle_by_vin (2026-09-27,
-- SECURITY INVOKER) timed out as anon too. The deploy role reads the same row in milliseconds through
-- idx_vehicles_vin_norm_trim (upper(btrim(vin))).
--
-- This reader is SECURITY DEFINER with the public filter inside it: only public, undeleted rows, through
-- that index, and only the columns a search card shows. No private money: purchase price, cost basis and
-- the estimate (current_value) stay out; the asking price is returned only while the vehicle is for sale.
-- Pure addition: one function and its grants. No table, policy, row or cron changes.
BEGIN;
SET LOCAL statement_timeout = '30s'; SET LOCAL lock_timeout = '1s';

DO $guard$ BEGIN
  IF to_regclass('public.idx_vehicles_vin_norm_trim') IS NULL THEN
    RAISE EXCEPTION 'vehicle_by_vin_public relies on idx_vehicles_vin_norm_trim (upper(btrim(vin))); it is missing';
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.vehicle_by_vin_public(p_vin text)
RETURNS TABLE (
  id uuid,
  vin text,
  year integer,
  make text,
  model text,
  image_url text,
  sale_price integer,
  asking_price numeric,
  is_for_sale boolean,
  sale_status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT v.id,
         v.vin,
         v.year,
         v.make,
         v.model,
         COALESCE(v.primary_image_url, v.image_url) AS image_url,
         v.sale_price,
         CASE WHEN v.is_for_sale THEN v.asking_price END AS asking_price,
         v.is_for_sale,
         v.sale_status
    FROM public.vehicles v
   WHERE upper(btrim(v.vin)) = upper(btrim(p_vin))
     AND v.deleted_at IS NULL
     AND v.is_public = true
   ORDER BY (v.status IS DISTINCT FROM 'merged') DESC, v.created_at ASC
   LIMIT 5
$$;

REVOKE ALL ON FUNCTION public.vehicle_by_vin_public(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_by_vin_public(text) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.vehicle_by_vin_public(text) IS
  'Public, undeleted vehicles whose VIN matches (case and space insensitive, via idx_vehicles_vin_norm_trim), unmerged first, at most 5; the columns a search card shows and no private money. SECURITY DEFINER because under anon row policies no vin qual can use an index (measured 15-60 s, 2026-10-13). Used by the search page for a 17-character query.';

COMMIT;

-- Live verification (after apply), as anon through PostgREST:
--   POST /rest/v1/rpc/vehicle_by_vin_public {"p_vin":"WMWSX3C52DT408613"}   -- one row in well under a second
--   POST /rest/v1/rpc/vehicle_by_vin_public {"p_vin":"WP0AA2A95ES123456"}   -- [] in well under a second
