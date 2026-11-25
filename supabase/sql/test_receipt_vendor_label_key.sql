-- Disposable PG17 contract for 20261124213500_receipt_vendor_label_key (receipt_vendor_public_v2). Synthetic rows only.
-- Builds on the line-text contract (which builds on the vendor-label one), adds receipts.vendor_organization_id as
-- 20261124205000 made it, applies the migration twice, and asserts:
--   * an untied caller gets the organisation the receipt is keyed to, whatever its vendor string says;
--   * the alias register alone no longer names a vendor: no key, no organisation name;
--   * no private name reaches an untied caller from the three readers; tied viewers keep the string as read;
--   * a second run changes nothing, and the revert restores v1.
\set ON_ERROR_STOP on
\ir test_receipt_line_text_public.sql
RESET ROLE;
SELECT set_config('test.role', '', false), set_config('test.uid', '', false);

ALTER TABLE public.receipts ADD COLUMN IF NOT EXISTS vendor_organization_id uuid REFERENCES public.organizations(id);
-- As live (2026-11-24): the keyed organisations carry their name in business_name, with name NULL.
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS business_name text;
INSERT INTO public.organizations (id, name, is_public, business_name) VALUES ('00000000-0000-0000-0000-00000000e002', NULL, true, 'Corner Garage LLC');
-- The body shop receipt is keyed to its organisation; the garage invoice (vendor string a person's name) is keyed to the
-- garage the alias review resolved; the marketplace receipt has no key.
UPDATE public.receipts SET vendor_organization_id = '00000000-0000-0000-0000-00000000e001' WHERE id = '00000000-0000-0000-0000-0000000000c1';
UPDATE public.receipts SET vendor_organization_id = '00000000-0000-0000-0000-00000000e002' WHERE id = '00000000-0000-0000-0000-0000000000b2';

\ir ../migrations/20261124213500_receipt_vendor_label_key.sql
\ir ../migrations/20261124215000_receipt_vendor_label_business_name.sql

-- Logged out.
SELECT set_config('test.role', 'anon', false), set_config('test.uid', '', false);
SELECT public.assert((SELECT string_agg(vendor_name, ';' ORDER BY id) FROM public.receipts_public_summary
                       WHERE vehicle_id = '00000000-0000-0000-0000-0000000000a1')
                     = 'eBay seller;Corner Garage LLC;Speedway Parts & Body', 'anon: keyed organisation, marketplace, keyed organisation');
SELECT public.assert(concat_ws(' | ',
                       (SELECT string_agg(vendor_name, ';') FROM public.receipts_public_summary WHERE vehicle_id = '00000000-0000-0000-0000-0000000000a1'),
                       public.vehicle_build_reconstruction('00000000-0000-0000-0000-0000000000a1')::text,
                       public.get_vehicle_day_documents('00000000-0000-0000-0000-0000000000a1', '2024-01-08')::text,
                       public.get_vehicle_day_documents('00000000-0000-0000-0000-0000000000a1', '2024-02-01')::text) !~ 'Private',
                     'anon never receives a private name');
SELECT public.assert(public.get_vehicle_day_documents('00000000-0000-0000-0000-0000000000a1', '2024-02-01') #>> '{documents,0,vendor}' = 'Corner Garage LLC',
                     'anon day documents: the keyed organisation');
SELECT public.assert(public.vehicle_build_reconstruction('00000000-0000-0000-0000-0000000000a1')::text ~ 'Corner Garage LLC',
                     'anon build record: the keyed organisation');

-- The key, not the string: remove the body shop's key and its alias no longer names it.
RESET ROLE; SELECT set_config('test.role', '', false);
UPDATE public.receipts SET vendor_organization_id = NULL WHERE id = '00000000-0000-0000-0000-0000000000c1';
SELECT set_config('test.role', 'anon', false);
SELECT public.assert((SELECT vendor_name FROM public.receipts_public_summary WHERE id = '00000000-0000-0000-0000-0000000000c1')
                     = 'Seller not identified', 'no key: not identified, even with an alias');
SELECT public.assert(public.receipt_vendor_label(NULL, 'Speedway Parts and Body', false) = 'Speedway Parts & Body',
                     'a line with no receipt falls back to the v1 rule');
SELECT set_config('test.role', '', false);
UPDATE public.receipts SET vendor_organization_id = '00000000-0000-0000-0000-00000000e001' WHERE id = '00000000-0000-0000-0000-0000000000c1';

-- The vehicle's owner.
SELECT set_config('test.role', 'authenticated', false), set_config('test.uid', '00000000-0000-0000-0000-0000000000f1', false);
SELECT public.assert((SELECT vendor_name FROM public.receipts_public_summary WHERE id = '00000000-0000-0000-0000-0000000000b2') = 'Pat Private'
                     AND public.get_vehicle_day_documents('00000000-0000-0000-0000-0000000000a1', '2024-02-01') #>> '{documents,0,vendor}' = 'Pat Private',
                     'tied viewer keeps the vendor as read');

-- A second run changes nothing.
SELECT set_config('test.role', '', false), set_config('test.uid', '', false);
CREATE TEMP TABLE key_first AS SELECT pg_get_viewdef('public.receipts_public_summary'::regclass) v,
  pg_get_functiondef('public.vehicle_build_reconstruction(uuid)'::regprocedure) b,
  pg_get_functiondef('public.get_vehicle_day_documents(uuid, date)'::regprocedure) g;
\ir ../migrations/20261124213500_receipt_vendor_label_key.sql
SELECT public.assert((SELECT v = pg_get_viewdef('public.receipts_public_summary'::regclass)
                         AND b = pg_get_functiondef('public.vehicle_build_reconstruction(uuid)'::regprocedure)
                         AND g = pg_get_functiondef('public.get_vehicle_day_documents(uuid, date)'::regprocedure) FROM key_first),
                     'second run changes nothing');

-- The revert restores v1 and the migration applies again after it.
\ir revert_20261124213500_receipt_vendor_label_key.sql
SELECT public.assert(position('receipt_vendor_label' IN pg_get_functiondef('public.vehicle_build_reconstruction(uuid)'::regprocedure)) = 0
                     AND position('receipt_vendor_for_viewer' IN pg_get_viewdef('public.receipts_public_summary'::regclass)) > 0,
                     'revert restores v1');
\ir ../migrations/20261124213500_receipt_vendor_label_key.sql
\ir ../migrations/20261124215000_receipt_vendor_label_business_name.sql

SELECT 'test_receipt_vendor_label_key: ok';
