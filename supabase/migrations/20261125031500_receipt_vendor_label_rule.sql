-- 20261125031500 receipt_vendor_label_rule (receipt_vendor_public_v2.3): which organisations a logged-out reader may
-- name on a receipt comes from rule rows, not from organizations.is_public alone.
--
-- WHY. Since 20261125011500 an untied caller is told an organisation's name only when organizations.is_public is true.
-- Measured 2026-11-25: 132 receipts are keyed to 8 organisations with is_public false. On none of the 8 did a person or
-- a writer choose that: organization_visibility_changes holds 0 rows for them, and their updated_at equals their
-- creation date. is_public = false is create_organization_batch's staging default ("entity key only; is_public=false").
-- 7 were created 2026-10-19 by the fetch-verified vendor intake and 1 on 2026-11-07 from retained receipts. All 8 are
-- businesses in the supply register (decision create_by_domain, a domain and supply kinds). 7 of them have a
-- supply_vendor_domain_verifications row with verdict 'verified' for that domain. A private person prints no domain,
-- so no person reaches the register that way.
--
-- RULE (vendor_label_rules, rule rows; a row with enabled false stops naming by that rule):
--   public_organization       organizations.is_public is true
--   verified_register_domain  the organisation holds a supply_vendors row whose domain has a
--                             supply_vendor_domain_verifications row with verdict 'verified' for that same domain
-- An untied caller gets coalesce(name, business_name) when any enabled rule holds; otherwise 'eBay seller' for a
-- marketplace line, else 'Seller not identified'. Tied viewers still get the vendor as read. Nothing else changes.
-- MEASURED on anon receipts_public_summary before: 408 rows, organisation labels 155, 'Seller not identified' 230,
-- 'eBay seller' 8, null 15. PREDICTED after: organisation labels 211 (+56 receipts on 5 organisations), not identified
-- 174. The 33 receipts of the one organisation with no verification row stay masked.
-- TEST. supabase/sql/test_receipt_vendor_label_rule.sql. REVERT: supabase/sql/revert_20261125031500_receipt_vendor_label_rule.sql.

SET statement_timeout = '60s';
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.vendor_label_rules (
  rule_key text PRIMARY KEY CHECK (rule_key IN ('public_organization', 'verified_register_domain')),
  enabled boolean NOT NULL,
  description text NOT NULL
);
INSERT INTO public.vendor_label_rules (rule_key, enabled, description) VALUES
  ('public_organization', true, 'organizations.is_public is true'),
  ('verified_register_domain', true,
   'the organisation holds a supply_vendors row whose domain has a supply_vendor_domain_verifications row with verdict verified for that domain; a business''s own website, fetched')
ON CONFLICT (rule_key) DO NOTHING;
ALTER TABLE public.vendor_label_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vendor_label_rules_read ON public.vendor_label_rules;
CREATE POLICY vendor_label_rules_read ON public.vendor_label_rules FOR SELECT USING (true);
REVOKE ALL ON public.vendor_label_rules FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.vendor_label_rules TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.receipt_vendor_label(p_receipt_id uuid, p_vendor_name text, p_tied boolean) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT CASE
           WHEN p_tied IS TRUE THEN p_vendor_name
           WHEN nullif(btrim(coalesce(p_vendor_name, '')), '') IS NULL THEN NULL
           WHEN p_receipt_id IS NULL THEN public.receipt_vendor_for_viewer(p_vendor_name, false)
           ELSE coalesce((SELECT nullif(btrim(coalesce(o.name, o.business_name)), '')
                            FROM public.receipts r JOIN public.organizations o ON o.id = r.vendor_organization_id
                           WHERE r.id = p_receipt_id
                             -- receipt_vendor_label_rule_v1: named only by an enabled vendor_label_rules row
                             AND ((o.is_public IS TRUE
                                   AND EXISTS (SELECT 1 FROM public.vendor_label_rules lr WHERE lr.rule_key = 'public_organization' AND lr.enabled))
                               OR (EXISTS (SELECT 1 FROM public.vendor_label_rules lr WHERE lr.rule_key = 'verified_register_domain' AND lr.enabled)
                                   AND EXISTS (SELECT 1 FROM public.supply_vendors v
                                                 JOIN public.supply_vendor_domain_verifications d
                                                   ON d.vendor_slug = v.vendor_slug AND d.domain = v.domain AND d.verdict = 'verified'
                                                WHERE v.organization_id = o.id)))),
                         CASE WHEN p_vendor_name ~* '^\s*ebay\M' THEN 'eBay seller' END,
                         'Seller not identified')
         END
$$;
REVOKE ALL ON FUNCTION public.receipt_vendor_label(uuid, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.receipt_vendor_label(uuid, text, boolean) TO anon, authenticated, service_role;
