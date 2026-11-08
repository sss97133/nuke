-- Bound both existing expiry projections so trigger fan-out can commit each cycle.
-- No schedule, grants, timeout, sale-price or source evidence changes.
SET statement_timeout = '10s';
SET lock_timeout = '2s';

CREATE INDEX IF NOT EXISTS idx_external_listings_active_end
  ON public.external_listings (end_date, id)
  WHERE listing_status = 'active';

-- Expiring a listing must not claim its undisclosed reserve was met. Preserve
-- the deployed trigger's other behavior/ACL/config while fixing this expression.
DO $repair$
DECLARE
  body text := pg_get_functiondef('public.track_auction_phase_transitions()'::regprocedure);
  old_expression text := 'COALESCE(NEW.current_bid, 0) >= COALESCE(NEW.reserve_price, 0)';
  new_expression text := '(NEW.current_bid >= NEW.reserve_price)';
BEGIN
  IF strpos(body, old_expression) > 0 THEN
    EXECUTE replace(body, old_expression, new_expression);
  ELSIF strpos(body, new_expression) = 0 THEN
    RAISE EXCEPTION 'Unexpected auction transition reserve expression; review before replacing';
  END IF;
END;
$repair$;

CREATE OR REPLACE FUNCTION public.cleanup_stale_listings()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET statement_timeout TO '20s'
AS $function$
DECLARE
  updated_count integer := 0;
  vehicle_count integer := 0;
  v_cutoff timestamptz := now() - interval '45 days';
BEGIN
  -- Keep trigger fan-out bounded: every transition writes the legacy timeline.
  WITH stale AS (
    SELECT id FROM public.external_listings
    WHERE listing_status = 'active'
      AND end_date < NOW() - INTERVAL '30 minutes'
    ORDER BY end_date, id
    LIMIT 25
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.external_listings l
  SET listing_status = 'ended',
      updated_at = NOW()
  FROM stale s
  WHERE l.id = s.id;

  GET DIAGNOSTICS updated_count = ROW_COUNT;

  WITH stale AS (
    SELECT v.id
    FROM public.vehicles v
    WHERE v.is_for_sale IS TRUE
      AND v.deleted_at IS NULL
      AND COALESCE(v.listing_updated_at, v.listing_posted_at, v.updated_at) < v_cutoff
    ORDER BY COALESCE(v.listing_updated_at, v.listing_posted_at, v.updated_at) ASC NULLS FIRST
    LIMIT 50
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.vehicles v
  SET is_for_sale = false,
      updated_at = now()
  FROM stale s
  WHERE v.id = s.id;

  GET DIAGNOSTICS vehicle_count = ROW_COUNT;
  RETURN updated_count + vehicle_count;
END;
$function$;


COMMENT ON FUNCTION public.cleanup_stale_listings() IS
  'Bounded expiry projection: at most 25 elapsed legacy listings and 50 stale for-sale flags per cycle; preserves existing clocks, triggers and unknown sale outcomes.';
