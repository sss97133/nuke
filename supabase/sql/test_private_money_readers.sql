-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_private_money -f this-file.sql
-- Contract for 20261014073000_private_money_readers.sql. Synthetic rows only; never production.
-- Proves, starting from the live definitions (supabase/sql/helpers/*_live_20261014.sql, byte-identical to
-- production: their source hashes are checked below) and applying the migration as a non-superuser owner:
--   * organization_vehicle_books returns the links' money to the organization's managers only;
--   * vehicle_owner_books returns the purchase facts to owners and contributors with access only;
--   * vehicle_row_read returns NULL for a hidden row and nulls the purchase facts for non-insiders;
--   * get_vehicle_profile_data, vehicle_price_signal and sold_vehicle_proof stop carrying the owner's money
--     to strangers and keep it for insiders, every other field unchanged;
--   * vehicles_inventory is closed to anon and authenticated; public price history leaves out purchase rows;
--   * the migration is idempotent (a second run passes its guard).
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
     OR current_setting('server_version_num')::int / 10000 <> 17
     OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 dm_refinement_* database';
  END IF;
END $$;
SET statement_timeout = '60s';
SET lock_timeout = '3s';
SET TimeZone = 'UTC';

CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.auth_uid', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.auth_role', true), '') $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
$$ SELECT jsonb_strip_nulls(jsonb_build_object('role', nullif(current_setting('test.auth_role', true), ''))) $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'dm_contract_deployer') THEN CREATE ROLE dm_contract_deployer NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role, dm_contract_deployer;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
-- Prod's deploy role owns the tables and is not a superuser; build the fixture and apply the migration as one.
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

-- Live shapes: the columns the readers touch, with production's types (information_schema, 2026-10-14).
CREATE TABLE public.vehicles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), uploaded_by uuid, make text, model text, year integer, vin text, msrp numeric, current_value numeric, purchase_price numeric, purchase_date date, purchase_location text, is_public boolean, updated_at timestamp with time zone, sale_price integer, bat_auction_url text, discovery_url text, is_for_sale boolean, deleted_at timestamp with time zone, asking_price numeric, user_id uuid, owner_id uuid, created_by_user_id uuid, origin_metadata jsonb);
CREATE TABLE public.vehicle_images (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, user_id uuid, image_url text, image_type text, category text, position integer, caption text, is_primary boolean, created_at timestamp with time zone, file_name text, source text, is_sensitive boolean, storage_path text, thumbnail_url text, medium_url text, large_url text, variants jsonb, ai_scan_metadata jsonb, is_document boolean, is_duplicate boolean, is_superseded boolean);
CREATE TABLE public.timeline_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, user_id uuid, event_type text, source text, title text, description text, event_date date, image_urls text[], metadata jsonb, created_at timestamp with time zone, updated_at timestamp with time zone, mileage_at_event integer, cost_amount numeric, cost_currency text, duration_hours numeric, location_name text, location_address text, location_coordinates point, service_provider_name text, service_provider_type text, invoice_number text, warranty_info jsonb, parts_used jsonb[], verification_documents jsonb[], is_insurance_claim boolean, insurance_claim_number text, next_service_due_date date, next_service_due_mileage integer, data_source text, confidence_score integer, source_type text, event_category text, activity_type text, automated_tags text[], manual_tags text[], photo_analysis jsonb, receipt_data jsonb, parts_mentioned text[], tools_mentioned text[], labor_hours numeric, cost_estimate numeric, organization_id uuid, client_id uuid, is_monetized boolean, work_started timestamp with time zone, work_completed timestamp with time zone, contract_id uuid, applied_labor_rate numeric, applied_shop_rate numeric, rate_source text, contextual_analysis_status text, documented_by uuid, primary_technician uuid, quality_rating integer, quality_justification text, value_impact numeric, ai_confidence_score numeric, concerns text[], industry_standard_comparison jsonb, search_vector tsvector, work_order_id uuid);
CREATE TABLE public.work_sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, vehicle_id uuid, session_date date, duration_minutes integer, image_count integer, work_description text, status text, title text, work_type text, total_parts_cost numeric, total_labor_cost numeric, total_job_cost numeric);
CREATE TABLE public.vehicle_comments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, user_id uuid, created_at timestamp with time zone);
CREATE TABLE public.vehicle_valuations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, valuation_date timestamp with time zone);
CREATE TABLE public.external_listings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, organization_id uuid, platform text, listing_url text, listing_status text, end_date timestamp with time zone, current_bid numeric, final_price numeric, sold_at timestamp with time zone, created_at timestamp with time zone, updated_at timestamp with time zone);
CREATE TABLE public.auction_comments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid);
CREATE TABLE public.vehicle_observations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid);
CREATE TABLE public.vehicle_documents (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, uploaded_by uuid, document_type text, amount numeric, privacy_level text);
CREATE TABLE public.data_validations (entity_type text, entity_id uuid, field_name text, field_value text, validation_source text, confidence_score integer, source_url text);
CREATE TABLE public.organizations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_name text, is_public boolean);
CREATE TABLE public.organization_vehicles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid, vehicle_id uuid, relationship_type text, status text, linked_by_user_id uuid, notes text, created_at timestamp with time zone, listing_status text, asking_price numeric, cost_basis numeric, days_on_lot integer, sale_date date, sale_price numeric, internal_notes text);
CREATE TABLE public.organization_contributors (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid, user_id uuid, role text, status text);
CREATE TABLE public.vehicle_price_history (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, price_type text, value numeric, as_of timestamp with time zone, logged_by uuid);
CREATE TABLE public.vehicle_contributors (vehicle_id uuid, user_id uuid, status text);
CREATE VIEW public.vehicle_timeline_events AS
  SELECT id, vehicle_id, event_type, title, event_date, metadata FROM public.timeline_events;
CREATE VIEW public.vehicles_inventory AS
  SELECT id, purchase_price, purchase_date, purchase_location, is_public FROM public.vehicles WHERE is_public = true;
CREATE FUNCTION public.vehicle_user_has_access(p_vehicle_id uuid, p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.vehicle_contributors
                 WHERE vehicle_id = p_vehicle_id AND user_id = p_user_id AND coalesce(status, 'active') = 'active') $$;
CREATE FUNCTION public.vehicle_image_gallery_eligible(public.vehicle_images) RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT true $$;
-- public.jsonb_mask_keys exactly as 20261013170000 created it (its source hash is checked below).
CREATE OR REPLACE FUNCTION public.jsonb_mask_keys(j jsonb, p_keys text[])
RETURNS jsonb
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT CASE jsonb_typeof(j)
    WHEN 'object' THEN coalesce((
      SELECT jsonb_object_agg(e.k, CASE WHEN e.k = ANY (p_keys) THEN 'null'::jsonb ELSE public.jsonb_mask_keys(e.v, p_keys) END)
      FROM jsonb_each(j) AS e(k, v)), '{}'::jsonb)
    WHEN 'array' THEN coalesce((
      SELECT jsonb_agg(public.jsonb_mask_keys(a.e, p_keys) ORDER BY a.o)
      FROM jsonb_array_elements(j) WITH ORDINALITY AS a(e, o)), '[]'::jsonb)
    ELSE j END;
$$;

-- Row policies as in production for the tables a caller reads directly here.
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY vehicles_public_select ON public.vehicles FOR SELECT USING ((is_public = true) OR (auth.role() = 'service_role'));
CREATE POLICY vehicles_private_select ON public.vehicles FOR SELECT USING ((is_public = false) AND ((SELECT auth.uid()) IS NOT NULL)
  AND (((SELECT auth.uid()) = user_id) OR ((SELECT auth.uid()) = owner_id) OR ((SELECT auth.uid()) = uploaded_by)
       OR public.vehicle_user_has_access(id, (SELECT auth.uid()))));
ALTER TABLE public.vehicle_price_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners can view all price history for their vehicles" ON public.vehicle_price_history FOR SELECT
  USING (EXISTS (SELECT 1 FROM vehicles v WHERE ((v.id = vehicle_price_history.vehicle_id)
         AND ((v.user_id = (SELECT auth.uid())) OR (v.owner_id = (SELECT auth.uid()))))));
CREATE POLICY "Users can view price history for public vehicles" ON public.vehicle_price_history FOR SELECT
  USING (EXISTS (SELECT 1 FROM vehicles v WHERE ((v.id = vehicle_price_history.vehicle_id) AND (v.is_public = true))));
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;

\ir helpers/get_vehicle_profile_data_live_20261014.sql
\ir helpers/vehicle_price_signal_live_20261014.sql
\ir helpers/sold_vehicle_proof_live_20261014.sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sold_vehicle_proof, public.vehicles_inventory TO anon, authenticated, service_role;

-- The helpers are production's sources byte for byte.
SELECT pg_temp.ok('helper get_vehicle_profile_data is the live source',
  (SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'base64') FROM pg_proc WHERE oid = 'public.get_vehicle_profile_data(uuid)'::regprocedure)
    = 'pfSCC/mXgFBy4SoZ9Eafe4f+WAhYp413HxamX1QajJo=');
SELECT pg_temp.ok('helper vehicle_price_signal is the live source',
  (SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'base64') FROM pg_proc WHERE oid = 'public.vehicle_price_signal(uuid[])'::regprocedure)
    = 'b6226lg3uqOKaT5sGeXRGYHGNr0vKgAusSZTi/4ZiI4=');
SELECT pg_temp.ok('helper sold_vehicle_proof is the live definition',
  encode(sha256(convert_to(pg_get_viewdef('public.sold_vehicle_proof'::regclass), 'UTF8')), 'base64') = 'Jo1Yi/q1GTWkK9HsG2RXVTDf0MJkkJCEtMpfWbK29A4=');

SELECT pg_temp.ok('fixture jsonb_mask_keys is the live source',
  (SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'base64') FROM pg_proc WHERE oid = 'public.jsonb_mask_keys(jsonb,text[])'::regprocedure)
    = 'BsL/CHZOOiZFsj+M6EfadEc8CiQb38VLpkohwTz9O6g=');

-- Before: a stranger reads the owner's money through every one of these paths.
INSERT INTO public.vehicles (id, year, make, model, is_public, owner_id, user_id, purchase_price, purchase_date, purchase_location, msrp, is_for_sale, updated_at) VALUES
 ('10000000-0000-0000-0000-000000000001', 1972, 'Chevrolet', 'K5', true, '20000000-0000-0000-0000-000000000001', NULL, 15000, '2024-06-01', 'Las Vegas', 30000, false, '2026-10-01'),
 ('10000000-0000-0000-0000-000000000002', 1990, 'Ford', 'Bronco', false, NULL, '20000000-0000-0000-0000-000000000001', 5000, NULL, NULL, 20000, false, '2026-10-01'),
 ('10000000-0000-0000-0000-000000000003', 1967, 'Ford', 'Mustang', true, '20000000-0000-0000-0000-000000000005', NULL, NULL, NULL, NULL, 25000, false, '2026-10-01');
INSERT INTO public.vehicle_contributors VALUES ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'active');
INSERT INTO public.organizations VALUES ('30000000-0000-0000-0000-000000000001', 'Dealer One', true), ('30000000-0000-0000-0000-000000000002', 'Dealer Two', true);
INSERT INTO public.organization_contributors (organization_id, user_id, role, status) VALUES
 ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'board_member', 'active'),
 ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003', 'technician', 'active'),
 ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000006', 'manager', 'pending');
INSERT INTO public.organization_vehicles (id, organization_id, vehicle_id, relationship_type, status, listing_status, sale_date, sale_price, asking_price, cost_basis, internal_notes, notes, created_at) VALUES
 ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'sold_by', 'sold', 'sold', '2025-03-01', 18000, 21000, 12000, 'held for paint', 'External listing: bat', '2025-01-01'),
 ('40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', 'in_stock', 'active', 'for_sale', NULL, NULL, NULL, NULL, NULL, 'Imported from a listing', '2025-01-02'),
 ('40000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000003', 'in_stock', 'active', 'for_sale', NULL, NULL, 26000, 999, NULL, NULL, '2025-01-03');
INSERT INTO public.vehicle_price_history (vehicle_id, price_type, value, as_of) VALUES
 ('10000000-0000-0000-0000-000000000001', 'purchase', 15000, '2024-06-01'),
 ('10000000-0000-0000-0000-000000000001', 'msrp', 30000, '2024-06-01');

SET ROLE anon;
SELECT pg_temp.ok('before: anon reads the purchase price through the profile read',
  (public.get_vehicle_profile_data('10000000-0000-0000-0000-000000000001')::jsonb -> 'vehicle' ->> 'purchase_price')::numeric = 15000);
SELECT pg_temp.ok('before: anon reads PAID/PURCHASE price signals and a private vehicle''s signal',
  (SELECT anchor_label FROM public.vehicle_price_signal(ARRAY['10000000-0000-0000-0000-000000000001']::uuid[])) = 'PURCHASE'
  AND (SELECT count(*) FROM public.vehicle_price_signal(ARRAY['10000000-0000-0000-0000-000000000002']::uuid[])) = 1);
SELECT pg_temp.ok('before: anon reads the link sale price from sold_vehicle_proof',
  (SELECT sale_price FROM public.sold_vehicle_proof WHERE org_vehicle_id = '40000000-0000-0000-0000-000000000001') = 18000);
SELECT pg_temp.ok('before: anon reads purchase price history and vehicles_inventory',
  (SELECT count(*) FROM public.vehicle_price_history WHERE price_type = 'purchase') = 1
  AND (SELECT purchase_price FROM public.vehicles_inventory WHERE id = '10000000-0000-0000-0000-000000000001') = 15000);
RESET ROLE;
SET ROLE dm_contract_deployer;

\ir ../migrations/20261014073000_private_money_readers.sql
-- A second application passes its own guard and changes nothing.
\ir ../migrations/20261014073000_private_money_readers.sql

-- 1. Anonymous reader.
SET ROLE anon;
SELECT set_config('test.auth_uid', '', false), set_config('test.auth_role', 'anon', false);
DO $$
DECLARE doc jsonb; r jsonb;
BEGIN
  PERFORM pg_temp.ok('anon: no organization books', (SELECT count(*) FROM public.organization_vehicle_books('30000000-0000-0000-0000-000000000001')) = 0);
  PERFORM pg_temp.ok('anon: does not manage the organization', NOT public.caller_manages_organization('30000000-0000-0000-0000-000000000001'));
  PERFORM pg_temp.ok('anon: no owner books', (SELECT count(*) FROM public.vehicle_owner_books(ARRAY['10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002']::uuid[])) = 0);

  r := public.vehicle_row_read('10000000-0000-0000-0000-000000000001');
  PERFORM pg_temp.ok('anon: row read keeps the public fields', r ->> 'make' = 'Chevrolet' AND (r ->> 'msrp')::numeric = 30000 AND r ? 'purchase_price');
  PERFORM pg_temp.ok('anon: row read nulls the purchase facts',
    r -> 'purchase_price' = 'null'::jsonb AND r -> 'purchase_date' = 'null'::jsonb AND r -> 'purchase_location' = 'null'::jsonb);
  PERFORM pg_temp.ok('anon: a private row reads as NULL', public.vehicle_row_read('10000000-0000-0000-0000-000000000002') IS NULL);

  doc := public.get_vehicle_profile_data('10000000-0000-0000-0000-000000000001')::jsonb;
  PERFORM pg_temp.ok('anon: profile read masks the purchase facts',
    doc -> 'vehicle' -> 'purchase_price' = 'null'::jsonb AND doc -> 'vehicle' -> 'purchase_location' = 'null'::jsonb
    AND doc -> 'money_masked' = 'true'::jsonb AND doc -> 'vehicle' ->> 'model' = 'K5');
  PERFORM pg_temp.ok('anon: profile read of a private vehicle is NULL', public.get_vehicle_profile_data('10000000-0000-0000-0000-000000000002') IS NULL);

  PERFORM pg_temp.ok('anon: price signal falls back to MSRP, no purchase anywhere',
    (SELECT primary_label = 'MSRP' AND anchor_label = 'MSRP' AND delta_amount = 0
            AND NOT ('purchase_price' = ANY (missing_fields)) AND NOT ('vehicles.purchase_price' = ANY (sources)) AND confidence = 5
     FROM public.vehicle_price_signal(ARRAY['10000000-0000-0000-0000-000000000001']::uuid[])));
  PERFORM pg_temp.ok('anon: no price signal for a private vehicle',
    (SELECT count(*) FROM public.vehicle_price_signal(ARRAY['10000000-0000-0000-0000-000000000002']::uuid[])) = 0);
  PERFORM pg_temp.ok('anon: a purchase price is never listed as missing (its absence is the owner''s too)',
    (SELECT NOT ('purchase_price' = ANY (missing_fields)) FROM public.vehicle_price_signal(ARRAY['10000000-0000-0000-0000-000000000003']::uuid[])));

  PERFORM pg_temp.ok('anon: sold proof keeps the row, its notes and proof, not the sale price',
    (SELECT sale_price IS NULL AND org_vehicle_notes = 'External listing: bat' AND proof_type = 'manual_mark' AND year = 1972
     FROM public.sold_vehicle_proof WHERE org_vehicle_id = '40000000-0000-0000-0000-000000000001'));
  PERFORM pg_temp.ok('anon: public price history without the purchase row',
    (SELECT count(*) FILTER (WHERE price_type = 'purchase') = 0 AND count(*) FILTER (WHERE price_type = 'msrp') = 1
     FROM public.vehicle_price_history));
END $$;
SELECT pg_temp.ok('anon: vehicles_inventory is closed',
  NOT has_table_privilege('anon', 'public.vehicles_inventory', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.vehicles_inventory', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.vehicles_inventory', 'DELETE'));
RESET ROLE;

-- 2. Signed-in callers.
SET ROLE authenticated;
SELECT set_config('test.auth_role', 'authenticated', false);
-- The organization's board member, who also owns both vehicles.
SELECT set_config('test.auth_uid', '20000000-0000-0000-0000-000000000001', false);
DO $$
DECLARE doc jsonb; r jsonb;
BEGIN
  PERFORM pg_temp.ok('manager: manages the organization', public.caller_manages_organization('30000000-0000-0000-0000-000000000001'));
  PERFORM pg_temp.ok('manager: reads the books of booked links only',
    (SELECT count(*) = 1 AND bool_and(id = '40000000-0000-0000-0000-000000000001' AND cost_basis = 12000 AND sale_price = 18000
                                      AND asking_price = 21000 AND internal_notes = 'held for paint')
     FROM public.organization_vehicle_books('30000000-0000-0000-0000-000000000001')));
  PERFORM pg_temp.ok('manager: no books of another organization',
    (SELECT count(*) FROM public.organization_vehicle_books('30000000-0000-0000-0000-000000000002')) = 0);
  PERFORM pg_temp.ok('owner: reads the purchase facts of both vehicles',
    (SELECT count(*) = 2 AND sum(purchase_price) = 20000 AND max(purchase_location) = 'Las Vegas'
     FROM public.vehicle_owner_books(ARRAY['10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000003']::uuid[])));
  PERFORM pg_temp.ok('owner: the first 500 ids only',
    (SELECT count(*) FROM public.vehicle_owner_books(array_fill('10000000-0000-0000-0000-000000000003'::uuid, ARRAY[500])
                                                     || ARRAY['10000000-0000-0000-0000-000000000001']::uuid[])) = 0);
  r := public.vehicle_row_read('10000000-0000-0000-0000-000000000002');
  PERFORM pg_temp.ok('owner: reads the private row whole', (r ->> 'purchase_price')::numeric = 5000 AND r ->> 'make' = 'Ford');
  doc := public.get_vehicle_profile_data('10000000-0000-0000-0000-000000000001')::jsonb;
  PERFORM pg_temp.ok('owner: profile read carries the purchase facts',
    (doc -> 'vehicle' ->> 'purchase_price')::numeric = 15000 AND doc -> 'vehicle' ->> 'purchase_date' = '2024-06-01'
    AND doc -> 'money_masked' = 'false'::jsonb);
  PERFORM pg_temp.ok('owner: price signal labels PAID against PURCHASE',
    (SELECT primary_label = 'PAID' AND primary_value = 15000 AND anchor_label = 'PURCHASE' AND anchor_value = 15000
            AND confidence = 15 AND 'vehicles.purchase_price' = ANY (sources)
     FROM public.vehicle_price_signal(ARRAY['10000000-0000-0000-0000-000000000001']::uuid[])));
  PERFORM pg_temp.ok('owner: the private vehicle''s signal labels PAID',
    (SELECT primary_label = 'PAID' AND anchor_label = 'PURCHASE' AND anchor_value = 5000
     FROM public.vehicle_price_signal(ARRAY['10000000-0000-0000-0000-000000000002']::uuid[])));
  PERFORM pg_temp.ok('manager: sold proof carries the link sale price',
    (SELECT sale_price FROM public.sold_vehicle_proof WHERE org_vehicle_id = '40000000-0000-0000-0000-000000000001') = 18000);
  PERFORM pg_temp.ok('owner: price history keeps the purchase row',
    (SELECT count(*) FROM public.vehicle_price_history WHERE price_type = 'purchase') = 1);
END $$;

-- A contributor with access to the public vehicle: its purchase facts, no organization books.
SELECT set_config('test.auth_uid', '20000000-0000-0000-0000-000000000002', false);
DO $$ BEGIN
  PERFORM pg_temp.ok('contributor: purchase facts of the vehicle with access only',
    (SELECT count(*) = 1 AND bool_and(vehicle_id = '10000000-0000-0000-0000-000000000001')
     FROM public.vehicle_owner_books(ARRAY['10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002']::uuid[])));
  PERFORM pg_temp.ok('contributor: row read unmasked for the vehicle with access',
    (public.vehicle_row_read('10000000-0000-0000-0000-000000000001') ->> 'purchase_price')::numeric = 15000);
  PERFORM pg_temp.ok('contributor: no organization books', (SELECT count(*) FROM public.organization_vehicle_books('30000000-0000-0000-0000-000000000001')) = 0);
END $$;

-- A technician of the organization and a pending manager: members, but not its bookkeepers.
SELECT set_config('test.auth_uid', '20000000-0000-0000-0000-000000000003', false);
SELECT pg_temp.ok('technician: no books', (SELECT count(*) FROM public.organization_vehicle_books('30000000-0000-0000-0000-000000000001')) = 0);
SELECT set_config('test.auth_uid', '20000000-0000-0000-0000-000000000006', false);
SELECT pg_temp.ok('pending manager: no books', (SELECT count(*) FROM public.organization_vehicle_books('30000000-0000-0000-0000-000000000001')) = 0);

-- A signed-in stranger: nothing private anywhere.
SELECT set_config('test.auth_uid', '20000000-0000-0000-0000-000000000004', false);
DO $$ BEGIN
  PERFORM pg_temp.ok('stranger: no books, no owner books',
    (SELECT count(*) FROM public.organization_vehicle_books('30000000-0000-0000-0000-000000000001')) = 0
    AND (SELECT count(*) FROM public.vehicle_owner_books(ARRAY['10000000-0000-0000-0000-000000000001']::uuid[])) = 0);
  PERFORM pg_temp.ok('stranger: row and profile reads masked, private row hidden',
    public.vehicle_row_read('10000000-0000-0000-0000-000000000001') -> 'purchase_price' = 'null'::jsonb
    AND public.get_vehicle_profile_data('10000000-0000-0000-0000-000000000001')::jsonb -> 'money_masked' = 'true'::jsonb
    AND public.vehicle_row_read('10000000-0000-0000-0000-000000000002') IS NULL);
  PERFORM pg_temp.ok('stranger: sold proof without the sale price',
    (SELECT sale_price IS NULL FROM public.sold_vehicle_proof WHERE org_vehicle_id = '40000000-0000-0000-0000-000000000001'));
END $$;
RESET ROLE;

-- 3. Grants: stated, and PUBLIC holds none of the owner-run readers.
SELECT pg_temp.ok('readers: executable by the API roles, not by PUBLIC',
  (SELECT bool_and(has_function_privilege('anon', f, 'EXECUTE') AND has_function_privilege('authenticated', f, 'EXECUTE')
                   AND has_function_privilege('service_role', f, 'EXECUTE')
                   AND (SELECT proacl FROM pg_proc WHERE oid = f) IS NOT NULL
                   AND NOT EXISTS (SELECT 1 FROM aclexplode((SELECT proacl FROM pg_proc WHERE oid = f)) a WHERE a.grantee = 0))

   FROM unnest(ARRAY['public.caller_manages_organization(uuid)', 'public.organization_vehicle_books(uuid)',
                     'public.vehicle_owner_books(uuid[])', 'public.vehicle_row_read(uuid)',
                     'public.get_vehicle_profile_data(uuid)', 'public.vehicle_price_signal(uuid[])']::regprocedure[]) f));
SELECT pg_temp.ok('readers: SECURITY DEFINER with a pinned search_path',
  (SELECT bool_and(prosecdef AND proconfig::text LIKE '%search_path=public%') FROM pg_proc
   WHERE oid = ANY (ARRAY['public.caller_manages_organization(uuid)', 'public.organization_vehicle_books(uuid)',
                          'public.vehicle_owner_books(uuid[])', 'public.vehicle_row_read(uuid)']::regprocedure[])));
