-- Use the existing bounded poller to acquire every live Collecting Cars lot.
-- Discovery cadence is independent of the daily full-page refresh interval.
-- Source holds, per-invocation caps, failed-attempt backoff and paid allowances
-- remain enforced by the existing writers. No new cron or capacity is added.
SET LOCAL statement_timeout = '3s';
SET LOCAL lock_timeout = '2s';

DO $$
DECLARE changed integer;
BEGIN
  UPDATE public.listing_feeds
  SET display_name = 'Collecting Cars - all live lots',
      search_criteria = (search_criteria - 'slug_year_min' - 'slug_year_max')
        || jsonb_build_object('full_capture_interval_minutes', 1440),
      poll_interval_minutes = 15,
      updated_at = now()
  WHERE id = '7a39d1a1-cd75-4886-8d37-8148a1409c68'
    AND source_slug = 'collecting-cars'
    AND feed_type = 'html'
    AND feed_url = 'https://collectingcars.com/sitemap.xml'
    AND enabled = true
    AND poll_interval_minutes = 1440
    AND search_criteria->>'slug_year_min' = '1964'
    AND search_criteria->>'slug_year_max' = '1991'
    AND (NOT search_criteria ? 'full_capture_interval_minutes'
      OR search_criteria->>'full_capture_interval_minutes' = '1440');
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 1 THEN
    RAISE EXCEPTION 'Collecting Cars feed changed; inspect configuration before widening scope';
  END IF;
END $$;
