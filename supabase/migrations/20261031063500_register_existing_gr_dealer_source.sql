-- The enabled GR inventory feed already exists. Supply its missing canonical
-- dealer attribution before native listings can enter ingest-observation.
-- Capture samples are retained; no vehicle, observation or held source is changed.
BEGIN;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '2s';
DO $registration$
BEGIN
  IF EXISTS (SELECT 1 FROM public.observation_sources
    WHERE lower(regexp_replace(coalesce(base_url,''), '/+$', '')) IN
      ('https://www.grautogallery.com','https://grautogallery.com') AND slug <> 'gr-auto-gallery') THEN
    RAISE EXCEPTION 'GR already has another canonical source; reconcile ownership before registration';
  END IF;
  INSERT INTO public.observation_sources
    (slug, display_name, category, base_url, supported_observations, species, species_set, species_evidence)
  VALUES ('gr-auto-gallery', 'GR Auto Gallery', 'dealer', 'https://www.grautogallery.com',
    ARRAY['listing']::public.observation_kind[], 'dealer', ARRAY['dealer']::public.source_species[],
    jsonb_build_object('examined_at','2026-10-31','examined',jsonb_build_array(
      'https://www.grautogallery.com/vehicles',
      'listing_page_snapshots:0cfab5a3-40d1-41b4-83e1-99c643ed2141'),
      'seen','Own-site dealer inventory; per-stock Car microdata, Stock/Vin panels, asking/inquiry pages; no auction end or bids.',
      'doc','docs/ledger/theory/data-machine-cases.md section 6: Dealer sites',
      'extractor','dealer_microdata_v1', 'listing_rule','Own /vehicles/<stock>/<slug> pages; seller claims; currency and event time remain unknown unless explicit.'))
  ON CONFLICT (slug) DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM public.observation_sources WHERE slug='gr-auto-gallery'
    AND base_url='https://www.grautogallery.com' AND category='dealer' AND species='dealer'
    AND 'listing'=ANY(supported_observations)) THEN
    RAISE EXCEPTION 'Existing GR source registration differs; preserve it for review';
  END IF;
END
$registration$;
COMMIT;
