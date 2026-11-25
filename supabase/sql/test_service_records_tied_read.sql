-- Disposable PG17 contract for 20261125081000_service_records_tied_read (service_records_tied_read_v1). Synthetic rows
-- only. The table, grants and policy are copied from live (2026-11-24); vehicle_viewer_tied is applied from its own
-- migration's body. Reads run under SET ROLE so RLS is really applied. Asserts counts only:
--   * anon reads no rows; a second signed-in user with no tie reads no rows and no cost;
--   * the vehicle's owner and a user vehicle_user_has_access admits read their vehicle's rows, and only those;
--   * the migration applies twice; the revert restores the before state.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF to_regclass('public.service_records') IS NOT NULL THEN RAISE EXCEPTION 'Requires an empty disposable database'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.role', true), '') $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated;
CREATE FUNCTION public.assert(ok boolean, what text) RETURNS void LANGUAGE plpgsql AS
  $$ BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'contract failed: %', what; END IF; END $$;
GRANT EXECUTE ON FUNCTION public.assert(boolean, text) TO anon, authenticated;

CREATE TABLE public.vehicles (id uuid PRIMARY KEY, owner_id uuid, user_id uuid, created_by_user_id uuid, uploaded_by uuid,
  is_public boolean, deleted_at timestamptz);
CREATE TABLE public.access_grants (vehicle_id uuid, user_id uuid);
CREATE FUNCTION public.vehicle_user_has_access(p_vehicle uuid, p_user uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS
  $$ SELECT EXISTS (SELECT 1 FROM public.access_grants g WHERE g.vehicle_id = p_vehicle AND g.user_id = p_user) $$;
-- vehicle_viewer_tied as live (20261124211500).
CREATE FUNCTION public.vehicle_viewer_tied(p_vehicle_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT CASE
           WHEN (SELECT auth.role()) = 'service_role' THEN true
           WHEN (SELECT auth.uid()) IS NULL THEN false
           ELSE coalesce((SELECT (SELECT auth.uid()) IN (v.owner_id, v.user_id, v.created_by_user_id, v.uploaded_by)
                            FROM public.vehicles v WHERE v.id = p_vehicle_id), false)
                OR coalesce(public.vehicle_user_has_access(p_vehicle_id, (SELECT auth.uid())), false)
         END
$$;
REVOKE ALL ON FUNCTION public.vehicle_viewer_tied(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_viewer_tied(uuid) TO anon, authenticated, service_role;

CREATE TABLE public.service_records (id uuid PRIMARY KEY, vehicle_id uuid, service_date date, mileage integer, shop_name text,
  shop_location text, work_performed text, cost numeric, parts_replaced text[], service_type text, documentation_available boolean,
  source text, confidence_score numeric, created_at timestamptz DEFAULT now(), updated_at timestamptz);
ALTER TABLE public.service_records ENABLE ROW LEVEL SECURITY;
GRANT SELECT, REFERENCES, TRIGGER ON public.service_records TO anon, authenticated;
CREATE POLICY allow_authenticated_read_service_records ON public.service_records FOR SELECT TO authenticated USING (true);

-- Vehicle a1 owned by f1 (f2 granted access); vehicle a2 owned by f4. f3 is a stranger.
INSERT INTO public.vehicles VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f1', NULL, NULL, NULL, true, NULL),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000f4', NULL, NULL, NULL, true, NULL);
INSERT INTO public.access_grants VALUES ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f2');
INSERT INTO public.service_records (id, vehicle_id, cost) VALUES
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', 100),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000a1', NULL),
  ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000a2', 50);

-- Before: the exposure the audit measured.
SET ROLE authenticated; SELECT set_config('test.role', 'authenticated', false), set_config('test.uid', '00000000-0000-0000-0000-0000000000f3', false);
SELECT public.assert((SELECT count(cost) FROM public.service_records) = 2, 'before: a stranger reads every cost');
RESET ROLE;

\ir ../migrations/20261125081000_service_records_tied_read.sql
\ir ../migrations/20261125081000_service_records_tied_read.sql

SET ROLE anon; SELECT set_config('test.role', 'anon', false), set_config('test.uid', '', false);
SELECT public.assert((SELECT count(*) FROM public.service_records) = 0, 'anon: no rows');
RESET ROLE;

SET ROLE authenticated; SELECT set_config('test.role', 'authenticated', false);
SELECT set_config('test.uid', '00000000-0000-0000-0000-0000000000f3', false);
SELECT public.assert((SELECT count(*) FROM public.service_records) = 0, 'stranger: no rows');
SELECT public.assert((SELECT count(cost) FROM public.service_records) = 0, 'stranger: no cost');
SELECT set_config('test.uid', '00000000-0000-0000-0000-0000000000f1', false);
SELECT public.assert((SELECT count(*) FROM public.service_records) = 2, 'owner of a1: its 2 rows');
SELECT public.assert((SELECT count(*) FROM public.service_records WHERE vehicle_id = '00000000-0000-0000-0000-0000000000a2') = 0, 'owner of a1: none of a2');
SELECT set_config('test.uid', '00000000-0000-0000-0000-0000000000f2', false);
SELECT public.assert((SELECT count(cost) FROM public.service_records) = 1, 'granted user on a1: its 1 cost');
SELECT set_config('test.uid', '00000000-0000-0000-0000-0000000000f4', false);
SELECT public.assert((SELECT count(*) FROM public.service_records) = 1, 'owner of a2: its 1 row');
RESET ROLE;
SELECT public.assert((SELECT count(*) FROM pg_policies WHERE tablename = 'service_records' AND qual = 'true') = 0, 'no USING (true) policy remains');

\ir revert_20261125081000_service_records_tied_read.sql
SET ROLE authenticated; SELECT set_config('test.uid', '00000000-0000-0000-0000-0000000000f3', false);
SELECT public.assert((SELECT count(cost) FROM public.service_records) = 2, 'revert: before state restored');
RESET ROLE;
\echo service_records_tied_read: ok
