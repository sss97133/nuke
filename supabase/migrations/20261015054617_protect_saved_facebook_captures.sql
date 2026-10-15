-- Saved membership belongs to the signed-in collector owner. Existing search
-- and item-page captures retain their present visibility. No grants are added.
SET statement_timeout = '8s';
SET lock_timeout = '3s';

CREATE POLICY fb_saved_captures_private ON public.fb_sweep_jobs
  AS RESTRICTIVE FOR SELECT TO anon, authenticated
  USING (coalesce(metadata #>> '{capture,retrieval_surface}', '') <> 'chrome_mv3_rendered_saved_cards');

CREATE POLICY fb_saved_sightings_private ON public.fb_listing_sightings
  AS RESTRICTIVE FOR SELECT TO anon, authenticated
  USING (source IS DISTINCT FROM 'saved_browser_capture');

COMMENT ON POLICY fb_saved_captures_private ON public.fb_sweep_jobs IS
  'Keep private Saved-page membership and original captures out of anonymous and ordinary signed-in reads. Existing service/admin history owns inspection.';
COMMENT ON POLICY fb_saved_sightings_private ON public.fb_listing_sightings IS
  'Saved-card sightings are private collection evidence, not public listing availability. Other sighting sources retain existing visibility.';
