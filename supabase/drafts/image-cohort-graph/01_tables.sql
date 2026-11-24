-- DRAFT, NOT APPLIED. Per-image cohort graph: storage. Spec: docs/library/PHOTO_COHORT_GRAPH.md
-- Inert on its own: no triggers, no cron, no backfill.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';

-- Edges that are facts of ONE photo and are not already a vehicle_images column or a link table.
CREATE TABLE IF NOT EXISTS public.image_cohort_edges (
  id                    bigserial PRIMARY KEY,
  image_id              uuid NOT NULL,             -- vehicle_images.id (no FK: the deriver checks; keeps 76 GB table writes cheap)
  cohort_kind           text NOT NULL CHECK (cohort_kind IN
                          ('place_cell','zcta','garage','garage_site','capture_session','work_order','data_set',
                           'photo_kind','person_present','burst')   -- the last three come from free device reads (05)),
  cohort_key            text NOT NULL CHECK (cohort_key <> ''),   -- '34.052:-118.244', '90012', uuid text, ...
  cohort_id             uuid,                      -- the row when the cohort is a row (garage, image_set, work order, data set)
  basis                 text NOT NULL,             -- 'vehicle_images.gps', 'geo_cell_zcta', 'image_set_members', ...
  basis_id              uuid,
  -- Garage model (#3448): who made the evidence, where it belongs, and their rank there. Never merged.
  originator_user_id    uuid,
  originator_external_identity_id uuid,
  place_garage_id       uuid,
  originator_rank       smallint,
  visibility            text NOT NULL DEFAULT 'inherit' CHECK (visibility IN ('inherit','private')),
  confidence            numeric(4,3) NOT NULL DEFAULT 1 CHECK (confidence BETWEEN 0 AND 1),
  rule_version          text NOT NULL,
  derived_at            timestamptz NOT NULL DEFAULT now(),
  superseded_at         timestamptz,
  CHECK (originator_user_id IS NULL OR originator_external_identity_id IS NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS image_cohort_edges_current_uq
  ON public.image_cohort_edges (image_id, cohort_kind, cohort_key) WHERE superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS image_cohort_edges_cohort_idx
  ON public.image_cohort_edges (cohort_kind, cohort_key) WHERE superseded_at IS NULL;   -- cohort -> its photos

-- The fold: one row per vehicle per cohort. Every photo of the vehicle inherits these through vehicle_id.
CREATE TABLE IF NOT EXISTS public.vehicle_cohort_edges (
  id             bigserial PRIMARY KEY,
  vehicle_id     uuid NOT NULL,
  cohort_kind    text NOT NULL CHECK (cohort_kind IN ('make','model','year_model','generation','series','organization')),
  cohort_key     text NOT NULL CHECK (cohort_key <> '' AND cohort_key = lower(btrim(cohort_key))),
  cohort_id      uuid,                 -- organizations.id for kind organization
  role           text,                 -- organization_vehicles.relationship_type
  basis          text NOT NULL,        -- 'vehicles.make', 'organization_vehicles', ...
  basis_id       uuid,
  rule_version   text NOT NULL,
  derived_at     timestamptz NOT NULL DEFAULT now(),
  superseded_at  timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_cohort_edges_current_uq
  ON public.vehicle_cohort_edges (vehicle_id, cohort_kind, cohort_key, coalesce(role,'')) WHERE superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS vehicle_cohort_edges_cohort_idx
  ON public.vehicle_cohort_edges (cohort_kind, cohort_key) WHERE superseded_at IS NULL;

CREATE TABLE IF NOT EXISTS public.image_cohort_queue (
  image_id     uuid PRIMARY KEY,
  reason       text NOT NULL,
  enqueued_at  timestamptz NOT NULL DEFAULT now(),
  attempts     smallint NOT NULL DEFAULT 0,
  last_error   text
);
CREATE TABLE IF NOT EXISTS public.vehicle_cohort_queue (
  vehicle_id   uuid PRIMARY KEY,
  reason       text NOT NULL,
  enqueued_at  timestamptz NOT NULL DEFAULT now(),
  attempts     smallint NOT NULL DEFAULT 0,
  last_error   text
);

ALTER TABLE public.image_cohort_edges   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_cohort_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.image_cohort_queue   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_cohort_queue ENABLE ROW LEVEL SECURITY;
-- No anon/authenticated policies: clients read through image_cohorts_read (04), which checks vehicle_images RLS.
REVOKE ALL ON public.image_cohort_edges, public.vehicle_cohort_edges, public.image_cohort_queue, public.vehicle_cohort_queue
  FROM anon, authenticated;

-- One switch for the drains (03 reads it every run).
INSERT INTO public.platform_config (config_key, config_value, description)
SELECT 'image_cohort_graph',
       jsonb_build_object('paused', true, 'image_batch', 500, 'vehicle_batch', 2000,
                          'budget_ms', 2000, 'max_active_backends', 40),
       'Per-image cohort graph drains (docs/library/PHOTO_COHORT_GRAPH.md). paused=true stops both drains.'
WHERE NOT EXISTS (SELECT 1 FROM public.platform_config WHERE config_key = 'image_cohort_graph');

commit;
