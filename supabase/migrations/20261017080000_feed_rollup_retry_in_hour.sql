-- refresh_feed_rollups and refresh_for_sale_count return at once when their figures are under 55 minutes old, so the job
-- can run every 15 minutes and retry a lock-guard skip without doing the work twice.
SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.refresh_feed_rollups()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_plan jsonb;
  v_total bigint;
  v_total_as_of timestamptz;
  v_today integer;
  v_day_start timestamptz := date_trunc('day', now() AT TIME ZONE 'utc') AT TIME ZONE 'utc';
  v_prev record;
  v_since timestamptz;
  v_sources integer;
BEGIN
  IF EXISTS (SELECT 1 FROM public.portfolio_stats_cache WHERE id = 'global' AND counts_updated_at > now() - interval '55 minutes') THEN
    RETURN jsonb_build_object('skipped', 'fresh');
  END IF;
  SET LOCAL statement_timeout = '25s';
  SET LOCAL lock_timeout = '2s';
  IF EXISTS (
    SELECT 1 FROM pg_stat_activity
    WHERE datname = current_database() AND backend_type = 'client backend' AND wait_event_type = 'Lock'
      AND pid <> pg_backend_pid() AND now() - state_change > interval '10 seconds'
  ) THEN
    RETURN jsonb_build_object('skipped', 'lock waiters');
  END IF;

  -- The total is the map's exact count of public records from its latest refresh (treemap_refreshes.populations), with
  -- that refresh's time, so the feed and the map show one number with one definition. The planner estimate is the
  -- fallback only when no receipt exists.
  SELECT (populations ->> 'public_records')::bigint, refreshed_at INTO v_total, v_total_as_of
  FROM public.treemap_refreshes WHERE populations ? 'public_records' ORDER BY refreshed_at DESC LIMIT 1;
  IF v_total IS NULL THEN
    EXECUTE 'EXPLAIN (FORMAT JSON) SELECT 1 FROM public.vehicles WHERE is_public IS TRUE AND deleted_at IS NULL' INTO v_plan;
    v_total := (v_plan -> 0 -> 'Plan' ->> 'Plan Rows')::bigint;
    v_total_as_of := NULL;
  END IF;

  SELECT counts_updated_at, vehicles_added_today INTO v_prev FROM public.portfolio_stats_cache WHERE id = 'global';
  IF v_prev.counts_updated_at IS NOT NULL AND v_prev.counts_updated_at >= v_day_start THEN
    v_since := v_prev.counts_updated_at;
  ELSE
    v_since := greatest(v_day_start, now() - interval '3 hours'); -- first run of a day: the last 3 hours at most
    v_prev.vehicles_added_today := 0;
  END IF;
  -- Dynamic SQL with the literal bound: a generic plan for the parameterised form chose the status index and ran for
  -- seconds where the literal form answers in under one (measured 2026-10-15, 20 minutes of rows).
  EXECUTE format($q$SELECT count(DISTINCT vehicle_id) FROM public.vehicle_events
    WHERE vehicle_id IS NOT NULL AND created_at >= %L AND created_at < now()
      AND (event_type = 'listing' OR event_status IN ('listed', 'upcoming'))$q$, v_since) INTO v_today;
  v_today := coalesce(v_prev.vehicles_added_today, 0) + coalesce(v_today, 0);

  WITH d AS (
    SELECT source_platform, count(DISTINCT vehicle_id)::integer AS n
    FROM public.vehicle_events
    WHERE created_at >= now() - interval '70 minutes' AND source_platform IS NOT NULL AND vehicle_id IS NOT NULL
    GROUP BY 1
  )
  INSERT INTO public.feed_source_rollup (source_platform, label, discovery_sources, n_1h, last_seen_at, refreshed_at)
  SELECT d.source_platform, coalesce(public.feed_source_label(d.source_platform), d.source_platform),
         coalesce(public.feed_discovery_sources(d.source_platform), ARRAY[d.source_platform]), d.n, now(), now()
  FROM d
  ON CONFLICT (source_platform) DO UPDATE
    SET label = excluded.label, discovery_sources = excluded.discovery_sources, n_1h = excluded.n_1h,
        last_seen_at = excluded.last_seen_at, refreshed_at = excluded.refreshed_at;
  GET DIAGNOSTICS v_sources = ROW_COUNT;
  UPDATE public.feed_source_rollup SET n_1h = 0, refreshed_at = now() WHERE refreshed_at < now() - interval '1 minute';
  -- Rows not seen this run keep a current name too (a label written before the mapping knew the source would otherwise stay).
  UPDATE public.feed_source_rollup SET label = coalesce(public.feed_source_label(source_platform), source_platform),
      discovery_sources = coalesce(public.feed_discovery_sources(source_platform), ARRAY[source_platform]);

  UPDATE public.portfolio_stats_cache
  SET total_vehicles = v_total, total_is_estimate = (v_total_as_of IS NULL), total_as_of = v_total_as_of, vehicles_added_today = v_today, counts_updated_at = now()
  WHERE id = 'global';

  RETURN jsonb_build_object('sources_seen', v_sources, 'total_estimate', v_total, 'added_today', v_today);
END
$$;
REVOKE ALL ON FUNCTION public.refresh_feed_rollups() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_feed_rollups() TO service_role;

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
  IF EXISTS (SELECT 1 FROM public.portfolio_stats_cache WHERE id = 'global' AND for_sale_updated_at > now() - interval '55 minutes') THEN
    RETURN jsonb_build_object('skipped', 'fresh');
  END IF;
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


-- The job runs every 15 minutes and does work only when the last success is more than 55 minutes old: a run skipped by the
-- lock guard is retried at +15 and +30 minutes inside the same hour (the strip hides FOR SALE after 3 hours, so three
-- skipped hourly runs would blank it). Still one job; a run that finds fresh figures returns at once.
DO $$
DECLARE v_id bigint;
BEGIN
  SELECT jobid INTO v_id FROM cron.job WHERE jobname = 'refresh-feed-rollups';
  IF v_id IS NOT NULL THEN
    PERFORM cron.alter_job(job_id := v_id, schedule := '*/15 * * * *');
  END IF;
END
$$;
