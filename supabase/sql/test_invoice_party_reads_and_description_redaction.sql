-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_invoice_redaction -f this-file.sql
-- Proves that after 20261020185000_invoice_party_reads_and_description_redaction.sql a signed-in stranger no longer reads
-- invoices, while the creator, the vehicle's owner and the work order's customer do; and that vehicle_row_read hands an
-- outsider a description and origin_metadata without phone numbers or e-mail addresses (the owner still reads them as
-- captured), and get_vehicle_profile_data uses the same projection. Starts from the live functions
-- (helpers/invoice_redaction_live_20261020.sql) and shows each leak there first.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.generated_invoices') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.auth_uid', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.auth_role', true), '') $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'invoice_owner') THEN CREATE ROLE invoice_owner NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role, invoice_owner;
GRANT CREATE ON SCHEMA public TO invoice_owner;

SET ROLE invoice_owner;
CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY, user_id uuid, owner_id uuid, uploaded_by uuid, created_by_user_id uuid, is_public boolean DEFAULT true,
  description text, origin_metadata jsonb, owner_name text, owner_contact text, purchase_price numeric, purchase_date date, purchase_location text);
CREATE TABLE public.timeline_events (id uuid PRIMARY KEY, vehicle_id uuid);
CREATE TABLE public.work_orders (id uuid PRIMARY KEY, organization_id uuid, customer_id uuid, vehicle_id uuid);
CREATE TABLE public.business_ownership (business_id uuid, owner_id uuid, status text);
CREATE TABLE public.admin_users (user_id uuid PRIMARY KEY, is_active boolean);
CREATE TABLE public.organization_contributors (organization_id uuid, user_id uuid, role text, status text);
CREATE TABLE public.ownership_verifications (vehicle_id uuid, user_id uuid, status text);
CREATE TABLE public.vehicle_user_permissions (vehicle_id uuid, user_id uuid, role text, is_active boolean, granted_by uuid);
CREATE TABLE public.vehicle_contributors (vehicle_id uuid, user_id uuid, role text, status text);
CREATE TABLE public.organization_vehicles (vehicle_id uuid, organization_id uuid, relationship_type text, status text, linked_by_user_id uuid);
CREATE TABLE public.clients (id uuid PRIMARY KEY, created_by uuid);
CREATE TABLE public.generated_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid, work_order_id uuid, business_id uuid, client_id uuid,
  technician_id uuid, created_by uuid, total_amount numeric, html_content text, payment_token text);
ALTER TABLE public.generated_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY allow_authenticated_read_generated_invoices ON public.generated_invoices FOR SELECT TO authenticated USING (true);
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
SET check_function_bodies = off;
\ir helpers/invoice_redaction_live_20261020.sql
RESET check_function_bodies;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;
RESET ROLE;

CREATE FUNCTION public.t_is(p_got text, p_want text, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF p_got IS DISTINCT FROM p_want THEN RAISE EXCEPTION 'FAIL: % (got %, want %)', p_what, p_got, p_want; END IF; END $$;
-- Invoices the caller reads, and contact details left in the vehicle row vehicle_row_read hands them.
CREATE FUNCTION public.t_reads() RETURNS text LANGUAGE sql AS $$
  SELECT format('invoices=%s phones=%s emails=%s private=%s', (SELECT count(*) FROM public.generated_invoices),
    (SELECT count(*) FROM regexp_matches(coalesce(public.vehicle_row_read('10000000-0000-0000-0000-000000000001')::text, ''), '555-0123|555-8765|555-0199', 'g')),
    (SELECT count(*) FROM regexp_matches(coalesce(public.vehicle_row_read('10000000-0000-0000-0000-000000000001')::text, ''), '@example\.invalid', 'g')),
    (SELECT count(*) FROM jsonb_each(public.vehicle_row_read('10000000-0000-0000-0000-000000000001')) e
      WHERE e.key IN ('owner_name', 'owner_contact', 'purchase_price') AND e.value <> 'null'::jsonb)) $$;
GRANT EXECUTE ON FUNCTION public.t_is(text, text, text), public.t_reads() TO anon, authenticated;
SELECT public.t_is(encode(sha256(convert_to(prosrc, 'UTF8')), 'base64'), 'v9AyXs0bf7DTqHbonvDuxagChbclcplB6b9/1rAxKi0=',
  'fixture: vehicle_row_read as live') FROM pg_proc WHERE oid = 'public.vehicle_row_read(uuid)'::regprocedure;
SELECT public.t_is(encode(sha256(convert_to(prosrc, 'UTF8')), 'base64'), 'gSQbPpb2Dl/WWZOVuJSS1CSCv74x/KPF05NwPf8FI1s=',
  'fixture: get_vehicle_profile_data as live') FROM pg_proc WHERE oid = 'public.get_vehicle_profile_data(uuid)'::regprocedure;

-- Seeds. Owner O1's public vehicle V1: a description with a phone number and an e-mail address, origin_metadata with an
-- e-mail address, private purchase fields. One invoice per party route: by creator K1 for V1's event, and one on a work
-- order whose customer is W1. Stranger X9.
INSERT INTO public.vehicles (id, user_id, description, origin_metadata, owner_name, owner_contact, purchase_price) VALUES
 ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000a0',
  'Runs great. Call 702-555-0123 or (702) 555-8765, seller@example.invalid. Text 702-555-0199Email. 1967 427 block, 45,123 miles, VIN 1G1YY22G965104567.',
  '{"seller": {"email": "private@example.invalid", "listing_id": 1234567890}}', 'Owner', 'o@x.invalid', 1000);
INSERT INTO public.timeline_events VALUES ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001');
INSERT INTO public.work_orders VALUES ('50000000-0000-0000-0000-000000000001', NULL, '20000000-0000-0000-0000-0000000000c1', NULL);
INSERT INTO public.generated_invoices (event_id, created_by, total_amount, html_content, payment_token) VALUES
 ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000b1', 500, '<p>Client</p>', 'tok_1');
INSERT INTO public.generated_invoices (work_order_id, total_amount) VALUES ('50000000-0000-0000-0000-000000000001', 700);

-- 1. Before: a stranger reads both invoices and the vehicle's contact details.
SET ROLE authenticated;
SET test.auth_role = 'authenticated';
SET test.auth_uid = '20000000-0000-0000-0000-0000000000e9';
SELECT public.t_is(public.t_reads(), 'invoices=2 phones=3 emails=2 private=0', 'before: a stranger reads every invoice and the contact details');
RESET ROLE;

-- 2. The migration, twice.
SET test.auth_role = '';
SET test.auth_uid = '';
\ir ../migrations/20261020185000_invoice_party_reads_and_description_redaction.sql
\ir ../migrations/20261020185000_invoice_party_reads_and_description_redaction.sql
SELECT public.t_is(encode(sha256(convert_to(prosrc, 'UTF8')), 'base64'), 'OfecuDAROe7a+p0OybLnO8kgSE3BFJwRbfRAHVi0x5U=', 'after: vehicle_row_read as the guard accepts it done')
FROM pg_proc WHERE oid = 'public.vehicle_row_read(uuid)'::regprocedure;
SELECT public.t_is((position('public.vehicle_row_public_projection(to_jsonb(v.*))::json' IN prosrc) > 0 AND position('jsonb_mask_keys(to_jsonb(v.*)' IN prosrc) = 0)::text,
  'true', 'after: get_vehicle_profile_data hands outsiders the projection') FROM pg_proc WHERE oid = 'public.get_vehicle_profile_data(uuid)'::regprocedure;

-- 3. After.
SET ROLE authenticated;
SET test.auth_role = 'authenticated';
SET test.auth_uid = '20000000-0000-0000-0000-0000000000e9';
SELECT public.t_is(public.t_reads(), 'invoices=0 phones=0 emails=0 private=0', 'after: a stranger reads no invoice and no contact details');
SELECT public.t_is((public.vehicle_row_read('10000000-0000-0000-0000-000000000001') ->> 'description'),
  'Runs great. Call [contact through Nuke] or [contact through Nuke], [contact through Nuke]. Text [contact through Nuke]Email. 1967 427 block, 45,123 miles, VIN 1G1YY22G965104567.',
  'after: only the contact details leave the description');
SELECT public.t_is((public.vehicle_row_read('10000000-0000-0000-0000-000000000001') #>> '{origin_metadata,seller,listing_id}'), '1234567890',
  'after: origin_metadata stays valid JSON with its numbers');
SET test.auth_uid = '20000000-0000-0000-0000-0000000000b1';
SELECT public.t_is(public.t_reads(), 'invoices=1 phones=0 emails=0 private=0', 'after: the creator reads their invoice');
SET test.auth_uid = '20000000-0000-0000-0000-0000000000c1';
SELECT public.t_is(public.t_reads(), 'invoices=1 phones=0 emails=0 private=0', 'after: the work order''s customer reads its invoice');
SET test.auth_uid = '20000000-0000-0000-0000-0000000000a0';
SELECT public.t_is(public.t_reads(), 'invoices=1 phones=3 emails=2 private=3', 'after: the vehicle''s owner reads its event''s invoice and the row as captured');
RESET ROLE;
SET ROLE anon;
SET test.auth_role = 'anon';
SET test.auth_uid = '';
SELECT public.t_is((SELECT count(*) FROM regexp_matches(public.vehicle_row_read('10000000-0000-0000-0000-000000000001')::text, '555-0123|555-8765|555-0199|@example\.invalid', 'g'))::text,
  '0', 'after: anon reads no contact details');
RESET ROLE;

SELECT 'invoice party reads and description redaction: ok' AS result;
