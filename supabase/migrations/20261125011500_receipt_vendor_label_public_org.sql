-- 20261125011500 receipt_vendor_label_public_org (receipt_vendor_public_v2.2)
--
-- WHY. receipt_vendor_label names, to an untied caller, the organisation a receipt is keyed to
-- (receipts.vendor_organization_id). A public reader states its visibility test, and organizations.is_public is the
-- only visibility flag an organisation carries; 10 of the 23 organisations the alias register keys are is_public false
-- (ta-paper, 2026-11-25). Their names reached logged-out callers.
--
-- RULE. An untied caller gets coalesce(organizations.name, organizations.business_name) only when
-- organizations.is_public IS TRUE; otherwise 'eBay seller' for a marketplace line, else 'Seller not identified'.
-- Tied viewers still get the vendor as read. Nothing else changes.
-- TEST. supabase/sql/test_receipt_vendor_label_key.sql.

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
                           WHERE r.id = p_receipt_id AND o.is_public IS TRUE),
                         CASE WHEN p_vendor_name ~* '^\s*ebay\M' THEN 'eBay seller' END,
                         'Seller not identified')
         END
$$;
REVOKE ALL ON FUNCTION public.receipt_vendor_label(uuid, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.receipt_vendor_label(uuid, text, boolean) TO anon, authenticated, service_role;
