-- receipts.vendor_organization_id (migration 20261124205000): the reviewed vendor alias resolves a receipt's vendor to an
-- organisation when the receipt lands, when its vendor name changes, and when an alias is reviewed or its organisation
-- resolved later; a direct write of the columns is replaced by the resolver's answer; an unaliased name stays NULL.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_receipt_vendor_organization%' OR to_regclass('public.receipts') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires empty disposable dm_refinement_receipt_vendor_organization* database';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
END $$;
CREATE TABLE public.organizations(id uuid PRIMARY KEY, business_name text);
CREATE TABLE public.receipts(id uuid PRIMARY KEY, vendor_name text, total numeric);
CREATE TABLE public.supply_vendors(vendor_slug text PRIMARY KEY, business_name text, decision text, organization_id uuid REFERENCES public.organizations(id));
CREATE TABLE public.supply_vendor_aliases(alias_key text PRIMARY KEY, vendor_slug text REFERENCES public.supply_vendors(vendor_slug));
-- Production definition, 2026-11-24.
CREATE OR REPLACE FUNCTION public.supply_vendor_key(p_name text)
 RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT NULLIF(btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(lower(COALESCE(p_name, '')), '[®™©]', '', 'g'),
    '[^a-z0-9&'' ]+', ' ', 'g'), '\m(store|#)\s*[0-9]+.*$', ''), '\s+', ' ', 'g')), '')
$function$;
INSERT INTO public.organizations VALUES ('00000000-0000-4000-8000-00000000000a', 'Parts Org'), ('00000000-0000-4000-8000-00000000000b', 'Later Org');
INSERT INTO public.supply_vendors VALUES ('parts_co', 'Parts Co', 'existing_organization', '00000000-0000-4000-8000-00000000000a'),
  ('later_co', 'Later Co', 'create_by_domain', NULL);
INSERT INTO public.supply_vendor_aliases VALUES ('parts co', 'parts_co'), ('later co', 'later_co');
INSERT INTO public.receipts VALUES ('00000000-0000-4000-8000-000000000001', 'PARTS CO.', 10),
  ('00000000-0000-4000-8000-000000000002', 'Later Co', 20), ('00000000-0000-4000-8000-000000000003', 'A Private Person', 30),
  ('00000000-0000-4000-8000-000000000004', 'New Vendor', 40);

\ir ../migrations/20261124205000_receipt_vendor_organization.sql
\ir ../migrations/20261124205000_receipt_vendor_organization.sql

DO $$ BEGIN
  -- backfill
  IF (SELECT vendor_organization_id FROM public.receipts WHERE id = '00000000-0000-4000-8000-000000000001') IS DISTINCT FROM '00000000-0000-4000-8000-00000000000a'
     OR (SELECT vendor_organization_basis FROM public.receipts WHERE id = '00000000-0000-4000-8000-000000000001') <> 'supply_vendor_alias:parts_co' THEN
    RAISE EXCEPTION 'backfill: aliased vendor not resolved';
  END IF;
  IF EXISTS (SELECT 1 FROM public.receipts WHERE id IN ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004') AND vendor_organization_id IS NOT NULL) THEN
    RAISE EXCEPTION 'backfill: unresolved vendors must stay NULL';
  END IF;
END $$;
-- landing, by a signed-in uploader who cannot read the alias register
ALTER TABLE public.supply_vendor_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supply_vendors ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.receipts TO authenticated;
SET ROLE authenticated;
INSERT INTO public.receipts VALUES ('00000000-0000-4000-8000-000000000005', 'Parts Co', 50);
RESET ROLE;
-- direct write is replaced
UPDATE public.receipts SET vendor_organization_id = '00000000-0000-4000-8000-00000000000b' WHERE id = '00000000-0000-4000-8000-000000000003';
-- the alias's organisation resolved later
UPDATE public.supply_vendors SET organization_id = '00000000-0000-4000-8000-00000000000b' WHERE vendor_slug = 'later_co';
-- an alias reviewed later
INSERT INTO public.supply_vendor_aliases VALUES ('new vendor', 'parts_co');
-- a vendor name corrected away from an alias
UPDATE public.receipts SET vendor_name = 'Someone Else' WHERE id = '00000000-0000-4000-8000-000000000001';
DO $$ BEGIN
  IF (SELECT vendor_organization_id FROM public.receipts WHERE id = '00000000-0000-4000-8000-000000000005') IS DISTINCT FROM '00000000-0000-4000-8000-00000000000a' THEN RAISE EXCEPTION 'landing'; END IF;
  IF (SELECT vendor_organization_id FROM public.receipts WHERE id = '00000000-0000-4000-8000-000000000003') IS NOT NULL THEN RAISE EXCEPTION 'direct write kept'; END IF;
  IF (SELECT vendor_organization_id FROM public.receipts WHERE id = '00000000-0000-4000-8000-000000000002') IS DISTINCT FROM '00000000-0000-4000-8000-00000000000b' THEN RAISE EXCEPTION 'later organisation'; END IF;
  IF (SELECT vendor_organization_id FROM public.receipts WHERE id = '00000000-0000-4000-8000-000000000004') IS DISTINCT FROM '00000000-0000-4000-8000-00000000000a' THEN RAISE EXCEPTION 'later alias'; END IF;
  IF (SELECT vendor_organization_id FROM public.receipts WHERE id = '00000000-0000-4000-8000-000000000001') IS NOT NULL THEN RAISE EXCEPTION 'renamed vendor kept its organisation'; END IF;
  IF has_function_privilege('anon', 'public.supply_vendor_alias_receipts_refresh()', 'EXECUTE') THEN RAISE EXCEPTION 'grant'; END IF;
END $$;
DELETE FROM public.supply_vendor_aliases WHERE alias_key = 'new vendor';
DO $$ BEGIN
  IF (SELECT vendor_organization_id FROM public.receipts WHERE id = '00000000-0000-4000-8000-000000000004') IS NOT NULL THEN RAISE EXCEPTION 'alias removed, edge kept'; END IF;
END $$;

\ir revert_20261124205000_receipt_vendor_organization.sql
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'receipts' AND column_name IN ('vendor_organization_id','vendor_organization_basis')) THEN
    RAISE EXCEPTION 'revert incomplete';
  END IF;
END $$;
SELECT 'test_receipt_vendor_organization: ok' AS result;
