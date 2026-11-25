-- Revert 20261125082000_organization_publication_states: create_organization_batch without the staged write,
-- receipt_vendor_label as 20261125031500 defined it, then the table goes.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $patch$
DECLARE
  d text;
  a1 text := E'  c_writer constant text := ''create-organization-batch'';\n';
  r1 text := E'  c_writer constant text := ''create-organization-batch'';\n  v_staged_id uuid; /* organization_publication_states_v1 */\n';
  a2 text := E'            ELSE NULL END)));\n      v_created := v_created + 1;\n';
  r2 text := E'            ELSE NULL END)))\n      RETURNING id INTO v_staged_id;\n'
          || E'      -- organization_publication_states_v1: the private default is a staged state, not a privacy choice\n'
          || E'      INSERT INTO public.organization_publication_states (organization_id, state, basis, set_by)\n'
          || E'      VALUES (v_staged_id, ''staged'', ''create_organization_batch CREATE default; metadata.org_intake.source='' || p_source_slug, c_writer)\n'
          || E'      ON CONFLICT (organization_id) DO NOTHING;\n'
          || E'      v_created := v_created + 1;\n';
BEGIN
  d := pg_get_functiondef('public.create_organization_batch(jsonb,text,boolean)'::regprocedure);
  IF position('organization_publication_states_v1' IN d) = 0 THEN RETURN; END IF;
  EXECUTE replace(replace(d, r1, a1), r2, a2);
END $patch$;
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
UPDATE public.vendor_label_rules SET description =
  'the organisation holds a supply_vendors row whose domain has a supply_vendor_domain_verifications row with verdict verified for that domain; a business''s own website, fetched'
 WHERE rule_key = 'verified_register_domain';
DROP TABLE IF EXISTS public.organization_publication_states;
COMMIT;
