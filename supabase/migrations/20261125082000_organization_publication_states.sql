-- organization_publication_states: create_organization_batch's private-by-default is recorded as what it is, a staged
-- state, and the vendor label rule promotes only staged organisations.
--
-- WHY. create_organization_batch writes every new organisation with is_public = false ("entity key only; is_public=false"),
-- and a boolean false reads as a privacy decision. Measured 2026-11-25: 13 organisations carry its metadata.org_intake
-- stamp, are not public, and have no organization_visibility_changes row; 8 of them are keyed by receipts. No function
-- sets an existing organisation private (0 matches over pg_proc), so no other state has a writer yet. The other 1,194
-- non-public organisations came from other writers and are left unlabelled: nothing on them says why.
--
-- WHAT.
--   organization_publication_states (grain: one organisation): organization_id PK FK organizations, state ('staged'),
--     basis, set_by, set_at. The only states are the ones a writer sets; is_public = true supersedes the row (a reader
--     tests is_public first; set_organizations_public_owner_delegated publishes and logs the change).
--   Backfill: the 13, with the intake source from their own metadata as basis.
--   create_organization_batch: its CREATE branch writes the staged row in the same statement block (two anchors, each
--     matched exactly once against the live body; a drifted body fails the migration instead of being rewritten).
--   receipt_vendor_label: rule verified_register_domain names an organisation only when it is staged, so a later
--     private state (or an unlabelled non-public organisation) is never named by a fetched domain.
-- A rule cannot publish a profile: organization_visibility_changes.owner_delegated_sign_id is NOT NULL, so the profile
-- flip stays the owner's Sign (set_organizations_public_owner_delegated). The rule promotes the label only.
-- PREDICTED on apply: 13 staged rows; anon receipts_public_summary labels unchanged from 20261125031500 (all 7
-- verified-domain organisations named there are staged).
-- Contract: supabase/sql/test_organization_publication_states.sql. Revert: supabase/sql/revert_20261125082000_organization_publication_states.sql.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS public.organization_publication_states (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  state text NOT NULL CHECK (state IN ('staged')),
  basis text NOT NULL,
  set_by text NOT NULL,
  set_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.organization_publication_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.organization_publication_states FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.organization_publication_states TO service_role;
COMMENT ON TABLE public.organization_publication_states IS
  'organization_publication_states_v1: why a non-public organisation is not public. staged = written private by create_organization_batch, never reviewed. is_public = true supersedes the row.';

INSERT INTO public.organization_publication_states (organization_id, state, basis, set_by, set_at)
SELECT o.id, 'staged',
       'create_organization_batch CREATE default; metadata.org_intake.source=' || coalesce(o.metadata #>> '{org_intake,source}', '?'),
       'migration:20261125082000',
       coalesce((o.metadata #>> '{org_intake,created_at}')::timestamptz, now())
  FROM public.organizations o
 WHERE o.is_public IS NOT TRUE AND o.metadata ? 'org_intake'
   AND NOT EXISTS (SELECT 1 FROM public.organization_visibility_changes c WHERE c.organization_id = o.id)
ON CONFLICT (organization_id) DO NOTHING;

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
  n int;
BEGIN
  d := pg_get_functiondef('public.create_organization_batch(jsonb,text,boolean)'::regprocedure);
  IF position('organization_publication_states_v1' IN d) > 0 THEN RETURN; END IF;
  FOR n IN SELECT (length(d) - length(replace(d, a, ''))) / length(a) FROM unnest(ARRAY[a1, a2]) a LOOP
    IF n <> 1 THEN RAISE EXCEPTION 'create_organization_batch anchor drifted: % matches', n; END IF;
  END LOOP;
  EXECUTE replace(replace(d, a1, r1), a2, r2);
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
                                   -- organization_publication_states_v1: only an organisation in the staged state
                                   AND EXISTS (SELECT 1 FROM public.organization_publication_states ps
                                                WHERE ps.organization_id = o.id AND ps.state = 'staged')
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
  'the organisation is staged (organization_publication_states) and holds a supply_vendors row whose domain has a supply_vendor_domain_verifications row with verdict verified for that domain'
 WHERE rule_key = 'verified_register_domain';

DO $$ BEGIN RAISE NOTICE 'organization_publication_states on apply: % staged, % keyed by receipts',
  (SELECT count(*) FROM public.organization_publication_states),
  (SELECT count(*) FROM public.organization_publication_states s WHERE EXISTS (SELECT 1 FROM public.receipts r WHERE r.vendor_organization_id = s.organization_id)); END $$;

COMMIT;
