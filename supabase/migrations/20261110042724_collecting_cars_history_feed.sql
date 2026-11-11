-- Historical discovery uses the existing bounded poller and canonical CC intake.
-- The live feed and the paused legacy discovery cron are unchanged.
BEGIN;
SELECT set_config('statement_timeout', least(3000, coalesce(nullif(extract(epoch FROM current_setting('statement_timeout')::interval) * 1000, 0), 3000))::text || 'ms', true);
SELECT set_config('lock_timeout', least(2000, coalesce(nullif(extract(epoch FROM current_setting('lock_timeout')::interval) * 1000, 0), 2000))::text || 'ms', true);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.listing_feeds WHERE source_slug = 'collecting-cars'
    AND search_criteria->>'fetch_strategy' = 'collecting_cars_history') THEN
    RAISE EXCEPTION 'Collecting Cars historical feed already exists; inspect its cursor';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.listing_feeds
    WHERE id = '7a39d1a1-cd75-4886-8d37-8148a1409c68' AND source_slug = 'collecting-cars'
      AND enabled = true AND search_criteria->>'full_capture_interval_minutes' = '1440') THEN
    RAISE EXCEPTION 'Collecting Cars live feed configuration changed';
  END IF;
  INSERT INTO public.listing_feeds (id, source_slug, display_name, feed_url, feed_type, search_criteria, enabled, poll_interval_minutes)
  VALUES ('7fe152d8-53cb-4bc1-9409-e8f4ebfd7c24', 'collecting-cars', 'Collecting Cars - historical source index',
    'https://collectingcars.com/sold', 'html',
    jsonb_build_object('fetch_strategy','collecting_cars_history','history_version',1,
      'history_ceiling_id',94791,'history_after_id',0,'history_capture',null,
      'history_pass',1,'history_discovery_complete',false), true, 15);
END $$;
COMMIT;
