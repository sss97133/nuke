-- Disposable PG17 only. Proves 20261020050000_organization_supply_from_receipts.sql: purchase records resolve to
-- organizations only through reviewed exact vendor names; an organization is created only through create_organization_batch
-- for a vendor with a printed domain and at least one record (private, receipted), and found instead when that domain is
-- already on a row; named businesses without an identifier and every other counterparty (groceries, individuals) stay
-- counted gaps; supply kinds come from the vendor and the paid line categories; the projection is idempotent and follows
-- supersession; the open readers show kinds, counts and dates only.
-- Fixture: organizations / write_receipts / pipeline_registry as the create_organization_batch contract, the real
-- 20261007130000 migration, and the purchase tables (receipts, receipt_items, work_order_parts, payment_events) as live.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_%' OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.organizations') IS NOT NULL THEN
    RAISE EXCEPTION 'Empty disposable PG17 database required';
  END IF;
END $$;
SET TimeZone = 'UTC';
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_name text NOT NULL, name text, website text,
  city text, state text, zip_code text, country text DEFAULT 'US', is_public boolean DEFAULT true, business_type text,
  discovered_by uuid, uploaded_by uuid, discovered_via text, metadata jsonb DEFAULT '{}'::jsonb, created_at timestamptz DEFAULT now());
GRANT SELECT ON public.organizations TO anon, authenticated, service_role;
CREATE TABLE public.write_receipts (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, at timestamptz DEFAULT now(),
  tbl text, op text, rows integer, writer text, db_role text, app_name text, txid bigint);
CREATE TABLE public.pipeline_registry (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_name text NOT NULL, column_name text,
  owned_by text NOT NULL, description text NOT NULL, valid_values text[], do_not_write_directly boolean NOT NULL DEFAULT false, write_via text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (table_name, column_name));
CREATE FUNCTION public.platform_organization_label(p_organization_id uuid) RETURNS jsonb LANGUAGE sql STABLE
SET search_path TO 'pg_catalog', 'public' AS $function$
  SELECT CASE WHEN p_organization_id IS NULL THEN NULL ELSE
    jsonb_build_object('kind', 'organization', 'organization_id', p_organization_id,
      'name', (SELECT COALESCE(o.business_name, o.name) FROM public.organizations o WHERE o.id = p_organization_id)) END
$function$;
CREATE TABLE public.receipts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, vendor_name text, receipt_date date,
  transaction_date date, purchase_date date, created_at timestamptz DEFAULT now(), total_amount numeric, card_last4 text,
  is_superseded boolean, is_active boolean);
CREATE TABLE public.receipt_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), receipt_id uuid, description text, category text, total_price numeric);
CREATE TABLE public.work_order_parts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), supplier text, category text, part_name text,
  total_price numeric, created_at timestamptz DEFAULT now());
CREATE TABLE public.payment_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), direction text, amount_usd numeric, paid_at timestamptz,
  counterparty_name text, counterparty_org_id uuid, is_superseded boolean);
CREATE FUNCTION public.t_assert(v boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'PASS: %', label; END $$;
CREATE FUNCTION public.t_refused(q text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN false; EXCEPTION WHEN OTHERS THEN RETURN true; END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean,text), public.t_refused(text) TO anon, authenticated, service_role;

-- Organizations the reviewed map names by id, an existing Lowe's row (by domain), and an unrelated 'Albertsons' row.
INSERT INTO organizations(id, business_name, website, is_public, business_type) VALUES
 ('d0769163-47a9-4635-986c-e44a6ca86635', 'Holley', 'https://www.holley.com', true, 'other'),
 ('f40f60ca-e9dc-466a-9364-4ac407c4eca1', 'Wild Horses 4x4', 'https://www.wildhorses4x4.com', true, 'other'),
 ('40deadd4-f91f-4e92-99b5-50d42fcb0083', 'Ernie''s Upholstery', NULL, true, 'restoration_shop'),
 ('54e6ce85-a4d7-448e-8ad4-f23d3835486e', 'Tuckers Classic Auto Parts', 'https://tuckersparts.com', true, 'other'),
 ('0f000000-0000-0000-0000-0000000000b1', 'Lowe''s Home Improvement', 'https://www.lowes.com/', true, 'other'),
 ('0f000000-0000-0000-0000-0000000000b2', 'Albertsons', NULL, true, 'other');
INSERT INTO receipts(id, user_id, vendor_name, receipt_date, total_amount, card_last4) VALUES
 ('a1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000aa', 'AutoZone Store #5724', '2024-05-12', 41.17, '1234'),
 ('a1000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000aa', 'AUTO ZONE®', '2025-01-03', 12.50, '1234'),
 ('a1000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000aa', 'O''Reilly Auto Parts', '2026-03-28', 88.00, '1234'),
 ('a1000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000aa', 'Carquest Auto Parts', '2023-02-02', 30.00, '1234'),
 ('a1000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-0000000000aa', 'Albertsons', '2024-01-01', 54.00, '1234'),
 ('a1000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-0000000000aa', 'Holley', '2022-06-06', 400.00, '1234'),
 ('a1000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-0000000000aa', 'Skylar Williams', '2022-06-07', 10.00, '1234'),
 ('a1000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-0000000000aa', 'Lowe''s', '2021-09-09', 22.00, '1234'),
 ('a1000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-0000000000aa', 'AutoZone', '2020-01-01', 5.00, '1234');
UPDATE receipts SET is_superseded = true WHERE id = 'a1000000-0000-0000-0000-000000000009';
INSERT INTO receipt_items(receipt_id, description, category, total_price) VALUES
 ('a1000000-0000-0000-0000-000000000001', 'Rust primer spray', 'paint', 9.99), ('a1000000-0000-0000-0000-000000000001', 'Snacks', 'food', 3.00),
 ('a1000000-0000-0000-0000-000000000003', 'Brake pads', 'brakes', 80.00);
INSERT INTO work_order_parts(id, supplier, category, part_name, total_price) VALUES
 ('b2000000-0000-0000-0000-000000000001', 'Ernie''s Upholstery', 'interior', 'Seat recover', 600),
 ('b2000000-0000-0000-0000-000000000002', 'Summit Racing', 'exhaust', 'Muffler', 120);
INSERT INTO payment_events(id, direction, amount_usd, paid_at, counterparty_name, counterparty_org_id) VALUES
 ('c3000000-0000-0000-0000-000000000001', 'out', 300, '2023-03-03', 'Holley', 'd0769163-47a9-4635-986c-e44a6ca86635'),
 ('c3000000-0000-0000-0000-000000000002', 'in', 9000, '2023-04-04', 'Buyer org', '0f000000-0000-0000-0000-0000000000b2'),
 ('c3000000-0000-0000-0000-000000000003', 'out', 150, '2023-05-05', 'Tommy (paint)', NULL);

\ir ../migrations/20261007130000_create_organization_batch.sql
\ir ../migrations/20261020050000_organization_supply_from_receipts.sql

SELECT t_assert(NOT has_function_privilege('anon', 'public.supply_resolve_counterparties()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.supply_resolve_counterparties()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.supply_counterparty_gaps()', 'EXECUTE')
  AND has_function_privilege('anon', 'public.organization_supply_read(uuid)', 'EXECUTE')
  AND has_function_privilege('anon', 'public.requirement_plan_b_suppliers(text,integer)', 'EXECUTE')
  AND NOT has_table_privilege('anon', 'public.organization_supply_evidence', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.supply_vendors', 'SELECT'), 'resolver and gaps service-only; projection private; readers open');

-- 1. Organizations: created only for vendors with a printed domain and a record; found when the domain exists.
SELECT t_assert((SELECT count(*) FROM organizations WHERE discovered_via = 'declared-source:nuke-retained-receipts') = 2
  AND EXISTS (SELECT 1 FROM organizations WHERE website = 'https://autozone.com' AND business_name = 'AutoZone' AND is_public IS FALSE)
  AND EXISTS (SELECT 1 FROM organizations WHERE website = 'https://oreillyauto.com' AND is_public IS FALSE),
  'AutoZone and O''Reilly created privately through create_organization_batch');
SELECT t_assert(NOT EXISTS (SELECT 1 FROM organizations WHERE website IN ('https://tomsoffroad.com', 'https://lmctruck.com', 'https://lowes.com')),
  'no organization for vendors without records here, and none for a domain already on a row');
SELECT t_assert((SELECT organization_id FROM supply_vendors WHERE vendor_slug = 'lowes') = '0f000000-0000-0000-0000-0000000000b1',
  'Lowe''s resolved to the existing row by its domain');
SELECT t_assert((SELECT count(*) FROM write_receipts WHERE writer = 'create-organization-batch' AND tbl = 'organizations') = 2, 'each creation is receipted');
SELECT t_assert(NOT EXISTS (SELECT 1 FROM organizations WHERE business_name ~* '(carquest|summit|albertsons buyer|skylar|tommy)'),
  'named businesses without an identifier and individuals are never created');

-- 2. Evidence: reviewed names only, kinds from vendor and paid line categories, no superseded or personal records.
SELECT t_assert((SELECT jsonb_object_agg(supply_kind, n) FROM (SELECT supply_kind, count(*) n FROM organization_supply_evidence e
  JOIN organizations o ON o.id = e.organization_id WHERE o.website = 'https://autozone.com' GROUP BY 1) q) = '{"auto_parts":2,"paint_materials":1}',
  'AutoZone: two current receipts as auto parts, one paid paint line; food line ignored; superseded receipt excluded');
SELECT t_assert((SELECT array_agg(supply_kind ORDER BY supply_kind) FROM organization_supply_evidence e JOIN organizations o ON o.id = e.organization_id
  WHERE o.website = 'https://oreillyauto.com') = ARRAY['auto_parts','brake_parts'], 'O''Reilly: auto parts + brake parts from its line');
SELECT t_assert((SELECT array_agg(DISTINCT basis_table ORDER BY basis_table) FROM organization_supply_evidence
  WHERE organization_id = 'd0769163-47a9-4635-986c-e44a6ca86635') = ARRAY['payment_events','receipts'],
  'Holley: its receipt and the outgoing payment already resolved to it');
SELECT t_assert((SELECT count(*) FROM organization_supply_evidence WHERE organization_id = '40deadd4-f91f-4e92-99b5-50d42fcb0083'
  AND basis_table = 'work_order_parts' AND supply_kind IN ('upholstery_service', 'interior_parts')) = 2, 'Ernie''s Upholstery from a work-order part');
SELECT t_assert(NOT EXISTS (SELECT 1 FROM organization_supply_evidence WHERE basis_id IN ('a1000000-0000-0000-0000-000000000004',
  'a1000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000007', 'a1000000-0000-0000-0000-000000000009',
  'b2000000-0000-0000-0000-000000000002', 'c3000000-0000-0000-0000-000000000002', 'c3000000-0000-0000-0000-000000000003')),
  'not resolved: Carquest, Summit (no identifier), Albertsons, a person, a superseded receipt, an incoming payment, an individual payee');

-- 3. Idempotent; follows supersession.
SELECT count(*) AS n1 FROM organization_supply_evidence \gset
SELECT t_assert((SELECT r @> '{"organizations_created":0}' AND (r->>'evidence_rows')::int = :n1 FROM (SELECT supply_resolve_counterparties() r) x),
  'a second run creates nothing and keeps the same projection');
UPDATE receipts SET is_superseded = true WHERE id = 'a1000000-0000-0000-0000-000000000001';
SELECT supply_resolve_counterparties();
SELECT t_assert(NOT EXISTS (SELECT 1 FROM organization_supply_evidence WHERE basis_id = 'a1000000-0000-0000-0000-000000000001'),
  'a superseded receipt leaves the projection');
UPDATE receipts SET is_superseded = NULL WHERE id = 'a1000000-0000-0000-0000-000000000001';
SELECT supply_resolve_counterparties();

-- 4. Open readers: kinds, counts and dates only.
SET ROLE anon;
CREATE TEMP TABLE rd AS SELECT organization_supply_read((SELECT id FROM organizations WHERE website = 'https://autozone.com')) j;
SELECT t_assert((SELECT j @> '{"organization":{"name":"AutoZone"},"profile_public":false,"work_recorded_on_nuke":{"records":2,
  "kinds":[{"supply_kind":"auto_parts","times":2,"first_on":"2024-05-12","last_on":"2025-01-03"},{"supply_kind":"paint_materials","times":1}],
  "by_source":{"receipts":2}}}' FROM rd), 'organization_supply_read: kinds with counts and dates');
SELECT t_assert((SELECT j::text !~ '((^|[^:0-9.])(41\.17|12\.5)([^0-9]|$)|(^|[^0-9a-f-])1234([^0-9a-f-]|$)|a1000000|Rust primer|0000000000aa)' FROM rd), 'no amounts, card, receipt ids, line text or payer');
CREATE TEMP TABLE pb AS SELECT requirement_plan_b_suppliers('Paint touch-up capability for the door') j;
SELECT t_assert((SELECT jsonb_array_length(j) = 1 AND j->0 @> '{"organization":{"name":"AutoZone"},"kinds_matched":["paint_materials"],"times":1,
  "label":"paid for this before on Nuke (1 time)","role":"plan_b_supplier","profile_public":false}' FROM pb), 'plan-B: a paint requirement finds the paint supplier');
SELECT t_assert((SELECT jsonb_array_length(requirement_plan_b_suppliers('Seat upholstery for the bench')) = 1
  AND requirement_plan_b_suppliers('Seat upholstery for the bench')->0 @> '{"organization":{"name":"Ernie''s Upholstery"},"times":1}'),
  'plan-B: upholstery finds the upholsterer');
SELECT t_assert(requirement_plan_b_suppliers('Road-test drive') = '[]'::jsonb, 'no keyword, no suggestion');
SELECT t_assert((SELECT j::text !~ '((^|[^:0-9.])41\.17([^0-9]|$)|(^|[^0-9a-f-])1234([^0-9a-f-]|$)|a1000000)' FROM pb), 'plan-B carries no amounts or record ids');
RESET ROLE;

-- 5. Gaps (service).
SELECT t_assert((SELECT g @> '{"receipts":8,"named_businesses_without_identifier":[{"vendor":"Carquest Auto Parts","receipts":1}]}'
  AND (g->>'unmapped_receipts')::int = 2 FROM (SELECT supply_counterparty_gaps() g) x), 'gaps: named businesses without identifier and unmapped records are counted');
