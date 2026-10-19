-- Isolated PostgreSQL 17 contract for 20261018230000_auto_classify_vehicle_resolve_make.sql.
-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_auto_classify -f this-file.sql
-- Synthetic rows only; never production.

DO $guard$
BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
     OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' AND c.relname = 'vehicles') THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 dm_refinement_* database';
  END IF;
END $guard$;

CREATE TABLE public.canonical_makes (
  id uuid PRIMARY KEY,
  canonical_name text UNIQUE NOT NULL,
  display_name text NOT NULL,
  aliases text[] DEFAULT '{}',
  parent_company text
);

CREATE TABLE public.vehicle_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL
);

CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY,
  year integer,
  make text,
  model text,
  era text,
  segment_id uuid REFERENCES public.vehicle_segments(id),
  canonical_make_id uuid REFERENCES public.canonical_makes(id)
);

INSERT INTO public.canonical_makes (id, canonical_name, display_name, aliases) VALUES
  ('00000000-0000-4000-a000-000000000001', 'NISSAN',     'Nissan',     ARRAY['nissan', 'datsun', 'Datsun', 'DATSUN']),
  ('00000000-0000-4000-a000-000000000002', 'Datsun',     'Datsun',     ARRAY['datsun', 'DATSUN']),
  ('00000000-0000-4000-a000-000000000003', 'FORD',       'Ford',       ARRAY['ford']),
  ('00000000-0000-4000-a000-000000000004', 'SHELBY',     'Shelby',     '{}'),
  ('00000000-0000-4000-a000-000000000005', 'DESOTO',     'DeSoto',     ARRAY['De Soto']),
  ('00000000-0000-4000-a000-000000000006', 'De Tomaso',  'De Tomaso',  ARRAY['DeTomaso']),
  ('00000000-0000-4000-a000-000000000007', 'CHEVROLET',  'Chevrolet',  ARRAY['Chevy']);

INSERT INTO public.vehicle_segments (slug) VALUES ('jdm'), ('mustang');

\ir ../migrations/20261018230000_auto_classify_vehicle_resolve_make.sql

-- Inserts: case-insensitive, display_name before another make's alias, alias as the last resort,
-- a contradicting writer id corrected, an unresolvable make keeps the writer's id.
INSERT INTO public.vehicles (id, year, make, model, canonical_make_id) VALUES
  ('00000000-0000-4000-b000-000000000001', 1972, 'datsun',     '240Z',      NULL),
  ('00000000-0000-4000-b000-000000000002', 1971, 'DATSUN',     '510',       '00000000-0000-4000-a000-000000000001'),
  ('00000000-0000-4000-b000-000000000003', 1971, 'de tomaso',  'Pantera',   '00000000-0000-4000-a000-000000000005'),
  ('00000000-0000-4000-b000-000000000004', 1957, 'chevy',      'Bel Air',   NULL),
  ('00000000-0000-4000-b000-000000000005', 1966, 'Ford',       'Mustang',   NULL),
  ('00000000-0000-4000-b000-000000000006', 1966, 'Ford',       'Mustang',   NULL),
  ('00000000-0000-4000-b000-000000000007', 1966, 'Ford',       'Mustang',   NULL),
  ('00000000-0000-4000-b000-000000000008', 1930, 'Unknown Co', 'Roadster',  '00000000-0000-4000-a000-000000000003'),
  ('00000000-0000-4000-b000-000000000009', 1958, ' DeSoto ',   'Firesweep', NULL);

-- Updates: a make rewrite re-resolves; an id written alone is corrected to the make; a rewrite to an
-- unresolvable make clears the inherited id unless the same statement sets one.
UPDATE public.vehicles SET make = 'Shelby' WHERE id = '00000000-0000-4000-b000-000000000005';
UPDATE public.vehicles SET make = 'Shelby' WHERE id = '00000000-0000-4000-b000-000000000006';
UPDATE public.vehicles SET canonical_make_id = '00000000-0000-4000-a000-000000000003'
WHERE id = '00000000-0000-4000-b000-000000000006';
UPDATE public.vehicles SET make = 'Shelby American Replica' WHERE id = '00000000-0000-4000-b000-000000000007';

INSERT INTO public.vehicles (id, year, make, model) VALUES
  ('00000000-0000-4000-b000-000000000010', 1966, 'Ford', 'Mustang');
UPDATE public.vehicles SET make = 'Shelby American Replica', canonical_make_id = '00000000-0000-4000-a000-000000000004'
WHERE id = '00000000-0000-4000-b000-000000000010';

-- A make that resolves only after an alias is added fills on the next model-only update.
INSERT INTO public.vehicles (id, year, make, model) VALUES
  ('00000000-0000-4000-b000-000000000011', 1969, 'Nissan Motor', 'Skyline');
UPDATE public.canonical_makes SET aliases = aliases || ARRAY['Nissan Motor']
WHERE id = '00000000-0000-4000-a000-000000000001';
UPDATE public.vehicles SET model = 'Skyline GT-R' WHERE id = '00000000-0000-4000-b000-000000000011';

DO $assert$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('00000000-0000-4000-b000-000000000001'::uuid, '00000000-0000-4000-a000-000000000002'::uuid, 'lowercase datsun is Datsun, not Nissan''s alias'),
      ('00000000-0000-4000-b000-000000000002', '00000000-0000-4000-a000-000000000002', 'writer id Nissan on make DATSUN is corrected to Datsun'),
      ('00000000-0000-4000-b000-000000000003', '00000000-0000-4000-a000-000000000006', 'writer id DeSoto on make de tomaso is corrected to De Tomaso'),
      ('00000000-0000-4000-b000-000000000004', '00000000-0000-4000-a000-000000000007', 'alias chevy resolves to Chevrolet'),
      ('00000000-0000-4000-b000-000000000005', '00000000-0000-4000-a000-000000000004', 'make rewritten Ford -> Shelby re-resolves to Shelby'),
      ('00000000-0000-4000-b000-000000000006', '00000000-0000-4000-a000-000000000004', 'id Ford written alone on a Shelby row is corrected to Shelby'),
      ('00000000-0000-4000-b000-000000000008', '00000000-0000-4000-a000-000000000003', 'unresolvable make keeps the writer''s id'),
      ('00000000-0000-4000-b000-000000000009', '00000000-0000-4000-a000-000000000005', 'padded make resolves after trim'),
      ('00000000-0000-4000-b000-000000000010', '00000000-0000-4000-a000-000000000004', 'unresolvable rewrite with an id in the same statement keeps that id'),
      ('00000000-0000-4000-b000-000000000011', '00000000-0000-4000-a000-000000000001', 'model-only update fills a NULL id from the make')
    ) AS t(vehicle_id, expected, label)
  LOOP
    IF (SELECT canonical_make_id FROM public.vehicles WHERE id = r.vehicle_id) IS DISTINCT FROM r.expected THEN
      RAISE EXCEPTION 'canonical_make_id: % (got %)', r.label,
        (SELECT canonical_make_id FROM public.vehicles WHERE id = r.vehicle_id);
    END IF;
  END LOOP;

  IF (SELECT canonical_make_id FROM public.vehicles WHERE id = '00000000-0000-4000-b000-000000000007') IS NOT NULL THEN
    RAISE EXCEPTION 'a rewrite to an unresolvable make must clear the id inherited from the previous make';
  END IF;

  IF (SELECT era FROM public.vehicles WHERE id = '00000000-0000-4000-b000-000000000001') IS DISTINCT FROM 'classic' THEN
    RAISE EXCEPTION 'era must still be derived from year';
  END IF;

  IF (SELECT s.slug FROM public.vehicles v JOIN public.vehicle_segments s ON s.id = v.segment_id
      WHERE v.id = '00000000-0000-4000-b000-000000000004') IS NOT NULL
     OR (SELECT s.slug FROM public.vehicles v JOIN public.vehicle_segments s ON s.id = v.segment_id
         WHERE v.id = '00000000-0000-4000-b000-000000000005') IS DISTINCT FROM 'mustang' THEN
    RAISE EXCEPTION 'segment_id assignment must be unchanged';
  END IF;

  IF pg_get_triggerdef((SELECT oid FROM pg_trigger WHERE tgname = 'trigger_auto_classify_vehicle'))
     NOT LIKE '%UPDATE OF make, model, year, canonical_make_id%' THEN
    RAISE EXCEPTION 'trigger_auto_classify_vehicle must fire on UPDATE OF canonical_make_id';
  END IF;
END $assert$;

\echo 'test_auto_classify_vehicle_make: ok'
