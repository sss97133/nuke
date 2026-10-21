-- Extend cleanup_stale_listings (existing owner) so advisor find_listings can
-- trust is_for_sale: clear projected for-sale flags when listing clocks age out.
-- Also index active asks for the reader. Does not touch observation testimony.
SET statement_timeout = '30s';
SET lock_timeout = '10s';

CREATE INDEX IF NOT EXISTS idx_vehicles_active_asks
  ON public.vehicles (listing_updated_at DESC NULLS LAST)
  WHERE is_for_sale IS TRUE
    AND deleted_at IS NULL
    AND asking_price IS NOT NULL
    AND asking_price > 0;

COMMENT ON INDEX public.idx_vehicles_active_asks IS
  'Advisor find_listings: active asks ordered by listing_updated_at (2026-10-21).';

-- Was: mark external_listings ended after end_date. Now also clears vehicles.is_for_sale
-- when COALESCE(listing_updated_at, listing_posted_at, updated_at) is older than 45 days.
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
  UPDATE public.external_listings
  SET listing_status = 'ended',
      updated_at = NOW()
  WHERE listing_status = 'active'
    AND end_date < NOW() - INTERVAL '30 minutes';

  GET DIAGNOSTICS updated_count = ROW_COUNT;

  WITH stale AS (
    SELECT v.id
    FROM public.vehicles v
    WHERE v.is_for_sale IS TRUE
      AND v.deleted_at IS NULL
      AND COALESCE(v.listing_updated_at, v.listing_posted_at, v.updated_at) < v_cutoff
    ORDER BY COALESCE(v.listing_updated_at, v.listing_posted_at, v.updated_at) ASC NULLS FIRST
    LIMIT 500
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
  'Ends stale external_listings past end_date, and clears vehicles.is_for_sale when listing '
  'clocks are older than 45 days (advisor liveness). Does not delete testimony. 2026-10-21.';

REVOKE ALL ON FUNCTION public.cleanup_stale_listings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_stale_listings() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid)
    FROM cron.job
    WHERE jobname = 'cleanup-stale-listings';
    PERFORM cron.schedule(
      'cleanup-stale-listings',
      '17 * * * *',
      $cron$SELECT public.cleanup_stale_listings()$cron$
    );
  END IF;
END $$;
