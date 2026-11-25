-- Disposable PG17 contract for 20261125082000_organization_publication_states. Synthetic rows only. Builds on the
-- vendor-label rule contract (which ends reverted; 20261125031500 is applied again), adds the organizations columns and
-- tables create_organization_batch needs, loads its real definition (20261007130000), applies the migration twice, and
-- asserts: the intake-stamped private organisation is backfilled staged; a public one and an unstamped private one are
-- not; create_organization_batch writes a staged row for each organisation it creates; the vendor label names a
-- verified-domain organisation only while it is staged; the revert restores both functions byte for byte.
\set ON_ERROR_STOP on
\ir test_receipt_vendor_label_rule.sql
RESET ROLE;
SELECT set_config('test.role', '', false), set_config('test.uid', '', false);
\ir ../migrations/20261125031500_receipt_vendor_label_rule.sql

ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS website text, ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS state text, ADD COLUMN IF NOT EXISTS zip_code text, ADD COLUMN IF NOT EXISTS country text DEFAULT 'US',
  ADD COLUMN IF NOT EXISTS business_type text, ADD COLUMN IF NOT EXISTS discovered_by uuid, ADD COLUMN IF NOT EXISTS uploaded_by uuid,
  ADD COLUMN IF NOT EXISTS discovered_via text, ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.organizations ALTER COLUMN id SET DEFAULT gen_random_uuid();
CREATE TABLE IF NOT EXISTS public.write_receipts (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, at timestamptz DEFAULT now(),
  tbl text, op text, rows integer, writer text, db_role text, app_name text, txid bigint);
CREATE TABLE IF NOT EXISTS public.pipeline_registry (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_name text NOT NULL, column_name text,
  owned_by text NOT NULL, description text NOT NULL, valid_values text[], do_not_write_directly boolean NOT NULL DEFAULT false, write_via text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (table_name, column_name));
CREATE TABLE IF NOT EXISTS public.organization_visibility_changes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id), from_public boolean, to_public boolean NOT NULL, reason text NOT NULL,
  owner_delegated_sign_id uuid NOT NULL, changed_at timestamptz NOT NULL DEFAULT now());
\ir ../migrations/20261007130000_create_organization_batch.sql
CREATE TABLE public.batch_before AS SELECT md5(pg_get_functiondef('public.create_organization_batch(jsonb,text,boolean)'::regprocedure)) h;
CREATE TABLE public.label_before AS SELECT md5(pg_get_functiondef('public.receipt_vendor_label(uuid,text,boolean)'::regprocedure)) h;

-- e001 (the body shop, receipt c1) was written by the intake: private, stamped. e002 is public. e003 is private, unstamped.
UPDATE public.organizations SET is_public = false, metadata = '{"org_intake": {"source": "domain-verified-by-fetch-owner-delegated", "created_at": "2026-10-19T20:49:33Z"}}'
 WHERE id = '00000000-0000-0000-0000-00000000e001';
INSERT INTO public.organizations (id, name, is_public, metadata) VALUES ('00000000-0000-0000-0000-00000000e003', 'Unstamped Co', false, '{}');
UPDATE public.supply_vendors SET domain = 'speedway.example' WHERE vendor_slug = 'speedway';
DELETE FROM public.supply_vendor_domain_verifications;
INSERT INTO public.supply_vendor_domain_verifications (vendor_slug, domain, verdict) VALUES ('speedway', 'speedway.example', 'verified');

\ir ../migrations/20261125082000_organization_publication_states.sql
\ir ../migrations/20261125082000_organization_publication_states.sql

CREATE OR REPLACE FUNCTION pg_temp.anon_label() RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text; BEGIN
  PERFORM set_config('test.role', 'anon', false); PERFORM set_config('test.uid', '', false);
  SELECT vendor_name INTO v FROM public.receipts_public_summary WHERE id = '00000000-0000-0000-0000-0000000000c1';
  PERFORM set_config('test.role', '', false);
  RETURN v; END $$;
SELECT public.assert((SELECT string_agg(right(organization_id::text, 4) || ':' || state, ',') FROM public.organization_publication_states) = 'e001:staged',
                     'backfill: only the stamped private organisation is staged');
SELECT public.assert(pg_temp.anon_label() = 'Speedway Parts & Body', 'staged + verified domain: named');
SELECT public.assert((SELECT count(*) FROM regexp_matches(pg_get_functiondef('public.create_organization_batch(jsonb,text,boolean)'::regprocedure),
                       'organization_publication_states_v1', 'g')) = 2, 'batch patched once (declare + insert)');
CREATE TEMP TABLE made AS SELECT public.create_organization_batch('[{"business_name": "New Parts Co", "website": "https://newparts.example"}]', 'test-source') j;
SELECT public.assert((SELECT (j ->> 'created')::int FROM made) = 1, 'the batch created one: ' || (SELECT j::text FROM made));
SELECT public.assert(EXISTS (SELECT 1 FROM public.organization_publication_states s JOIN public.organizations o ON o.id = s.organization_id
                              WHERE o.business_name = 'New Parts Co' AND s.state = 'staged' AND s.set_by = 'create-organization-batch'
                                AND o.is_public IS NOT TRUE), 'the batch writes the staged state with the organisation');
-- the staged row is what the label rule promotes: without it a verified domain names nothing
DELETE FROM public.organization_publication_states WHERE organization_id = '00000000-0000-0000-0000-00000000e001';
SELECT public.assert(pg_temp.anon_label() = 'Seller not identified', 'not staged: a verified domain alone does not name it');
\ir revert_20261125082000_organization_publication_states.sql
SELECT public.assert(md5(pg_get_functiondef('public.create_organization_batch(jsonb,text,boolean)'::regprocedure)) = (SELECT h FROM public.batch_before),
                     'revert restores create_organization_batch');
SELECT public.assert(md5(pg_get_functiondef('public.receipt_vendor_label(uuid,text,boolean)'::regprocedure)) = (SELECT h FROM public.label_before),
                     'revert restores receipt_vendor_label');
SELECT public.assert(to_regclass('public.organization_publication_states') IS NULL, 'revert drops the table');
\echo organization_publication_states: ok
