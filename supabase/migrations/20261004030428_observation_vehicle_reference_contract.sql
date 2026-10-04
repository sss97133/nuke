-- Owner-authorized DB trust repair (2026-10-03): enforce the existing observation
-- vehicle reference and describe its two clocks. This extracts the trunk-key
-- repair already proposed in the staged Mecum media contract; media fields and
-- its broader changes are not included. Rebase that draft without a duplicate FK.
-- NOT VALID avoids scanning or rewriting historical testimony. New non-NULL
-- vehicle references are enforced immediately; NULL remains unresolved evidence.
-- Historical orphan attribution/validation is a separate bounded operation.
-- No new table, writer, job, reader, grant, row write or model call.
-- Ship as the sole migration in a commit through supabase-deploy.yml.

BEGIN;
SET LOCAL statement_timeout = '120s';
SET LOCAL lock_timeout = '5s';

DO $contract$
DECLARE
  fk_name text;
BEGIN
  SELECT c.conname INTO fk_name
  FROM pg_constraint c
  WHERE c.conrelid = 'public.vehicle_observations'::regclass
    AND c.contype = 'f'
    AND c.conkey = ARRAY[(SELECT attnum FROM pg_attribute
      WHERE attrelid = c.conrelid AND attname = 'vehicle_id')]::smallint[]
    AND c.confrelid = 'public.vehicles'::regclass
    AND c.confkey = ARRAY[(SELECT attnum FROM pg_attribute
      WHERE attrelid = c.confrelid AND attname = 'id')]::smallint[]
    AND c.confdeltype IN ('a', 'r')
  ORDER BY c.conname
  LIMIT 1;

  IF fk_name IS NULL THEN
    ALTER TABLE public.vehicle_observations
      ADD CONSTRAINT vehicle_observations_vehicle_id_fkey
      FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id)
      ON DELETE RESTRICT NOT VALID;
    fk_name := 'vehicle_observations_vehicle_id_fkey';
  END IF;

  EXECUTE format('COMMENT ON CONSTRAINT %I ON public.vehicle_observations IS %L',
    fk_name,
    'Resolved chassis reference: new non-NULL assignments must reference vehicles.id; referenced vehicles cannot be deleted. Historical validation is separate; no historical testimony is rewritten.');
END
$contract$;

COMMENT ON COLUMN public.vehicle_observations.vehicle_id IS
  'Nullable FK to vehicles.id: the resolved physical chassis for one observation. NULL preserves unresolved or non-vehicle testimony. New non-NULL references are enforced; historical validation remains separate. Attribution changes use the sanctioned relink path and retain lineage.';
COMMENT ON COLUMN public.vehicle_observations.observed_at IS
  'Observation clock in timestamptz: source event or capture time supplied by the writer. Legacy writers used mixed event/capture/publication semantics; this column alone does not establish an exact event time or availability at a prediction cutoff. Retain the source clock meaning and precision with provenance; do not recast legacy timestamps.';
COMMENT ON COLUMN public.vehicle_observations.ingested_at IS
  'Ingest clock in timestamptz: when this observation entered Nuke, distinct from its source event/capture/publication clock. One timestamp per observation grain; used for as-of-system reconstruction. Does not by itself establish when the evidence was externally available.';

COMMIT;
