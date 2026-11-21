-- Isolated PostgreSQL 17 contract for 20261121231500_correct_work_order_vehicle_writer.sql. Synthetic rows only; never production.
-- Run in an empty, disposable dm_refinement_* database from the repo root:
--   createdb dm_refinement_wo_vehicle
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_wo_vehicle -f supabase/sql/test_correct_work_order_vehicle.sql
-- Proof: the service role moves a work order for an actor tied to both vehicles, writing one journal row (old/new vehicle,
-- reason, evidence, actor, the metadata keys as they were) and rewriting only vehicle_id and the four vehicle metadata keys; the
-- undo is the same call pointed back and names the first row; anon, other roles, a signed-in caller acting as someone else
-- or unable to edit both vehicles, and an actor not tied to both are refused; a blank reason, empty evidence, a no-op move,
-- a missing / merged / deleted target, a requested job, a parent/child pair and every class of row bound to the current
-- vehicle are refused and change nothing; read-through rows follow the move unchanged; the journal stays append-only and
-- its earlier totals rows still pass the widened checks; the live work_orders triggers run unchanged.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR to_regclass('public.work_orders') IS NOT NULL THEN
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

-- Live shapes (columns this writer and the live triggers read), 2026-11-21.
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, status text, merged_into_vehicle_id uuid, deleted_at timestamptz, user_id uuid);
CREATE TABLE public.vehicle_access (vehicle_id uuid, user_id uuid);
CREATE TABLE public.work_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, customer_id uuid, title text NOT NULL DEFAULT 'job',
  status text DEFAULT 'pending', scope_category text, estimated_labor_cost numeric, estimated_parts_cost numeric,
  estimated_total numeric, estimated_cost_cents integer, actual_labor_cost numeric, actual_parts_cost numeric, actual_total numeric,
  metadata jsonb DEFAULT '{}'::jsonb, parent_work_order_id uuid REFERENCES public.work_orders(id), request_observation_id uuid,
  request_visibility text, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
GRANT SELECT ON public.work_orders TO authenticated;  -- as live
CREATE TABLE public.vehicle_observations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, kind text,
  source_identifier text, extraction_method text, is_superseded boolean DEFAULT false, ingested_at timestamptz DEFAULT now(),
  submitted_by_user_id uuid, structured_data jsonb);
CREATE TABLE public.timeline_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, work_order_id uuid);
CREATE TABLE public.component_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, work_order_id uuid);
CREATE TABLE public.financial_vehicle_uses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, work_order_id uuid);
CREATE TABLE public.parts_transfers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), dest_vehicle_id uuid, dest_work_order_id uuid);
CREATE TABLE public.vehicle_build_manifest (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid);
CREATE TABLE public.work_order_line_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), work_order_id uuid, component_table text, component_id uuid);
CREATE TABLE public.work_order_labor (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), work_order_id uuid, hours numeric, hourly_rate numeric, total_cost numeric);
CREATE TABLE public.work_order_parts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), work_order_id uuid, part_name text, unit_price numeric, total_price numeric);
CREATE TABLE public.work_order_payments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), work_order_id uuid, status text);
CREATE TABLE public.work_order_quotes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), work_order_id uuid);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['work_order_quote_acceptances', 'work_order_invoices', 'work_order_payment_witnesses',
      'work_order_processor_payments', 'work_order_work_starts', 'work_order_completion_attestations',
      'work_order_completion_acceptances', 'work_order_evidence_attachments', 'work_order_resource_requirements',
      'work_order_retained_testimony', 'work_order_retained_source_bindings'] LOOP
    EXECUTE format('CREATE TABLE public.%I (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), work_order_id uuid)', t);
  END LOOP;
END $$;
CREATE TABLE public.pipeline_registry (id uuid DEFAULT gen_random_uuid(), table_name text, column_name text, owned_by text,
  description text, do_not_write_directly boolean, write_via text, UNIQUE (table_name, column_name));

-- The live helpers read many more relations; a user_id / access row is enough for this contract.
CREATE FUNCTION public.user_can_edit_vehicle(p_vehicle_id uuid, p_user_id uuid) RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT EXISTS (SELECT 1 FROM public.vehicles WHERE id = p_vehicle_id AND user_id = p_user_id) $$;
CREATE FUNCTION public.vehicle_user_has_access(p_vehicle_id uuid, p_user_id uuid) RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT public.user_can_edit_vehicle(p_vehicle_id, p_user_id)
       OR EXISTS (SELECT 1 FROM public.vehicle_access WHERE vehicle_id = p_vehicle_id AND user_id = p_user_id) $$;

-- Both live work_orders BEFORE triggers, verbatim (pg_get_functiondef, 2026-11-21).
CREATE OR REPLACE FUNCTION public.calculate_work_order_estimate()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.estimated_labor_cost IS NOT NULL OR NEW.estimated_parts_cost IS NOT NULL THEN
    NEW.estimated_total := COALESCE(NEW.estimated_labor_cost, 0) + COALESCE(NEW.estimated_parts_cost, 0);
  END IF;
  IF NEW.actual_labor_cost IS NOT NULL OR NEW.actual_parts_cost IS NOT NULL THEN
    NEW.actual_total := COALESCE(NEW.actual_labor_cost, 0) + COALESCE(NEW.actual_parts_cost, 0);
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.work_order_link_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.request_visibility IS DISTINCT FROM OLD.request_visibility AND NEW.request_visibility IS NOT NULL
        AND (NEW.parent_work_order_id, NEW.request_observation_id, NEW.vehicle_id)
          IS NOT DISTINCT FROM (OLD.parent_work_order_id, OLD.request_observation_id, OLD.vehicle_id)
        AND EXISTS (SELECT 1 FROM public.vehicle_observations o WHERE o.source_identifier = 'work_order_publication:' || NEW.id::text
          AND o.extraction_method = 'work_order_publication_sign_v1' AND o.is_superseded IS FALSE AND o.ingested_at = now()
          AND o.structured_data#>>'{work_order_publication,visibility}' = NEW.request_visibility) THEN
      RETURN NEW;
    END IF;
    IF (NEW.parent_work_order_id, NEW.request_observation_id, NEW.request_visibility)
        IS DISTINCT FROM (OLD.parent_work_order_id, OLD.request_observation_id, OLD.request_visibility)
      OR (OLD.request_observation_id IS NOT NULL AND NEW.vehicle_id IS DISTINCT FROM OLD.vehicle_id) THEN
      RAISE EXCEPTION 'Work order links, visibility, and the vehicle of a requested job, are immutable';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.parent_work_order_id IS NULL AND NEW.request_observation_id IS NULL AND NEW.request_visibility IS NULL THEN RETURN NEW; END IF;
  IF NEW.parent_work_order_id IS NULL AND NEW.request_observation_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.vehicle_observations o
      WHERE o.id = NEW.request_observation_id AND o.kind::text = 'work_record' AND o.is_superseded IS FALSE
        AND o.vehicle_id = NEW.vehicle_id AND o.extraction_method = 'work_request_sign_v1'
        AND o.submitted_by_user_id IS NOT DISTINCT FROM NEW.customer_id
        AND o.structured_data#>>'{work_request,work_order_id}' = NEW.id::text
        AND o.structured_data#>>'{work_request,visibility}' IS NOT DISTINCT FROM NEW.request_visibility)
    AND NEW.scope_category IS DISTINCT FROM 'inspection' AND NEW.request_visibility IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.request_visibility IS NOT NULL OR NOT EXISTS (SELECT 1 FROM public.vehicle_observations o
      WHERE o.id = NEW.request_observation_id AND o.kind::text = 'work_record' AND o.is_superseded IS FALSE
        AND o.vehicle_id = NEW.vehicle_id AND o.extraction_method = 'inspection_request_sign_v1'
        AND o.submitted_by_user_id IS NOT DISTINCT FROM NEW.customer_id
        AND o.structured_data#>>'{inspection_request,work_order_id}' = NEW.id::text
        AND o.structured_data#>>'{inspection_request,parent_work_order_id}' IS NOT DISTINCT FROM NEW.parent_work_order_id::text)
    OR NEW.scope_category IS DISTINCT FROM 'inspection'
    OR (NEW.parent_work_order_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.work_orders p
      WHERE p.id = NEW.parent_work_order_id AND p.vehicle_id = NEW.vehicle_id)) THEN
    RAISE EXCEPTION 'A parent link needs the inspection request Sign for the same vehicle; visibility needs the work request Sign';
  END IF;
  RETURN NEW;
END $function$;
CREATE TRIGGER trg_calculate_work_order_estimate BEFORE INSERT OR UPDATE ON public.work_orders FOR EACH ROW EXECUTE FUNCTION public.calculate_work_order_estimate();
CREATE TRIGGER work_order_link_guard BEFORE INSERT OR UPDATE ON public.work_orders FOR EACH ROW EXECUTE FUNCTION public.work_order_link_guard();

\set OWNER '''00000000-0000-0000-0000-00000000f001'''
\set OTHER '''00000000-0000-0000-0000-00000000f002'''
\set CLIENT '''00000000-0000-0000-0000-00000000f003'''
-- a1 build (owner edits), a2 client's trade-in (owner has access only, like the live case), a3 owner's, a4 a stranger's,
-- m1 merged, d1 deleted.
INSERT INTO vehicles (id, status, merged_into_vehicle_id, deleted_at, user_id) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'active', NULL, NULL, :OWNER),
  ('00000000-0000-0000-0000-0000000000a2', 'active', NULL, NULL, :CLIENT),
  ('00000000-0000-0000-0000-0000000000a3', 'active', NULL, NULL, :OWNER),
  ('00000000-0000-0000-0000-0000000000a4', 'active', NULL, NULL, :OTHER),
  ('00000000-0000-0000-0000-0000000000b1', 'merged', '00000000-0000-0000-0000-0000000000a1', NULL, :OWNER),
  ('00000000-0000-0000-0000-0000000000b2', 'active', NULL, now(), :OWNER);
INSERT INTO vehicle_access (vehicle_id, user_id) VALUES ('00000000-0000-0000-0000-0000000000a2', :OWNER);

-- w1: the case (an agreement moved by hand onto the trade-in, metadata keys written by hand, priced estimate).
-- w0: a totals row for 20261020000500 to journal before the new checks land.
INSERT INTO work_orders (id, vehicle_id, title, status, estimated_labor_cost, estimated_parts_cost, estimated_total, actual_total, metadata) VALUES
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a2', 'build agreement', 'quoted', 100, 50, 150, NULL,
   jsonb_build_object('vehicle_id_old', '00000000-0000-0000-0000-0000000000a1', 'vehicle_id_new', '00000000-0000-0000-0000-0000000000a2',
     'vehicle_id_corrected_at', '2026-04-29', 'correction_source', 'session_verbal', 'job_ref', 'kept')),
  ('00000000-0000-0000-0000-0000000000e0', '00000000-0000-0000-0000-0000000000a3', 'invented zeros', 'pending', NULL, NULL, 0, 0, '{}');
-- read-through rows on w1 (no vehicle column of their own)
INSERT INTO work_order_parts (work_order_id, part_name, unit_price, total_price) VALUES ('00000000-0000-0000-0000-0000000000e1', 'kit', 10, 10);
INSERT INTO work_order_labor (work_order_id, hours, hourly_rate, total_cost) VALUES ('00000000-0000-0000-0000-0000000000e1', 1, 10, 10);
INSERT INTO work_order_line_items (work_order_id, component_table, component_id) VALUES ('00000000-0000-0000-0000-0000000000e1', 'other', gen_random_uuid());
-- rows the guard must refuse on (one work order per class), each on vehicle a3 and moving to a1
INSERT INTO work_orders (id, vehicle_id, title) SELECT ('00000000-0000-0000-0000-0000000001' || lpad(g::text, 2, '0'))::uuid,
  '00000000-0000-0000-0000-0000000000a3', 'held ' || g FROM generate_series(1, 9) g;
INSERT INTO timeline_events (vehicle_id, work_order_id) VALUES ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000101');
INSERT INTO component_events (vehicle_id, work_order_id) VALUES ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000102');
INSERT INTO financial_vehicle_uses (vehicle_id, work_order_id) VALUES ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000103');
INSERT INTO parts_transfers (dest_vehicle_id, dest_work_order_id) VALUES ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000104');
INSERT INTO vehicle_build_manifest (id, vehicle_id) VALUES ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a3');
INSERT INTO work_order_line_items (work_order_id, component_table, component_id) VALUES ('00000000-0000-0000-0000-000000000105', 'vehicle_build_manifest', '00000000-0000-0000-0000-0000000000c1');
INSERT INTO vehicle_observations (vehicle_id, kind, source_identifier) VALUES ('00000000-0000-0000-0000-0000000000a3', 'work_record', 'work_order_start:00000000-0000-0000-0000-000000000106');
INSERT INTO work_order_quotes (work_order_id) VALUES ('00000000-0000-0000-0000-000000000107');
INSERT INTO work_order_payments (work_order_id, status) VALUES ('00000000-0000-0000-0000-000000000108', 'completed');
INSERT INTO work_order_invoices (work_order_id) VALUES ('00000000-0000-0000-0000-000000000109');
-- a requested job, and a parent with an inspection child, each with the request Sign the live guard demands on INSERT
INSERT INTO vehicle_observations (id, vehicle_id, kind, extraction_method, structured_data) VALUES
  ('00000000-0000-0000-0000-0000000002f1', '00000000-0000-0000-0000-0000000000a3', 'work_record', 'work_request_sign_v1',
   '{"work_request": {"work_order_id": "00000000-0000-0000-0000-000000000201", "visibility": "public"}}'),
  ('00000000-0000-0000-0000-0000000002f3', '00000000-0000-0000-0000-0000000000a3', 'work_record', 'inspection_request_sign_v1',
   '{"inspection_request": {"work_order_id": "00000000-0000-0000-0000-000000000203", "parent_work_order_id": "00000000-0000-0000-0000-000000000202"}}');
INSERT INTO work_orders (id, vehicle_id, title, request_observation_id, request_visibility) VALUES
  ('00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-0000000000a3', 'requested', '00000000-0000-0000-0000-0000000002f1', 'public'),
  ('00000000-0000-0000-0000-000000000202', '00000000-0000-0000-0000-0000000000a3', 'parent', NULL, NULL);
INSERT INTO work_orders (id, vehicle_id, title, parent_work_order_id, request_observation_id, scope_category) VALUES
  ('00000000-0000-0000-0000-000000000203', '00000000-0000-0000-0000-0000000000a3', 'inspection', '00000000-0000-0000-0000-000000000202',
   '00000000-0000-0000-0000-0000000002f3', 'inspection');

-- The table as 20261020000500 made it, with one totals row, then the writer.
\ir ../migrations/20261020000500_work_order_invented_zero_totals.sql
SELECT pg_temp.ok('the earlier migration journaled its totals rows', (SELECT count(*) FROM work_order_scalar_corrections) = 2);
\ir ../migrations/20261121231500_correct_work_order_vehicle_writer.sql
SELECT pg_temp.ok('existing totals rows pass the widened checks and keep their values',
  (SELECT count(*) FROM work_order_scalar_corrections WHERE column_name IN ('estimated_total', 'actual_total')
     AND reason = 'invented_zero_no_priced_basis' AND old_value = 0 AND new_value IS NULL AND old_ref IS NULL) = 2);
SELECT pg_temp.ok('registry names the writer',
  (SELECT write_via FROM pipeline_registry WHERE table_name = 'work_order_scalar_corrections') LIKE '%correct_work_order_vehicle%');

CREATE TABLE pg_temp.before_wo AS SELECT * FROM work_orders;
CREATE TABLE pg_temp.before_parts AS SELECT * FROM work_order_parts;
\set W1 '''00000000-0000-0000-0000-0000000000e1'''
\set EV '''{"prior_correction": "work order metadata: hand correction 2026-04-29", "document": "agreement sheet names the build"}'''

-- 1. grants and refused callers.
SELECT pg_temp.ok('PUBLIC and anon have no EXECUTE; authenticated and service_role do',
  NOT has_function_privilege('anon', 'correct_work_order_vehicle(uuid,uuid,text,jsonb,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('public', 'correct_work_order_vehicle(uuid,uuid,text,jsonb,uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'correct_work_order_vehicle(uuid,uuid,text,jsonb,uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'correct_work_order_vehicle(uuid,uuid,text,jsonb,uuid)', 'EXECUTE'));
SELECT pg_temp.ok('SECURITY DEFINER with a pinned search_path',
  (SELECT prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp'] FROM pg_proc WHERE proname = 'correct_work_order_vehicle'));
SET ROLE anon;
SELECT set_config('test.role', 'anon', false), set_config('test.uid', '', false);
SELECT pg_temp.ok('anon over the API is refused (no privilege)',
  pg_temp.raises(format('SELECT correct_work_order_vehicle(%L, %L, %L, %L, %L)', :W1, '00000000-0000-0000-0000-0000000000a1', 'a reason long enough', :EV, :OWNER)) = '42501');
RESET ROLE;
SELECT pg_temp.ok('an anon JWT that reaches the body is refused there',
  pg_temp.raises(format('SELECT correct_work_order_vehicle(%L, %L, %L, %L, %L)', :W1, '00000000-0000-0000-0000-0000000000a1', 'a reason long enough', :EV, :OWNER)) = '42501');
SELECT set_config('test.role', '', false);
SELECT pg_temp.ok('a caller with no API role (a direct connection) is refused: fail closed',
  pg_temp.raises(format('SELECT correct_work_order_vehicle(%L, %L, %L, %L, %L)', :W1, '00000000-0000-0000-0000-0000000000a1', 'a reason long enough', :EV, :OWNER)) = '42501');

SET ROLE authenticated;
SELECT set_config('test.role', 'authenticated', false), set_config('test.uid', '00000000-0000-0000-0000-00000000f002', false);
SELECT pg_temp.ok('a signed-in user acting in someone else''s name is refused',
  pg_temp.raises(format('SELECT correct_work_order_vehicle(%L, %L, %L, %L, %L)', :W1, '00000000-0000-0000-0000-0000000000a1', 'a reason long enough', :EV, :OWNER)) = '42501');
SELECT pg_temp.ok('a signed-in user who edits neither vehicle is refused',
  pg_temp.raises(format('SELECT correct_work_order_vehicle(%L, %L, %L, %L, %L)', :W1, '00000000-0000-0000-0000-0000000000a1', 'a reason long enough', :EV, :OTHER)) = '42501');
SELECT pg_temp.ok('a signed-in stranger learns nothing: a missing work order, a no-op and a dead target all answer 42501',
  pg_temp.raises(format('SELECT correct_work_order_vehicle(%L, %L, %L, %L, %L)', '00000000-0000-0000-0000-000000000999', '00000000-0000-0000-0000-0000000000a4', 'a reason long enough', :EV, :OTHER)) = '42501'
  AND pg_temp.raises(format('SELECT correct_work_order_vehicle(%L, %L, %L, %L, %L)', :W1, '00000000-0000-0000-0000-0000000000a2', 'a reason long enough', :EV, :OTHER)) = '42501'
  AND pg_temp.raises(format('SELECT correct_work_order_vehicle(%L, %L, %L, %L, %L)', :W1, '00000000-0000-0000-0000-0000000000b2', 'a reason long enough', :EV, :OTHER)) = '42501');
SELECT set_config('test.uid', '00000000-0000-0000-0000-00000000f001', false);
SELECT pg_temp.ok('a signed-in user who edits the target but only has access to the current vehicle is refused',
  pg_temp.raises(format('SELECT correct_work_order_vehicle(%L, %L, %L, %L, %L)', :W1, '00000000-0000-0000-0000-0000000000a1', 'a reason long enough', :EV, :OWNER)) = '42501');
RESET ROLE;
SELECT pg_temp.ok('refused calls wrote nothing',
  (SELECT count(*) FROM work_order_scalar_corrections WHERE column_name = 'vehicle_id') = 0
  AND (SELECT vehicle_id FROM work_orders WHERE id = :W1) = '00000000-0000-0000-0000-0000000000a2');

-- 2. service role: argument refusals.
SELECT set_config('test.role', 'service_role', false), set_config('test.uid', '', false);
SELECT pg_temp.ok('an actor not tied to both vehicles is refused',
  pg_temp.raises(format('SELECT correct_work_order_vehicle(%L, %L, %L, %L, %L)', :W1, '00000000-0000-0000-0000-0000000000a1', 'a reason long enough', :EV, :OTHER)) = '42501');
SELECT pg_temp.ok('a blank or short reason, empty or non-object evidence and no actor are refused',
  pg_temp.raises(format('SELECT correct_work_order_vehicle(%L, %L, %L, %L, %L)', :W1, '00000000-0000-0000-0000-0000000000a1', '   ', :EV, :OWNER)) = '22023'
  AND pg_temp.raises(format('SELECT correct_work_order_vehicle(%L, %L, %L, %L, %L)', :W1, '00000000-0000-0000-0000-0000000000a1', 'short', :EV, :OWNER)) = '22023'
  AND pg_temp.raises(format('SELECT correct_work_order_vehicle(%L, %L, %L, %L, %L)', :W1, '00000000-0000-0000-0000-0000000000a1', 'a reason long enough', '{}', :OWNER)) = '22023'
  AND pg_temp.raises(format('SELECT correct_work_order_vehicle(%L, %L, %L, %L, %L)', :W1, '00000000-0000-0000-0000-0000000000a1', 'a reason long enough', '["x"]', :OWNER)) = '22023'
  AND pg_temp.raises(format('SELECT correct_work_order_vehicle(%L, %L, %L, %L, NULL)', :W1, '00000000-0000-0000-0000-0000000000a1', 'a reason long enough', :EV)) = '22023');
SELECT pg_temp.ok('a missing work order, a no-op move and a missing, merged or deleted target are refused',
  pg_temp.raises(format('SELECT correct_work_order_vehicle(%L, %L, %L, %L, %L)', '00000000-0000-0000-0000-000000000999', '00000000-0000-0000-0000-0000000000a1', 'a reason long enough', :EV, :OWNER)) = 'P0002'
  AND pg_temp.raises(format('SELECT correct_work_order_vehicle(%L, %L, %L, %L, %L)', :W1, '00000000-0000-0000-0000-0000000000a2', 'a reason long enough', :EV, :OWNER)) = '22023'
  AND pg_temp.raises(format('SELECT correct_work_order_vehicle(%L, %L, %L, %L, %L)', :W1, '00000000-0000-0000-0000-0000000000ff', 'a reason long enough', :EV, :OWNER)) = '22023'
  AND pg_temp.raises(format('SELECT correct_work_order_vehicle(%L, %L, %L, %L, %L)', :W1, '00000000-0000-0000-0000-0000000000b1', 'a reason long enough', :EV, :OWNER)) = '22023'
  AND pg_temp.raises(format('SELECT correct_work_order_vehicle(%L, %L, %L, %L, %L)', :W1, '00000000-0000-0000-0000-0000000000b2', 'a reason long enough', :EV, :OWNER)) = '22023');

-- 3. derived-row refusals: each class of row bound to the current vehicle, a requested job, a parent and a child.
SELECT pg_temp.ok('every work order holding rows bound to its current vehicle is refused',
  (SELECT bool_and(pg_temp.raises(format('SELECT correct_work_order_vehicle(%L, %L, %L, %L, %L)', id,
      '00000000-0000-0000-0000-0000000000a1', 'a reason long enough', :EV, :OWNER)) = '22023')
     FROM work_orders WHERE title LIKE 'held %') AND (SELECT count(*) FROM work_orders WHERE title LIKE 'held %') = 9);
SELECT pg_temp.ok('a requested job, a parent and an inspection child are refused',
  pg_temp.raises(format('SELECT correct_work_order_vehicle(%L, %L, %L, %L, %L)', '00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-0000000000a1', 'a reason long enough', :EV, :OWNER)) = '22023'
  AND pg_temp.raises(format('SELECT correct_work_order_vehicle(%L, %L, %L, %L, %L)', '00000000-0000-0000-0000-000000000202', '00000000-0000-0000-0000-0000000000a1', 'a reason long enough', :EV, :OWNER)) = '22023'
  AND pg_temp.raises(format('SELECT correct_work_order_vehicle(%L, %L, %L, %L, %L)', '00000000-0000-0000-0000-000000000203', '00000000-0000-0000-0000-0000000000a1', 'a reason long enough', :EV, :OWNER)) = '22023');
DO $$ DECLARE m text; BEGIN
  PERFORM correct_work_order_vehicle('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-0000000000a1',
    'a reason long enough', '{"x": 1}', '00000000-0000-0000-0000-00000000f001');
  RAISE EXCEPTION 'Contract failed: held work order moved';
EXCEPTION WHEN invalid_parameter_value THEN
  GET STACKED DIAGNOSTICS m = MESSAGE_TEXT;
  IF m NOT LIKE '%"timeline_events": 1%' THEN RAISE EXCEPTION 'Contract failed: refusal does not name the table and count: %', m; END IF;
  RAISE NOTICE 'PASS the refusal names each holding table with its count';
END $$;
SELECT pg_temp.ok('refused calls changed no work order and wrote no journal row',
  (SELECT count(*) FROM work_order_scalar_corrections WHERE column_name = 'vehicle_id') = 0
  AND NOT EXISTS (SELECT 1 FROM work_orders w FULL JOIN pg_temp.before_wo b USING (id) WHERE to_jsonb(w) IS DISTINCT FROM to_jsonb(b)));

-- 4. the move.
CREATE TABLE pg_temp.first AS SELECT correct_work_order_vehicle(:W1, '00000000-0000-0000-0000-0000000000a1',
  '  The agreement belongs on the build; the 2026-04-29 hand correction put it on the trade-in.  ', :EV, :OWNER) AS r;
SELECT pg_temp.ok('the service role moves the work order for an actor tied to both vehicles',
  (SELECT r ->> 'status' = 'moved' AND r ->> 'from_vehicle_id' = '00000000-0000-0000-0000-0000000000a2'
          AND r ->> 'to_vehicle_id' = '00000000-0000-0000-0000-0000000000a1' AND r -> 'reverses_correction_id' = 'null'::jsonb FROM pg_temp.first)
  AND (SELECT vehicle_id FROM work_orders WHERE id = :W1) = '00000000-0000-0000-0000-0000000000a1');
SELECT pg_temp.ok('one journal row: old/new vehicle, trimmed reason, evidence, actor, writer, version and the metadata keys as they were',
  (SELECT count(*) FROM work_order_scalar_corrections WHERE column_name = 'vehicle_id') = 1
  AND (SELECT c.id = (f.r ->> 'correction_id')::uuid AND c.work_order_id = :W1 AND c.old_ref = '00000000-0000-0000-0000-0000000000a2'
         AND c.new_ref = '00000000-0000-0000-0000-0000000000a1' AND c.old_value IS NULL AND c.new_value IS NULL
         AND c.reason = 'The agreement belongs on the build; the 2026-04-29 hand correction put it on the trade-in.'
         AND c.evidence = :EV::jsonb AND c.actor_user_id = :OWNER AND c.writer = 'correct_work_order_vehicle'
         AND c.migration_version = '20261121231500' AND c.reverses_correction_id IS NULL
         AND c.metadata_before = jsonb_build_object('vehicle_id_old', '00000000-0000-0000-0000-0000000000a1',
           'vehicle_id_new', '00000000-0000-0000-0000-0000000000a2', 'vehicle_id_corrected_at', '2026-04-29', 'correction_source', 'session_verbal')
       FROM work_order_scalar_corrections c, pg_temp.first f WHERE c.column_name = 'vehicle_id'));
SELECT pg_temp.ok('vehicle metadata keys describe the new move and point at the journal; correction_source and other keys kept',
  (SELECT w.metadata ->> 'vehicle_id_old' = '00000000-0000-0000-0000-0000000000a2' AND w.metadata ->> 'vehicle_id_new' = '00000000-0000-0000-0000-0000000000a1'
          AND w.metadata ->> 'vehicle_id_correction_ref' = 'work_order_scalar_corrections:' || (f.r ->> 'correction_id')
          AND w.metadata ->> 'correction_source' = 'session_verbal'
          AND w.metadata ->> 'vehicle_id_corrected_at' ~ '^\d{4}-\d\d-\d\dT' AND w.metadata ->> 'job_ref' = 'kept'
     FROM work_orders w, pg_temp.first f WHERE w.id = :W1));
SELECT pg_temp.ok('only vehicle_id, metadata and updated_at changed; the estimate trigger left the totals as they were',
  (SELECT (to_jsonb(w) - ARRAY['vehicle_id', 'metadata', 'updated_at']) = (to_jsonb(b) - ARRAY['vehicle_id', 'metadata', 'updated_at'])
     FROM work_orders w JOIN pg_temp.before_wo b USING (id) WHERE w.id = :W1)
  AND NOT EXISTS (SELECT 1 FROM work_orders w JOIN pg_temp.before_wo b USING (id) WHERE w.id <> :W1 AND to_jsonb(w) <> to_jsonb(b)));
SELECT pg_temp.ok('read-through rows are untouched and now read on the new vehicle through the work order',
  NOT EXISTS (SELECT 1 FROM work_order_parts p FULL JOIN pg_temp.before_parts b USING (id) WHERE to_jsonb(p) IS DISTINCT FROM to_jsonb(b))
  AND (SELECT count(*) FROM work_order_parts p JOIN work_orders w ON w.id = p.work_order_id
        WHERE w.vehicle_id = '00000000-0000-0000-0000-0000000000a1') = 1);

-- 5. the undo: the same call pointed back.
CREATE TABLE pg_temp.undo AS SELECT correct_work_order_vehicle(:W1, '00000000-0000-0000-0000-0000000000a2',
  'Undo of the previous move, made to test the reversal.', '{"undo_of": "the previous correction"}', :OWNER) AS r;
SELECT pg_temp.ok('the undo moves it back and its row names the first correction',
  (SELECT vehicle_id FROM work_orders WHERE id = :W1) = '00000000-0000-0000-0000-0000000000a2'
  AND (SELECT (u.r ->> 'reverses_correction_id') = (f.r ->> 'correction_id') FROM pg_temp.undo u, pg_temp.first f)
  AND (SELECT c.reverses_correction_id = (f.r ->> 'correction_id')::uuid AND c.old_ref = '00000000-0000-0000-0000-0000000000a1'
         AND c.new_ref = '00000000-0000-0000-0000-0000000000a2'
         AND c.metadata_before ->> 'vehicle_id_correction_ref' = 'work_order_scalar_corrections:' || (f.r ->> 'correction_id')
       FROM work_order_scalar_corrections c, pg_temp.undo u, pg_temp.first f WHERE c.id = (u.r ->> 'correction_id')::uuid)
  AND (SELECT count(*) FROM work_order_scalar_corrections WHERE column_name = 'vehicle_id') = 2);
SELECT pg_temp.ok('a move to a third vehicle is not an undo',
  (correct_work_order_vehicle(:W1, '00000000-0000-0000-0000-0000000000a3', 'Moved to a third vehicle for the test.', '{"t": 1}', :OWNER)
     -> 'reverses_correction_id') = 'null'::jsonb);

-- 6. the signed-in path: an editor of both vehicles, as themself.
SET ROLE authenticated;
SELECT set_config('test.role', 'authenticated', false), set_config('test.uid', '00000000-0000-0000-0000-00000000f001', false);
CREATE TABLE pg_temp.signed AS
  SELECT correct_work_order_vehicle(:W1, '00000000-0000-0000-0000-0000000000a1', 'Signed-in editor moving it to the build.', '{"t": 2}', :OWNER) AS r;
SELECT pg_temp.ok('a signed-in actor who edits both vehicles may move it',
  (SELECT (r ->> 'status') = 'moved' AND (r -> 'reverses_correction_id') = 'null'::jsonb FROM pg_temp.signed)
  AND (SELECT vehicle_id FROM work_orders WHERE id = :W1) = '00000000-0000-0000-0000-0000000000a1');
SELECT pg_temp.ok('and may undo their own move, which names it',
  (SELECT (correct_work_order_vehicle(:W1, '00000000-0000-0000-0000-0000000000a3', 'Signed-in editor undoing that move.', '{"t": 3}', :OWNER)
     ->> 'reverses_correction_id') = (s.r ->> 'correction_id') FROM pg_temp.signed s));
RESET ROLE;

-- 7. the journal stays append-only and service-only.
SELECT pg_temp.ok('journal rows cannot be changed or deleted; anon and authenticated cannot read them',
  pg_temp.raises($q$UPDATE work_order_scalar_corrections SET reason = 'rewritten reason text' WHERE column_name = 'vehicle_id'$q$) IS NOT NULL
  AND pg_temp.raises($q$DELETE FROM work_order_scalar_corrections WHERE column_name = 'vehicle_id'$q$) IS NOT NULL
  AND NOT has_table_privilege('anon', 'public.work_order_scalar_corrections', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.work_order_scalar_corrections', 'SELECT'));
SELECT pg_temp.ok('the checks refuse a vehicle row without evidence or actor written outside the writer',
  pg_temp.raises($q$INSERT INTO work_order_scalar_corrections (work_order_id, column_name, reason, migration_version, old_ref, new_ref, writer)
    VALUES ('00000000-0000-0000-0000-0000000000e1', 'vehicle_id', 'a reason long enough', 'x', gen_random_uuid(), gen_random_uuid(), 'correct_work_order_vehicle')$q$) = '23514');

-- 8. rerunning the migration changes no row.
CREATE TABLE pg_temp.journal AS SELECT * FROM work_order_scalar_corrections;
\ir ../migrations/20261121231500_correct_work_order_vehicle_writer.sql
SELECT pg_temp.ok('a second run of the migration changes no journal row',
  NOT EXISTS (SELECT 1 FROM work_order_scalar_corrections c FULL JOIN pg_temp.journal j USING (id) WHERE to_jsonb(c) IS DISTINCT FROM to_jsonb(j)));
SELECT 'correct_work_order_vehicle contract: PASS' AS result;
