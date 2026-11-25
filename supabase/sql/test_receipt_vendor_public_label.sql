-- Disposable PG17 contract for 20261124173000_receipt_vendor_public_label (receipt_vendor_public_v1). Synthetic rows only.
-- Builds on the receipt quote fixture (real definitions of vehicle_build_reconstruction and the receipt tables, md5-checked
-- there), adds the supply register and a day-documents reader of the live shape, applies the migration twice, and asserts:
--   * a logged-out caller never receives a vendor string carrying a private person's name, from any of the three readers;
--   * it receives the registered organisation's name, 'eBay seller' for a marketplace line, 'Seller not identified' otherwise;
--   * the vehicle's people (tied) still receive the vendor exactly as read;
--   * a second run changes nothing.
\set ON_ERROR_STOP on
\ir test_receipt_quote_kind.sql
RESET ROLE;
SELECT set_config('test.role', '', false), set_config('test.uid', '', false);

-- The live columns receipts_public_summary names that the quote fixture did not need.
ALTER TABLE public.receipts ADD COLUMN IF NOT EXISTS source_document_id uuid, ADD COLUMN IF NOT EXISTS source_document_table text,
  ADD COLUMN IF NOT EXISTS currency text, ADD COLUMN IF NOT EXISTS invoice_number text, ADD COLUMN IF NOT EXISTS transaction_number text;

-- The supply register as 20261020050000 created it (columns the reader uses) and its key function, verbatim.
CREATE TABLE IF NOT EXISTS public.organizations (id uuid PRIMARY KEY, name text, is_public boolean);
CREATE TABLE public.supply_vendors (vendor_slug text PRIMARY KEY, business_name text NOT NULL, decision text NOT NULL,
  organization_id uuid REFERENCES public.organizations(id));
CREATE TABLE public.supply_vendor_aliases (alias_key text PRIMARY KEY, vendor_slug text NOT NULL REFERENCES public.supply_vendors(vendor_slug));
CREATE FUNCTION public.supply_vendor_key(p_name text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT NULLIF(btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(lower(COALESCE(p_name, '')), '[®™©]', '', 'g'),
    '[^a-z0-9&'' ]+', ' ', 'g'), '\m(store|#)\s*[0-9]+.*$', ''), '\s+', ' ', 'g')), '')
$$;
INSERT INTO public.organizations VALUES ('00000000-0000-0000-0000-00000000e001', 'Speedway Parts & Body', false);
INSERT INTO public.supply_vendors VALUES ('speedway', 'Speedway Parts and Body', 'existing_organization', '00000000-0000-0000-0000-00000000e001'),
                                         ('napa', 'NAPA Auto Parts', 'gap_no_stable_identifier', NULL);
INSERT INTO public.supply_vendor_aliases VALUES ('speedway parts and body', 'speedway'), ('napa auto parts', 'napa');

-- A day-documents reader of the live shape: the gate CTE, the docs CTE and the 'vendor' key exactly as the live definition
-- writes them (2026-11-24); the migration wraps that key in place.
CREATE FUNCTION public.get_vehicle_day_documents(p_vehicle_id uuid, p_date date) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $function$
  WITH gate AS (
    SELECT (auth.role() = 'service_role' OR (auth.uid() IS NOT NULL AND (v.user_id = auth.uid() OR v.owner_id = auth.uid()))) IS TRUE AS tied
      FROM public.vehicles v WHERE v.id = p_vehicle_id AND v.is_public IS TRUE AND v.deleted_at IS NULL),
  docs AS (SELECT r.id, r.vendor_name FROM public.receipts r WHERE r.vehicle_id = p_vehicle_id AND r.receipt_date = p_date AND EXISTS (SELECT 1 FROM gate)),
  shaped AS (
    SELECT jsonb_build_object(
             'receipt_id', d.id, 'vendor', d.vendor_name, 'vendor_address', NULL) AS j, d.vendor_name
      FROM docs d)
  SELECT jsonb_build_object('tied', coalesce((SELECT tied FROM gate), false),
                            'documents', coalesce((SELECT jsonb_agg(s.j ORDER BY s.vendor_name) FROM shaped s), '[]'::jsonb));
$function$;

-- Car A's paper, re-typed the way private sellers and buyers' names arrive on real paper.
UPDATE public.receipts SET vendor_name = 'eBay seller handle9 (Jane Private); message signed Jane Private' WHERE id = '00000000-0000-0000-0000-0000000000b1';
UPDATE public.receipts SET vendor_name = 'Pat Private' WHERE id = '00000000-0000-0000-0000-0000000000b2';

\ir ../migrations/20261124173000_receipt_vendor_public_label.sql

CREATE FUNCTION pg_temp.all_reads(p_vehicle uuid) RETURNS text LANGUAGE sql AS $$
  SELECT concat_ws(' | ',
    (SELECT string_agg(vendor_name, ';') FROM public.receipts_public_summary WHERE vehicle_id = p_vehicle),
    public.vehicle_build_reconstruction(p_vehicle)::text,
    public.get_vehicle_day_documents(p_vehicle, '2024-01-08')::text,
    public.get_vehicle_day_documents(p_vehicle, '2024-02-01')::text)
$$;

-- Logged out.
SELECT set_config('test.role', 'anon', false), set_config('test.uid', '', false);
SELECT public.assert(pg_temp.all_reads('00000000-0000-0000-0000-0000000000a1') !~ 'Private', 'anon never receives a private name');
SELECT public.assert((SELECT string_agg(vendor_name, ';' ORDER BY id) FROM public.receipts_public_summary
                       WHERE vehicle_id = '00000000-0000-0000-0000-0000000000a1')
                     = 'eBay seller;Seller not identified;Speedway Parts & Body', 'anon labels in the summary view');
SELECT public.assert(public.get_vehicle_day_documents('00000000-0000-0000-0000-0000000000a1', '2024-01-08') #>> '{documents,0,vendor}' = 'eBay seller',
                     'anon day documents: the marketplace');
SELECT public.assert(public.vehicle_build_reconstruction('00000000-0000-0000-0000-0000000000a1')::text ~ 'Speedway Parts & Body',
                     'anon build record: the registered organisation');

-- The vehicle's owner.
SELECT set_config('test.role', 'authenticated', false), set_config('test.uid', '00000000-0000-0000-0000-0000000000f1', false);
SELECT public.assert((SELECT count(*) FROM public.receipts_public_summary WHERE vehicle_id = '00000000-0000-0000-0000-0000000000a1'
                       AND vendor_name IN ('Pat Private', 'eBay seller handle9 (Jane Private); message signed Jane Private')) = 2,
                     'tied viewer keeps the vendor as read (view)');
SELECT public.assert(public.get_vehicle_day_documents('00000000-0000-0000-0000-0000000000a1', '2024-02-01') #>> '{documents,0,vendor}' = 'Pat Private',
                     'tied viewer keeps the vendor as read (day documents)');
SELECT public.assert(public.vehicle_build_reconstruction('00000000-0000-0000-0000-0000000000a1')::text ~ 'Pat Private|Jane Private',
                     'tied viewer keeps the vendor as read (build record)');

-- The rule itself.
SELECT set_config('test.role', '', false), set_config('test.uid', '', false);
SELECT public.assert(public.receipt_vendor_for_viewer('NAPA AUTO PARTS', false) = 'NAPA Auto Parts', 'register business name when no organisation');
SELECT public.assert(public.receipt_vendor_for_viewer('  ', false) IS NULL AND public.receipt_vendor_for_viewer(NULL, false) IS NULL, 'blank stays blank');
SELECT public.assert(public.receipt_vendor_for_viewer('Pat Private', NULL) = 'Seller not identified', 'unknown tie is untied');

-- A second run changes nothing.
CREATE TEMP TABLE first_run AS SELECT pg_get_viewdef('public.receipts_public_summary'::regclass) v,
  pg_get_functiondef('public.vehicle_build_reconstruction(uuid)'::regprocedure) b,
  pg_get_functiondef('public.get_vehicle_day_documents(uuid, date)'::regprocedure) g;
\ir ../migrations/20261124173000_receipt_vendor_public_label.sql
SELECT public.assert((SELECT v = pg_get_viewdef('public.receipts_public_summary'::regclass)
                         AND b = pg_get_functiondef('public.vehicle_build_reconstruction(uuid)'::regprocedure)
                         AND g = pg_get_functiondef('public.get_vehicle_day_documents(uuid, date)'::regprocedure) FROM first_run),
                     'second run changes nothing');

SELECT 'test_receipt_vendor_public_label: ok';
