-- FOR SALE counts distinct vehicles across the union of classified listings and listed/upcoming auctions, so a vehicle in
-- both is counted once (the previous figure was the sum of two distinct counts).
SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.refresh_for_sale_count()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET statement_timeout = '90s'
AS $$
DECLARE
  v_total integer;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_stat_activity
    WHERE datname = current_database() AND backend_type = 'client backend' AND wait_event_type = 'Lock'
      AND pid <> pg_backend_pid() AND now() - state_change > interval '10 seconds'
  ) THEN
    RETURN jsonb_build_object('skipped', 'lock waiters');
  END IF;

  -- One set: a vehicle that is both a live classified and in a listed or upcoming auction counts once.
  -- Classified: unended listing event last written within 14 days (no source has a revisit cadence yet, so last-written is
  -- the freshness measure). Auction: listed or upcoming event not ended, last written within 14 days, starting within 30 days.
  SELECT count(*) INTO v_total FROM (
    SELECT vehicle_id FROM public.vehicle_events
    WHERE event_type = 'listing' AND ended_at IS NULL AND vehicle_id IS NOT NULL
      AND event_status NOT IN ('ended', 'removed', 'sold', 'expired', 'cancelled')
      AND source_platform IN ('craigslist', 'ksl', 'classiccars', 'ebay_motors', 'facebook_marketplace', 'hagerty', 'barnfinds')
      AND updated_at >= now() - interval '14 days'
    UNION
    SELECT vehicle_id FROM public.vehicle_events
    WHERE event_type = 'auction' AND event_status IN ('listed', 'upcoming') AND ended_at IS NULL AND vehicle_id IS NOT NULL
      AND (started_at IS NULL OR started_at < now() + interval '30 days')
      AND updated_at >= now() - interval '14 days'
  ) u;

  UPDATE public.portfolio_stats_cache
  SET for_sale_count = v_total, for_sale_updated_at = now(),
      for_sale_definition = 'Distinct vehicles with an unended classified listing event (craigslist, ksl, classiccars, ebay_motors, facebook_marketplace, hagerty, barnfinds) last written within 14 days, plus distinct vehicles with a listed or upcoming auction event not ended, last written within 14 days and starting within 30 days. One set: a vehicle in both counts once.'
  WHERE id = 'global';
  RETURN jsonb_build_object('for_sale', v_total);
END
$$;
REVOKE ALL ON FUNCTION public.refresh_for_sale_count() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_for_sale_count() TO service_role;
COMMENT ON FUNCTION public.refresh_for_sale_count() IS 'Writes portfolio_stats_cache.for_sale_count, for_sale_definition and for_sale_updated_at from vehicle_events. Second statement of the refresh-feed-rollups job.';

