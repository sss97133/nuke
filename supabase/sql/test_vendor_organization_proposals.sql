-- Disposable PG17 contract for 20261125021500_vendor_organization_proposals. Synthetic rows only. Asserts:
--   * a key with one public candidate by exact name + printed phone and a mapped line is promoted: a register row and an
--     alias for that organisation; a gap vendor with such a candidate becomes existing_organization;
--   * one witness, two candidates, a private organisation, no mapped line and no candidate each hold, with that state;
--   * an unlinked key that is not a gap vendor is not a subject;
--   * a second run adds nothing and keeps the promoted rows; anon reads the rules, not the proposals, and cannot run
--     the fold; applied twice; the revert drops it all.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_vendor_organization_proposals%' OR to_regclass('public.receipts') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires empty disposable dm_refinement_vendor_organization_proposals* database'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE FUNCTION public.assert(ok boolean, what text) RETURNS void LANGUAGE plpgsql AS
  $$ BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'contract failed: %', what; END IF; END $$;
-- Production definition, 2026-11-25.
CREATE FUNCTION public.supply_vendor_key(p_name text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'pg_catalog', 'public' AS $function$
  SELECT NULLIF(btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(lower(COALESCE(p_name, '')), '[®™©]', '', 'g'),
    '[^a-z0-9&'' ]+', ' ', 'g'), '\m(store|#)\s*[0-9]+.*$', ''), '\s+', ' ', 'g')), '')
$function$;
CREATE TABLE public.organizations (id uuid PRIMARY KEY, name text, business_name text, phone text, website text, is_public boolean,
  status text DEFAULT 'active', is_active boolean DEFAULT true);
CREATE TABLE public.receipts (id uuid PRIMARY KEY, vendor_name text, raw_extraction jsonb, duplicate_of uuid, is_superseded boolean DEFAULT false,
  vendor_organization_id uuid);
CREATE TABLE public.receipt_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), receipt_id uuid REFERENCES public.receipts(id));
CREATE TABLE public.receipt_line_edges (receipt_item_id uuid REFERENCES public.receipt_items(id), system_key text);
CREATE TABLE public.receipt_vehicle_links (receipt_id uuid REFERENCES public.receipts(id), status text, retired_at timestamptz);
-- The register as 20261020050000 defines it.
CREATE TABLE public.supply_vendors (
  vendor_slug text PRIMARY KEY CHECK (vendor_slug ~ '^[a-z0-9_]+$'),
  business_name text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('existing_organization', 'create_by_domain', 'gap_no_stable_identifier')),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE RESTRICT,
  domain text CHECK (domain IS NULL OR domain ~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$'),
  supply_kinds text[] NOT NULL CHECK (cardinality(supply_kinds) BETWEEN 1 AND 6),
  basis text NOT NULL,
  reviewed_at date NOT NULL DEFAULT '2026-10-19',
  CHECK ((decision = 'existing_organization' AND organization_id IS NOT NULL)
    OR (decision = 'create_by_domain' AND domain IS NOT NULL)
    OR (decision = 'gap_no_stable_identifier' AND organization_id IS NULL AND domain IS NULL)));
CREATE TABLE public.supply_vendor_aliases (
  alias_key text PRIMARY KEY CHECK (alias_key = public.supply_vendor_key(alias_key)),
  vendor_slug text NOT NULL REFERENCES public.supply_vendors(vendor_slug) ON DELETE CASCADE);
CREATE TABLE public.supply_category_kinds (category text PRIMARY KEY, supply_kind text NOT NULL);
INSERT INTO public.supply_category_kinds VALUES ('interior', 'interior_parts'), ('brakes', 'brake_parts');

INSERT INTO public.organizations (id, name, business_name, phone, website, is_public) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'Alpha Parts', NULL, '(702) 555-0101', 'https://alphaparts.com', true),
  ('00000000-0000-0000-0000-0000000000b1', 'Beta Shop', NULL, '702-555-0202', NULL, true),
  ('00000000-0000-0000-0000-0000000000c1', 'Gamma Supply', NULL, NULL, NULL, true),
  ('00000000-0000-0000-0000-0000000000c2', 'GAMMA SUPPLY', NULL, NULL, NULL, true),
  ('00000000-0000-0000-0000-0000000000d1', 'Delta Person', NULL, '7025550404', NULL, false),
  ('00000000-0000-0000-0000-0000000000e1', 'Epsilon Tire', NULL, '7025550505', NULL, true),
  ('00000000-0000-0000-0000-0000000000f1', 'Zeta Garage', NULL, '7025550606', NULL, true);
INSERT INTO public.supply_vendors (vendor_slug, business_name, decision, supply_kinds, basis) VALUES
  ('epsilon_tire', 'Epsilon Tire', 'gap_no_stable_identifier', ARRAY['tire_service'], '2 receipts; no domain printed'),
  ('omega_design', 'Omega Design', 'gap_no_stable_identifier', ARRAY['offroad_parts'], '1 receipt; no domain printed');
INSERT INTO public.supply_vendor_aliases VALUES ('epsilon tire', 'epsilon_tire'), ('omega design', 'omega_design');
-- receipts: 01 alpha (name + phone + domain), 02 beta (name only), 03 gamma (two orgs), 04 delta (private), 05 epsilon
-- (gap vendor, name + phone), 06 zeta (name + phone, no mapped line), 07 omega (gap vendor, no org), 08 unlinked stranger
INSERT INTO public.receipts (id, vendor_name, raw_extraction) VALUES
  ('00000000-0000-0000-0000-000000000001', 'ALPHA PARTS', '{"data":{"merchant_phone":"702.555.0101"},"text":"www.alphaparts.com bill@gmail.com"}'),
  ('00000000-0000-0000-0000-000000000002', 'Beta Shop', '{}'),
  ('00000000-0000-0000-0000-000000000003', 'Gamma Supply', '{}'),
  ('00000000-0000-0000-0000-000000000004', 'Delta Person', '{"data":{"merchant_phone":"702 555 0404"}}'),
  ('00000000-0000-0000-0000-000000000005', 'Epsilon Tire', '{"data":{"merchant_phone":"7025550505"}}'),
  ('00000000-0000-0000-0000-000000000006', 'Zeta Garage', '{"data":{"merchant_phone":"7025550606"}}'),
  ('00000000-0000-0000-0000-000000000007', 'Omega Design', '{}'),
  ('00000000-0000-0000-0000-000000000008', 'Stranger Co', '{}');
INSERT INTO public.receipt_vehicle_links (receipt_id, status)
  SELECT id, 'linked' FROM public.receipts WHERE id <> '00000000-0000-0000-0000-000000000008';
INSERT INTO public.receipt_items (id, receipt_id) VALUES
  ('00000000-0000-0000-0000-0000000001a1', '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000001a2', '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000001b1', '00000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-0000000001f1', '00000000-0000-0000-0000-000000000006');
INSERT INTO public.receipt_line_edges VALUES
  ('00000000-0000-0000-0000-0000000001a1', 'interior'), ('00000000-0000-0000-0000-0000000001a2', 'brakes'),
  ('00000000-0000-0000-0000-0000000001b1', 'interior'), ('00000000-0000-0000-0000-0000000001f1', 'machining');

\ir ../migrations/20261125021500_vendor_organization_proposals.sql
\ir ../migrations/20261125021500_vendor_organization_proposals.sql

CREATE FUNCTION pg_temp.states() RETURNS text LANGUAGE sql AS $$
  SELECT string_agg(vendor_key || ':' || state || coalesce(':' || array_to_string(witness_kinds, '+'), ''), ',' ORDER BY vendor_key, organization_id)
    FROM public.vendor_organization_proposals WHERE retired_at IS NULL $$;
SELECT public.assert(pg_temp.states() =
  'alpha parts:promoted:exact_name+printed_domain+printed_phone,beta shop:held_one_witness:exact_name,'
  'delta person:held_private_organization:exact_name+printed_phone,epsilon tire:promoted:exact_name+printed_phone,'
  'gamma supply:held_ambiguous:exact_name,gamma supply:held_ambiguous:exact_name,omega design:no_organisation_in_register:,'
  'zeta garage:held_no_supply_kind:exact_name+printed_phone', 'states: ' || coalesce(pg_temp.states(), 'none'));
SELECT public.assert((SELECT proposed_supply_kinds FROM public.vendor_organization_proposals WHERE vendor_key = 'alpha parts' AND retired_at IS NULL)
                     = ARRAY['brake_parts', 'interior_parts'], 'kinds from the lines through supply_category_kinds');
SELECT public.assert(EXISTS (SELECT 1 FROM public.supply_vendor_aliases a JOIN public.supply_vendors v USING (vendor_slug)
                              WHERE a.alias_key = 'alpha parts' AND v.vendor_slug = 'vop_alpha_parts' AND v.decision = 'existing_organization'
                                AND v.organization_id = '00000000-0000-0000-0000-0000000000a1'), 'new key: register row + alias');
SELECT public.assert((SELECT decision || ' ' || organization_id FROM public.supply_vendors WHERE vendor_slug = 'epsilon_tire')
                     = 'existing_organization 00000000-0000-0000-0000-0000000000e1', 'gap vendor takes the organisation');
SELECT public.assert((SELECT decision FROM public.supply_vendors WHERE vendor_slug = 'omega_design') = 'gap_no_stable_identifier', 'no candidate: register untouched');
SELECT public.assert(NOT EXISTS (SELECT 1 FROM public.vendor_organization_proposals WHERE vendor_key = 'stranger co'), 'an unlinked key is not a subject');
CREATE TEMP TABLE second AS SELECT public.vendor_organization_proposals_fold('t2') AS j;
SELECT public.assert((SELECT (j ->> 'added')::int = 0 AND (j ->> 'retired')::int = 0 AND (j ->> 'promoted')::int = 0 FROM second),
                     'second run is quiet: ' || (SELECT j::text FROM second));
SET ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM count(*) FROM public.vendor_organization_proposals; RAISE EXCEPTION 'contract failed: anon read proposals'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.vendor_organization_proposals_fold('x'); RAISE EXCEPTION 'contract failed: anon ran the fold'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT public.assert((SELECT count(*) FROM public.vendor_organization_proposal_rules) = 4, 'anon reads the rule rows');
RESET ROLE;
\ir revert_20261125021500_vendor_organization_proposals.sql
SELECT public.assert(to_regclass('public.vendor_organization_proposals') IS NULL AND to_regclass('public.vendor_organization_proposal_rules') IS NULL
                     AND to_regprocedure('public.vendor_organization_proposals_fold(text)') IS NULL, 'revert drops it all');
\echo vendor_organization_proposals: ok
