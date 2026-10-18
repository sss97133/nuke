-- Disposable PG17 only. Reuse the verified existing observer and its assays.
-- psql -X -v ON_ERROR_STOP=1 -d dm_refinement_image_health -f this-file.sql
\set ON_ERROR_STOP on
\ir test_comment_write_receipts.sql

CREATE TABLE public.vehicle_images (id integer PRIMARY KEY, source text NOT NULL, created_at timestamptz NOT NULL);
CREATE TABLE public.vehicle_observations (
  id integer PRIMARY KEY, image_id integer REFERENCES public.vehicle_images,
  testimony text NOT NULL, observed_at timestamptz NOT NULL, ingested_at timestamptz NOT NULL
);
CREATE TABLE public.observation_witnesses (
  observation_id integer PRIMARY KEY REFERENCES public.vehicle_observations,
  image_id integer REFERENCES public.vehicle_images, added_at timestamptz NOT NULL
);
-- Minimal row projection exercises statement-observer coexistence and atomicity;
-- production projection semantics are unchanged and separately tested.
CREATE FUNCTION public.test_image_projection() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.image_id IS NOT NULL THEN
    INSERT INTO public.observation_witnesses VALUES (NEW.id, NEW.image_id, NEW.ingested_at);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER test_image_projection AFTER INSERT ON public.vehicle_observations
FOR EACH ROW EXECUTE FUNCTION public.test_image_projection();

\ir ../migrations/20261004052152_observe_image_observation_writes.sql

BEGIN;
SET LOCAL app.writer = '';
SET LOCAL request.headers = '{"x-nuke-writer":"ingest-observation"}';
INSERT INTO public.vehicle_images VALUES (1, 'fixture', '2026-01-01T00:00:00Z');
INSERT INTO public.vehicle_observations
SELECT i, 1, 'original ' || i, '2026-01-02T00:00:00Z', '2026-10-04T00:00:00Z'
FROM generate_series(1,200) i;
DO $$ BEGIN
  IF (SELECT sum(rows) FROM public.write_receipts WHERE tbl='vehicle_observations') <> 200
     OR (SELECT sum(rows) FROM public.write_receipts WHERE tbl='observation_witnesses') <> 200
     OR (SELECT count(*) FROM public.write_receipts WHERE tbl='vehicle_observations') <> 1
     OR EXISTS (SELECT 1 FROM public.write_receipts WHERE tbl IN ('vehicle_observations','observation_witnesses','vehicle_images')
       AND (writer <> 'ingest-observation' OR txid <> txid_current())) THEN
    RAISE EXCEPTION 'Actual new rows must have transaction-correlated, attributed receipts';
  END IF;
END $$;

INSERT INTO public.vehicle_observations
SELECT i, 1, 'overwrite', now(), now() FROM generate_series(1,200) i ON CONFLICT DO NOTHING;
INSERT INTO public.vehicle_observations SELECT * FROM public.vehicle_observations WHERE false;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.write_receipts WHERE tbl='vehicle_observations') <> 1
     OR (SELECT count(*) FROM public.write_receipts WHERE tbl='observation_witnesses') <> 200
     OR (SELECT count(*) FROM public.vehicle_observations WHERE testimony='original ' || id
       AND observed_at='2026-01-02T00:00:00Z' AND ingested_at='2026-10-04T00:00:00Z') <> 200 THEN
    RAISE EXCEPTION 'Conflict/empty replay must not emit receipts or change source/log clocks';
  END IF;
END $$;

SAVEPOINT rejected;
INSERT INTO public.vehicle_observations VALUES (201, 1, 'rolled back', now(), now());
ROLLBACK TO SAVEPOINT rejected;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.vehicle_observations WHERE id=201)
     OR EXISTS (SELECT 1 FROM public.observation_witnesses WHERE observation_id=201)
     OR (SELECT sum(rows) FROM public.write_receipts WHERE tbl='vehicle_observations') <> 200
     OR (SELECT sum(rows) FROM public.write_receipts WHERE tbl='observation_witnesses') <> 200 THEN
    RAISE EXCEPTION 'Receipt and derived witness must roll back with testimony';
  END IF;
END $$;

SET LOCAL request.headers = '{}';
INSERT INTO public.vehicle_images VALUES (2, 'undeclared fixture', now());
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.write_receipts WHERE tbl='vehicle_images' AND rows=1 AND writer='undeclared') THEN
    RAISE EXCEPTION 'Unknown image producers must stay undeclared';
  END IF;
END $$;

-- Sensor failure remains fail-open for ingestion; the CLI must report it.
ALTER TABLE public.write_receipts RENAME TO held_write_receipts;
INSERT INTO public.vehicle_observations VALUES (202, 1, 'sensor failed', now(), now());
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.vehicle_observations WHERE id=202)
     OR NOT EXISTS (SELECT 1 FROM public.observation_witnesses WHERE observation_id=202) THEN
    RAISE EXCEPTION 'Receipt failure must not destroy intake or projection';
  END IF;
END $$;
ALTER TABLE public.held_write_receipts RENAME TO write_receipts;
COMMIT;
SELECT 'PASS: three sensors, batch counts, nested projection txid, empty/conflict replay, clocks/testimony, rollback, undeclared image writer, sensor failure' AS result;
