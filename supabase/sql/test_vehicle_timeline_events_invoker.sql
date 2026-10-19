-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_timeline_view -f this-file.sql
-- Contract for 20261014130000_vehicle_timeline_events_invoker.sql. Synthetic rows only; never production.
-- Starts from the live view definition and the live row policies of timeline_events
-- (supabase/sql/helpers/{vehicle_timeline_events,timeline_events_policies}_live_20261014.sql) with the default API
-- grants, then proves, for anon, the vehicle's owner, a contributor and a signed-in stranger:
--   * before: writes through the owner-run view ignore the row policies (anon deletes every event and inserts one in
--     the owner's name; a stranger rewrites everyone's events);
--   * after: reads are unchanged; anon cannot insert, update or delete; the owner and the contributor insert their own
--     events and update them (the contributor only through the added author policy, shown by dropping it in a
--     rolled-back step); nobody updates someone else's event; the owner still deletes events on their vehicle; the
--     service role (BYPASSRLS) keeps its writes; the migration is idempotent.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
     OR current_setting('server_version_num')::int / 10000 <> 17
     OR to_regclass('public.timeline_events') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 dm_refinement_* database';
  END IF;
END $$;
SET statement_timeout = '60s';
SET lock_timeout = '3s';

CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.auth_uid', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.auth_role', true), '') $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'dm_contract_deployer') THEN CREATE ROLE dm_contract_deployer NOLOGIN; END IF;
END $$;
-- As on Supabase, the service role bypasses row security.
ALTER ROLE service_role BYPASSRLS;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role, dm_contract_deployer;
-- Prod's deploy role owns the tables and the view and is not a superuser; build and migrate as one.
GRANT CREATE ON SCHEMA public TO dm_contract_deployer;
SET ROLE dm_contract_deployer;
DO $$ BEGIN
  IF (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'the contract must run as a non-superuser after SET ROLE';
  END IF;
END $$;

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;
-- denied(sql) is true when the statement fails with insufficient_privilege (42501), as a row-policy refusal does.
CREATE FUNCTION pg_temp.denied(p_sql text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN false;
EXCEPTION WHEN insufficient_privilege THEN
  RETURN true;
END $$;
-- rows(sql) runs a write and returns how many rows it touched, then undoes it.
CREATE FUNCTION pg_temp.rows(p_sql text) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  BEGIN
    EXECUTE p_sql;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE EXCEPTION 'undo' USING ERRCODE = 'P0001', DETAIL = n::text;
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS p_sql = PG_EXCEPTION_DETAIL;
    RETURN p_sql::integer;
  END;
END $$;

-- Live shapes: vehicles with its two read policies, the permissions table one timeline policy reads, and
-- timeline_events with all 62 production columns and types (information_schema, 2026-10-14).
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, user_id uuid, owner_id uuid, uploaded_by uuid,
  is_public boolean NOT NULL DEFAULT true);
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY vehicles_public_select ON public.vehicles FOR SELECT USING ((is_public = true) OR (auth.role() = 'service_role'));
CREATE POLICY vehicles_private_select ON public.vehicles FOR SELECT USING ((is_public = false) AND ((SELECT auth.uid()) IS NOT NULL)
  AND (((SELECT auth.uid()) = user_id) OR ((SELECT auth.uid()) = owner_id) OR ((SELECT auth.uid()) = uploaded_by)));
CREATE TABLE public.vehicle_user_permissions (vehicle_id uuid, user_id uuid);
CREATE TABLE public.timeline_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, user_id uuid,
  event_type text, source text, title text, description text, event_date date, image_urls text[], metadata jsonb,
  created_at timestamp with time zone, updated_at timestamp with time zone, mileage_at_event integer,
  cost_amount numeric, cost_currency text, duration_hours numeric, location_name text, location_address text,
  location_coordinates point, service_provider_name text, service_provider_type text, invoice_number text,
  warranty_info jsonb, parts_used jsonb[], verification_documents jsonb[], is_insurance_claim boolean,
  insurance_claim_number text, next_service_due_date date, next_service_due_mileage integer, data_source text,
  confidence_score integer, source_type text, event_category text, activity_type text, automated_tags text[],
  manual_tags text[], photo_analysis jsonb, receipt_data jsonb, parts_mentioned text[], tools_mentioned text[],
  labor_hours numeric, cost_estimate numeric, organization_id uuid, client_id uuid, is_monetized boolean,
  work_started timestamp with time zone, work_completed timestamp with time zone, contract_id uuid,
  applied_labor_rate numeric, applied_shop_rate numeric, rate_source text, contextual_analysis_status text,
  documented_by uuid, primary_technician uuid, quality_rating integer, quality_justification text,
  value_impact numeric, ai_confidence_score numeric, concerns text[], industry_standard_comparison jsonb,
  search_vector tsvector, work_order_id uuid);
ALTER TABLE public.timeline_events ENABLE ROW LEVEL SECURITY;
\ir helpers/timeline_events_policies_live_20261014.sql
\ir helpers/vehicle_timeline_events_live_20261014.sql
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
SELECT pg_temp.ok('helper vehicle_timeline_events is the live definition',
  encode(sha256(convert_to(pg_get_viewdef('public.vehicle_timeline_events'::regclass), 'UTF8')), 'base64')
    = 'kNvtw6hwmei/XvNbqDYisB+PpKwDXR2t2vUGY4sgOQI=');
SELECT pg_temp.ok('helper policies are the live eleven',
  (SELECT count(*) FROM pg_policies WHERE tablename = 'timeline_events') = 11);

-- Owner u1 owns the public vehicle; u2 contributes to it; u3 is a signed-in stranger.
-- ALLOW_RAW_TESTIMONY_WRITE: rows of a disposable PG17 fixture, never production.
INSERT INTO public.vehicles (id, user_id, is_public) VALUES ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', true);
INSERT INTO public.vehicle_user_permissions VALUES ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002');
INSERT INTO public.timeline_events (id, vehicle_id, user_id, event_type, title, event_date) VALUES
 ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', NULL, 'auction_sold', 'System event', '2026-01-01'),
 ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'maintenance', 'Owner event', '2026-02-01'),
 ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'repair', 'Contributor event', '2026-03-01');

-- 1. Before: the owner-run view ignores the row policies.
SET ROLE anon;
SELECT set_config('test.auth_uid', '', false), set_config('test.auth_role', 'anon', false);
SELECT pg_temp.ok('before: anon deletes every event and inserts one in the owner''s name through the view',
  pg_temp.rows($q$DELETE FROM public.vehicle_timeline_events$q$) = 3
  AND pg_temp.rows($q$INSERT INTO public.vehicle_timeline_events (vehicle_id, user_id, event_type, title) VALUES
    ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'other', 'Forged')$q$) = 1
  AND pg_temp.rows($q$DELETE FROM public.timeline_events$q$) = 0);
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('test.auth_uid', '20000000-0000-0000-0000-000000000003', false), set_config('test.auth_role', 'authenticated', false);
SELECT pg_temp.ok('before: a signed-in stranger rewrites every event through the view',
  pg_temp.rows($q$UPDATE public.vehicle_timeline_events SET title = 'Vandal'$q$) = 3);
RESET ROLE;

SET ROLE dm_contract_deployer;
\ir ../migrations/20261014130000_vehicle_timeline_events_invoker.sql
-- A second application changes nothing and passes its own check.
\ir ../migrations/20261014130000_vehicle_timeline_events_invoker.sql

-- 2. Anon: reads unchanged, no writes.
SET ROLE anon;
SELECT set_config('test.auth_uid', '', false), set_config('test.auth_role', 'anon', false);
SELECT pg_temp.ok('anon: reads every event through the view',
  (SELECT count(*) FROM public.vehicle_timeline_events) = 3
  AND (SELECT title FROM public.vehicle_timeline_events WHERE id = '30000000-0000-0000-0000-000000000003') = 'Contributor event');
SELECT pg_temp.ok('anon: cannot insert, update or delete through the view',
  pg_temp.denied($q$INSERT INTO public.vehicle_timeline_events (vehicle_id, user_id, event_type, title) VALUES
    ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'other', 'Forged')$q$)
  AND pg_temp.rows($q$UPDATE public.vehicle_timeline_events SET title = 'Vandal'$q$) = 0
  AND pg_temp.rows($q$DELETE FROM public.vehicle_timeline_events$q$) = 0);
RESET ROLE;

-- 3. The owner.
SET ROLE authenticated;
SELECT set_config('test.auth_role', 'authenticated', false), set_config('test.auth_uid', '20000000-0000-0000-0000-000000000001', false);
SELECT pg_temp.ok('owner: inserts an own event and updates it',
  pg_temp.rows($q$INSERT INTO public.vehicle_timeline_events (vehicle_id, user_id, event_type, title) VALUES
    ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'maintenance', 'New owner event')$q$) = 1
  AND pg_temp.rows($q$UPDATE public.vehicle_timeline_events SET image_urls = ARRAY['https://example.invalid/a.jpg']
    WHERE id = '30000000-0000-0000-0000-000000000002'$q$) = 1);
SELECT pg_temp.ok('owner: does not rewrite the contributor''s or the system''s event',
  pg_temp.rows($q$UPDATE public.vehicle_timeline_events SET title = 'Edited' WHERE id IN
    ('30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003')$q$) = 0);
SELECT pg_temp.ok('owner: still deletes events on their vehicle',
  pg_temp.rows($q$DELETE FROM public.vehicle_timeline_events$q$) = 3);

-- 4. The contributor: their own events, through the added author policy.
SELECT set_config('test.auth_uid', '20000000-0000-0000-0000-000000000002', false);
SELECT pg_temp.ok('contributor: inserts an own event; attaches images to and annotates it',
  pg_temp.rows($q$INSERT INTO public.vehicle_timeline_events (vehicle_id, user_id, event_type, title) VALUES
    ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'repair', 'New contributor event')$q$) = 1
  AND pg_temp.rows($q$UPDATE public.vehicle_timeline_events SET image_urls = ARRAY['https://example.invalid/b.jpg'],
    description = 'Notes' WHERE id = '30000000-0000-0000-0000-000000000003' AND user_id = '20000000-0000-0000-0000-000000000002'$q$) = 1);
SELECT pg_temp.ok('contributor: does not rewrite or delete anyone else''s event, nor delete their own',
  pg_temp.rows($q$UPDATE public.vehicle_timeline_events SET title = 'Edited' WHERE id <> '30000000-0000-0000-0000-000000000003'$q$) = 0
  AND pg_temp.rows($q$DELETE FROM public.vehicle_timeline_events$q$) = 0);
RESET ROLE;
-- Without the added policy the contributor's update would match no row: the path the policy keeps.
SET ROLE dm_contract_deployer;
BEGIN;
DROP POLICY "Authors can update their own timeline events" ON public.timeline_events;
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok('without the author policy, the contributor''s update of their own event matches no row',
  pg_temp.rows($q$UPDATE public.vehicle_timeline_events SET description = 'Notes' WHERE id = '30000000-0000-0000-0000-000000000003'$q$) = 0);
ROLLBACK;
RESET ROLE;

-- 5. A signed-in stranger: may add an event in their own name (the existing insert policy), nothing else.
SET ROLE authenticated;
SELECT set_config('test.auth_uid', '20000000-0000-0000-0000-000000000003', false);
SELECT pg_temp.ok('stranger: cannot forge an author, rewrite or delete; own-name insert stays as the policy allows',
  pg_temp.denied($q$INSERT INTO public.vehicle_timeline_events (vehicle_id, user_id, event_type, title) VALUES
    ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'other', 'Forged')$q$)
  AND pg_temp.rows($q$UPDATE public.vehicle_timeline_events SET title = 'Vandal'$q$) = 0
  AND pg_temp.rows($q$DELETE FROM public.vehicle_timeline_events$q$) = 0
  AND pg_temp.rows($q$INSERT INTO public.vehicle_timeline_events (vehicle_id, user_id, event_type, title) VALUES
    ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003', 'other', 'Sighting')$q$) = 1);
RESET ROLE;

-- 6. The service role bypasses row security and keeps its writes through the view.
SET ROLE service_role;
SELECT set_config('test.auth_uid', '', false), set_config('test.auth_role', 'service_role', false);
SELECT pg_temp.ok('service role: writes through the view as before',
  pg_temp.rows($q$UPDATE public.vehicle_timeline_events SET title = title$q$) = 3
  AND pg_temp.rows($q$DELETE FROM public.vehicle_timeline_events$q$) = 3);
RESET ROLE;
