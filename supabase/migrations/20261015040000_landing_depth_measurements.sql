-- landing_depth_measurements: the nightly raw-vs-model test, one row per run x source x field.
--
-- For each source, measure-landing-depth samples recently landed lots, reads what the retained raw capture
-- (listing_page_snapshots) holds for each field, and checks whether the canonical model holds it for the same lot
-- (vehicles columns, vehicle_events, vehicle_location_observations, vehicle_images, auction_comments).
--   raw_present      lots in the sample whose raw capture held the field
--   model_present    of those, lots where the canonical model holds it anywhere (any canonical table)
--   profile_present  of those, lots where the vehicles row itself holds it (what the profile reader shows)
--   dropped          raw_present - model_present: the field was captured and did not land
-- Field "_linked" counts lots whose raw capture resolved to a vehicle at all (sample_n = lots sampled); every other field
-- is counted over the linked lots only (sample_n = linked lots), so an unlinked lot is counted once.
-- Nothing here is private data: values are not stored, only counts and up to 3 snapshot ids per field as examples.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.landing_depth_measurements (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id          uuid        NOT NULL,
  measured_at     timestamptz NOT NULL DEFAULT now(),
  source          text        NOT NULL,
  field           text        NOT NULL,
  sample_n        integer     NOT NULL,
  raw_present     integer     NOT NULL,
  model_present   integer     NOT NULL,
  profile_present integer     NOT NULL,
  population_n    integer,
  window_start    timestamptz NOT NULL,
  window_end      timestamptz NOT NULL,
  examples        jsonb       NOT NULL DEFAULT '[]'::jsonb,
  detail          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  probe_version   text        NOT NULL,
  CONSTRAINT landing_depth_counts_sane CHECK (raw_present <= sample_n AND model_present <= raw_present AND profile_present <= raw_present),
  CONSTRAINT landing_depth_run_source_field UNIQUE (run_id, source, field)
);

CREATE INDEX IF NOT EXISTS landing_depth_source_field_time ON public.landing_depth_measurements (source, field, measured_at DESC);

COMMENT ON TABLE public.landing_depth_measurements IS
  'Nightly raw-vs-model landing depth: per run x source x field, how many sampled lots held the field in the retained raw capture, how many of those the canonical model holds, and how many the vehicles row holds. Written by measure-landing-depth; read through v_landing_depth_latest and v_landing_depth_drops.';
COMMENT ON COLUMN public.landing_depth_measurements.sample_n IS 'Lots sampled in this run (one snapshot per listing url, fetched between window_start and window_end); for every field but _linked, the sampled lots that resolved to a vehicle.';
COMMENT ON COLUMN public.landing_depth_measurements.population_n IS 'Distinct lot urls the sample was drawn from (candidate snapshots in the window, lot pages only), not a platform total.';
COMMENT ON COLUMN public.landing_depth_measurements.raw_present IS 'Sampled lots whose raw capture held the field (probe in _shared/landingDepthProbes.ts).';
COMMENT ON COLUMN public.landing_depth_measurements.model_present IS 'Of raw_present, lots where any canonical table holds the field for the resolved vehicle.';
COMMENT ON COLUMN public.landing_depth_measurements.profile_present IS 'Of raw_present, lots where the vehicles row itself holds the field (comment_count and photo_count are never on the row).';
COMMENT ON COLUMN public.landing_depth_measurements.detail IS 'Field-specific measures; for description, the median held-length / raw-length ratio on the vehicles row and anywhere in the model, and counts of teaser-only lots.';
COMMENT ON COLUMN public.landing_depth_measurements.examples IS 'Up to 3 {snapshot_id, vehicle_id} pairs where the raw capture held the field and the model did not.';

ALTER TABLE public.landing_depth_measurements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.landing_depth_measurements FROM anon, authenticated;

COMMIT;
