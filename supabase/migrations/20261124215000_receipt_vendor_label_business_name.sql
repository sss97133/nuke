-- 20261124215000 receipt_vendor_label_business_name (receipt_vendor_public_v2.1)
--
-- WHY. After 20261124213500 deployed (2026-11-24 22:45 PT), logged-out vendor labels on receipts_public_summary went
-- from 272 organisation-named of 408 to 0: organizations.name is NULL on all 20 organisations receipts are keyed to;
-- their name is in organizations.business_name. v1 read supply_vendors.business_name, which is why it showed names.
-- No private name was exposed by the defect; visitors lost the shop names.
--
-- FIX. receipt_vendor_label reads coalesce(organizations.name, organizations.business_name). Nothing else changes.
-- TEST. supabase/sql/test_receipt_vendor_label_key.sql (fixture organisations now carry business_name with name NULL).

SET statement_timeout = '60s';
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.receipt_vendor_label(p_receipt_id uuid, p_vendor_name text, p_tied boolean) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT CASE
           WHEN p_tied IS TRUE THEN p_vendor_name
           WHEN nullif(btrim(coalesce(p_vendor_name, '')), '') IS NULL THEN NULL
           WHEN p_receipt_id IS NULL THEN public.receipt_vendor_for_viewer(p_vendor_name, false)
           ELSE coalesce((SELECT nullif(btrim(coalesce(o.name, o.business_name)), '')
                            FROM public.receipts r JOIN public.organizations o ON o.id = r.vendor_organization_id
                           WHERE r.id = p_receipt_id),
                         CASE WHEN p_vendor_name ~* '^\s*ebay\M' THEN 'eBay seller' END,
                         'Seller not identified')
         END
$$;
REVOKE ALL ON FUNCTION public.receipt_vendor_label(uuid, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.receipt_vendor_label(uuid, text, boolean) TO anon, authenticated, service_role;
