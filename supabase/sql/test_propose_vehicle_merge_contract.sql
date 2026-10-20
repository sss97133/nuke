-- Isolated PostgreSQL 17 contract for 20261021180000_propose_vehicle_merge_writer.sql. Synthetic rows only; never production.
-- Run in an empty, disposable dm_refinement_* database from the repo root:
--   createdb dm_refinement_propose_merge
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_propose_merge -f supabase/sql/test_propose_vehicle_merge_contract.sql
-- Proof: the writer files one 'proposed' row with its evidence and approver, is idempotent per pair in either direction, does not
-- reopen a closed decision, refuses a proposal without evidence or with a merged, deleted or missing vehicle, never edits a
-- vehicle, and only service_role may call it.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty, disposable dm_refinement_* database';
  END IF;
END $$;
SET statement_timeout = '60s';
SET lock_timeout = '5s';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;
-- true when the statement raises
CREATE FUNCTION pg_temp.raises(stmt text) RETURNS boolean LANGUAGE plpgsql AS $$ BEGIN
  EXECUTE stmt; RETURN false;
EXCEPTION WHEN OTHERS THEN RETURN true;
END $$;

CREATE TABLE public.vehicles (id uuid PRIMARY KEY, status text, deleted_at timestamptz);
CREATE TABLE public.vehicle_merge_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), primary_vehicle_id uuid NOT NULL, duplicate_vehicle_id uuid NOT NULL,
  match_type text, confidence_score integer, match_reasoning jsonb, ai_summary text, recommended_primary uuid,
  recommendation_reason text, status text, visible_to_user_ids uuid[], requires_approval_from uuid, reviewed_by uuid,
  detected_at timestamptz, detected_by text, created_at timestamptz DEFAULT now(),
  UNIQUE (primary_vehicle_id, duplicate_vehicle_id),
  CONSTRAINT vehicle_merge_proposals_confidence_score_check CHECK (confidence_score >= 0 AND confidence_score <= 100),
  CONSTRAINT vehicle_merge_proposals_status_check CHECK (status = ANY (ARRAY['detected','proposed','approved','rejected','merged','auto_merged','unmerged'])));

\i supabase/migrations/20261021180000_propose_vehicle_merge_writer.sql

\set P '''00000000-0000-0000-0000-0000000000a1'''
\set D '''00000000-0000-0000-0000-0000000000d1'''
\set APPROVER '''00000000-0000-0000-0000-0000000000f1'''
INSERT INTO vehicles (id, status, deleted_at) VALUES
  (:P, 'active', NULL), (:D, 'active', NULL),
  ('00000000-0000-0000-0000-0000000000b1', 'merged', NULL), ('00000000-0000-0000-0000-0000000000b2', 'active', now()),
  ('00000000-0000-0000-0000-0000000000a2', 'active', NULL), ('00000000-0000-0000-0000-0000000000d2', 'active', NULL);

CREATE TABLE pg_temp.before_vehicles AS SELECT * FROM public.vehicles;
CREATE TABLE pg_temp.filed AS SELECT propose_vehicle_merge(:P, :D, 'manual_merge', 92, '{"case": "IC01", "witnesses": ["album 1980 K30", "99 shared photos items"]}'::jsonb,
  'same album, same sessions', 'the survivor holds the VIN and the money', :APPROVER) AS id;

SELECT pg_temp.ok('files one proposed row with the survivor, evidence, approver and writer',
  (SELECT count(*) FROM vehicle_merge_proposals) = 1
  AND (SELECT status = 'proposed' AND primary_vehicle_id = :P AND duplicate_vehicle_id = :D AND recommended_primary = :P
         AND match_type = 'manual_merge' AND confidence_score = 92 AND match_reasoning ->> 'case' = 'IC01'
         AND requires_approval_from = :APPROVER AND visible_to_user_ids = ARRAY[:APPROVER]::uuid[] AND reviewed_by IS NULL
         AND detected_by = 'propose_vehicle_merge' AND detected_at IS NOT NULL
         AND ai_summary = 'same album, same sessions' AND recommendation_reason = 'the survivor holds the VIN and the money'
       FROM vehicle_merge_proposals WHERE id = (SELECT id FROM pg_temp.filed)));

SELECT pg_temp.ok('the same pair again, in either direction, returns the open proposal and files nothing',
  propose_vehicle_merge(:P, :D, 'manual_merge', 50, '{"x": 1}'::jsonb) = (SELECT id FROM pg_temp.filed)
  AND propose_vehicle_merge(:D, :P, 'manual_merge', 50, '{"x": 1}'::jsonb) = (SELECT id FROM pg_temp.filed)
  AND (SELECT count(*) FROM vehicle_merge_proposals) = 1);

UPDATE vehicle_merge_proposals SET status = 'rejected' WHERE id = (SELECT id FROM pg_temp.filed);
SELECT pg_temp.ok('a rejected pair is not reopened by a filing: NULL, nothing filed',
  propose_vehicle_merge(:P, :D, 'manual_merge', 92, '{"x": 1}'::jsonb) IS NULL
  AND propose_vehicle_merge(:D, :P, 'manual_merge', 92, '{"x": 1}'::jsonb) IS NULL
  AND (SELECT count(*) FROM vehicle_merge_proposals) = 1);

SELECT set_config('app.writer', 'identity-cases-2026-10-20', false);
CREATE TABLE pg_temp.filed2 AS
  SELECT propose_vehicle_merge('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000d2', 'manual_merge', 70, '{"w": "x"}'::jsonb) AS id;
SELECT pg_temp.ok('without an approver the row carries none and no visibility list; app.writer names the filer',
  (SELECT id FROM pg_temp.filed2) IS NOT NULL
  AND (SELECT requires_approval_from IS NULL AND visible_to_user_ids IS NULL AND detected_by = 'identity-cases-2026-10-20'
         FROM vehicle_merge_proposals WHERE id = (SELECT id FROM pg_temp.filed2)));

SELECT pg_temp.ok('refused: the same vehicle twice',
  pg_temp.raises(format('SELECT propose_vehicle_merge(%L, %L, ''manual_merge'', 90, ''{"a":1}''::jsonb)', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1')));
SELECT pg_temp.ok('refused: no evidence (NULL, empty object, a non-object)',
  pg_temp.raises(format('SELECT propose_vehicle_merge(%L, %L, ''manual_merge'', 90, NULL)', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b9'))
  AND pg_temp.raises(format('SELECT propose_vehicle_merge(%L, %L, ''manual_merge'', 90, ''{}''::jsonb)', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d2'))
  AND pg_temp.raises(format('SELECT propose_vehicle_merge(%L, %L, ''manual_merge'', 90, ''["a"]''::jsonb)', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d2')));
SELECT pg_temp.ok('refused: an empty match_type and a confidence outside 0 to 100',
  pg_temp.raises(format('SELECT propose_vehicle_merge(%L, %L, '' '', 90, ''{"a":1}''::jsonb)', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d2'))
  AND pg_temp.raises(format('SELECT propose_vehicle_merge(%L, %L, ''manual_merge'', 101, ''{"a":1}''::jsonb)', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d2'))
  AND pg_temp.raises(format('SELECT propose_vehicle_merge(%L, %L, ''manual_merge'', -1, ''{"a":1}''::jsonb)', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d2')));
SELECT pg_temp.ok('refused: a merged, a deleted and a missing vehicle',
  pg_temp.raises(format('SELECT propose_vehicle_merge(%L, %L, ''manual_merge'', 90, ''{"a":1}''::jsonb)', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1'))
  AND pg_temp.raises(format('SELECT propose_vehicle_merge(%L, %L, ''manual_merge'', 90, ''{"a":1}''::jsonb)', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000d2'))
  AND pg_temp.raises(format('SELECT propose_vehicle_merge(%L, %L, ''manual_merge'', 90, ''{"a":1}''::jsonb)', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e9')));
SELECT pg_temp.ok('a refused call files nothing', (SELECT count(*) FROM vehicle_merge_proposals) = 2);

SELECT pg_temp.ok('no vehicle was edited, merged or approved by any filing',
  NOT EXISTS (SELECT 1 FROM public.vehicles v FULL JOIN pg_temp.before_vehicles b USING (id)
               WHERE v.status IS DISTINCT FROM b.status OR v.deleted_at IS DISTINCT FROM b.deleted_at)
  AND NOT EXISTS (SELECT 1 FROM vehicle_merge_proposals WHERE status IN ('approved', 'merged', 'auto_merged') OR reviewed_by IS NOT NULL));

SELECT pg_temp.ok('service_role may call it; anon, authenticated and PUBLIC may not; SECURITY DEFINER with a pinned search_path',
  has_function_privilege('service_role', 'propose_vehicle_merge(uuid,uuid,text,integer,jsonb,text,text,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'propose_vehicle_merge(uuid,uuid,text,integer,jsonb,text,text,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'propose_vehicle_merge(uuid,uuid,text,integer,jsonb,text,text,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('public', 'propose_vehicle_merge(uuid,uuid,text,integer,jsonb,text,text,uuid)', 'EXECUTE')
  AND (SELECT prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp'] FROM pg_proc WHERE proname = 'propose_vehicle_merge'));

\i supabase/migrations/20261021180000_propose_vehicle_merge_writer.sql
SELECT pg_temp.ok('a second run of the migration is a no-op', (SELECT count(*) FROM vehicle_merge_proposals) = 2);
SELECT 'propose_vehicle_merge contract: PASS' AS result;
