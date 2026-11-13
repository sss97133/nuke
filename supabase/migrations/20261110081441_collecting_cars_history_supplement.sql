-- Enable the bounded existing history supplement without resetting any held page.
-- Candidate URLs were read from a retained local discovery file; its hash is
-- provenance supplied by the operator, not a publisher capture or auction claim.
BEGIN;
SELECT set_config('statement_timeout', least(3000, coalesce(nullif(extract(epoch FROM current_setting('statement_timeout')::interval) * 1000, 0), 3000))::text || 'ms', true);
SELECT set_config('lock_timeout', least(2000, coalesce(nullif(extract(epoch FROM current_setting('lock_timeout')::interval) * 1000, 0), 2000))::text || 'ms', true);
DO $$
DECLARE
  current_config jsonb;
  candidates constant jsonb := $manifest${
  "version": 1,
  "origin_sha256": "a52e1ee9bb25c3181fd4a14b813b926caf1c6ac85ed0d9b1f685d85f9a6fcaeb",
  "discovered_at": "2026-11-10T07:47:47.712Z",
  "urls": [
    "https://collectingcars.com/for-sale/1971-triumph-tr6-1",
    "https://collectingcars.com/for-sale/1979-porsche-928-1",
    "https://collectingcars.com/for-sale/1989-ford-maverick-swb-series-ii-1",
    "https://collectingcars.com/for-sale/1992-porsche-911-964-carrera-4-7",
    "https://collectingcars.com/for-sale/1997-bmw-e31-840ci-sport",
    "https://collectingcars.com/for-sale/1997-subaru-impreza-turbo-2000",
    "https://collectingcars.com/for-sale/2000-nissan-skyline-r34-gt-r-7",
    "https://collectingcars.com/for-sale/2012-mercedes-benz-w204-c63-amg-6",
    "https://collectingcars.com/for-sale/2016-bmw-f82-m4-gts-6",
    "https://collectingcars.com/for-sale/2019-mclaren-senna-5",
    "https://collectingcars.com/for-sale/2023-lamborghini-huracan-sto-4",
    "https://collectingcars.com/for-sale/2024-porsche-718-spyder-rs-weissach-pack-11"
  ]
}$manifest$::jsonb;
BEGIN
  SELECT search_criteria INTO current_config FROM public.listing_feeds
  WHERE id='7fe152d8-53cb-4bc1-9409-e8f4ebfd7c24' AND source_slug='collecting-cars'
    AND enabled=true AND poll_interval_minutes=15
    AND search_criteria->>'fetch_strategy'='collecting_cars_history'
    AND search_criteria->>'history_version'='1'
    AND search_criteria->>'history_ceiling_id'='94791'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Historical feed controls changed; inspect before activation'; END IF;
  IF current_config ? 'history_supplement_version' OR current_config ? 'history_retained_discovery' THEN
    IF current_config->'history_supplement_version'='1'::jsonb
       AND current_config->'history_retained_discovery'=candidates THEN RETURN; END IF;
    RAISE EXCEPTION 'Historical supplement already configured differently';
  END IF;
  UPDATE public.listing_feeds SET search_criteria=current_config || jsonb_build_object(
    'history_supplement_version',1,'history_retained_discovery',candidates),updated_at=now()
  WHERE id='7fe152d8-53cb-4bc1-9409-e8f4ebfd7c24';
END $$;
COMMIT;
