-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_timeline_read_rule -f this-file.sql
-- Contract for 20261121101500_timeline_events_read_rule.sql. Synthetic rows only; never production.
--
-- The fixture is the live shape, pinned:
--   * timeline_events carries its thirteen live policies: the eleven read on 2026-10-14
--     (helpers/timeline_events_policies_live_20261014.sql), then 20261014130000 and 20261118160000 applied from their
--     own files. Their text is checked against a checksum of pg_policies read from production on 2026-11-21.
--   * vehicles carries its two live read policies (helpers/vehicles_read_policies_live_20261121.sql, same check) and
--     the live grant shape: anon and authenticated hold SELECT column by column, never on the table, and one fixture
--     column is left ungranted.
--   * vehicle_user_has_access, auto_group_photos_into_events and the trigger that stamps who granted a permission
--     are the live bodies, byte for byte (helpers/*_live_20261121.sql, md5 asserted below).
--
-- It proves, for a logged-out reader, a signed-in stranger, an event's author, each kind of account the vehicles read
-- rule admits to a private vehicle, the accounts it does not admit, and the service role:
--   * before: the open policy returns every event the private-source rule does not hold back;
--   * after: logged out and strangers read the events of public vehicles only, through the table and the view; an
--     author reads what they wrote, with or without a vehicle; whoever can read a private vehicle's row reads its
--     events (holder by user_id, owner_id or uploaded_by; a permission a holder granted; an admin; an approved
--     ownership verification; a contributor; a member of an organization that owns the vehicle), and an account that
--     granted itself a permission, or whose permission was revoked, does not; the restrictive private-source policy
--     still applies on top; INSERT ... RETURNING and UPDATE by an author still work, and are shown to depend on the
--     author policy; a photo landing still creates and extends its event, which only its account reads; the migration
--     is idempotent, refuses when a premise no longer holds, and its revert restores the open policy.
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
-- Prod's deploy role owns the tables, the view and the functions and is not a superuser; build and migrate as one.
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
-- policies_md5(table, reads_only): the checksum named in the header, computed the same way against production
-- (one line per policy: name, command, permissive, roles, USING and, unless reads_only, WITH CHECK; whitespace folded).
CREATE FUNCTION pg_temp.policies_md5(p_table text, p_reads_only boolean) RETURNS text LANGUAGE sql AS $$
  SELECT md5(string_agg(policyname || '|' || cmd || '|' || permissive || '|' || array_to_string(roles, ',') || '|' ||
                        regexp_replace(coalesce(qual, ''), '\s+', ' ', 'g') ||
                        CASE WHEN p_reads_only THEN '' ELSE '|' || regexp_replace(coalesce(with_check, ''), '\s+', ' ', 'g') END,
                        E'\n' ORDER BY policyname))
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = p_table AND (NOT p_reads_only OR cmd IN ('SELECT', 'ALL'))
$$;

-- ===== live shapes =====
-- The tables vehicle_user_has_access reads, with the columns it reads at their live types. The client roles are
-- granted nothing on five of them here (production grants more, under row security): the function runs as its owner
-- and needs none.
CREATE TABLE public.admin_users (user_id uuid, is_active boolean);
CREATE TABLE public.ownership_verifications (vehicle_id uuid, user_id uuid, status text);
CREATE TABLE public.vehicle_user_permissions (id uuid DEFAULT gen_random_uuid(), vehicle_id uuid, user_id uuid, role text,
  is_active boolean, granted_by uuid, granted_at timestamp with time zone);
CREATE TABLE public.vehicle_contributors (vehicle_id uuid, user_id uuid, status text, role text);
CREATE TABLE public.organization_vehicles (vehicle_id uuid, organization_id uuid, relationship_type text, status text,
  linked_by_user_id uuid);
CREATE TABLE public.organization_contributors (organization_id uuid, user_id uuid, status text, role text);
-- vehicles: the five columns the policies read, and one column no client role may select.
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, user_id uuid, owner_id uuid, uploaded_by uuid,
  is_public boolean NOT NULL DEFAULT true, purchase_price numeric);
\ir helpers/vehicle_user_has_access_live_20261121.sql
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
\ir helpers/vehicles_read_policies_live_20261121.sql
-- vehicle_user_permissions: its live policies, and the live trigger that stamps who granted a row a client writes.
ALTER TABLE public.vehicle_user_permissions ENABLE ROW LEVEL SECURITY;
\ir helpers/vehicle_user_permissions_rules_live_20261121.sql
-- timeline_events with the 62 columns the 2026-10-14 view reads (information_schema, 2026-10-14).
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
CREATE UNIQUE INDEX idx_timeline_events_one_photo_session_per_day ON public.timeline_events
  USING btree (vehicle_id, event_date, COALESCE((user_id)::text, 'system'::text))
  WHERE (event_type = ANY (ARRAY['photo_session'::text, 'batch_image_upload'::text]));
ALTER TABLE public.timeline_events ENABLE ROW LEVEL SECURITY;
\ir helpers/timeline_events_policies_live_20261014.sql
\ir helpers/vehicle_timeline_events_live_20261014.sql
-- titles(): the titles the current role reads from the table, sorted, as one string (it runs as its caller).
CREATE FUNCTION pg_temp.titles() RETURNS text LANGUAGE sql AS
$$ SELECT coalesce(string_agg(title, ',' ORDER BY title), '') FROM public.timeline_events $$;
CREATE FUNCTION pg_temp.view_titles() RETURNS text LANGUAGE sql AS
$$ SELECT coalesce(string_agg(title, ',' ORDER BY title), '') FROM public.vehicle_timeline_events $$;
-- The photo table, reduced to what the event trigger reads and writes, with an account's own insert and read.
CREATE TABLE public.vehicle_images (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, user_id uuid,
  image_url text, taken_at timestamp with time zone, timeline_event_id uuid, ai_scan_metadata jsonb, exif_data jsonb);
ALTER TABLE public.vehicle_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_insert ON public.vehicle_images FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY own_read ON public.vehicle_images FOR SELECT USING ((SELECT auth.uid()) = user_id);
\ir helpers/auto_group_photos_into_events_live_20261121.sql
CREATE TRIGGER trg_auto_group_photos BEFORE INSERT ON public.vehicle_images
  FOR EACH ROW EXECUTE FUNCTION public.auto_group_photos_into_events();

-- Grants. vehicles as production holds it for the two client roles: column by column, never the table (measured
-- 2026-11-21: 339 of 368 columns; these five are among them). The other tables the clients touch here: table grants.
GRANT SELECT (id, user_id, owner_id, uploaded_by, is_public) ON public.vehicles TO anon, authenticated;
GRANT ALL ON public.timeline_events, public.vehicle_timeline_events, public.vehicle_user_permissions, public.vehicle_images
  TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
\ir ../migrations/20261014130000_vehicle_timeline_events_invoker.sql
\ir ../migrations/20261118160000_timeline_events_private_source_read.sql

SELECT pg_temp.ok('fixture: the three functions are the live bodies, and the two that must run as their owner do',
  (SELECT md5(p.prosrc) = 'fb0bc02ec95b96e89fd6db034bdfdb49' AND p.prosecdef FROM pg_proc p
    WHERE p.oid = 'public.auto_group_photos_into_events()'::regprocedure)
  AND (SELECT md5(p.prosrc) = 'bb834e763e061f07a6b75f315e34d473' AND p.prosecdef AND p.provolatile = 's' FROM pg_proc p
        WHERE p.oid = 'public.vehicle_user_has_access(uuid,uuid)'::regprocedure)
  AND (SELECT md5(p.prosrc) = '61c59015710c5aafabc426a1e7240d4f' AND NOT p.prosecdef FROM pg_proc p
        WHERE p.oid = 'public.stamp_vehicle_permission_grantor()'::regprocedure));
SELECT pg_temp.ok('fixture: timeline_events carries the thirteen policies production has (checksum read 2026-11-21)',
  (SELECT count(*) FROM pg_policies WHERE tablename = 'timeline_events') = 13
  AND pg_temp.policies_md5('timeline_events', false) = '7adbbd92f915a2b68b6ce88865af3aca');
SELECT pg_temp.ok('fixture: vehicles carries the two read policies production has (checksum read 2026-11-21)',
  (SELECT count(*) FROM pg_policies WHERE tablename = 'vehicles' AND cmd IN ('SELECT', 'ALL')) = 2
  AND pg_temp.policies_md5('vehicles', true) = '1441865563a264ff84950c7ac36ed69d');
SELECT pg_temp.ok('fixture: the client roles hold vehicles column by column, and nothing on the tables only the access function reads',
  NOT has_table_privilege('anon', 'public.vehicles', 'SELECT') AND NOT has_table_privilege('authenticated', 'public.vehicles', 'SELECT')
  AND has_column_privilege('authenticated', 'public.vehicles', 'id', 'SELECT')
  AND NOT has_column_privilege('authenticated', 'public.vehicles', 'purchase_price', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.admin_users', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.vehicle_contributors', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.organization_contributors', 'SELECT'));

-- Accounts. u1 holds the public car A. The private car B: u4 is user_id, u5 uploaded_by, u6 owner_id.
-- Admitted to B by the access function: u7 (a permission u4 granted), u10 (active admin), u11 (contributor),
-- u12 (member of the organization that owns B), u13 (approved ownership verification), u16 (granted below by u4).
-- Not admitted: u2 (wrote events on both cars, holds neither), u3 (stranger), u9 (grants itself a permission, below),
-- u14 (a permission that was revoked), u15 (member of an organization that only services B). u8 takes photos.
-- ALLOW_RAW_TESTIMONY_WRITE: rows of a disposable PG17 fixture, never production.
INSERT INTO public.vehicles (id, user_id, owner_id, uploaded_by, is_public, purchase_price) VALUES
 ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-000000000001', NULL, NULL, true, 1),
 ('10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000006',
  '20000000-0000-0000-0000-000000000005', false, 1);
INSERT INTO public.vehicle_user_permissions (vehicle_id, user_id, is_active, role, granted_by) VALUES
 ('10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-000000000007', true, 'mechanic', '20000000-0000-0000-0000-000000000004'),
 ('10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-000000000014', false, 'mechanic', '20000000-0000-0000-0000-000000000004');
INSERT INTO public.admin_users VALUES ('20000000-0000-0000-0000-000000000010', true);
INSERT INTO public.vehicle_contributors VALUES ('10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-000000000011', 'active', 'restorer');
INSERT INTO public.organization_vehicles VALUES
 ('10000000-0000-0000-0000-00000000000b', '50000000-0000-0000-0000-000000000001', 'owner', 'active', NULL),
 ('10000000-0000-0000-0000-00000000000b', '50000000-0000-0000-0000-000000000002', 'service_provider', 'active', NULL);
INSERT INTO public.organization_contributors VALUES
 ('50000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000012', 'active', 'employee'),
 ('50000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000015', 'active', 'employee');
INSERT INTO public.ownership_verifications VALUES ('10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-000000000013', 'approved');
INSERT INTO public.timeline_events (id, vehicle_id, user_id, event_type, source, title, event_date) VALUES
 ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000a', NULL, 'auction_sold', 'bat', 'A-system', '2026-01-01'),
 ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-000000000002', 'repair', 'user_input', 'A-by-u2', '2026-02-01'),
 ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-00000000000b', NULL, 'maintenance', 'system', 'B-system', '2026-03-01'),
 ('30000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-000000000002', 'repair', 'user_input', 'B-by-u2', '2026-03-02'),
 ('30000000-0000-0000-0000-000000000005', NULL, '20000000-0000-0000-0000-000000000002', 'pending_analysis', 'photo_upload', 'own-u2', '2026-04-01'),
 ('30000000-0000-0000-0000-000000000006', NULL, '20000000-0000-0000-0000-000000000002', 'daily_movement', 'whatsapp_ingest', 'private-u2', '2026-04-02'),
 ('30000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-000000000002', 'note', 'imessage_thread', 'A-private-u2', '2026-04-03'),
 ('30000000-0000-0000-0000-000000000008', NULL, NULL, 'pending_analysis', 'photo_upload', 'own-nobody', '2026-04-04'),
 ('30000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-0000000000ff', NULL, 'other', 'system', 'no-such-vehicle', '2026-04-05');

-- 1. Before: the open policy returns every event the private-source rule does not hold back.
SET ROLE anon;
SELECT set_config('test.auth_uid', '', false), set_config('test.auth_role', 'anon', false);
SELECT pg_temp.ok('before: logged out reads every event but the private-source ones',
  pg_temp.titles() = 'A-by-u2,A-system,B-by-u2,B-system,no-such-vehicle,own-nobody,own-u2'
  AND pg_temp.view_titles() = pg_temp.titles());
RESET ROLE;

SET ROLE dm_contract_deployer;
\ir ../migrations/20261121101500_timeline_events_read_rule.sql
-- A second application changes nothing and passes its own checks.
\ir ../migrations/20261121101500_timeline_events_read_rule.sql
SELECT pg_temp.ok('after: no open read policy; two signed-in read policies; the restrictive one still there; fourteen in all',
  NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'timeline_events' AND cmd = 'SELECT' AND qual = 'true')
  AND (SELECT count(*) FROM pg_policies WHERE tablename = 'timeline_events'
        AND policyname IN ('timeline_events_author_read', 'timeline_events_vehicle_reader_read') AND roles = '{authenticated}') = 2
  AND EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'timeline_events' AND policyname = 'timeline_events_private_source_read'
               AND permissive = 'RESTRICTIVE')
  AND (SELECT count(*) FROM pg_policies WHERE tablename = 'timeline_events') = 14);
RESET ROLE;

-- 2. Logged out: public vehicles only, through the table and the view; no writes.
SET ROLE anon;
SELECT set_config('test.auth_uid', '', false), set_config('test.auth_role', 'anon', false);
SELECT pg_temp.ok('logged out: reads the public car''s events and nothing else, table and view',
  pg_temp.titles() = 'A-by-u2,A-system' AND pg_temp.view_titles() = 'A-by-u2,A-system');
SELECT pg_temp.ok('logged out: no event without a vehicle, on the private car or on a missing vehicle, by filter or by id',
  (SELECT count(*) FROM public.timeline_events WHERE vehicle_id IS NULL) = 0
  AND (SELECT count(*) FROM public.vehicle_timeline_events WHERE vehicle_id IS NULL) = 0
  AND (SELECT count(*) FROM public.timeline_events WHERE vehicle_id = '10000000-0000-0000-0000-00000000000b') = 0
  AND (SELECT count(*) FROM public.timeline_events WHERE id IN ('30000000-0000-0000-0000-000000000005',
        '30000000-0000-0000-0000-000000000008', '30000000-0000-0000-0000-000000000009')) = 0);
SELECT pg_temp.ok('logged out: select * works on the table and the view (no column the reader lacks is needed)',
  (SELECT count(*) FROM (SELECT * FROM public.timeline_events) t) = 2
  AND (SELECT count(*) FROM (SELECT * FROM public.vehicle_timeline_events) t) = 2);
SELECT pg_temp.ok('logged out: cannot insert, update or delete',
  pg_temp.denied($q$INSERT INTO public.timeline_events (vehicle_id, user_id, event_type, title) VALUES
    ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-000000000001', 'other', 'Forged')$q$)
  AND pg_temp.rows($q$UPDATE public.timeline_events SET title = 'Vandal'$q$) = 0
  AND pg_temp.rows($q$DELETE FROM public.timeline_events$q$) = 0);
RESET ROLE;

-- 3. A signed-in stranger reads what a logged-out reader does.
SET ROLE authenticated;
SELECT set_config('test.auth_role', 'authenticated', false), set_config('test.auth_uid', '20000000-0000-0000-0000-000000000003', false);
SELECT pg_temp.ok('stranger: the public car''s events only, table and view, select * included',
  pg_temp.titles() = 'A-by-u2,A-system' AND pg_temp.view_titles() = 'A-by-u2,A-system'
  AND (SELECT count(*) FROM (SELECT * FROM public.timeline_events) t) = 2);

-- 4. The author: what they wrote, with or without a vehicle, private-source rows included.
SELECT set_config('test.auth_uid', '20000000-0000-0000-0000-000000000002', false);
SELECT pg_temp.ok('author: own events on both cars, own event with no vehicle, own private-source rows',
  pg_temp.titles() = 'A-by-u2,A-private-u2,A-system,B-by-u2,own-u2,private-u2'
  AND pg_temp.view_titles() = 'A-by-u2,A-private-u2,A-system,B-by-u2,own-u2,private-u2');
SELECT pg_temp.ok('author: does not read the private car''s other events, nor an event with no account',
  (SELECT count(*) FROM public.timeline_events WHERE title IN ('B-system', 'own-nobody', 'no-such-vehicle')) = 0);

-- 5. Whoever can read the private car's row reads its events.
SELECT set_config('test.auth_uid', '20000000-0000-0000-0000-000000000004', false);
SELECT pg_temp.ok('holder by vehicles.user_id reads the private car''s events', pg_temp.titles() = 'A-by-u2,A-system,B-by-u2,B-system');
SELECT set_config('test.auth_uid', '20000000-0000-0000-0000-000000000005', false);
SELECT pg_temp.ok('holder by vehicles.uploaded_by reads the private car''s events, table and view',
  pg_temp.titles() = 'A-by-u2,A-system,B-by-u2,B-system' AND pg_temp.view_titles() = 'A-by-u2,A-system,B-by-u2,B-system');
SELECT set_config('test.auth_uid', '20000000-0000-0000-0000-000000000006', false);
SELECT pg_temp.ok('holder by vehicles.owner_id reads the private car''s events', pg_temp.titles() = 'A-by-u2,A-system,B-by-u2,B-system');
SELECT set_config('test.auth_uid', '20000000-0000-0000-0000-000000000007', false);
SELECT pg_temp.ok('a permission a holder granted reads the private car''s events', pg_temp.titles() = 'A-by-u2,A-system,B-by-u2,B-system');
SELECT set_config('test.auth_uid', '20000000-0000-0000-0000-000000000010', false);
SELECT pg_temp.ok('an active admin reads the private car''s events, and no other account''s vehicle-less event',
  pg_temp.titles() = 'A-by-u2,A-system,B-by-u2,B-system');
SELECT set_config('test.auth_uid', '20000000-0000-0000-0000-000000000011', false);
SELECT pg_temp.ok('a contributor reads the private car''s events', pg_temp.titles() = 'A-by-u2,A-system,B-by-u2,B-system');
SELECT set_config('test.auth_uid', '20000000-0000-0000-0000-000000000012', false);
SELECT pg_temp.ok('a member of the organization that owns the car reads its events, table and view',
  pg_temp.titles() = 'A-by-u2,A-system,B-by-u2,B-system' AND pg_temp.view_titles() = 'A-by-u2,A-system,B-by-u2,B-system');
SELECT set_config('test.auth_uid', '20000000-0000-0000-0000-000000000013', false);
SELECT pg_temp.ok('an approved ownership verification reads the private car''s events', pg_temp.titles() = 'A-by-u2,A-system,B-by-u2,B-system');
-- and the accounts the vehicles rule does not admit read none of them
SELECT set_config('test.auth_uid', '20000000-0000-0000-0000-000000000014', false);
SELECT pg_temp.ok('a revoked permission reads none of the private car''s events', pg_temp.titles() = 'A-by-u2,A-system');
SELECT set_config('test.auth_uid', '20000000-0000-0000-0000-000000000015', false);
SELECT pg_temp.ok('a member of an organization that only services the car reads none of its events', pg_temp.titles() = 'A-by-u2,A-system');
-- an account adds a permission row in its own name, naming a holder as the grantor: the trigger stamps the account
-- itself as grantor, and a permission an account gave itself admits nothing
SELECT set_config('test.auth_uid', '20000000-0000-0000-0000-000000000009', false);
INSERT INTO public.vehicle_user_permissions (vehicle_id, user_id, is_active, role, granted_by) VALUES
 ('10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-000000000009', true, 'mechanic', '20000000-0000-0000-0000-000000000004');
SELECT pg_temp.ok('a permission an account gave itself reads none of the private car''s events',
  (SELECT granted_by = user_id FROM public.vehicle_user_permissions WHERE user_id = '20000000-0000-0000-0000-000000000009')
  AND pg_temp.titles() = 'A-by-u2,A-system' AND pg_temp.view_titles() = 'A-by-u2,A-system');
-- a holder grants a permission through the same door: the trigger stamps the holder, and that admits the account
SELECT set_config('test.auth_uid', '20000000-0000-0000-0000-000000000004', false);
INSERT INTO public.vehicle_user_permissions (vehicle_id, user_id, is_active, role) VALUES
 ('10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-000000000016', true, 'appraiser');
SELECT set_config('test.auth_uid', '20000000-0000-0000-0000-000000000016', false);
SELECT pg_temp.ok('a permission a holder grants through the API is stamped with the holder and reads the private car''s events',
  (SELECT granted_by = '20000000-0000-0000-0000-000000000004' FROM public.vehicle_user_permissions
    WHERE user_id = '20000000-0000-0000-0000-000000000016')
  AND pg_temp.titles() = 'A-by-u2,A-system,B-by-u2,B-system');
RESET ROLE;
-- Without the added vehicle policy, the accounts the vehicles rule admits by anything but vehicles.user_id or a
-- permission row would lose the car's events while still reading the car.
SET ROLE dm_contract_deployer;
BEGIN;
DROP POLICY timeline_events_vehicle_reader_read ON public.timeline_events;
SET LOCAL ROLE authenticated;
SELECT set_config('test.auth_uid', '20000000-0000-0000-0000-000000000005', true);
SELECT pg_temp.ok('without the vehicle policy, the uploaded_by holder reads the car and none of its events',
  (SELECT count(*) FROM public.vehicles WHERE id = '10000000-0000-0000-0000-00000000000b') = 1 AND pg_temp.titles() = 'A-by-u2,A-system');
SELECT set_config('test.auth_uid', '20000000-0000-0000-0000-000000000012', true);
SELECT pg_temp.ok('without the vehicle policy, the organization member reads the car and none of its events',
  (SELECT count(*) FROM public.vehicles WHERE id = '10000000-0000-0000-0000-00000000000b') = 1 AND pg_temp.titles() = 'A-by-u2,A-system');
SELECT set_config('test.auth_uid', '20000000-0000-0000-0000-000000000010', true);
SELECT pg_temp.ok('without the vehicle policy, the admin reads the car and none of its events',
  (SELECT count(*) FROM public.vehicles WHERE id = '10000000-0000-0000-0000-00000000000b') = 1 AND pg_temp.titles() = 'A-by-u2,A-system');
ROLLBACK;
RESET ROLE;

-- 6. Writes by a signed-in account keep working, and the row comes back.
SET ROLE authenticated;
SELECT set_config('test.auth_role', 'authenticated', false), set_config('test.auth_uid', '20000000-0000-0000-0000-000000000003', false);
SELECT pg_temp.ok('a signed-in account inserts an own event with no vehicle and gets it back (INSERT ... RETURNING)',
  pg_temp.rows($q$WITH ins AS (INSERT INTO public.timeline_events (user_id, event_type, source, title, event_date)
    VALUES ('20000000-0000-0000-0000-000000000003', 'note', 'user_input', 'own-note', '2026-05-01') RETURNING id)
    SELECT id FROM ins$q$) = 1
  AND pg_temp.rows($q$INSERT INTO public.vehicle_timeline_events (vehicle_id, user_id, event_type, source, title, event_date)
    VALUES ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-000000000003', 'other', 'user_input', 'Sighting', '2026-05-02')
    RETURNING id$q$) = 1);
SELECT pg_temp.ok('a signed-in account cannot forge an author, rewrite or delete someone else''s event',
  pg_temp.denied($q$INSERT INTO public.timeline_events (vehicle_id, user_id, event_type, title) VALUES
    ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-000000000001', 'other', 'Forged')$q$)
  AND pg_temp.rows($q$UPDATE public.timeline_events SET title = 'Vandal'$q$) = 0
  AND pg_temp.rows($q$DELETE FROM public.timeline_events$q$) = 0);
SELECT set_config('test.auth_uid', '20000000-0000-0000-0000-000000000002', false);
SELECT pg_temp.ok('an author still updates the events they wrote, with or without a vehicle',
  pg_temp.rows($q$UPDATE public.timeline_events SET description = 'Notes' WHERE id = '30000000-0000-0000-0000-000000000005'$q$) = 1
  AND pg_temp.rows($q$UPDATE public.vehicle_timeline_events SET description = 'Notes' WHERE id = '30000000-0000-0000-0000-000000000004'$q$) = 1);
SELECT set_config('test.auth_uid', '20000000-0000-0000-0000-000000000004', false);
SELECT pg_temp.ok('the holder still deletes events on their private car',
  pg_temp.rows($q$DELETE FROM public.timeline_events WHERE vehicle_id = '10000000-0000-0000-0000-00000000000b'$q$) = 2);
RESET ROLE;
-- Without the author policy an account's own vehicle-less insert could not hand the row back, and its update of an
-- event it wrote with no vehicle would match no row: the paths the policy keeps.
SET ROLE dm_contract_deployer;
BEGIN;
DROP POLICY timeline_events_author_read ON public.timeline_events;
SET LOCAL ROLE authenticated;
SELECT set_config('test.auth_uid', '20000000-0000-0000-0000-000000000003', true);
SELECT pg_temp.ok('without the author policy, INSERT ... RETURNING of an own vehicle-less event is refused',
  pg_temp.denied($q$INSERT INTO public.timeline_events (user_id, event_type, source, title, event_date)
    VALUES ('20000000-0000-0000-0000-000000000003', 'note', 'user_input', 'own-note', '2026-05-01') RETURNING id$q$));
SELECT set_config('test.auth_uid', '20000000-0000-0000-0000-000000000002', true);
SELECT pg_temp.ok('without the author policy, an author''s update of their own vehicle-less event matches no row',
  pg_temp.rows($q$UPDATE public.timeline_events SET description = 'Notes' WHERE id = '30000000-0000-0000-0000-000000000005'$q$) = 0);
ROLLBACK;
RESET ROLE;

-- 7. A photo landing: the trigger runs as its owner, so the event is created and extended as before, and only the
--    account that took the photos reads it.
SET ROLE authenticated;
SELECT set_config('test.auth_role', 'authenticated', false), set_config('test.auth_uid', '20000000-0000-0000-0000-000000000008', false);
INSERT INTO public.vehicle_images (id, user_id, image_url, taken_at) VALUES
 ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000008', 'https://example.invalid/u8/1.jpg', '2026-06-01 10:00+00');
INSERT INTO public.vehicle_images (id, user_id, image_url, taken_at) VALUES
 ('40000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000008', 'https://example.invalid/u8/2.jpg', '2026-06-01 10:05+00');
SELECT pg_temp.ok('uploader: two photos five minutes apart land in one event, which the uploader reads',
  (SELECT count(DISTINCT timeline_event_id) FROM public.vehicle_images WHERE user_id = '20000000-0000-0000-0000-000000000008') = 1
  AND (SELECT (e.metadata->>'photo_count')::int = 2 AND cardinality(e.image_urls) = 2 AND e.vehicle_id IS NULL
              AND e.user_id = '20000000-0000-0000-0000-000000000008'
         FROM public.timeline_events e
        WHERE e.id = (SELECT timeline_event_id FROM public.vehicle_images WHERE id = '40000000-0000-0000-0000-000000000002')));
-- a photo taken on the public car on the day of a system event joins that event, though the uploader did not write it
INSERT INTO public.vehicle_images (id, vehicle_id, user_id, image_url, taken_at) VALUES
 ('40000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-000000000008',
  'https://example.invalid/u8/3.jpg', '2026-01-01 12:00+00');
SELECT pg_temp.ok('uploader: a photo on a car joins that day''s existing event',
  (SELECT timeline_event_id FROM public.vehicle_images WHERE id = '40000000-0000-0000-0000-000000000003') = '30000000-0000-0000-0000-000000000001');
-- and on the private car, whose events the uploader cannot read: the trigger still finds the day's event
INSERT INTO public.vehicle_images (id, vehicle_id, user_id, image_url, taken_at) VALUES
 ('40000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-000000000008',
  'https://example.invalid/u8/4.jpg', '2026-03-01 12:00+00');
SELECT pg_temp.ok('uploader: a photo on a car whose events they cannot read still joins that day''s event, unseen',
  (SELECT timeline_event_id FROM public.vehicle_images WHERE id = '40000000-0000-0000-0000-000000000004') = '30000000-0000-0000-0000-000000000003'
  AND (SELECT count(*) FROM public.timeline_events WHERE id = '30000000-0000-0000-0000-000000000003') = 0);
SELECT set_config('test.auth_uid', '20000000-0000-0000-0000-000000000003', false);
SELECT pg_temp.ok('stranger: does not read the uploader''s event',
  (SELECT count(*) FROM public.timeline_events WHERE user_id = '20000000-0000-0000-0000-000000000008') = 0);
RESET ROLE;
SET ROLE anon;
SELECT set_config('test.auth_uid', '', false), set_config('test.auth_role', 'anon', false);
SELECT pg_temp.ok('logged out: does not read the uploader''s event; still reads the public car''s event',
  (SELECT count(*) FROM public.timeline_events WHERE user_id = '20000000-0000-0000-0000-000000000008') = 0
  AND (SELECT count(*) FROM public.timeline_events WHERE vehicle_id IS NULL) = 0
  AND (SELECT count(*) FROM public.timeline_events WHERE id = '30000000-0000-0000-0000-000000000001') = 1);
RESET ROLE;

-- 8. The service role bypasses row security and reads everything, private-source rows included.
SET ROLE service_role;
SELECT set_config('test.auth_uid', '', false), set_config('test.auth_role', 'service_role', false);
SELECT pg_temp.ok('service role: reads every row',
  (SELECT count(*) FROM public.timeline_events) = 10
  AND (SELECT count(*) FROM public.vehicle_timeline_events) = 10
  AND (SELECT count(*) FROM public.timeline_events WHERE vehicle_id IS NULL) = 4
  AND (SELECT count(*) FROM public.timeline_events WHERE source IN ('whatsapp_ingest', 'imessage_thread')) = 2);
RESET ROLE;

-- 9. The revert, then the refusals: the migration changes nothing when a premise no longer holds.
SET ROLE dm_contract_deployer;
SELECT set_config('test.auth_uid', '', false), set_config('test.auth_role', '', false);
\ir revert_20261121101500_timeline_events_read_rule.sql
SELECT pg_temp.ok('revert: the open policy is back and the two added policies are gone (the thirteen again, same checksum)',
  EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'timeline_events' AND policyname = 'Public can view all timeline events' AND qual = 'true')
  AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'timeline_events'
                    AND policyname IN ('timeline_events_author_read', 'timeline_events_vehicle_reader_read'))
  AND (SELECT count(*) FROM pg_policies WHERE tablename = 'timeline_events') = 13
  AND pg_temp.policies_md5('timeline_events', false) = '7adbbd92f915a2b68b6ce88865af3aca');
-- a second revert is a no-op
\ir revert_20261121101500_timeline_events_read_rule.sql
SELECT pg_temp.ok('revert twice: still the thirteen', (SELECT count(*) FROM pg_policies WHERE tablename = 'timeline_events') = 13);
CREATE FUNCTION pg_temp.unchanged() RETURNS boolean LANGUAGE sql AS $$
  SELECT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'timeline_events' AND policyname = 'Public can view all timeline events')
     AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'timeline_events'
                       AND policyname IN ('timeline_events_author_read', 'timeline_events_vehicle_reader_read'))
$$;

-- (a) the open policy is no longer USING (true): someone narrowed it; do not drop their rule
DROP POLICY "Public can view all timeline events" ON public.timeline_events;
CREATE POLICY "Public can view all timeline events" ON public.timeline_events AS PERMISSIVE FOR SELECT TO public
  USING (event_type <> 'note');
\set ON_ERROR_STOP off
\ir ../migrations/20261121101500_timeline_events_read_rule.sql
\set ON_ERROR_STOP on
SELECT pg_temp.ok('refused: a read policy of that name that is not USING (true) is left in place, and nothing is added',
  pg_temp.unchanged()
  AND (SELECT qual FROM pg_policies WHERE tablename = 'timeline_events' AND policyname = 'Public can view all timeline events') <> 'true');
DROP POLICY "Public can view all timeline events" ON public.timeline_events;
CREATE POLICY "Public can view all timeline events" ON public.timeline_events AS PERMISSIVE FOR SELECT TO public USING (true);

-- (b) the policy that keeps public vehicles readable is missing: dropping the open one would blank the public site
ALTER POLICY "Public vehicle timeline events are viewable" ON public.timeline_events RENAME TO "renamed away";
\set ON_ERROR_STOP off
\ir ../migrations/20261121101500_timeline_events_read_rule.sql
\set ON_ERROR_STOP on
SELECT pg_temp.ok('refused: without the public-vehicle read policy the open policy stays', pg_temp.unchanged());
ALTER POLICY "renamed away" ON public.timeline_events RENAME TO "Public vehicle timeline events are viewable";

-- (c) a client role can no longer select the vehicles column the policies read
REVOKE SELECT (id) ON public.vehicles FROM authenticated;
\set ON_ERROR_STOP off
\ir ../migrations/20261121101500_timeline_events_read_rule.sql
\set ON_ERROR_STOP on
SELECT pg_temp.ok('refused: when authenticated cannot select vehicles.id nothing is added and the open policy stays', pg_temp.unchanged());
GRANT SELECT (id) ON public.vehicles TO authenticated;

-- (d) row security is off on vehicles: the vehicle policy would admit every signed-in account
ALTER TABLE public.vehicles DISABLE ROW LEVEL SECURITY;
\set ON_ERROR_STOP off
\ir ../migrations/20261121101500_timeline_events_read_rule.sql
\set ON_ERROR_STOP on
SELECT pg_temp.ok('refused: with row security off on vehicles nothing is added and the open policy stays', pg_temp.unchanged());
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;

-- (e) vehicles has an open read policy: same reason
CREATE POLICY open_for_the_test ON public.vehicles FOR SELECT USING (true);
\set ON_ERROR_STOP off
\ir ../migrations/20261121101500_timeline_events_read_rule.sql
\set ON_ERROR_STOP on
SELECT pg_temp.ok('refused: with an open read policy on vehicles nothing is added and the open policy stays', pg_temp.unchanged());
DROP POLICY open_for_the_test ON public.vehicles;

-- With the premises restored it applies again, and a logged-out reader is back to the public car's events.
\ir ../migrations/20261121101500_timeline_events_read_rule.sql
RESET ROLE;
SET ROLE anon;
SELECT set_config('test.auth_uid', '', false), set_config('test.auth_role', 'anon', false);
SELECT pg_temp.ok('re-applied after the refusals: logged out reads the public car''s events only',
  (SELECT count(*) FROM public.timeline_events WHERE vehicle_id IS DISTINCT FROM '10000000-0000-0000-0000-00000000000a') = 0
  AND (SELECT count(*) FROM public.timeline_events) = 2);
RESET ROLE;
\echo 'test_timeline_events_read_rule: all contract assertions passed'
