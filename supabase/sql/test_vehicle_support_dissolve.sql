-- Contract for 20261113140000_vehicle_support_dissolve.sql. Synthetic rows only; never production.
--   createdb dm_refinement_vehicle_support_dissolve
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_vehicle_support_dissolve -f supabase/sql/test_vehicle_support_dissolve.sql
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty, disposable dm_refinement_* database';
  END IF;
END $$;
SET client_min_messages = notice;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;

-- Production shapes (only the columns the producer reads).
CREATE TYPE public.vision_gate_status AS ENUM ('pending', 'passed', 'review_needed', 'rejected_misattributed', 'rejected_personal');
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, year int, make text, model text, vin text, status text,
  deleted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), listing_url text, merged_into_vehicle_id uuid,
  user_id uuid, is_public boolean DEFAULT true);
CREATE TABLE public.vehicle_images (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, file_hash text,
  is_superseded boolean DEFAULT false, is_duplicate boolean DEFAULT false, duplicate_of uuid,
  vision_gate_status public.vision_gate_status, caption text);
CREATE TABLE public.vehicle_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, source_platform text,
  source_url text, source_listing_id text);
CREATE TABLE public.vehicle_documents (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, document_type text);
CREATE TABLE public.bat_listings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid);
CREATE TABLE public.external_listings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid);

\i supabase/migrations/20261113140000_vehicle_support_dissolve.sql

-- Fixtures (ids: a* anchors, b* candidates). Old = 30 days, young = 2 days.
INSERT INTO vehicles (id, year, make, model, vin, created_at) VALUES
 ('00000000-0000-0000-0000-0000000000a1', 1989, 'Porsche', '911 Speedster', 'WP0EB0910KS170001', now() - interval '60 days'),
 ('00000000-0000-0000-0000-0000000000b1', 1989, 'Porsche', '911 Speedster', NULL, now() - interval '30 days'),       -- listing stub of a1
 ('00000000-0000-0000-0000-0000000000a2', 1966, 'Ford', 'Thunderbird Custom Convertible', '6Y85Z100001', now() - interval '60 days'),
 ('00000000-0000-0000-0000-0000000000b2', 1966, 'Ford', 'Galaxie 500 7 Liter 2 Door Hardtop', NULL, now() - interval '30 days'), -- misfiled listing on a2
 ('00000000-0000-0000-0000-0000000000b3', 1972, 'Datsun', '240Z', NULL, now() - interval '30 days'),               -- thin single-listing
 ('00000000-0000-0000-0000-0000000000a4', 1965, 'Chevrolet', 'Corvette', '194375S100001', now() - interval '60 days'),
 ('00000000-0000-0000-0000-0000000000b4', 1965, 'Chevrolet', 'Corvette', NULL, now() - interval '30 days'),        -- 1 own photo
 ('00000000-0000-0000-0000-0000000000b5', 1965, 'Chevrolet', 'Corvette', NULL, now() - interval '30 days'),        -- all copies
 ('00000000-0000-0000-0000-0000000000a6', 1957, 'Ford', 'Thunderbird', 'F7FH310001', now() - interval '60 days'),
 ('00000000-0000-0000-0000-0000000000b6', 1957, 'Ford', 'Thunderbird', 'F7FH340062', now() - interval '30 days'),  -- different short chassis
 ('00000000-0000-0000-0000-0000000000b7', 1989, 'Porsche', '911 Speedster', NULL, now() - interval '2 days'),       -- grace
 ('00000000-0000-0000-0000-0000000000b8', 1990, 'Mazda', 'Miata', NULL, now() - interval '30 days'),               -- empty
 ('00000000-0000-0000-0000-0000000000a9', 1969, 'Dodge', 'Charger', 'XS29L9B000001', now() - interval '60 days'),
 ('00000000-0000-0000-0000-0000000000b9', 1970, 'Plymouth', 'Cuda', NULL, now() - interval '30 days');             -- mecum lot id reuse

INSERT INTO vehicle_events (vehicle_id, source_platform, source_url, source_listing_id) VALUES
 ('00000000-0000-0000-0000-0000000000a1', 'bat', 'https://bringatrailer.com/listing/1989-porsche-911-speedster-98', NULL),
 ('00000000-0000-0000-0000-0000000000b1', 'bat', 'https://bringatrailer.com/listing/1989-porsche-911-speedster-98', NULL),
 ('00000000-0000-0000-0000-0000000000b7', 'bat', 'https://bringatrailer.com/listing/1989-porsche-911-speedster-98', NULL),
 ('00000000-0000-0000-0000-0000000000a2', 'barrettjackson', 'https://bj.example/2011/galaxie-98860', NULL),
 ('00000000-0000-0000-0000-0000000000b2', 'barrettjackson', 'https://bj.example/2011/galaxie-98860', NULL),
 ('00000000-0000-0000-0000-0000000000b3', 'bat', 'https://bringatrailer.com/listing/1972-datsun-240z-1', NULL),
 ('00000000-0000-0000-0000-0000000000a6', 'barrettjackson', 'https://bj.example/2002/tbird-17456', NULL),
 ('00000000-0000-0000-0000-0000000000b6', 'barrettjackson', 'https://bj.example/2002/tbird-17456', NULL),
 ('00000000-0000-0000-0000-0000000000a9', 'mecum', 'https://mecum.example/kissimmee-2020/s108', 'S108'),
 ('00000000-0000-0000-0000-0000000000b9', 'mecum', 'https://mecum.example/indy-2021/s108', 'S108');

INSERT INTO vehicle_images (vehicle_id, file_hash) VALUES
 ('00000000-0000-0000-0000-0000000000a4', 'h1'), ('00000000-0000-0000-0000-0000000000a4', 'h2'),
 ('00000000-0000-0000-0000-0000000000a4', 'h3'),
 ('00000000-0000-0000-0000-0000000000b4', 'h1'), ('00000000-0000-0000-0000-0000000000b4', 'own-b4'),
 ('00000000-0000-0000-0000-0000000000b5', 'h2'), ('00000000-0000-0000-0000-0000000000b5', 'h3');
TRUNCATE vehicle_support_dirty;

CREATE TEMP TABLE d AS SELECT * FROM vehicle_support_assess(ARRAY(SELECT id FROM vehicles));
SELECT pg_temp.ok('stub sharing a stronger same-car listing dissolves to it',
  (SELECT decision = 'dissolve' AND resolves_to = '00000000-0000-0000-0000-0000000000a1' FROM d WHERE vehicle_id = '00000000-0000-0000-0000-0000000000b1'));
SELECT pg_temp.ok('identity guard: different model family never shadows (Galaxie vs Thunderbird)',
  (SELECT decision = 'supported' AND listing_indep FROM d WHERE vehicle_id = '00000000-0000-0000-0000-0000000000b2'));
SELECT pg_temp.ok('thin single-listing vehicle is anchored by its own URL',
  (SELECT decision = 'supported' AND listing_indep FROM d WHERE vehicle_id = '00000000-0000-0000-0000-0000000000b3'));
SELECT pg_temp.ok('one unshared photo keeps a profile (100% rule)',
  (SELECT decision = 'supported' AND n_img_indep = 1 FROM d WHERE vehicle_id = '00000000-0000-0000-0000-0000000000b4'));
SELECT pg_temp.ok('all photos exact copies of a VIN profile -> dissolve to it',
  (SELECT decision = 'dissolve' AND resolves_to = '00000000-0000-0000-0000-0000000000a4' FROM d WHERE vehicle_id = '00000000-0000-0000-0000-0000000000b5'));
SELECT pg_temp.ok('pre-1981 chassis (6+ chars) counts as VIN and different chassis blocks shadowing',
  (SELECT decision = 'supported' AND has_vin AND vin_indep FROM d WHERE vehicle_id = '00000000-0000-0000-0000-0000000000b6'));
SELECT pg_temp.ok('young fully-shadowed profile is only flagged (grace)',
  (SELECT decision = 'shadowed_in_grace' FROM d WHERE vehicle_id = '00000000-0000-0000-0000-0000000000b7'));
SELECT pg_temp.ok('empty profile is flagged, not dissolved',
  (SELECT decision = 'unsupported_empty' FROM d WHERE vehicle_id = '00000000-0000-0000-0000-0000000000b8'));
SELECT pg_temp.ok('listing match is URL first: reused Mecum lot id does not shadow',
  (SELECT decision = 'supported' AND listing_indep FROM d WHERE vehicle_id = '00000000-0000-0000-0000-0000000000b9'));
SELECT pg_temp.ok('anchors with VINs stay supported',
  (SELECT bool_and(decision = 'supported') FROM d WHERE vehicle_id::text LIKE '%a_'));

-- Dry run is the default and writes nothing to vehicles.
CREATE TEMP TABLE r1 AS SELECT vehicle_support_run(ARRAY(SELECT id FROM vehicles)) AS j;
SELECT pg_temp.ok('default run is dry', (SELECT j->>'status' = 'dry_run' AND (j->>'dissolve')::int = 2 FROM r1));
SELECT pg_temp.ok('dry run changes no vehicle', (SELECT count(*) = 0 FROM vehicles WHERE derived_status IS NOT NULL));
SELECT pg_temp.ok('run is signed (sha256 of payload)',
  (SELECT signature = encode(sha256(convert_to(signed_payload::text, 'UTF8')), 'hex') AND length(signature) = 64
     FROM vehicle_support_runs WHERE run_id = ((SELECT j FROM r1)->>'run_id')::uuid));
SELECT pg_temp.ok('scores recorded per vehicle',
  (SELECT count(*) = (SELECT count(*) FROM vehicles) FROM vehicle_support_scores WHERE run_id = ((SELECT j FROM r1)->>'run_id')::uuid));

-- Over the cap: halt and flag, write nothing.
CREATE TEMP TABLE r2 AS SELECT vehicle_support_run(ARRAY(SELECT id FROM vehicles), p_dry_run => false, p_cap => 1) AS j;
SELECT pg_temp.ok('above cap halts and flags', (SELECT j->>'status' = 'halted_over_cap' AND (j->>'flagged')::boolean FROM r2));
SELECT pg_temp.ok('halted run changes no vehicle', (SELECT count(*) = 0 FROM vehicles WHERE derived_status IS NOT NULL));

-- Applied under the cap: derived status only, never a delete.
CREATE TEMP TABLE r3 AS SELECT vehicle_support_run(ARRAY(SELECT id FROM vehicles), p_dry_run => false, p_cap => 50) AS j;
SELECT pg_temp.ok('applied run dissolves exactly the two', (SELECT j->>'status' = 'applied' FROM r3)
  AND (SELECT array_agg(id ORDER BY id) = ARRAY['00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000b5']::uuid[]
         FROM vehicles WHERE derived_status = 'dissolved'));
SELECT pg_temp.ok('nothing deleted', (SELECT count(*) = 14 AND count(*) FILTER (WHERE deleted_at IS NOT NULL) = 0 FROM vehicles)
  AND (SELECT count(*) = 7 FROM vehicle_images));
SELECT pg_temp.ok('dissolved rows carry the run id',
  (SELECT bool_and(derived_status_run_id = ((SELECT j FROM r3)->>'run_id')::uuid) FROM vehicles WHERE derived_status = 'dissolved'));
SELECT pg_temp.ok('producer status write does not enqueue itself', (SELECT count(*) = 0 FROM vehicle_support_dirty));

-- Revert by run.
SELECT vehicle_support_revert_run(((SELECT j FROM r3)->>'run_id')::uuid, 'contract');
SELECT pg_temp.ok('revert restores prior status', (SELECT count(*) = 0 FROM vehicles WHERE derived_status IS NOT NULL));
SELECT pg_temp.ok('run marked reverted', (SELECT status = 'reverted' FROM vehicle_support_runs WHERE run_id = ((SELECT j FROM r3)->>'run_id')::uuid));

-- Incremental: triggers enqueue only evidence-key changes.
UPDATE vehicle_images SET caption = 'x' WHERE vehicle_id = '00000000-0000-0000-0000-0000000000a4';
SELECT pg_temp.ok('non-evidence image update does not enqueue', (SELECT count(*) = 0 FROM vehicle_support_dirty));
INSERT INTO vehicle_images (vehicle_id, file_hash) VALUES ('00000000-0000-0000-0000-0000000000b5', 'own-b5');
SELECT pg_temp.ok('new photo enqueues its vehicle only',
  (SELECT array_agg(vehicle_id) = ARRAY['00000000-0000-0000-0000-0000000000b5']::uuid[] FROM vehicle_support_dirty));
UPDATE vehicles SET vin = 'WP0EB0910KS170002' WHERE id = '00000000-0000-0000-0000-0000000000b1';
SELECT pg_temp.ok('identity change enqueues', (SELECT count(*) = 2 FROM vehicle_support_dirty));
UPDATE vehicles SET vin = NULL WHERE id = '00000000-0000-0000-0000-0000000000b1';
INSERT INTO vehicle_documents (vehicle_id, document_type) VALUES ('00000000-0000-0000-0000-0000000000b8', 'title');
UPDATE vehicle_events SET source_listing_id = 'x' WHERE vehicle_id = '00000000-0000-0000-0000-0000000000b3';
SELECT pg_temp.ok('document and event changes enqueue', (SELECT count(*) = 4 FROM vehicle_support_dirty));

-- Drain mode recomputes the dirty slice plus one hop of neighbours; dry run keeps the queue.
CREATE TEMP TABLE r4 AS SELECT vehicle_support_run() AS j;
SELECT pg_temp.ok('drain dry run keeps the queue', (SELECT j->>'status' = 'dry_run' FROM r4) AND (SELECT count(*) = 4 FROM vehicle_support_dirty));
SELECT pg_temp.ok('drain evaluates seed + neighbours only (not the whole table)',
  (SELECT (j->>'evaluated')::int BETWEEN 5 AND 8 FROM r4));
SELECT pg_temp.ok('b5 with its own photo is supported again',
  (SELECT decision = 'supported' FROM vehicle_support_scores WHERE run_id = ((SELECT j FROM r4)->>'run_id')::uuid
      AND vehicle_id = '00000000-0000-0000-0000-0000000000b5'));
CREATE TEMP TABLE r5 AS SELECT vehicle_support_run(p_dry_run => false) AS j;
SELECT pg_temp.ok('applied drain clears its seeds', (SELECT count(*) = 0 FROM vehicle_support_dirty));
SELECT pg_temp.ok('b1 dissolved via drain (neighbour of a1)', (SELECT derived_status = 'dissolved' FROM vehicles WHERE id = '00000000-0000-0000-0000-0000000000b1'));

-- Restore when evidence becomes independent again.
INSERT INTO vehicle_images (vehicle_id, file_hash) VALUES ('00000000-0000-0000-0000-0000000000b1', 'own-b1');
CREATE TEMP TABLE r6 AS SELECT vehicle_support_run(p_dry_run => false) AS j;
SELECT pg_temp.ok('regained evidence restores the profile',
  (SELECT (j->>'restore')::int = 1 FROM r6) AND (SELECT derived_status IS NULL FROM vehicles WHERE id = '00000000-0000-0000-0000-0000000000b1'));

-- Privileges.
SELECT pg_temp.ok('anon cannot run the producer', NOT has_function_privilege('anon', 'public.vehicle_support_run(uuid[], boolean, integer, integer, text)', 'EXECUTE'));
SELECT pg_temp.ok('authenticated cannot revert', NOT has_function_privilege('authenticated', 'public.vehicle_support_revert_run(uuid, text)', 'EXECUTE'));
SELECT pg_temp.ok('service_role can run', has_function_privilege('service_role', 'public.vehicle_support_run(uuid[], boolean, integer, integer, text)', 'EXECUTE'));
SELECT pg_temp.ok('anon cannot read the queue', NOT has_table_privilege('anon', 'public.vehicle_support_dirty', 'SELECT'));
