-- Empty disposable PG17 only, as a superuser, from the repo root:
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_profile_read_functions_v1 -f supabase/sql/test_profile_read_functions_v1.sql
-- scripts/ci/run-db-contracts.sh runs it that way in the db-contracts job.
-- Contract for 20261116050000_profile_read_functions_v1.sql, 20261116050100_viva_preauction_trio_consigned.sql and
-- 20261116050200_owner_claim_reclassify_from_evidence.sql. Synthetic rows only; never production. The ids of the real profile, Viva and
-- the reviewed vehicles are reused so the two data fixes run unchanged; every other row is invented.
--   * labor: owner-confirmed and inferred minutes are separate buckets, never added; ids only for the account; null with no sessions.
--   * money: one total per (scope, direction, basis, currency); NULL currency stays NULL; junk vendors, self-named vendors, implausible
--     amounts and unsourced payments are flagged and kept out of trusted totals; superseded / duplicate receipts are not flows; deal
--     jackets attributed by creator or by the user's organization, never by a name; only the account sees money.
--   * vehicle relationships: owner only from title / purchase / own deal jacket; contributor from photos or record creation; conflicts make
--     ambiguous; denial + photos is contributor; no evidence is no_evidence; a visitor sees public vehicles and no private testimony.
--   * determinism: the same call twice gives the same jsonb.
--   * fix B links the trio to Viva as consigned inventory with Skylar as photographer, once; fix C changes only reviewed ids that still
--     classify as contributor, backs every change up, flips the default, and is a no-op the second time.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;

CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.auth_uid', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.auth_role', true), '') $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

-- The live columns these functions and fixes read or write (2026-11-09), nothing else.
CREATE TYPE public.receipt_doc_kind AS ENUM ('parts_service','vehicle_transaction','government_fee','fuel','insurance_document','tax_form',
  'financial_statement','letter_notice','personal_purchase','unknown','vehicle_sale','shipping','general_merchandise');
CREATE TYPE public.receipt_amount_check AS ENUM ('unchecked','verified','plausible','implausible','no_amount');
CREATE TABLE public.profiles (id uuid PRIMARY KEY, username text, full_name text);
CREATE TABLE public.organizations (id uuid PRIMARY KEY, business_name text);
CREATE TABLE public.organization_contributors (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid, user_id uuid, role text, status text);
CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), year int, make text, model text, owner_id uuid, user_id uuid, uploaded_by uuid,
  entry_type text DEFAULT 'owner_claim', is_public boolean DEFAULT true, deleted_at timestamptz, created_at timestamptz DEFAULT '2026-01-01',
  purchase_price numeric(10,2), purchase_date date, merged_into_vehicle_id uuid,
  CONSTRAINT vehicles_entry_type_check CHECK (entry_type = ANY (ARRAY['owner_claim','contributor_data','title_verified','disputed'])));
CREATE TABLE public.vehicle_images (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, user_id uuid, documented_by_user_id uuid,
  is_superseded boolean, is_duplicate boolean, taken_at timestamptz, created_at timestamptz DEFAULT '2026-01-02');
CREATE TABLE public.work_sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, vehicle_id uuid, session_date date,
  start_time timestamptz, duration_minutes int, status text, session_type text, intent_source text, confidence_score numeric(3,2),
  owner_confirmed_at timestamptz, created_at timestamptz DEFAULT '2026-01-03');
CREATE TABLE public.receipts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, vehicle_id uuid, scope_type text, scope_id text,
  total_amount numeric(10,2), total numeric, currency text, receipt_date date, transaction_date date, purchase_date date, vendor_name text,
  document_kind public.receipt_doc_kind, amount_check public.receipt_amount_check, is_superseded boolean, duplicate_of uuid);
CREATE TABLE public.payment_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, direction text, amount_usd numeric(14,2),
  paid_at timestamptz, counterparty_name text, counterparty_org_id uuid, scope_type text, scope_id uuid, description text,
  source_observation_id uuid, source_url text, is_superseded boolean);
CREATE TABLE public.deal_jackets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, created_by uuid, organization_id uuid,
  entity_owner text, deal_type text, acquisition_date date, sold_date date, initial_cost numeric, total_initial_cost numeric,
  sale_price_inc_doc numeric, total_selling_price numeric, net_auction_proceeds numeric, gross_profit numeric,
  created_at timestamptz DEFAULT '2026-01-04', visibility text DEFAULT 'org');
CREATE TABLE public.ownership_verifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, vehicle_id uuid, status text,
  verification_category text, title_document_url text, approved_at timestamp, human_reviewed_at timestamp, created_at timestamp DEFAULT '2026-01-05');
CREATE TABLE public.vehicle_documents (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, uploaded_by uuid, document_type text,
  title text, amount numeric(10,2), currency text, created_at timestamptz DEFAULT '2026-01-06');
CREATE TABLE public.vehicle_observations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, submitted_by_user_id uuid,
  extraction_method text, is_superseded boolean, structured_data jsonb, observed_at timestamptz DEFAULT '2026-01-07');
CREATE TABLE public.vehicle_ownerships (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, owner_profile_id uuid, role text,
  ownership_type text, is_current boolean, end_date date, verification_id uuid, superseded_at timestamptz, created_at timestamptz DEFAULT '2026-01-08');
CREATE TABLE public.vehicle_user_permissions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, user_id uuid, role text,
  is_active boolean, revoked_at timestamptz, granted_at timestamptz, created_at timestamptz DEFAULT '2026-01-09');
CREATE TABLE public.vehicle_contributors (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, user_id uuid, role text, status text,
  can_sell boolean, notes text, organization_id uuid, created_at timestamptz DEFAULT '2026-01-10',
  CONSTRAINT vehicle_contributors_vehicle_id_user_id_role_key UNIQUE (vehicle_id, user_id, role));
CREATE FUNCTION public.enforce_contributor_evidence() RETURNS trigger LANGUAGE plpgsql AS $f$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.vehicle_images vi WHERE vi.vehicle_id = NEW.vehicle_id
                   AND (vi.user_id = NEW.user_id OR vi.documented_by_user_id = NEW.user_id)) THEN
    RAISE EXCEPTION 'Cannot add contributor without photo evidence on this vehicle';
  END IF;
  RETURN NEW;
END $f$;
CREATE TRIGGER trg_enforce_contributor_evidence BEFORE INSERT OR UPDATE ON public.vehicle_contributors
  FOR EACH ROW EXECUTE FUNCTION public.enforce_contributor_evidence();
CREATE TABLE public.organization_vehicles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, vehicle_id uuid NOT NULL,
  relationship_type text NOT NULL, status text DEFAULT 'active', start_date date, end_date date, linked_by_user_id uuid,
  auto_tagged boolean DEFAULT false, notes text, created_at timestamptz DEFAULT '2026-01-11', listing_status text DEFAULT 'for_sale',
  user_confirmed boolean, user_confirmed_by uuid, user_confirmed_at timestamptz, user_rejected boolean,
  CONSTRAINT organization_vehicles_organization_id_vehicle_id_relations_key UNIQUE (organization_id, vehicle_id, relationship_type),
  CONSTRAINT organization_vehicles_relationship_type_check CHECK (relationship_type = ANY (ARRAY['owner','consigner','service_provider',
    'work_location','sold_by','storage','auction_platform','buyer','parts_supplier','fabricator','painter','upholstery','transport','inspector',
    'collaborator','current_consignment','past_consignment','purchased_from','supplier_inventory','supplier_sold','supplier_build'])),
  CONSTRAINT organization_vehicles_listing_status_check CHECK (listing_status = ANY (ARRAY['for_sale','sold','pending','new_arrival','in_build',
    'auction_soon','consignment','trade_in','parts_car','archived'])),
  CONSTRAINT organization_vehicles_status_check CHECK (status = ANY (ARRAY['active','past','pending','sold','archived'])));
-- The live org-stats trigger, which fix B switches off for its own inserts.
CREATE TABLE public.org_stats_calls (organization_id uuid);
CREATE FUNCTION public.update_organization_stats() RETURNS trigger LANGUAGE plpgsql AS $f$
BEGIN
  IF current_setting('app.skip_org_stats_trigger', true) = 'on' THEN RETURN COALESCE(NEW, OLD); END IF;
  INSERT INTO public.org_stats_calls VALUES (COALESCE(NEW.organization_id, OLD.organization_id));
  RETURN COALESCE(NEW, OLD);
END $f$;
CREATE TRIGGER trg_update_org_stats_on_vehicle AFTER INSERT OR DELETE ON public.organization_vehicles
  FOR EACH ROW EXECUTE FUNCTION public.update_organization_stats();

-- Row-level security as live on the money tables (own rows; org principals for deal jackets).
ALTER TABLE public.receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY own ON public.receipts FOR SELECT USING ((SELECT auth.uid()) = user_id);
ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY own ON public.payment_events FOR SELECT TO authenticated USING (user_id = auth.uid());
ALTER TABLE public.deal_jackets ENABLE ROW LEVEL SECURITY;
CREATE POLICY principals ON public.deal_jackets FOR SELECT USING (created_by = (SELECT auth.uid()) OR organization_id IN (
  SELECT oc.organization_id FROM public.organization_contributors oc WHERE oc.user_id = (SELECT auth.uid()) AND oc.status = 'active'
    AND oc.role = ANY (ARRAY['owner','co_founder','board_member','manager','employee','technician'])));

-- Cast. U = the real profile id (the fixes name it); S2 = the other profile named Skylar; X = a stranger.
INSERT INTO public.profiles VALUES
  ('0b9f107a-d124-49de-9ded-94698f63c1c4', 'skylar', 'skylar williams'),
  ('13450c45-3e8b-4124-9f5b-5c512094ff04', NULL, 'Skylar'),
  ('00000000-0000-0000-0000-0000000000aa', 'stranger', 'Some One');
INSERT INTO public.organizations VALUES ('c433d27e-2159-4f8c-b4ae-32a5e44a77cf', 'Viva! Las Vegas Autos'),
  ('e796ca48-f3af-41b5-be13-5335bb422b41', 'Ernies Upholstery'), ('00000000-0000-0000-0000-0000000000b2', 'Other Skylar Co');
INSERT INTO public.organization_contributors (organization_id, user_id, role, status) VALUES
  ('c433d27e-2159-4f8c-b4ae-32a5e44a77cf', '0b9f107a-d124-49de-9ded-94698f63c1c4', 'board_member', 'active'),
  ('00000000-0000-0000-0000-0000000000b2', '13450c45-3e8b-4124-9f5b-5c512094ff04', 'owner', 'active');

-- Vehicles. Trio: unowned contributor_data, private. Owner-claim set: ids the fixes review, each with a different evidence story.
INSERT INTO public.vehicles (id, year, make, model, owner_id, user_id, uploaded_by, entry_type, is_public) VALUES
  ('7b0e02b9-42af-4998-b27d-69e3459b452b', 1964, 'Porsche', '356C', NULL, '0b9f107a-d124-49de-9ded-94698f63c1c4', '0b9f107a-d124-49de-9ded-94698f63c1c4', 'contributor_data', false),
  ('1e9fdf16-b453-44a9-8b74-46bbe886625a', 1970, 'Chevrolet', 'Corvette', NULL, '0b9f107a-d124-49de-9ded-94698f63c1c4', '0b9f107a-d124-49de-9ded-94698f63c1c4', 'contributor_data', false),
  ('1b16f3ec-97c6-4826-b1af-89c8c4687e7b', 1966, 'Chevrolet', 'Chevelle', NULL, '0b9f107a-d124-49de-9ded-94698f63c1c4', '0b9f107a-d124-49de-9ded-94698f63c1c4', 'contributor_data', false);
INSERT INTO public.vehicles (id, year, make, model, owner_id) VALUES
  ('5b4e6bcd-7f31-410a-876a-cb2947d954f5', 1973, 'GMC', 'K5 (title)', '0b9f107a-d124-49de-9ded-94698f63c1c4'),
  ('1db5daca-526e-42c6-99ae-7faee79b5bad', 1995, 'Chevrolet', 'Suburban (purchase book entry)', '0b9f107a-d124-49de-9ded-94698f63c1c4'),
  ('043c6d8b-c81e-420a-9d20-77cf3385fc2a', 1973, 'Dodge', 'Charger (photos only)', '0b9f107a-d124-49de-9ded-94698f63c1c4'),
  ('d29a8779-6815-42b9-a20f-c835742d6080', 1965, 'Chevrolet', 'Corvette (photos, denial, sale money)', '0b9f107a-d124-49de-9ded-94698f63c1c4'),
  ('06d4eb9b-74af-49a8-af7c-75aeb5abfe27', 1980, 'Chevrolet', 'C10 (reviewed, now has a typed price)', '0b9f107a-d124-49de-9ded-94698f63c1c4'),
  ('ef844607-46fc-40a5-a27b-ad245ffe5ef5', 1973, 'Chevrolet', 'K20 (photos, book entry)', '0b9f107a-d124-49de-9ded-94698f63c1c4'),
  ('57d8c982-24f2-48ab-b289-f59f896cf459', 1957, 'Chevrolet', 'Bel Air (nothing)', '0b9f107a-d124-49de-9ded-94698f63c1c4');
UPDATE public.vehicles SET purchase_price = 40000 WHERE id = '06d4eb9b-74af-49a8-af7c-75aeb5abfe27';
INSERT INTO public.vehicles (id, year, make, model, owner_id, is_public) VALUES
  ('00000000-0000-0000-0000-0000000000c1', 2001, 'Private', 'Photos only, private', '0b9f107a-d124-49de-9ded-94698f63c1c4', false);
INSERT INTO public.vehicle_images (vehicle_id, user_id, taken_at)
SELECT v, '0b9f107a-d124-49de-9ded-94698f63c1c4', '2026-10-15 17:50+00' FROM unnest(ARRAY[
  '7b0e02b9-42af-4998-b27d-69e3459b452b', '1e9fdf16-b453-44a9-8b74-46bbe886625a', '1b16f3ec-97c6-4826-b1af-89c8c4687e7b',
  '5b4e6bcd-7f31-410a-876a-cb2947d954f5', '043c6d8b-c81e-420a-9d20-77cf3385fc2a', '043c6d8b-c81e-420a-9d20-77cf3385fc2a',
  'd29a8779-6815-42b9-a20f-c835742d6080', '06d4eb9b-74af-49a8-af7c-75aeb5abfe27', 'ef844607-46fc-40a5-a27b-ad245ffe5ef5',
  '00000000-0000-0000-0000-0000000000c1']::uuid[]) AS v;
INSERT INTO public.vehicle_images (vehicle_id, user_id, is_superseded) VALUES   -- superseded photo: not evidence
  ('57d8c982-24f2-48ab-b289-f59f896cf459', '0b9f107a-d124-49de-9ded-94698f63c1c4', true);
INSERT INTO public.vehicle_contributors (vehicle_id, user_id, role, status, can_sell) VALUES
  ('7b0e02b9-42af-4998-b27d-69e3459b452b', '0b9f107a-d124-49de-9ded-94698f63c1c4', 'photographer', 'active', false),
  ('1e9fdf16-b453-44a9-8b74-46bbe886625a', '0b9f107a-d124-49de-9ded-94698f63c1c4', 'photographer', 'active', false);
INSERT INTO public.organization_vehicles (organization_id, vehicle_id, relationship_type, status, listing_status) VALUES
  ('e796ca48-f3af-41b5-be13-5335bb422b41', '1b16f3ec-97c6-4826-b1af-89c8c4687e7b', 'work_location', 'active', 'for_sale');
INSERT INTO public.ownership_verifications (user_id, vehicle_id, status, verification_category, title_document_url, approved_at) VALUES
  ('0b9f107a-d124-49de-9ded-94698f63c1c4', '5b4e6bcd-7f31-410a-876a-cb2947d954f5', 'approved', 'title_document', 'https://x/title.jpg', '2026-10-19'),
  ('0b9f107a-d124-49de-9ded-94698f63c1c4', '57d8c982-24f2-48ab-b289-f59f896cf459', 'expired', 'title_document', 'https://x/t2.jpg', NULL);
INSERT INTO public.vehicle_documents (vehicle_id, uploaded_by, document_type, title, amount) VALUES
  ('1db5daca-526e-42c6-99ae-7faee79b5bad', '0b9f107a-d124-49de-9ded-94698f63c1c4', 'books_decision', 'Expense: Vehicle disposition acquisition/job costs', 11000),
  ('ef844607-46fc-40a5-a27b-ad245ffe5ef5', '0b9f107a-d124-49de-9ded-94698f63c1c4', 'books_decision', 'Reference: Inventory held: 1973 K20', 400);
INSERT INTO public.vehicle_observations (vehicle_id, submitted_by_user_id, extraction_method, structured_data) VALUES
  ('d29a8779-6815-42b9-a20f-c835742d6080', '0b9f107a-d124-49de-9ded-94698f63c1c4', 'garage_owner_correction_v1',
   '{"correction":{"relationship":{"roles":["sales_representative"],"ownership_denied":true}}}'),
  ('043c6d8b-c81e-420a-9d20-77cf3385fc2a', '0b9f107a-d124-49de-9ded-94698f63c1c4', 'garage_owner_correction_v1',
   '{"correction":{"cover_image_id":"00000000-0000-0000-0000-000000000001"}}');   -- a cover choice says nothing about ownership

-- Labor: two owner-confirmed sessions (60 + 30 min), three inferred (120, 0, NULL), one of somebody else.
INSERT INTO public.work_sessions (user_id, vehicle_id, session_date, duration_minutes, status, confidence_score, owner_confirmed_at) VALUES
  ('0b9f107a-d124-49de-9ded-94698f63c1c4', '043c6d8b-c81e-420a-9d20-77cf3385fc2a', '2026-06-01', 60, 'completed', 0.9, '2026-06-02'),
  ('0b9f107a-d124-49de-9ded-94698f63c1c4', '043c6d8b-c81e-420a-9d20-77cf3385fc2a', '2026-06-03', 30, 'completed', 0.9, '2026-06-04'),
  ('0b9f107a-d124-49de-9ded-94698f63c1c4', '043c6d8b-c81e-420a-9d20-77cf3385fc2a', '2026-06-05', 120, 'derived', 0.5, NULL),
  ('0b9f107a-d124-49de-9ded-94698f63c1c4', NULL, '2026-06-06', 0, 'auto_inferred', 0.4, NULL),
  ('0b9f107a-d124-49de-9ded-94698f63c1c4', NULL, '2026-06-07', NULL, 'auto_inferred', 0.3, NULL),
  ('13450c45-3e8b-4124-9f5b-5c512094ff04', NULL, '2026-06-07', 999, 'completed', 1, '2026-06-08');

-- Money.
INSERT INTO public.receipts (id, user_id, vendor_name, total_amount, currency, receipt_date, document_kind, amount_check, is_superseded, duplicate_of) VALUES
  ('00000000-0000-0000-0000-00000000d001', '0b9f107a-d124-49de-9ded-94698f63c1c4', 'O''Reilly Auto Parts', 100.00, 'USD', '2026-01-01', 'parts_service', 'verified', false, NULL),
  ('00000000-0000-0000-0000-00000000d002', '0b9f107a-d124-49de-9ded-94698f63c1c4', '***IMPORTANT***', 816001.00, NULL, '2026-01-02', 'unknown', 'implausible', false, NULL),
  ('00000000-0000-0000-0000-00000000d003', '0b9f107a-d124-49de-9ded-94698f63c1c4', 'Skylar Williams', 59000.00, 'USD', '2026-01-03', 'parts_service', 'plausible', false, NULL),
  ('00000000-0000-0000-0000-00000000d004', '0b9f107a-d124-49de-9ded-94698f63c1c4', 'Summit Racing', 50.00, NULL, '2026-01-04', 'parts_service', 'plausible', false, NULL),
  ('00000000-0000-0000-0000-00000000d005', '0b9f107a-d124-49de-9ded-94698f63c1c4', 'Superseded Co', 70.00, 'USD', '2026-01-05', 'parts_service', 'verified', true, NULL),
  ('00000000-0000-0000-0000-00000000d006', '0b9f107a-d124-49de-9ded-94698f63c1c4', 'O''Reilly Auto Parts', 100.00, 'USD', '2026-01-01', 'parts_service', 'verified', false, '00000000-0000-0000-0000-00000000d001'),
  ('00000000-0000-0000-0000-00000000d007', '0b9f107a-d124-49de-9ded-94698f63c1c4', 'Bring a Trailer', 31000.00, 'USD', '2026-02-22', 'vehicle_sale', 'plausible', false, NULL),
  ('00000000-0000-0000-0000-00000000d008', '0b9f107a-d124-49de-9ded-94698f63c1c4', '25-Jul-25', 219501.66, NULL, '2026-01-06', 'unknown', 'implausible', false, NULL),
  ('00000000-0000-0000-0000-00000000d009', '13450c45-3e8b-4124-9f5b-5c512094ff04', 'Not mine', 5.00, 'USD', '2026-01-01', 'parts_service', 'verified', false, NULL);
INSERT INTO public.payment_events (id, user_id, direction, amount_usd, paid_at, counterparty_name, scope_type, scope_id, source_url, is_superseded) VALUES
  ('00000000-0000-0000-0000-00000000e001', '0b9f107a-d124-49de-9ded-94698f63c1c4', 'in', 1000, '2026-03-01 12:00+00', 'Buyer', 'personal', NULL, 'https://x/receipt', false),
  ('00000000-0000-0000-0000-00000000e002', '0b9f107a-d124-49de-9ded-94698f63c1c4', 'out', 500, '2026-03-02 12:00+00', 'Seller', 'personal', NULL, NULL, false),
  ('00000000-0000-0000-0000-00000000e003', '0b9f107a-d124-49de-9ded-94698f63c1c4', 'in', 9999, '2026-03-03 12:00+00', 'Old', 'personal', NULL, 'https://x/old', true),
  ('00000000-0000-0000-0000-00000000e004', '0b9f107a-d124-49de-9ded-94698f63c1c4', 'in', 57300, '2025-10-18 00:00+00', NULL, 'vehicle', 'd29a8779-6815-42b9-a20f-c835742d6080', NULL, false);
INSERT INTO public.deal_jackets (id, vehicle_id, created_by, organization_id, entity_owner, deal_type, acquisition_date, sold_date, initial_cost,
  total_selling_price, net_auction_proceeds, gross_profit) VALUES
  ('00000000-0000-0000-0000-00000000f001', NULL, '0b9f107a-d124-49de-9ded-94698f63c1c4', NULL, NULL, 'retail_sale', '2023-10-14', '2026-02-22', 2000, 31000, NULL, 24062.78),
  ('00000000-0000-0000-0000-00000000f002', NULL, NULL, 'c433d27e-2159-4f8c-b4ae-32a5e44a77cf', 'viva', 'consignment', '2025-01-01', NULL, NULL, NULL, 15000, NULL),
  ('00000000-0000-0000-0000-00000000f003', NULL, '13450c45-3e8b-4124-9f5b-5c512094ff04', '00000000-0000-0000-0000-0000000000b2', 'skylar', 'sale', '2025-01-01', '2025-02-01', 1, 2, 3, 4);

\ir ../migrations/20261116050000_profile_read_functions_v1.sql
\ir ../migrations/20261116050000_profile_read_functions_v1.sql

CREATE TEMP TABLE got (k text PRIMARY KEY, j jsonb);
GRANT ALL ON got TO anon, authenticated, service_role;

-- Labor ---------------------------------------------------------------------------------------------------------------------------------
SET ROLE authenticated;
SELECT set_config('test.auth_uid', '0b9f107a-d124-49de-9ded-94698f63c1c4', false);
INSERT INTO got VALUES ('labor_own', public.profile_labor_read_v1('0b9f107a-d124-49de-9ded-94698f63c1c4')),
                       ('labor_own_again', public.profile_labor_read_v1('0b9f107a-d124-49de-9ded-94698f63c1c4')),
                       ('labor_nobody', public.profile_labor_read_v1('00000000-0000-0000-0000-0000000000aa'));
RESET ROLE; SET ROLE anon; SELECT set_config('test.auth_uid', '', false);
INSERT INTO got VALUES ('labor_anon', public.profile_labor_read_v1('0b9f107a-d124-49de-9ded-94698f63c1c4'));
RESET ROLE;
DO $t$
DECLARE o jsonb := (SELECT j FROM got WHERE k = 'labor_own'); a jsonb := (SELECT j FROM got WHERE k = 'labor_anon');
        n jsonb := (SELECT j FROM got WHERE k = 'labor_nobody');
BEGIN
  ASSERT o = (SELECT j FROM got WHERE k = 'labor_own_again'), 'labor: not deterministic';
  ASSERT (o #>> '{owner_confirmed,minutes}')::int = 90 AND (o #>> '{owner_confirmed,sessions}')::int = 2, 'labor: owner-confirmed bucket ' || o::text;
  ASSERT (o #>> '{inferred,minutes}')::int = 120 AND (o #>> '{inferred,sessions}')::int = 3
     AND (o #>> '{inferred,sessions_without_duration}')::int = 2, 'labor: inferred bucket ' || o::text;
  ASSERT o #> '{owner_confirmed,confidence}' = 'null'::jsonb AND (o #>> '{inferred,confidence}')::numeric = 0.4, 'labor: confidence only on inferred';
  ASSERT jsonb_array_length(o #> '{owner_confirmed,evidence_ids}') = 2 AND jsonb_array_length(o #> '{inferred,evidence_ids}') = 3, 'labor: ids';
  ASSERT NOT (o ? 'total_minutes') AND NOT (o ? 'hours_proven'), 'labor: must not add the buckets together';
  ASSERT (a ->> 'evidence_visible')::boolean = false AND a #> '{inferred,evidence_ids}' = 'null'::jsonb
     AND (a #>> '{inferred,minutes}')::int = 120, 'labor: visitor gets totals, no ids';
  ASSERT n -> 'owner_confirmed' = 'null'::jsonb AND n -> 'inferred' = 'null'::jsonb AND n -> 'as_of' = 'null'::jsonb, 'labor: no sessions is null, not zero';
END $t$;

-- Money ---------------------------------------------------------------------------------------------------------------------------------
SET ROLE authenticated;
SELECT set_config('test.auth_uid', '0b9f107a-d124-49de-9ded-94698f63c1c4', false);
INSERT INTO got VALUES ('money_own', public.profile_money_read_v1('0b9f107a-d124-49de-9ded-94698f63c1c4')),
                       ('money_own_again', public.profile_money_read_v1('0b9f107a-d124-49de-9ded-94698f63c1c4'));
CREATE TEMP TABLE flows AS SELECT * FROM public.profile_money_flows_v1('0b9f107a-d124-49de-9ded-94698f63c1c4');
SELECT set_config('test.auth_uid', '00000000-0000-0000-0000-0000000000aa', false);
INSERT INTO got VALUES ('money_stranger', public.profile_money_read_v1('0b9f107a-d124-49de-9ded-94698f63c1c4'));
RESET ROLE;
DO $t$
DECLARE o jsonb := (SELECT j FROM got WHERE k = 'money_own'); t jsonb;
BEGIN
  ASSERT o = (SELECT j FROM got WHERE k = 'money_own_again'), 'money: not deterministic';
  ASSERT (SELECT j ->> 'visible' FROM got WHERE k = 'money_stranger') = 'false'
     AND NOT ((SELECT j FROM got WHERE k = 'money_stranger') ? 'totals'), 'money: stranger must see nothing';
  -- no superseded / duplicate receipt, no superseded payment, nothing of the other Skylar
  ASSERT NOT EXISTS (SELECT 1 FROM flows WHERE evidence_id IN ('00000000-0000-0000-0000-00000000d005', '00000000-0000-0000-0000-00000000d006',
                       '00000000-0000-0000-0000-00000000e003', '00000000-0000-0000-0000-00000000d009', '00000000-0000-0000-0000-00000000f003')),
    'money: superseded, duplicate or foreign rows leaked into flows';
  ASSERT (SELECT count(*) FROM flows) = (SELECT count(DISTINCT (evidence_table, evidence_id, basis)) FROM flows), 'money: a fact counted twice';
  -- per (scope, direction, basis, currency)
  SELECT x INTO t FROM jsonb_array_elements(o -> 'totals') x
   WHERE x ->> 'scope' = 'personal' AND x ->> 'direction' = 'out' AND x ->> 'basis' = 'receipt_total' AND x ->> 'currency' = 'USD';
  ASSERT (t ->> 'trusted_amount')::numeric = 100 AND (t ->> 'flagged_amount')::numeric = 59000, 'money: USD receipts ' || t::text;
  SELECT x INTO t FROM jsonb_array_elements(o -> 'totals') x
   WHERE x ->> 'scope' = 'personal' AND x ->> 'direction' = 'out' AND x ->> 'basis' = 'receipt_total' AND x -> 'currency' = 'null'::jsonb;
  -- an unrecorded currency is its own bucket, never folded into USD; the junk vendors sit there flagged, not trusted
  ASSERT t -> 'trusted_amount' = 'null'::jsonb AND (t ->> 'flagged_count')::int = 3
     AND (t ->> 'flagged_amount')::numeric = 50 + 816001 + 219501.66
     AND t -> 'flagged_ids' ? 'receipts:00000000-0000-0000-0000-00000000d002'
     AND t -> 'flagged_ids' ? 'receipts:00000000-0000-0000-0000-00000000d008', 'money: unrecorded-currency bucket ' || t::text;
  ASSERT (SELECT flags FROM flows WHERE evidence_id = '00000000-0000-0000-0000-00000000d008')
         = ARRAY['looks_like_date', 'amount_implausible', 'currency_unrecorded'], 'money: date-shaped vendor flags';
  SELECT x INTO t FROM jsonb_array_elements(o -> 'totals') x
   WHERE x ->> 'direction' = 'in' AND x ->> 'basis' = 'payment' AND x ->> 'currency' = 'USD';
  ASSERT (t ->> 'trusted_amount')::numeric = 1000 AND (t ->> 'flagged_amount')::numeric = 57300, 'money: payments in ' || t::text;
  SELECT x INTO t FROM jsonb_array_elements(o -> 'totals') x WHERE x ->> 'direction' = 'out' AND x ->> 'basis' = 'payment';
  ASSERT t -> 'trusted_amount' = 'null'::jsonb AND (t ->> 'flagged_amount')::numeric = 500, 'money: unsourced payment flagged';
  SELECT x INTO t FROM jsonb_array_elements(o -> 'totals') x WHERE x ->> 'direction' = 'in' AND x ->> 'basis' = 'sale_document_total';
  ASSERT (t ->> 'trusted_amount')::numeric = 31000, 'money: sale document is in, own basis';
  -- deal jackets: never mixed, never a guessed currency
  ASSERT (SELECT count(*) FROM flows WHERE evidence_table = 'deal_jackets' AND currency IS NOT NULL) = 0, 'money: deal jacket currency guessed';
  ASSERT (SELECT array_agg(basis || '/' || scope ORDER BY basis, scope) FROM flows WHERE evidence_table = 'deal_jackets')
         = ARRAY['acquisition_cost/personal', 'gross_profit/personal', 'sale_buyer_paid/personal', 'sale_net_proceeds/organization'],
    'money: deal jacket amounts by basis and scope';
  ASSERT (SELECT flags FROM flows WHERE evidence_id = '00000000-0000-0000-0000-00000000d003') = ARRAY['names_the_user'], 'money: self-named vendor';
  ASSERT (SELECT flags FROM flows WHERE evidence_id = '00000000-0000-0000-0000-00000000d002')
         = ARRAY['boilerplate', 'markup_noise', 'amount_implausible', 'currency_unrecorded'], 'money: ***IMPORTANT*** flags';
  ASSERT (o #>> '{flag_counts,names_the_user}')::int = 1, 'money: flag counts';
END $t$;
DO $t$ BEGIN
  SET LOCAL ROLE anon;
  PERFORM public.profile_money_read_v1('0b9f107a-d124-49de-9ded-94698f63c1c4');
  RAISE EXCEPTION 'anon could call profile_money_read_v1';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $t$;
DO $t$ BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM * FROM public._profile_vehicle_evidence_v1('0b9f107a-d124-49de-9ded-94698f63c1c4', NULL);
  RAISE EXCEPTION 'authenticated could call the internal evidence function';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $t$;

-- Vehicle relationships, before the fixes -------------------------------------------------------------------------------------------
CREATE TEMP TABLE cls0 AS SELECT * FROM public._profile_ownership_class_v1('0b9f107a-d124-49de-9ded-94698f63c1c4');
DO $t$ BEGIN
  ASSERT (SELECT ownership_class FROM cls0 WHERE vehicle_id = '5b4e6bcd-7f31-410a-876a-cb2947d954f5') = 'owner', 'title -> owner';
  ASSERT (SELECT confidence FROM cls0 WHERE vehicle_id = '5b4e6bcd-7f31-410a-876a-cb2947d954f5') = 0.95, 'title confidence';
  ASSERT (SELECT ownership_class FROM cls0 WHERE vehicle_id = '1db5daca-526e-42c6-99ae-7faee79b5bad') = 'owner', 'purchase book entry -> owner';
  ASSERT (SELECT ownership_class FROM cls0 WHERE vehicle_id = '043c6d8b-c81e-420a-9d20-77cf3385fc2a') = 'contributor', 'photos -> contributor';
  ASSERT (SELECT ownership_class FROM cls0 WHERE vehicle_id = 'd29a8779-6815-42b9-a20f-c835742d6080') = 'contributor', 'denial + photos -> contributor';
  ASSERT (SELECT ownership_class FROM cls0 WHERE vehicle_id = '06d4eb9b-74af-49a8-af7c-75aeb5abfe27') = 'ambiguous', 'typed price -> ambiguous';
  ASSERT (SELECT ownership_class FROM cls0 WHERE vehicle_id = 'ef844607-46fc-40a5-a27b-ad245ffe5ef5') = 'ambiguous', 'book entry -> ambiguous';
  ASSERT (SELECT ownership_class FROM cls0 WHERE vehicle_id = '57d8c982-24f2-48ab-b289-f59f896cf459') = 'no_evidence', 'nothing -> no_evidence';
  ASSERT (SELECT confidence FROM cls0 WHERE vehicle_id = '57d8c982-24f2-48ab-b289-f59f896cf459') IS NULL, 'no evidence -> null confidence';
  ASSERT (SELECT ownership_class FROM cls0 WHERE vehicle_id = '7b0e02b9-42af-4998-b27d-69e3459b452b') = 'contributor', 'trio -> contributor';
END $t$;

SET ROLE anon; SELECT set_config('test.auth_uid', '', false);
INSERT INTO got VALUES ('rel_anon', public.profile_vehicle_relationships_read_v1('0b9f107a-d124-49de-9ded-94698f63c1c4'));
RESET ROLE; SET ROLE authenticated; SELECT set_config('test.auth_uid', '0b9f107a-d124-49de-9ded-94698f63c1c4', false);
INSERT INTO got VALUES ('rel_own', public.profile_vehicle_relationships_read_v1('0b9f107a-d124-49de-9ded-94698f63c1c4')),
                       ('rel_own_again', public.profile_vehicle_relationships_read_v1('0b9f107a-d124-49de-9ded-94698f63c1c4'));
RESET ROLE;
DO $t$
DECLARE o jsonb := (SELECT j FROM got WHERE k = 'rel_own'); a jsonb := (SELECT j FROM got WHERE k = 'rel_anon'); v jsonb;
BEGIN
  ASSERT o = (SELECT j FROM got WHERE k = 'rel_own_again'), 'relationships: not deterministic';
  ASSERT (SELECT count(*) FROM jsonb_array_elements(o -> 'vehicles')) = 11, 'relationships: own view vehicle count';
  ASSERT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(a -> 'vehicles') x
                     WHERE x ->> 'vehicle_id' IN ('7b0e02b9-42af-4998-b27d-69e3459b452b', '00000000-0000-0000-0000-0000000000c1')),
    'relationships: a visitor saw a private vehicle';
  SELECT x INTO v FROM jsonb_array_elements(a -> 'vehicles') x WHERE x ->> 'vehicle_id' = 'ef844607-46fc-40a5-a27b-ad245ffe5ef5';
  ASSERT v ->> 'ownership_class' = 'unresolved' AND v -> 'conflicts' = 'null'::jsonb AND v -> 'asserted' = 'null'::jsonb,
    'relationships: visitor sees no private testimony ' || v::text;
  ASSERT (SELECT bool_and(r -> 'evidence_ids' = 'null'::jsonb) FROM jsonb_array_elements(v -> 'roles') r), 'relationships: visitor saw photo ids';
  SELECT x INTO v FROM jsonb_array_elements(o -> 'vehicles') x WHERE x ->> 'vehicle_id' = 'ef844607-46fc-40a5-a27b-ad245ffe5ef5';
  ASSERT v ->> 'ownership_class' = 'ambiguous' AND jsonb_array_length(v -> 'conflicts') = 1
     AND (v #>> '{asserted,owner_id_is_user}')::boolean, 'relationships: own view shows conflicts and the assertion ' || v::text;
  SELECT x INTO v FROM jsonb_array_elements(o -> 'vehicles') x WHERE x ->> 'vehicle_id' = '1b16f3ec-97c6-4826-b1af-89c8c4687e7b';
  ASSERT EXISTS (SELECT 1 FROM jsonb_array_elements(v -> 'roles') r WHERE r ->> 'role' = 'custody'
                   AND r ->> 'organization_id' = 'e796ca48-f3af-41b5-be13-5335bb422b41'), 'relationships: Ernies custody link';
  ASSERT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v -> 'roles') r WHERE r ->> 'role' IN ('owner', 'organization_inventory')),
    'relationships: Chevelle has no owner / inventory before fix B';
END $t$;

-- Fix B, twice ----------------------------------------------------------------------------------------------------------------------
TRUNCATE public.org_stats_calls;
\ir ../migrations/20261116050100_viva_preauction_trio_consigned.sql
\ir ../migrations/20261116050100_viva_preauction_trio_consigned.sql
DO $t$ BEGIN
  ASSERT (SELECT count(*) FROM public.organization_vehicles WHERE organization_id = 'c433d27e-2159-4f8c-b4ae-32a5e44a77cf'
            AND relationship_type = 'consigner' AND status = 'active' AND listing_status = 'auction_soon' AND user_confirmed
            AND linked_by_user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4') = 3, 'fix B: three consigned links';
  ASSERT (SELECT count(*) FROM public.vehicle_contributors WHERE user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4' AND role = 'photographer'
            AND vehicle_id IN ('7b0e02b9-42af-4998-b27d-69e3459b452b', '1e9fdf16-b453-44a9-8b74-46bbe886625a', '1b16f3ec-97c6-4826-b1af-89c8c4687e7b')) = 3,
    'fix B: photographer on all three';
  ASSERT (SELECT count(*) FROM public.vehicles WHERE id IN ('7b0e02b9-42af-4998-b27d-69e3459b452b', '1e9fdf16-b453-44a9-8b74-46bbe886625a',
            '1b16f3ec-97c6-4826-b1af-89c8c4687e7b') AND owner_id IS NULL AND entry_type = 'contributor_data') = 3, 'fix B: no owner written';
  ASSERT (SELECT count(*) FROM public.profile_data_fix_backup_20261114 WHERE fix = 'B') = 4, 'fix B: 3 links + 1 contributor backed up, once';
  ASSERT (SELECT count(*) FROM public.organization_vehicles WHERE vehicle_id = '1b16f3ec-97c6-4826-b1af-89c8c4687e7b'
            AND organization_id = 'e796ca48-f3af-41b5-be13-5335bb422b41' AND listing_status = 'for_sale') = 1, 'fix B: Ernies link untouched';
  ASSERT NOT EXISTS (SELECT 1 FROM public.org_stats_calls), 'fix B: org stats trigger should be skipped';
  ASSERT NOT has_table_privilege('anon', 'public.profile_data_fix_backup_20261114', 'SELECT')
     AND NOT has_table_privilege('authenticated', 'public.profile_data_fix_backup_20261114', 'SELECT'), 'backup table must be private';
  ASSERT EXISTS (SELECT 1 FROM public._profile_vehicle_evidence_v1('0b9f107a-d124-49de-9ded-94698f63c1c4', '1b16f3ec-97c6-4826-b1af-89c8c4687e7b')
                 WHERE signal = 'org_inventory' AND organization_id = 'c433d27e-2159-4f8c-b4ae-32a5e44a77cf' AND confidence = 0.9),
    'fix B: the read side now shows Viva inventory, confirmed';
  ASSERT (SELECT ownership_class FROM public._profile_ownership_class_v1('0b9f107a-d124-49de-9ded-94698f63c1c4')
          WHERE vehicle_id = '1b16f3ec-97c6-4826-b1af-89c8c4687e7b') = 'contributor', 'fix B: Skylar stays contributor';
END $t$;

-- Fix C, twice ----------------------------------------------------------------------------------------------------------------------
CREATE TEMP TABLE before_c AS SELECT id, owner_id, entry_type FROM public.vehicles;
\ir ../migrations/20261116050200_owner_claim_reclassify_from_evidence.sql
CREATE TEMP TABLE after_c1 AS SELECT id, owner_id, entry_type FROM public.vehicles;
\ir ../migrations/20261116050200_owner_claim_reclassify_from_evidence.sql
DO $t$ BEGIN
  ASSERT (SELECT array_agg(a.id ORDER BY a.id) FROM after_c1 a JOIN before_c b USING (id)
          WHERE (a.owner_id, a.entry_type) IS DISTINCT FROM (b.owner_id, b.entry_type))
         = ARRAY['043c6d8b-c81e-420a-9d20-77cf3385fc2a', 'd29a8779-6815-42b9-a20f-c835742d6080']::uuid[],
    'fix C: exactly the reviewed ids that still classify as contributor change';
  ASSERT (SELECT count(*) FROM after_c1 WHERE id IN ('043c6d8b-c81e-420a-9d20-77cf3385fc2a', 'd29a8779-6815-42b9-a20f-c835742d6080')
            AND owner_id IS NULL AND entry_type = 'contributor_data') = 2, 'fix C: contributor rows';
  ASSERT (SELECT owner_id FROM after_c1 WHERE id = '06d4eb9b-74af-49a8-af7c-75aeb5abfe27') = '0b9f107a-d124-49de-9ded-94698f63c1c4',
    'fix C: a reviewed id that turned ambiguous is skipped';
  ASSERT NOT EXISTS (SELECT 1 FROM public.vehicles v JOIN after_c1 a USING (id) WHERE (v.owner_id, v.entry_type) IS DISTINCT FROM (a.owner_id, a.entry_type)),
    'fix C: second run changed something';
  ASSERT (SELECT count(*) FROM public.profile_data_fix_backup_20261114 WHERE fix = 'C' AND action = 'update') = 2
     AND (SELECT count(*) FROM public.profile_data_fix_backup_20261114 WHERE fix = 'C' AND action = 'alter_default') = 1,
    'fix C: backups once';
  ASSERT (SELECT prior FROM public.profile_data_fix_backup_20261114 WHERE fix = 'C' AND row_key = '043c6d8b-c81e-420a-9d20-77cf3385fc2a')
         = jsonb_build_object('owner_id', '0b9f107a-d124-49de-9ded-94698f63c1c4', 'entry_type', 'owner_claim'), 'fix C: prior values kept';
  ASSERT (SELECT prior ->> 'default' FROM public.profile_data_fix_backup_20261114 WHERE fix = 'C' AND action = 'alter_default') = '''owner_claim''::text',
    'fix C: prior default kept';
END $t$;
INSERT INTO public.vehicles (year, make, model, user_id) VALUES (2020, 'New', 'Record', '00000000-0000-0000-0000-0000000000aa');
DO $t$ BEGIN
  ASSERT (SELECT entry_type FROM public.vehicles WHERE make = 'New') = 'contributor_data', 'default: a new record no longer claims ownership';
END $t$;

-- Undo, as written in the C header, restores the rows.
UPDATE public.vehicles v SET owner_id = (b.prior->>'owner_id')::uuid, entry_type = b.prior->>'entry_type'
  FROM public.profile_data_fix_backup_20261114 b
  WHERE b.fix = 'C' AND b.table_name = 'vehicles' AND b.action = 'update' AND v.id = b.row_key::uuid;
DO $t$ BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM public.vehicles v JOIN before_c b USING (id) WHERE (v.owner_id, v.entry_type) IS DISTINCT FROM (b.owner_id, b.entry_type)),
    'undo of fix C did not restore the rows';
END $t$;

\echo 'test_profile_read_functions_v1: all assertions passed'
