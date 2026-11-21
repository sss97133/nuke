-- Isolated PostgreSQL 17 contract for 20261121224500_approve_vehicle_merge_proposal_writer.sql. Synthetic rows only; never production.
-- Run in an empty, disposable dm_refinement_* database from the repo root:
--   createdb dm_refinement_approve_merge
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_approve_merge -f supabase/sql/test_approve_vehicle_merge_proposal_contract.sql
-- Proof: the service role moves an open proposal to approved with reviewer, time and note, and the row then satisfies
-- merge_into_primary's Gate 2 predicate exactly; a second approval by the same reviewer is a no-op; a signed-in caller who
-- cannot edit both vehicles, a caller approving as someone else, and anon are refused (by the body as well as the grant);
-- rejected, merged and unmerged rows, a blank note, a different named approver and a merged vehicle are refused; no vehicle
-- is touched.
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

-- auth.role() / auth.uid() read test settings, so one session can act as service_role, authenticated or anon.
CREATE SCHEMA auth;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.role', true), '') $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;
-- the SQLSTATE a statement raises, or NULL when it succeeds
CREATE FUNCTION pg_temp.raises(stmt text) RETURNS text LANGUAGE plpgsql AS $$ BEGIN
  EXECUTE stmt; RETURN NULL;
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.raises(text) TO anon, authenticated;

CREATE TABLE public.vehicles (id uuid PRIMARY KEY, status text, deleted_at timestamptz, user_id uuid);
CREATE TABLE public.vehicle_merge_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), primary_vehicle_id uuid NOT NULL, duplicate_vehicle_id uuid NOT NULL,
  match_type text NOT NULL DEFAULT 'manual_merge', confidence_score integer NOT NULL DEFAULT 90, status text NOT NULL DEFAULT 'detected',
  requires_approval_from uuid, reviewed_by uuid, reviewed_at timestamptz, review_notes text,
  merged_at timestamptz, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  UNIQUE (primary_vehicle_id, duplicate_vehicle_id),
  CONSTRAINT vehicle_merge_proposals_status_check CHECK (status = ANY (ARRAY['detected','proposed','approved','rejected','merged','auto_merged','unmerged'])));
-- The live helper also reads contributors, roles and organizations; owning both rows is enough for this contract.
CREATE FUNCTION public.user_can_edit_vehicle(p_vehicle_id uuid, p_user_id uuid) RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT EXISTS (SELECT 1 FROM public.vehicles WHERE id = p_vehicle_id AND user_id = p_user_id) $$;

\i supabase/migrations/20261121224500_approve_vehicle_merge_proposal_writer.sql

\set OWNER '''00000000-0000-0000-0000-00000000f001'''
\set OTHER '''00000000-0000-0000-0000-00000000f002'''
INSERT INTO vehicles (id, status, deleted_at, user_id) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'active', NULL, :OWNER), ('00000000-0000-0000-0000-0000000000d1', 'active', NULL, :OWNER),
  ('00000000-0000-0000-0000-0000000000a2', 'active', NULL, :OWNER), ('00000000-0000-0000-0000-0000000000d2', 'active', NULL, :OWNER),
  ('00000000-0000-0000-0000-0000000000a3', 'active', NULL, :OWNER), ('00000000-0000-0000-0000-0000000000d3', 'merged', now(), :OWNER),
  ('00000000-0000-0000-0000-0000000000a4', 'active', NULL, :OWNER), ('00000000-0000-0000-0000-0000000000d4', 'active', NULL, :OTHER);
INSERT INTO vehicle_merge_proposals (id, primary_vehicle_id, duplicate_vehicle_id, status, requires_approval_from) VALUES
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', 'proposed', :OWNER),
  ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000d2', 'detected', NULL),
  ('00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d2', 'rejected', NULL),
  ('00000000-0000-0000-0000-000000000104', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000d1', 'merged', NULL),
  ('00000000-0000-0000-0000-000000000105', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a2', 'unmerged', NULL),
  ('00000000-0000-0000-0000-000000000106', '00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000d3', 'proposed', NULL),
  ('00000000-0000-0000-0000-000000000107', '00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000d4', 'proposed', NULL);
CREATE TABLE pg_temp.before_vehicles AS SELECT * FROM public.vehicles;

-- Gate 2 of merge_into_primary, verbatim, for a pair.
CREATE FUNCTION pg_temp.gate2(p uuid, d uuid) RETURNS boolean LANGUAGE sql AS $$
  SELECT EXISTS (SELECT 1 FROM vehicle_merge_proposals
                  WHERE ((primary_vehicle_id = p AND duplicate_vehicle_id = d) OR (primary_vehicle_id = d AND duplicate_vehicle_id = p))
                    AND status = 'approved' AND reviewed_by IS NOT NULL) $$;

-- 1. anon: no grant, and the body refuses even when reached.
SELECT pg_temp.ok('anon has no EXECUTE; PUBLIC has none; authenticated and service_role do',
  NOT has_function_privilege('anon', 'approve_vehicle_merge_proposal(uuid,uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('public', 'approve_vehicle_merge_proposal(uuid,uuid,text)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'approve_vehicle_merge_proposal(uuid,uuid,text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'approve_vehicle_merge_proposal(uuid,uuid,text)', 'EXECUTE'));
SET ROLE anon;
SELECT set_config('test.role', 'anon', false), set_config('test.uid', '', false);
SELECT pg_temp.ok('anon calling over the API is refused (no privilege)',
  pg_temp.raises($q$SELECT approve_vehicle_merge_proposal('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-00000000f001', 'n')$q$) = '42501');
RESET ROLE;
SELECT pg_temp.ok('an anon JWT that reaches the body is refused there too',
  pg_temp.raises($q$SELECT approve_vehicle_merge_proposal('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-00000000f001', 'n')$q$) = '42501');

-- 2. authenticated callers.
SET ROLE authenticated;
SELECT set_config('test.role', 'authenticated', false), set_config('test.uid', '00000000-0000-0000-0000-00000000f002', false);
SELECT pg_temp.ok('a signed-in user who cannot edit both vehicles is refused',
  pg_temp.raises($q$SELECT approve_vehicle_merge_proposal('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-00000000f002', 'n')$q$) = '42501'
  AND pg_temp.raises($q$SELECT approve_vehicle_merge_proposal('00000000-0000-0000-0000-000000000107', '00000000-0000-0000-0000-00000000f002', 'n')$q$) = '42501');
SELECT pg_temp.ok('a signed-in user cannot approve in someone else''s name',
  pg_temp.raises($q$SELECT approve_vehicle_merge_proposal('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-00000000f001', 'n')$q$) = '42501');
SELECT set_config('test.uid', '00000000-0000-0000-0000-00000000f001', false);
SELECT pg_temp.ok('the editor of only one of the two vehicles is refused',
  pg_temp.raises($q$SELECT approve_vehicle_merge_proposal('00000000-0000-0000-0000-000000000107', '00000000-0000-0000-0000-00000000f001', 'n')$q$) = '42501');
SELECT pg_temp.ok('the signed-in reviewer who edits both vehicles may approve',
  (approve_vehicle_merge_proposal('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-00000000f001', 'approved in the app') ->> 'status') = 'approved');
RESET ROLE;
SELECT pg_temp.ok('nothing was approved by a refused call',
  (SELECT status FROM vehicle_merge_proposals WHERE id = '00000000-0000-0000-0000-000000000107') = 'proposed'
  AND (SELECT reviewed_by FROM vehicle_merge_proposals WHERE id = '00000000-0000-0000-0000-000000000107') IS NULL);

-- 3. service role: pending -> approved.
SELECT set_config('test.role', 'service_role', false), set_config('test.uid', '', false);
SELECT pg_temp.ok('before approval the pair fails Gate 2', NOT pg_temp.gate2('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1'));
CREATE TABLE pg_temp.first AS
  SELECT approve_vehicle_merge_proposal('00000000-0000-0000-0000-000000000101', :OWNER, '  owner approved in chat on 2026-11-21  ') AS r;
SELECT pg_temp.ok('service role moves a proposed row to approved with reviewer, time and trimmed note',
  (SELECT (r ->> 'already_approved')::boolean = false AND r ->> 'status' = 'approved' FROM pg_temp.first)
  AND (SELECT status = 'approved' AND reviewed_by = :OWNER AND reviewed_at IS NOT NULL AND updated_at >= reviewed_at
              AND review_notes = 'owner approved in chat on 2026-11-21'
         FROM vehicle_merge_proposals WHERE id = '00000000-0000-0000-0000-000000000101'));
SELECT pg_temp.ok('the approved row satisfies merge_into_primary Gate 2 in both call directions',
  pg_temp.gate2('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1')
  AND pg_temp.gate2('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1'));

-- 4. idempotence.
CREATE TABLE pg_temp.snap AS SELECT * FROM vehicle_merge_proposals WHERE id = '00000000-0000-0000-0000-000000000101';
SELECT pg_temp.ok('a second approval by the same reviewer is a no-op',
  (approve_vehicle_merge_proposal('00000000-0000-0000-0000-000000000101', :OWNER, 'again') ->> 'already_approved')::boolean
  AND (SELECT to_jsonb(p) FROM vehicle_merge_proposals p WHERE id = '00000000-0000-0000-0000-000000000101')
      = (SELECT to_jsonb(s) FROM pg_temp.snap s));
SELECT pg_temp.ok('an approved row is not re-approved by another reviewer',
  pg_temp.raises(format('SELECT approve_vehicle_merge_proposal(%L, %L, %L)', '00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-00000000f002', 'n')) IS NOT NULL);

-- 5. refusals.
SELECT pg_temp.ok('rejected, merged and unmerged rows are refused',
  pg_temp.raises(format('SELECT approve_vehicle_merge_proposal(%L, %L, %L)', '00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-00000000f001', 'n')) = '22023'
  AND pg_temp.raises(format('SELECT approve_vehicle_merge_proposal(%L, %L, %L)', '00000000-0000-0000-0000-000000000104', '00000000-0000-0000-0000-00000000f001', 'n')) = '22023'
  AND pg_temp.raises(format('SELECT approve_vehicle_merge_proposal(%L, %L, %L)', '00000000-0000-0000-0000-000000000105', '00000000-0000-0000-0000-00000000f001', 'n')) = '22023');
SELECT pg_temp.ok('a proposal with a merged or deleted vehicle is refused',
  pg_temp.raises(format('SELECT approve_vehicle_merge_proposal(%L, %L, %L)', '00000000-0000-0000-0000-000000000106', '00000000-0000-0000-0000-00000000f001', 'n')) = '22023');
SELECT pg_temp.ok('a blank note, a missing reviewer and a missing proposal are refused',
  pg_temp.raises(format('SELECT approve_vehicle_merge_proposal(%L, %L, %L)', '00000000-0000-0000-0000-000000000107', '00000000-0000-0000-0000-00000000f001', '  ')) = '22023'
  AND pg_temp.raises(format('SELECT approve_vehicle_merge_proposal(%L, NULL, %L)', '00000000-0000-0000-0000-000000000107', 'n')) = '22023'
  AND pg_temp.raises(format('SELECT approve_vehicle_merge_proposal(%L, %L, %L)', '00000000-0000-0000-0000-000000000999', '00000000-0000-0000-0000-00000000f001', 'n')) = 'P0002');
UPDATE vehicle_merge_proposals SET requires_approval_from = :OWNER WHERE id = '00000000-0000-0000-0000-000000000107';
SELECT pg_temp.ok('a proposal that names its approver refuses anyone else, even from the service role',
  pg_temp.raises(format('SELECT approve_vehicle_merge_proposal(%L, %L, %L)', '00000000-0000-0000-0000-000000000107', '00000000-0000-0000-0000-00000000f002', 'n')) = '42501');

SELECT pg_temp.ok('closed rows kept their status; no vehicle was touched',
  (SELECT array_agg(status ORDER BY id) FROM vehicle_merge_proposals WHERE id IN ('00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000104', '00000000-0000-0000-0000-000000000105', '00000000-0000-0000-0000-000000000106', '00000000-0000-0000-0000-000000000107'))
    = ARRAY['rejected', 'merged', 'unmerged', 'proposed', 'proposed']
  AND NOT EXISTS (SELECT 1 FROM public.vehicles v FULL JOIN pg_temp.before_vehicles b USING (id)
                   WHERE v.status IS DISTINCT FROM b.status OR v.deleted_at IS DISTINCT FROM b.deleted_at OR v.user_id IS DISTINCT FROM b.user_id));

SELECT pg_temp.ok('SECURITY DEFINER with a pinned search_path',
  (SELECT prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp'] FROM pg_proc WHERE proname = 'approve_vehicle_merge_proposal'));

\i supabase/migrations/20261121224500_approve_vehicle_merge_proposal_writer.sql
SELECT pg_temp.ok('a second run of the migration changes no row',
  (SELECT to_jsonb(p) FROM vehicle_merge_proposals p WHERE id = '00000000-0000-0000-0000-000000000101') = (SELECT to_jsonb(s) FROM pg_temp.snap s));
SELECT 'approve_vehicle_merge_proposal contract: PASS' AS result;
