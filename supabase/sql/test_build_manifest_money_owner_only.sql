-- Empty disposable PG17 only, from the repo root:
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_manifest_money -f supabase/sql/test_build_manifest_money_owner_only.sql
-- Proves 20261014050000_build_manifest_money_owner_only.sql: anon and a stranger read the public manifest
-- columns and none of the owner's fields; the owner reads them through vehicle_build_manifest_owner_fields;
-- the two money functions mask for everyone but the owner; the unused cost readers are closed.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;

-- Supabase's auth shims and roles.
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.auth_uid', true), '')::uuid $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;

-- The live shapes the migration touches.
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, owner_id uuid, user_id uuid, created_by_user_id uuid, uploaded_by uuid);
CREATE TABLE public.vehicle_build_manifest (id uuid PRIMARY KEY, vehicle_id uuid, device_name text, device_category text,
  manufacturer text, model_number text, part_number text, catalog_part_id uuid, supplier text, price numeric,
  price_source text, purchased boolean, invoice_ref text, pin_count integer, endpoint_description text,
  power_draw_amps numeric, signal_type text, requires_shielding boolean, connector_type text,
  wire_gauge_recommended integer, location_zone text, install_guide_url text, wiring_diagram_url text,
  datasheet_url text, device_pin_map_id uuid, pct_complete integer, missing_fields text[], status text, notes text,
  created_at timestamptz, updated_at timestamptz, sourcing_difficulty text, lead_time_days integer,
  supplier_contact text, supplier_type text, layer text, pos_x_pct numeric, pos_y_pct numeric,
  pdm_controlled boolean, pdm_channel_group text, product_image_url text, wire_status text,
  integration_decision text, open_questions text, evidence_level text, evidence_sources jsonb,
  harness_relevant boolean, quoted_cost numeric, actual_cost numeric, cost_source text, device_category_v2 text,
  device_family_v2 text, location_zone_v2 text, taxonomy_v2_notes text, tier text, pos_x_m numeric,
  pos_y_m numeric, pos_z_m numeric, pos_source text, weight_lbs numeric, length_in numeric, width_in numeric,
  height_in numeric, truck_runs_without_this boolean, pdm_channel_id uuid, interface_id uuid,
  lifecycle_state text, subsystem text);
ALTER TABLE public.vehicle_build_manifest ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON public.vehicle_build_manifest FOR SELECT USING (true);
CREATE TABLE public.qb_transactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, "date" date,
  vendor_name text, total_amount numeric, confidence numeric, enhanced_confidence numeric, category text);
CREATE TABLE public.invoice_learned_pricing (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), unit_price numeric, source_invoice text);
CREATE VIEW public.build_cost_comparison AS SELECT id, price AS quoted_cost FROM public.vehicle_build_manifest;
CREATE VIEW public.device_installation_status AS SELECT id, price FROM public.vehicle_build_manifest;
CREATE VIEW public.harness_workstation AS SELECT id, left(notes, 40) AS notes_short FROM public.vehicle_build_manifest;
CREATE VIEW public.wiring_enrichment_dashboard AS SELECT id, price FROM public.vehicle_build_manifest;
-- Supabase's default grants: everything to anon and authenticated.
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;

-- Access: the owner's contributor table, as vehicle_user_has_access reads it.
CREATE TABLE public.vehicle_contributors (vehicle_id uuid, user_id uuid, role text, status text);
CREATE FUNCTION public.vehicle_user_has_access(p_vehicle_id uuid, p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT p_user_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.vehicle_contributors c
    WHERE c.vehicle_id = p_vehicle_id AND c.user_id = p_user_id AND coalesce(c.status, 'active') = 'active'
      AND c.role IN ('owner', 'co_owner', 'mechanic')) $$;

-- The live definitions (hash-guarded by the migration).
\i supabase/sql/helpers/build_manifest_money_live_20261014.sql

-- Fixture: one vehicle, owner O, contributor C, stranger S; two devices, one bought.
INSERT INTO public.vehicles VALUES ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f1', NULL, NULL, NULL);
INSERT INTO public.vehicle_contributors VALUES ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', 'mechanic', 'active');
INSERT INTO public.vehicle_build_manifest (id, vehicle_id, device_name, price, purchased, invoice_ref, supplier_contact, evidence_sources, notes)
VALUES ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', 'ECU', 3000, true, 'INV-1', 'a@b.c', '[{"amount": 2010}]', 'paid $3000'),
       ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000a1', 'PDM', 1500, false, NULL, NULL, NULL, NULL);
INSERT INTO public.qb_transactions (vehicle_id, "date", vendor_name, total_amount, confidence)
VALUES ('00000000-0000-0000-0000-0000000000a1', '2026-01-05', 'Vendor', 99, 0.9);

-- Before: anon reads the money (the leak this migration closes).
SET ROLE anon;
DO $$ BEGIN
  IF (SELECT sum(price) FROM public.vehicle_build_manifest) IS DISTINCT FROM 4500 THEN
    RAISE EXCEPTION 'fixture: anon should read price before the migration';
  END IF;
END $$;
RESET ROLE;

\i supabase/migrations/20261014050000_build_manifest_money_owner_only.sql

-- anon: public columns yes, every owner field no, owner reader empty, summaries masked, cost readers closed.
SET ROLE anon;
SELECT set_config('test.auth_uid', '', false);
DO $$
DECLARE n int; s record; j jsonb;
BEGIN
  SELECT count(*) INTO n FROM public.vehicle_build_manifest WHERE device_name IS NOT NULL;
  IF n <> 2 THEN RAISE EXCEPTION 'anon: public columns should read 2 rows, got %', n; END IF;
  BEGIN PERFORM price FROM public.vehicle_build_manifest; RAISE EXCEPTION 'anon read price';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM notes FROM public.vehicle_build_manifest; RAISE EXCEPTION 'anon read notes';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM * FROM public.vehicle_build_manifest; RAISE EXCEPTION 'anon select * should fail';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  SELECT count(*) INTO n FROM public.vehicle_build_manifest_owner_fields('00000000-0000-0000-0000-0000000000a1');
  IF n <> 0 THEN RAISE EXCEPTION 'anon: owner fields returned % rows', n; END IF;
  SELECT * INTO s FROM public.wiring_tech_manifest_summary('00000000-0000-0000-0000-0000000000a1');
  IF s.devices_total <> 2 OR s.devices_purchased <> 1 OR s.spent_usd IS NOT NULL OR s.total_spec_usd IS NOT NULL THEN
    RAISE EXCEPTION 'anon: summary should count devices and null the dollars, got %', s;
  END IF;
  j := public.compute_build_spend_profile('00000000-0000-0000-0000-0000000000a1');
  IF (j->>'money_masked')::boolean IS NOT TRUE OR j ? 'total_documented_spend' OR j->'manifest' ? 'total_value'
     OR (j->'manifest'->>'total_devices')::int <> 2 THEN
    RAISE EXCEPTION 'anon: spend profile should be counts only, got %', j;
  END IF;
  BEGIN PERFORM * FROM public.build_cost_comparison; RAISE EXCEPTION 'anon read build_cost_comparison';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM * FROM public.invoice_learned_pricing; RAISE EXCEPTION 'anon read invoice_learned_pricing';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN UPDATE public.vehicle_build_manifest SET pos_x_pct = 1; RAISE EXCEPTION 'anon updated the manifest';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

-- A signed-in stranger: same as anon.
SET ROLE authenticated;
SELECT set_config('test.auth_uid', '00000000-0000-0000-0000-0000000000e1', false);
DO $$
DECLARE n int; s record; j jsonb;
BEGIN
  BEGIN PERFORM invoice_ref FROM public.vehicle_build_manifest; RAISE EXCEPTION 'stranger read invoice_ref';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  SELECT count(*) INTO n FROM public.vehicle_build_manifest_owner_fields('00000000-0000-0000-0000-0000000000a1');
  IF n <> 0 THEN RAISE EXCEPTION 'stranger: owner fields returned % rows', n; END IF;
  SELECT * INTO s FROM public.wiring_tech_manifest_summary('00000000-0000-0000-0000-0000000000a1');
  IF s.pending_usd IS NOT NULL THEN RAISE EXCEPTION 'stranger: summary dollars should be null'; END IF;
  j := public.compute_build_spend_profile('00000000-0000-0000-0000-0000000000a1');
  IF (j->>'money_masked')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'stranger: spend profile not masked'; END IF;
END $$;

-- The owner, then a contributor with access: everything.
SELECT set_config('test.auth_uid', '00000000-0000-0000-0000-0000000000f1', false);
DO $$
DECLARE n int; p numeric; s record; j jsonb;
BEGIN
  SELECT count(*), sum(price) INTO n, p FROM public.vehicle_build_manifest_owner_fields('00000000-0000-0000-0000-0000000000a1');
  IF n <> 2 OR p <> 4500 THEN RAISE EXCEPTION 'owner: owner fields should be 2 rows / 4500, got % / %', n, p; END IF;
  IF (SELECT notes FROM public.vehicle_build_manifest_owner_fields('00000000-0000-0000-0000-0000000000a1')
      WHERE id = '00000000-0000-0000-0000-0000000000d1') IS DISTINCT FROM 'paid $3000' THEN
    RAISE EXCEPTION 'owner: notes missing';
  END IF;
  SELECT * INTO s FROM public.wiring_tech_manifest_summary('00000000-0000-0000-0000-0000000000a1');
  IF s.spent_usd <> 3000 OR s.pending_usd <> 1500 OR s.total_spec_usd <> 4500 THEN
    RAISE EXCEPTION 'owner: summary dollars wrong, got %', s;
  END IF;
  j := public.compute_build_spend_profile('00000000-0000-0000-0000-0000000000a1');
  IF (j->>'money_masked')::boolean IS NOT FALSE OR (j->>'total_documented_spend')::numeric <> 99
     OR (j->'manifest'->>'total_value')::numeric <> 4500 THEN
    RAISE EXCEPTION 'owner: spend profile wrong, got %', j;
  END IF;
END $$;
SELECT set_config('test.auth_uid', '00000000-0000-0000-0000-0000000000c1', false);
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.vehicle_build_manifest_owner_fields('00000000-0000-0000-0000-0000000000a1');
  IF n <> 2 THEN RAISE EXCEPTION 'contributor: owner fields should be 2 rows, got %', n; END IF;
END $$;
RESET ROLE;

SELECT 'test_build_manifest_money_owner_only: PASS' AS result;
