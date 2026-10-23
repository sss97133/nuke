-- Disposable local PostgreSQL fixture only. Run from the repo root: scripts/ci/run-db-contracts.sh test_accounting_vehicle_photo_days.sql
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE public.vehicles(id uuid PRIMARY KEY, owner_id uuid, user_id uuid, deleted_at timestamptz, merged_into_vehicle_id uuid);
CREATE TABLE public.vehicle_images(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, taken_at timestamptz);
\ir ../migrations/20261024041000_accounting_vehicle_photo_days.sql
BEGIN;
-- Owner u: vehicles a..g. Another owner: x. A deleted (d) and a merged (m) profile of u's.
INSERT INTO vehicles(id, owner_id, user_id, deleted_at, merged_into_vehicle_id) VALUES
 ('00000000-0000-4000-8000-00000000000a','11111111-1111-4111-8111-111111111111',NULL,NULL,NULL),
 ('00000000-0000-4000-8000-00000000000b','11111111-1111-4111-8111-111111111111',NULL,NULL,NULL),
 ('00000000-0000-4000-8000-00000000000c',NULL,'11111111-1111-4111-8111-111111111111',NULL,NULL),
 ('00000000-0000-4000-8000-00000000000e','11111111-1111-4111-8111-111111111111',NULL,NULL,NULL),
 ('00000000-0000-4000-8000-00000000000f','11111111-1111-4111-8111-111111111111',NULL,NULL,NULL),
 ('00000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',NULL,NULL,NULL),
 ('00000000-0000-4000-8000-0000000000aa','22222222-2222-4222-8222-222222222222',NULL,NULL,NULL),
 ('00000000-0000-4000-8000-0000000000dd','11111111-1111-4111-8111-111111111111',NULL,now(),NULL),
 ('00000000-0000-4000-8000-0000000000ee','11111111-1111-4111-8111-111111111111',NULL,NULL,'00000000-0000-4000-8000-00000000000a');
-- Purchase on 2024-06-10. a: photographed on the 10th (twice) and the 12th; c (linked by user_id): the 9th.
-- b: the 15th (outside the window) and the 6th (outside). The 11th is a bulk day: five of u's vehicles photographed.
-- Another owner's vehicle and u's deleted and merged profiles are photographed on the 10th and never count.
INSERT INTO vehicle_images(vehicle_id, taken_at) VALUES
 ('00000000-0000-4000-8000-00000000000a','2024-06-10 15:00+00'),('00000000-0000-4000-8000-00000000000a','2024-06-10 16:00+00'),
 ('00000000-0000-4000-8000-00000000000a','2024-06-12 10:00+00'),
 ('00000000-0000-4000-8000-00000000000c','2024-06-09 23:30+00'),
 ('00000000-0000-4000-8000-00000000000b','2024-06-15 10:00+00'),('00000000-0000-4000-8000-00000000000b','2024-06-06 10:00+00'),
 ('00000000-0000-4000-8000-00000000000a','2024-06-11 09:00+00'),('00000000-0000-4000-8000-00000000000b','2024-06-11 09:00+00'),
 ('00000000-0000-4000-8000-00000000000c','2024-06-11 09:00+00'),('00000000-0000-4000-8000-00000000000e','2024-06-11 09:00+00'),
 ('00000000-0000-4000-8000-00000000000f','2024-06-11 09:00+00'),
 ('00000000-0000-4000-8000-0000000000aa','2024-06-10 12:00+00'),('00000000-0000-4000-8000-0000000000dd','2024-06-10 12:00+00'),
 ('00000000-0000-4000-8000-0000000000ee','2024-06-10 12:00+00'),
 ('00000000-0000-4000-8000-000000000001',NULL);
DO $$ DECLARE rows jsonb; BEGIN
 rows := (SELECT jsonb_agg(to_jsonb(x)) FROM accounting_vehicle_photo_days('11111111-1111-4111-8111-111111111111', date '2024-06-10') x);
 IF jsonb_array_length(rows) <> 2 THEN RAISE EXCEPTION 'expected the two vehicles photographed in the window: %', rows; END IF;
 IF rows->0->>'vehicle_id' <> '00000000-0000-4000-8000-00000000000a' OR rows->0->'photo_days' <> '["2024-06-10", "2024-06-12"]'::jsonb
    OR (rows->0->>'images')::int <> 3 THEN RAISE EXCEPTION 'most photographed vehicle first, bulk day left out: %', rows; END IF;
 IF rows->1->>'vehicle_id' <> '00000000-0000-4000-8000-00000000000c' OR rows->1->'photo_days' <> '["2024-06-09"]'::jsonb THEN
  RAISE EXCEPTION 'the day before counts, and a vehicle linked by user_id is the owner''s: %', rows; END IF;
 IF rows::text LIKE '%0000000000aa%' OR rows::text LIKE '%0000000000dd%' OR rows::text LIKE '%0000000000ee%' OR rows::text LIKE '%00000000000b%' THEN
  RAISE EXCEPTION 'another owner''s, deleted, merged or out-of-window vehicles leaked: %', rows; END IF;
 IF EXISTS (SELECT 1 FROM accounting_vehicle_photo_days('11111111-1111-4111-8111-111111111111', NULL)) THEN RAISE EXCEPTION 'no date, no suggestion'; END IF;
 IF EXISTS (SELECT 1 FROM accounting_vehicle_photo_days('11111111-1111-4111-8111-111111111111', date '2024-06-25')) THEN RAISE EXCEPTION 'nothing photographed, nothing suggested'; END IF;
 IF has_function_privilege('anon', 'public.accounting_vehicle_photo_days(uuid,date)', 'EXECUTE') THEN RAISE EXCEPTION 'anon must not call the reader'; END IF;
 IF NOT has_function_privilege('authenticated', 'public.accounting_vehicle_photo_days(uuid,date)', 'EXECUTE') THEN RAISE EXCEPTION 'signed-in reviewers call the reader'; END IF;
 IF (SELECT prosecdef FROM pg_proc WHERE proname = 'accounting_vehicle_photo_days') THEN RAISE EXCEPTION 'the reader must run with the caller''s policies'; END IF;
 RAISE NOTICE 'PASS accounting_vehicle_photo_days: owner''s live vehicles, D-1..D+3, bulk days left out, best first, signed-in only';
END $$;
ROLLBACK;
