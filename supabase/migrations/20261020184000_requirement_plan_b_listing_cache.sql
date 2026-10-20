-- Plan-B listing tier from a cache: output-identical, without the per-requirement organization scan.
--
-- 20261020173000 computed the stated_by_listing tier per requirement row by scanning public organizations in the job
-- area's state (~20 ms each); open_requirements_read and job_market_health_read went from ~0.27 s / ~0.35 s to ~0.75 s /
-- ~0.8 s in the database (live warm). This keeps the same candidates and order but reads them from a cache:
--   plan_b_listing_candidates_live(state_code, city): the gated candidate rows (organization, listed term, capability key,
--     same_city, distance, radius) for every mapped key in one job area: exactly the 20261020173000 rules.
--   plan_b_listing_cache / plan_b_listing_cache_areas: those rows for every area of a work order with requirements
--     (public vehicle city/state, or the public shop's); service-only.
--   plan_b_listing_cache_state: version / clean_version. Any change to the inputs bumps version: organizations rows whose
--     listing fields change (is_public, services_offered, state, city, latitude, longitude, service_radius_miles) or that
--     are inserted/deleted, organization_capabilities, listing_service_capability_map, city_geocode_lookup.
--   refresh_plan_b_listing_cache(): rebuilds areas and rows and marks clean the version it started from (a change during
--     the refresh leaves it dirty). Cron plan-b-listing-cache-refresh every 15 minutes; seeded here.
--   requirement_plan_b_suppliers_tiered (replaced): reads the cache when it is clean and has the area, otherwise the live
--     rows; ranking, labels and fields are unchanged.
--   organization_on_nuke (replaced, guarded): same query in PL/pgSQL (plans cached per session, website host read once);
--     it is called for every listed supplier and was the remaining per-row cost.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

CREATE FUNCTION public.us_state_variants(p_code text) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT CASE WHEN p_code IS NULL THEN NULL ELSE ARRAY[p_code, upper(CASE p_code
    WHEN 'AL' THEN 'Alabama' WHEN 'AK' THEN 'Alaska' WHEN 'AZ' THEN 'Arizona' WHEN 'AR' THEN 'Arkansas' WHEN 'CA' THEN 'California'
    WHEN 'CO' THEN 'Colorado' WHEN 'CT' THEN 'Connecticut' WHEN 'DE' THEN 'Delaware' WHEN 'DC' THEN 'District of Columbia'
    WHEN 'FL' THEN 'Florida' WHEN 'GA' THEN 'Georgia' WHEN 'HI' THEN 'Hawaii' WHEN 'ID' THEN 'Idaho' WHEN 'IL' THEN 'Illinois'
    WHEN 'IN' THEN 'Indiana' WHEN 'IA' THEN 'Iowa' WHEN 'KS' THEN 'Kansas' WHEN 'KY' THEN 'Kentucky' WHEN 'LA' THEN 'Louisiana'
    WHEN 'ME' THEN 'Maine' WHEN 'MD' THEN 'Maryland' WHEN 'MA' THEN 'Massachusetts' WHEN 'MI' THEN 'Michigan' WHEN 'MN' THEN 'Minnesota'
    WHEN 'MS' THEN 'Mississippi' WHEN 'MO' THEN 'Missouri' WHEN 'MT' THEN 'Montana' WHEN 'NE' THEN 'Nebraska' WHEN 'NV' THEN 'Nevada'
    WHEN 'NH' THEN 'New Hampshire' WHEN 'NJ' THEN 'New Jersey' WHEN 'NM' THEN 'New Mexico' WHEN 'NY' THEN 'New York'
    WHEN 'NC' THEN 'North Carolina' WHEN 'ND' THEN 'North Dakota' WHEN 'OH' THEN 'Ohio' WHEN 'OK' THEN 'Oklahoma' WHEN 'OR' THEN 'Oregon'
    WHEN 'PA' THEN 'Pennsylvania' WHEN 'RI' THEN 'Rhode Island' WHEN 'SC' THEN 'South Carolina' WHEN 'SD' THEN 'South Dakota'
    WHEN 'TN' THEN 'Tennessee' WHEN 'TX' THEN 'Texas' WHEN 'UT' THEN 'Utah' WHEN 'VT' THEN 'Vermont' WHEN 'VA' THEN 'Virginia'
    WHEN 'WA' THEN 'Washington' WHEN 'WV' THEN 'West Virginia' WHEN 'WI' THEN 'Wisconsin' WHEN 'WY' THEN 'Wyoming'
    WHEN 'PR' THEN 'Puerto Rico' END)] END
$$;
REVOKE ALL ON FUNCTION public.us_state_variants(text) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.plan_b_listing_candidates_live(p_state text, p_city text)
RETURNS TABLE (organization_id uuid, service_term text, capability_key text, same_city boolean, distance_miles numeric, service_radius_miles integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_state text := public.us_state_code(p_state);
  v_city text := lower(NULLIF(btrim(p_city), ''));
  v_variants text[];
  v_lat numeric;
  v_lng numeric;
BEGIN
  IF v_state IS NULL THEN RETURN; END IF;
  v_variants := public.us_state_variants(v_state);
  IF v_city IS NOT NULL THEN
    SELECT g.latitude, g.longitude INTO v_lat, v_lng FROM public.city_geocode_lookup g
      WHERE lower(g.city) = v_city AND upper(btrim(g.state)) = ANY (v_variants) ORDER BY g.sample_size DESC NULLS LAST LIMIT 1;
  END IF;
  RETURN QUERY
  WITH orgs AS MATERIALIZED (
    SELECT o.id, o.services_offered FROM public.organizations o WHERE o.is_public IS TRUE AND upper(btrim(o.state)) = ANY (v_variants)
  ), terms AS (
    SELECT o.id, public.listing_service_term(t) AS term FROM orgs o, unnest(o.services_offered) t
    UNION SELECT oc.organization_id, public.listing_service_term(oc.capability_type) FROM public.organization_capabilities oc
      JOIN orgs o ON o.id = oc.organization_id WHERE oc.is_active IS NOT FALSE
  ), mapped AS (
    SELECT DISTINCT t.id, t.term, m.capability_key FROM terms t JOIN public.listing_service_capability_map m ON m.service_term = t.term
  ), placed AS (
    SELECT p.id, o.service_radius_miles AS radius, lower(NULLIF(btrim(o.city), '')) = v_city AS same_city,
      CASE WHEN v_lat IS NOT NULL AND pt.lat IS NOT NULL THEN round((3958.8 * 2 * asin(sqrt(power(sin(radians(pt.lat - v_lat) / 2), 2)
        + cos(radians(v_lat)) * cos(radians(pt.lat)) * power(sin(radians(pt.lng - v_lng) / 2), 2))))::numeric, 1) END AS miles
    FROM (SELECT DISTINCT mp.id FROM mapped mp) p JOIN public.organizations o ON o.id = p.id
    CROSS JOIN LATERAL (SELECT COALESCE(o.latitude, g.latitude) AS lat, COALESCE(o.longitude, g.longitude) AS lng
      FROM (SELECT 1) one LEFT JOIN LATERAL (SELECT g0.latitude, g0.longitude FROM public.city_geocode_lookup g0
        WHERE lower(g0.city) = lower(NULLIF(btrim(o.city), '')) AND upper(btrim(g0.state)) = ANY (v_variants)
        ORDER BY g0.sample_size DESC NULLS LAST LIMIT 1) g ON true) pt
  )
  SELECT mp.id, mp.term, mp.capability_key, pl.same_city, pl.miles, pl.radius
  FROM mapped mp JOIN placed pl ON pl.id = mp.id
  WHERE pl.miles IS NULL OR pl.miles <= COALESCE(NULLIF(pl.radius, 0), 100);
END $$;
REVOKE ALL ON FUNCTION public.plan_b_listing_candidates_live(text, text) FROM PUBLIC, anon, authenticated;

CREATE TABLE public.plan_b_listing_cache_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  version bigint NOT NULL DEFAULT 1,
  clean_version bigint NOT NULL DEFAULT 0,
  refreshed_at timestamptz,
  areas integer,
  candidate_rows integer
);
INSERT INTO public.plan_b_listing_cache_state (singleton) VALUES (true);
CREATE TABLE public.plan_b_listing_cache_areas (
  state_code text NOT NULL,
  city_key text NOT NULL,
  PRIMARY KEY (state_code, city_key)
);
CREATE TABLE public.plan_b_listing_cache (
  state_code text NOT NULL,
  city_key text NOT NULL,
  capability_key text NOT NULL,
  organization_id uuid NOT NULL,
  service_term text NOT NULL,
  same_city boolean,
  distance_miles numeric,
  service_radius_miles integer,
  PRIMARY KEY (state_code, city_key, capability_key, organization_id, service_term)
);
ALTER TABLE public.plan_b_listing_cache_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_b_listing_cache_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_b_listing_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.plan_b_listing_cache_state, public.plan_b_listing_cache_areas, public.plan_b_listing_cache FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.plan_b_listing_cache_state, public.plan_b_listing_cache_areas, public.plan_b_listing_cache TO service_role;
COMMENT ON TABLE public.plan_b_listing_cache IS
  'Cache of plan_b_listing_candidates_live per job area (stated_by_listing Plan-B tier). Written only by refresh_plan_b_listing_cache(); used only while plan_b_listing_cache_state is clean.';

CREATE FUNCTION public.plan_b_listing_cache_touch() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  UPDATE public.plan_b_listing_cache_state SET version = version + 1 WHERE singleton;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.plan_b_listing_cache_touch() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER plan_b_listing_cache_org_update AFTER UPDATE ON public.organizations FOR EACH ROW
  WHEN (OLD.is_public IS DISTINCT FROM NEW.is_public OR OLD.services_offered IS DISTINCT FROM NEW.services_offered
    OR OLD.state IS DISTINCT FROM NEW.state OR OLD.city IS DISTINCT FROM NEW.city OR OLD.latitude IS DISTINCT FROM NEW.latitude
    OR OLD.longitude IS DISTINCT FROM NEW.longitude OR OLD.service_radius_miles IS DISTINCT FROM NEW.service_radius_miles)
  EXECUTE FUNCTION public.plan_b_listing_cache_touch();
CREATE TRIGGER plan_b_listing_cache_org_insert_delete AFTER INSERT OR DELETE ON public.organizations FOR EACH STATEMENT
  EXECUTE FUNCTION public.plan_b_listing_cache_touch();
CREATE TRIGGER plan_b_listing_cache_capabilities AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.organization_capabilities FOR EACH STATEMENT
  EXECUTE FUNCTION public.plan_b_listing_cache_touch();
CREATE TRIGGER plan_b_listing_cache_map AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.listing_service_capability_map FOR EACH STATEMENT
  EXECUTE FUNCTION public.plan_b_listing_cache_touch();
CREATE TRIGGER plan_b_listing_cache_geocode AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.city_geocode_lookup FOR EACH STATEMENT
  EXECUTE FUNCTION public.plan_b_listing_cache_touch();

CREATE FUNCTION public.refresh_plan_b_listing_cache() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v0 bigint; n_areas integer; n_rows integer;
BEGIN
  SELECT version INTO v0 FROM public.plan_b_listing_cache_state WHERE singleton;
  DELETE FROM public.plan_b_listing_cache;
  DELETE FROM public.plan_b_listing_cache_areas;
  INSERT INTO public.plan_b_listing_cache_areas (state_code, city_key)
  SELECT DISTINCT public.us_state_code(x.state), COALESCE(lower(NULLIF(btrim(x.city), '')), '')
  FROM (
    SELECT to_jsonb(v)->>'city' AS city, to_jsonb(v)->>'state' AS state FROM public.work_orders w JOIN public.vehicles v ON v.id = w.vehicle_id AND v.is_public IS TRUE
      WHERE EXISTS (SELECT 1 FROM public.work_order_resource_requirements r WHERE r.work_order_id = w.id)
    UNION SELECT o.city, o.state FROM public.work_orders w JOIN public.organizations o ON o.id = w.organization_id AND o.is_public IS TRUE
      WHERE EXISTS (SELECT 1 FROM public.work_order_resource_requirements r WHERE r.work_order_id = w.id)
  ) x WHERE public.us_state_code(x.state) IS NOT NULL;
  GET DIAGNOSTICS n_areas = ROW_COUNT;
  INSERT INTO public.plan_b_listing_cache (state_code, city_key, capability_key, organization_id, service_term, same_city, distance_miles, service_radius_miles)
  SELECT a.state_code, a.city_key, l.capability_key, l.organization_id, l.service_term, l.same_city, l.distance_miles, l.service_radius_miles
  FROM public.plan_b_listing_cache_areas a, LATERAL public.plan_b_listing_candidates_live(a.state_code, NULLIF(a.city_key, '')) l;
  GET DIAGNOSTICS n_rows = ROW_COUNT;
  UPDATE public.plan_b_listing_cache_state SET clean_version = v0, refreshed_at = now(), areas = n_areas, candidate_rows = n_rows WHERE singleton;
  RETURN jsonb_build_object('areas', n_areas, 'candidate_rows', n_rows, 'clean_version', v0, 'refreshed_at', now());
END $$;
REVOKE ALL ON FUNCTION public.refresh_plan_b_listing_cache() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_plan_b_listing_cache() TO service_role;

CREATE OR REPLACE FUNCTION public.requirement_plan_b_suppliers_tiered(p_text text, p_kind text, p_capability_keys jsonb, p_area jsonb, p_limit integer DEFAULT 5)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  lim integer := LEAST(GREATEST(COALESCE(p_limit, 5), 1), 20);
  paid jsonb;
  listed jsonb;
  keys text[];
  paid_ids uuid[];
  v_state text := public.us_state_code(p_area->>'state');
  v_city text := lower(NULLIF(btrim(p_area->>'city'), ''));
  use_cache boolean;
BEGIN
  SELECT COALESCE(jsonb_agg(e || jsonb_build_object('tier', 'paid_for_on_nuke', 'tier_label', 'paid for on Nuke', 'record_backed', true,
      'verified', false, 'counts_as_evidence', false) ORDER BY x.ord), '[]'::jsonb)
    INTO paid FROM jsonb_array_elements(public.requirement_plan_b_suppliers(p_text, lim)) WITH ORDINALITY x(e, ord);
  keys := ARRAY(SELECT DISTINCT k->>'key' FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_capability_keys) = 'array' THEN p_capability_keys ELSE '[]'::jsonb END) k
    WHERE k->>'key' IS NOT NULL);
  IF COALESCE(p_kind, '') NOT IN ('skill', 'inspection') OR cardinality(keys) = 0 OR v_state IS NULL THEN RETURN paid; END IF;
  paid_ids := ARRAY(SELECT (e#>>'{organization,organization_id}')::uuid FROM jsonb_array_elements(paid) e WHERE e#>>'{organization,organization_id}' IS NOT NULL);
  use_cache := EXISTS (SELECT 1 FROM public.plan_b_listing_cache_state s WHERE s.singleton AND s.version = s.clean_version)
    AND EXISTS (SELECT 1 FROM public.plan_b_listing_cache_areas a WHERE a.state_code = v_state AND a.city_key = COALESCE(v_city, ''));
  WITH cand AS (
    SELECT c.organization_id AS id, c.service_term AS term, c.capability_key, c.same_city, c.distance_miles AS miles, c.service_radius_miles AS radius
      FROM public.plan_b_listing_cache c
      WHERE use_cache AND c.state_code = v_state AND c.city_key = COALESCE(v_city, '') AND c.capability_key = ANY (keys)
    UNION ALL
    SELECT l.organization_id, l.service_term, l.capability_key, l.same_city, l.distance_miles, l.service_radius_miles
      FROM public.plan_b_listing_candidates_live(v_state, v_city) l
      WHERE NOT use_cache AND l.capability_key = ANY (keys)
  ), matched AS (
    SELECT cd.id, array_agg(DISTINCT cd.term ORDER BY cd.term) AS services, array_agg(DISTINCT cd.capability_key ORDER BY cd.capability_key) AS keys_matched,
      bool_or(cd.same_city) AS same_city, min(cd.miles) AS miles, min(cd.radius) AS radius
    FROM cand cd WHERE cd.id <> ALL (paid_ids) GROUP BY cd.id
  ), gated AS (
    SELECT * FROM matched p ORDER BY p.same_city IS TRUE DESC, p.miles NULLS LAST, cardinality(p.keys_matched) DESC, p.id LIMIT lim
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('organization', public.platform_organization_label(gd.id), 'profile_public', true,
      'tier', 'stated_by_listing', 'tier_label', 'stated by the business listing',
      'label', 'listed as offering ' || array_to_string(ARRAY(SELECT replace(s, '_', ' ') FROM unnest(gd.services) s), ', ') || ' — not verified',
      'services_listed', to_jsonb(gd.services), 'capability_keys_matched', to_jsonb(gd.keys_matched),
      'record_backed', false, 'verified', false, 'counts_as_evidence', false,
      'supplier_result', 'not_verified', 'supplier_label', 'listed as offering this — not verified',
      'geography', jsonb_build_object('same_state', true, 'same_city', gd.same_city IS TRUE, 'distance_miles', gd.miles,
        'service_radius_miles', gd.radius, 'basis', 'listing city/state against the job area'),
      'on_nuke', n.on_nuke, 'can_receive_requests', n.on_nuke->>'state' = 'claimed',
      'role', 'plan_b_supplier', 'basis', 'public business listing mapped by the reviewed listing_service_capability_map; not verified')
      ORDER BY gd.same_city IS TRUE DESC, gd.miles NULLS LAST, cardinality(gd.keys_matched) DESC, gd.id), '[]'::jsonb)
  INTO listed
  FROM gated gd CROSS JOIN LATERAL (SELECT public.organization_on_nuke(gd.id) AS on_nuke) n;
  RETURN paid || listed;
END $$;

DO $guard$
DECLARE def text := pg_get_functiondef('public.organization_on_nuke(uuid)'::regprocedure);
BEGIN
  IF position('LANGUAGE sql' IN def) = 0 OR position($a$UNION SELECT c.user_id, 'verified_claimant', c.method FROM public.organization_verified_claimants c$a$ IN def) = 0
    OR position($a$'offer_capable', EXISTS (SELECT 1 FROM m),$a$ IN def) = 0 THEN
    RAISE EXCEPTION 'organization_on_nuke is not the 20261020101000 body; refusing to replace it';
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.organization_on_nuke(p_organization_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  host text := public.organization_website_host(p_organization_id);
  r jsonb;
BEGIN
  WITH m AS (
    SELECT oc.user_id, oc.role, oc.verification_method FROM public.organization_contributors oc
      WHERE oc.organization_id = p_organization_id AND oc.status = 'active' AND oc.user_id IS NOT NULL
    UNION SELECT bo.owner_id, 'owner', 'business_ownership' FROM public.business_ownership bo
      WHERE bo.business_id = p_organization_id AND bo.status = 'active' AND bo.owner_id IS NOT NULL
    UNION SELECT c.user_id, 'verified_claimant', c.method FROM public.organization_verified_claimants c
      WHERE c.organization_id = p_organization_id AND c.revoked_at IS NULL
  )
  SELECT jsonb_build_object(
    'state', CASE WHEN EXISTS (SELECT 1 FROM m) THEN 'claimed' ELSE 'not_on_nuke_yet' END,
    'label', CASE WHEN EXISTS (SELECT 1 FROM m) THEN 'Claimed on Nuke' ELSE 'Not on Nuke yet' END,
    'members_active', (SELECT count(DISTINCT user_id) FROM m WHERE role <> 'verified_claimant'),
    'owners_active', (SELECT count(DISTINCT user_id) FROM m WHERE role IN ('owner', 'co_founder')),
    'verified_claimants', (SELECT count(DISTINCT user_id) FROM m WHERE role = 'verified_claimant'),
    'claimed_via', COALESCE((SELECT jsonb_agg(DISTINCT verification_method) FROM m WHERE role IN ('owner', 'co_founder', 'verified_claimant')), '[]'::jsonb),
    'offer_capable', EXISTS (SELECT 1 FROM m),
    'claim', jsonb_build_object('writer', 'claim_organization',
      'methods', CASE WHEN host IS NOT NULL THEN jsonb_build_array('domain_email', 'document') ELSE jsonb_build_array('document') END,
      'domain', host,
      'domain_email_rule', 'your confirmed sign-in e-mail is at this website''s domain',
      'grants', 'offer as this organization on open requirements; quote, start, complete and invoice only jobs where its offer was accepted; no access to its other work orders, customers or payments'))
  INTO r;
  RETURN r;
END $$;

INSERT INTO public.pipeline_registry (table_name, column_name, owned_by, description, do_not_write_directly, write_via)
SELECT t, NULL, 'refresh_plan_b_listing_cache', 'Plan-B stated_by_listing candidate cache per job area (output-identical to plan_b_listing_candidates_live).', true,
  'refresh_plan_b_listing_cache() (cron plan-b-listing-cache-refresh, every 15 minutes); version bumped by triggers on listing inputs'
FROM unnest(ARRAY['plan_b_listing_cache', 'plan_b_listing_cache_areas', 'plan_b_listing_cache_state']) t
WHERE NOT EXISTS (SELECT 1 FROM public.pipeline_registry r WHERE r.table_name = t AND r.column_name IS NULL);

DO $job$
DECLARE scheduled boolean;
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE $q$SELECT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'plan-b-listing-cache-refresh')$q$ INTO scheduled;
    IF NOT scheduled THEN
      EXECUTE $q$SELECT cron.schedule('plan-b-listing-cache-refresh', '4,19,34,49 * * * *',
        'SET statement_timeout = ''60s''; SELECT public.refresh_plan_b_listing_cache()')$q$;
    END IF;
  END IF;
END $job$;

SELECT public.refresh_plan_b_listing_cache();

NOTIFY pgrst, 'reload schema';
COMMIT;
