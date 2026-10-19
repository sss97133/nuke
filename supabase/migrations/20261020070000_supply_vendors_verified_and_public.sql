-- Supply organizations: public, and vendors whose official domain was verified by fetch.
--
-- Owner-delegated decisions (2026-10-19, lead under the owner's 16:09Z authorization):
--   1. The nine organizations created from retained receipts (20261020050000, create_organization_batch, is_public=false)
--      become public: businesses are not personal information under the open-data doctrine. No visibility writer exists
--      for organizations (the 2026-10-10 precedent was an inline migration UPDATE), so this adds a minimal one:
--      organization_visibility_changes (append-only audit) + set_organizations_public_owner_delegated(...) (service-only;
--      private -> public only; one owner_delegated_signs row per call, cited by each audit row).
--   2. Vendors recorded as gaps get a website only when their official domain was verified by fetching its homepage and
--      finding the company name in the title or og:site_name. supply_vendor_domain_verifications keeps each fetch (URL,
--      HTTP status, title, og:site_name, clock, verdict), including the four that failed (Offroad Design: title "ORD
--      Homepage"; George's Tire & Auto Repair: the listed domain is a different business in Fontana, CA; Lesa's Auto Body
--      Supplies: lesaslab.com unreachable; KM Racing: no matching company found). Verified vendors are created through
--      create_organization_batch with source 'domain-verified-by-fetch-owner-delegated', then the existing resolver links
--      their records and refreshes the supply projection. The new organizations stay private (create_organization_batch's
--      default); only the nine named in decision 1 are published here.
-- Side effect noted: a public organization with a website enqueues organization_inventory_sync_queue
-- (businesses_auto_investigate_zero_inventory); that queue has had no consumer since 2026-02-17.
-- Contract: supabase/sql/test_supply_vendors_verified_and_public.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

CREATE TABLE public.organization_visibility_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  from_public boolean,
  to_public boolean NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 1000),
  owner_delegated_sign_id uuid NOT NULL REFERENCES public.owner_delegated_signs(id) ON DELETE RESTRICT,
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.organization_visibility_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.organization_visibility_changes FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.organization_visibility_changes TO service_role;
CREATE FUNCTION public.organization_visibility_changes_append_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN RAISE EXCEPTION 'organization_visibility_changes is append-only'; END $$;
CREATE TRIGGER organization_visibility_changes_append_only BEFORE UPDATE OR DELETE ON public.organization_visibility_changes
  FOR EACH ROW EXECUTE FUNCTION public.organization_visibility_changes_append_only();

CREATE FUNCTION public.set_organizations_public_owner_delegated(p_organization_ids uuid[], p_reason text,
  p_authorization_quote text, p_agent_session text DEFAULT 'agent')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  n_ids integer := COALESCE(cardinality(p_organization_ids), 0);
  n_private integer;
  sign_id uuid;
BEGIN
  IF COALESCE(auth.jwt()->>'role', 'service_role') <> 'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
  IF n_ids NOT BETWEEN 1 AND 100 OR n_ids <> (SELECT count(DISTINCT x) FROM unnest(p_organization_ids) x) THEN
    RAISE EXCEPTION 'Name 1 to 100 distinct organizations';
  END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'A reason is required'; END IF;
  SELECT count(*) INTO n_private FROM public.organizations o WHERE o.id = ANY (p_organization_ids) AND o.is_public IS NOT TRUE;
  IF n_private <> n_ids THEN
    RAISE EXCEPTION 'Every named organization must exist and be private (% of % are)', n_private, n_ids;
  END IF;
  PERFORM 1 FROM public.organizations o WHERE o.id = ANY (p_organization_ids) FOR UPDATE;
  sign_id := public.owner_delegated_sign_record('set_organizations_public_owner_delegated',
    jsonb_build_object('organization_ids', to_jsonb(p_organization_ids), 'organizations', n_ids, 'to_public', true),
    'organizations:' || n_ids, p_authorization_quote, p_agent_session);
  INSERT INTO public.organization_visibility_changes (organization_id, from_public, to_public, reason, owner_delegated_sign_id)
    SELECT o.id, o.is_public, true, p_reason, sign_id FROM public.organizations o WHERE o.id = ANY (p_organization_ids);
  UPDATE public.organizations SET is_public = true WHERE id = ANY (p_organization_ids);
  RETURN jsonb_build_object('organizations_published', n_ids, 'owner_delegated_sign_id', sign_id);
END $$;
REVOKE ALL ON FUNCTION public.set_organizations_public_owner_delegated(uuid[], text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_organizations_public_owner_delegated(uuid[], text, text, text) TO service_role;
COMMENT ON FUNCTION public.set_organizations_public_owner_delegated(uuid[], text, text, text) IS
  'Service-only. Makes private organizations public on the owner''s behalf: audit rows in organization_visibility_changes, one owner_delegated_signs row per call.';

CREATE TABLE public.supply_vendor_domain_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_slug text NOT NULL REFERENCES public.supply_vendors(vendor_slug) ON DELETE CASCADE,
  domain text,
  fetched_url text,
  http_status integer,
  page_title text,
  og_site_name text,
  fetched_at timestamptz NOT NULL,
  method text NOT NULL,
  verdict text NOT NULL CHECK (verdict IN ('verified', 'not_verified')),
  note text,
  UNIQUE (vendor_slug, fetched_at)
);
ALTER TABLE public.supply_vendor_domain_verifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.supply_vendor_domain_verifications FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.supply_vendor_domain_verifications TO service_role;

INSERT INTO public.supply_vendor_domain_verifications (vendor_slug, domain, fetched_url, http_status, page_title, og_site_name, fetched_at, method, verdict, note)
SELECT v.* FROM (VALUES
 ('carquest', 'carquest.com', 'https://www.carquest.com/', 200, 'Carquest Auto Parts – Your SUPER-powered WP Engine Site', 'Carquest Auto Parts', '2026-10-19 20:32:32+00'::timestamptz, 'curl homepage', 'verified', NULL),
 ('snap_on', 'snapon.com', 'https://www.snapon.com/', 200, 'Snap-on Incorporated', NULL, '2026-10-19 20:32:37+00', 'curl homepage', 'verified', NULL),
 ('cj_pony_parts', 'cjponyparts.com', 'https://www.cjponyparts.com/', 200, 'CJ Pony Parts: Performance & Restoration Automotive Parts', NULL, '2026-10-19 20:34:00+00', 'firecrawl scrape (curl got a 403 bot challenge)', 'verified', NULL),
 ('summit_racing', 'summitracing.com', 'https://www.summitracing.com/', 200, 'Summit Racing | Aftermarket Parts & Accessories, Performance Parts, OEM Auto Parts', 'Summit Racing Equipment', '2026-10-19 20:34:06+00', 'firecrawl scrape (curl got a bot interstitial)', 'verified', NULL),
 ('sms_auto_fabrics', 'smsautofabrics.com', 'https://smsautofabrics.com/', 200, 'SMS Auto Fabrics - The Largest Selection of Classic Auto Interiors', 'SMS Auto Fabrics', '2026-10-19 20:32:49+00', 'curl homepage', 'verified', NULL),
 ('rockauto', 'rockauto.com', 'https://www.rockauto.com/', 200, 'RockAuto | All The Parts Your Car Will Ever Need', NULL, '2026-10-19 20:32:50+00', 'curl homepage', 'verified', NULL),
 ('ecklers', 'ecklers.com', 'https://www.ecklers.com/', 200, 'Automotive Restoration & Performance Parts | Ecklers', 'Ecklers.com', '2026-10-19 20:33:02+00', 'curl homepage', 'verified', NULL),
 ('davis_off_road', 'davisoffroad.com', 'https://www.davisoffroad.com/', 200, 'Davis Offroad, The Offroad Truck Headquarters In Richmond VA!', NULL, '2026-10-19 20:33:05+00', 'curl homepage', 'verified', 'name matches without the space (Davis Offroad)'),
 ('champion_cooling_systems', 'championcooling.com', 'https://championcooling.com/', 200, 'Champion Cooling Systems', NULL, '2026-10-19 20:33:15+00', 'curl homepage', 'verified', NULL),
 ('offroad_design', 'offroaddesign.com', 'https://www.offroaddesign.com/', 200, 'ORD Homepage', NULL, '2026-10-19 20:34:12+00', 'curl homepage + firecrawl scrape', 'not_verified', 'company name absent from title and og:site_name'),
 ('georges_tire_auto_repair', 'georgesbudgettire.com', 'https://www.georgesbudgettire.com/', 200, 'George’s Budget Tire and Auto Repair – Auto Repairs | Fontana, CA', NULL, '2026-10-19 20:34:38+00', 'curl homepage (domain from directory listings)', 'not_verified', 'a different business in Fontana, CA; the receipts name Boulder City, NV'),
 ('lesas_auto_body_supplies', 'lesaslab.com', 'https://lesaslab.com/', NULL, NULL, NULL, '2026-10-19 20:34:46+00', 'curl homepage + firecrawl scrape (domain from directory listings)', 'not_verified', 'unreachable'),
 ('km_racing', NULL, NULL, NULL, NULL, NULL, '2026-10-19 20:35:00+00', 'web search', 'not_verified', 'no matching company found (only unrelated businesses in France and Brazil)')
) v(vendor_slug, domain, fetched_url, http_status, page_title, og_site_name, fetched_at, method, verdict, note)
WHERE EXISTS (SELECT 1 FROM public.supply_vendors s WHERE s.vendor_slug = v.vendor_slug);

UPDATE public.supply_vendors s SET decision = 'create_by_domain', domain = v.domain,
    basis = s.basis || '; domain verified by fetch, owner-delegated (' || v.page_title || ', ' || to_char(v.fetched_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"') || ')'
  FROM public.supply_vendor_domain_verifications v
  WHERE v.vendor_slug = s.vendor_slug AND v.verdict = 'verified' AND s.decision = 'gap_no_stable_identifier';

DO $apply$
DECLARE
  v record;
  orgs jsonb := '[]'::jsonb;
  quote constant text := 'dude its fine you need to be running and making tests. you can sign on my behalf and register as such';
  s2_orgs uuid[];
BEGIN
  IF to_regprocedure('public.create_organization_batch(jsonb,text,boolean)') IS NULL OR to_regclass('public.receipts') IS NULL THEN
    RETURN;
  END IF;
  -- The nine organizations created from receipts in 20261020050000 (decision 1), before any new creation.
  s2_orgs := ARRAY(SELECT o.id FROM public.organizations o
    WHERE o.discovered_via = 'declared-source:nuke-retained-receipts' AND o.is_public IS NOT TRUE ORDER BY o.id);

  FOR v IN SELECT s.business_name, s.domain FROM public.supply_vendors s
      JOIN public.supply_vendor_domain_verifications d ON d.vendor_slug = s.vendor_slug AND d.verdict = 'verified'
    ORDER BY s.vendor_slug LOOP
    orgs := orgs || jsonb_build_array(jsonb_build_object('business_name', v.business_name, 'website', v.domain));
  END LOOP;
  IF jsonb_array_length(orgs) > 0 THEN
    RAISE NOTICE 'create_organization_batch: %', public.create_organization_batch(orgs, 'domain-verified-by-fetch-owner-delegated');
  END IF;
  RAISE NOTICE 'supply_resolve_counterparties: %', public.supply_resolve_counterparties();

  IF cardinality(s2_orgs) > 0 THEN
    RAISE NOTICE 'publish: %', public.set_organizations_public_owner_delegated(s2_orgs,
      'businesses resolved from retained receipts (20261020050000); not personal information under the open-data doctrine',
      quote, 'cursor supply S3 (migration 20261020060000)');
  END IF;
END $apply$;

NOTIFY pgrst, 'reload schema';
COMMIT;
