-- Plan-B suppliers gain a second, clearly weaker tier: what a public business listing says it offers.
--
-- Plan-B lists (open_requirements_read plan_b_suppliers) only named organizations Nuke users had paid for this kind of
-- work or part (organization_supply_evidence). 16 of 39 open requirements had none: routine skill work (oil change,
-- alignment, gaskets, trim) whose text matches no purchase category. Public organization listings already in the
-- database state services (organizations.services_offered, organization_capabilities.capability_type) and a city/state.
-- This adds:
--   listing_service_capability_map: a reviewed, conservative map from a normalized listed service term to a requirement
--     capability key (requirement_capability_keys vocabulary). Only terms whose meaning covers the key are mapped;
--     vague terms (service, sales, restoration, brakes without a matching key) are not.
--   us_state_code(text): 'Nevada' / 'nv' / 'NV' -> 'NV'.
--   listing_service_term(text): 'Oil Changes' -> 'oil_changes'.
--   requirement_plan_b_suppliers_tiered(text, kind, capability_keys, area, limit): tier 'paid_for_on_nuke' (the existing
--     requirement_plan_b_suppliers, unchanged, first) then, for skill and inspection requirements only, tier 'stated_by_listing': public organizations whose listing
--     names a service mapped to one of the requirement's capability keys, in the job area's state and, when both places
--     geocode (organization coordinates or city_geocode_lookup), within the listing's service radius (100 miles when the
--     listing states none). Labelled 'listed as offering <services> — not verified'; record_backed/verified/
--     counts_as_evidence false. Never an input pass: provider_requirement_match and the readers' match inputs are
--     unchanged. Every entry keeps on_nuke ('Not on Nuke yet' + claim/invite) and can_receive_requests.
--   open_requirements_read, job_market_health_compute (anchored): Plan-B goes through the tiered function with the job
--     area and capability keys; job_market_health reports Plan-B coverage by tier ('with_plan_b_supplier' stays the
--     paid-for tier, comparable with earlier snapshots).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

CREATE TABLE public.listing_service_capability_map (
  service_term text NOT NULL CHECK (service_term ~ '^[a-z0-9_]+$'),
  capability_key text NOT NULL,
  reviewed_note text NOT NULL,
  PRIMARY KEY (service_term, capability_key)
);
ALTER TABLE public.listing_service_capability_map ENABLE ROW LEVEL SECURITY;
CREATE POLICY listing_service_capability_map_read ON public.listing_service_capability_map FOR SELECT USING (true);
REVOKE ALL ON public.listing_service_capability_map FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.listing_service_capability_map TO anon, authenticated, service_role;
COMMENT ON TABLE public.listing_service_capability_map IS
  'Reviewed map: normalized service term from a public business listing -> requirement capability key. Feeds the stated_by_listing Plan-B tier only; never evidence.';

INSERT INTO public.listing_service_capability_map (service_term, capability_key, reviewed_note) VALUES
 ('oil_changes', 'general_maintenance', 'routine maintenance shop'),
 ('oil_change', 'general_maintenance', 'routine maintenance shop'),
 ('oil', 'general_maintenance', 'listed as oil service'),
 ('maintenance', 'general_maintenance', 'routine maintenance'),
 ('maintenance_packages', 'general_maintenance', 'routine maintenance'),
 ('light_diesel_maintenance', 'general_maintenance', 'routine maintenance'),
 ('tune_ups', 'general_maintenance', 'plugs, filters, belts'),
 ('tune_up', 'general_maintenance', 'plugs, filters, belts'),
 ('batteries', 'general_maintenance', 'battery replacement'),
 ('general_repair', 'general_maintenance', 'general repair shop'),
 ('general_auto_repair', 'general_maintenance', 'general repair shop'),
 ('complete_auto_repair', 'general_maintenance', 'general repair shop'),
 ('full_repair', 'general_maintenance', 'general repair shop'),
 ('repair_services', 'general_maintenance', 'general repair shop'),
 ('alignment', 'steering_suspension_alignment', 'wheel alignment'),
 ('alignments', 'steering_suspension_alignment', 'wheel alignment'),
 ('wheel_alignment', 'steering_suspension_alignment', 'wheel alignment'),
 ('suspension', 'steering_suspension_alignment', 'suspension work'),
 ('undercar', 'steering_suspension_alignment', 'steering and suspension components'),
 ('steering', 'steering_suspension_alignment', 'steering work'),
 ('radiator', 'cooling_system', 'radiator / cooling'),
 ('cooling', 'cooling_system', 'cooling system'),
 ('ac', 'ac_system', 'air conditioning'),
 ('air_conditioning', 'ac_system', 'air conditioning'),
 ('exhaust', 'exhaust_system', 'exhaust work'),
 ('muffler', 'exhaust_system', 'exhaust work'),
 ('mufflers', 'exhaust_system', 'exhaust work'),
 ('inspections', 'inspection', 'vehicle inspections'),
 ('inspection', 'inspection', 'vehicle inspections'),
 ('pre_purchase_inspection', 'inspection', 'vehicle inspections'),
 ('diagnostics', 'engine_diagnostics', 'diagnostics'),
 ('engine_diag', 'engine_diagnostics', 'diagnostics'),
 ('engine_repair', 'intake_system', 'engine repair covers intake and manifold gaskets'),
 ('engine', 'intake_system', 'engine repair covers intake and manifold gaskets'),
 ('electrical', 'electrical_repair', 'electrical repair'),
 ('transmission', 'transmission_rebuild', 'transmission shop'),
 ('transmissions', 'transmission_rebuild', 'transmission shop'),
 ('paint', 'paint_refinish', 'paint'),
 ('body_paint', 'paint_refinish', 'paint'),
 ('auto_paint', 'paint_refinish', 'paint'),
 ('auto_body', 'body_repair', 'body shop'),
 ('body_repair', 'body_repair', 'body shop'),
 ('body_work', 'body_repair', 'body shop'),
 ('collision_repair', 'body_repair', 'body shop'),
 ('auto_body', 'trim_installation', 'body shops fit moldings, emblems and seals'),
 ('auto_glass', 'glass_installation', 'glass'),
 ('windshield', 'glass_installation', 'glass'),
 ('custom_upholstery', 'upholstery_full', 'upholstery shop'),
 ('custom_upholstery', 'upholstery_repair', 'upholstery shop'),
 ('upholstery', 'upholstery_full', 'upholstery shop'),
 ('upholstery', 'upholstery_repair', 'upholstery shop'),
 ('powder_coating', 'powder_coating', 'powder coating'),
 ('chrome_plating', 'chrome_plating', 'plating');

CREATE FUNCTION public.us_state_code(p text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT CASE WHEN p IS NULL THEN NULL
    WHEN upper(btrim(p)) ~ '^[A-Z]{2}$' AND upper(btrim(p)) IN ('AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA',
      'ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV',
      'WI','WY','PR') THEN upper(btrim(p))
    ELSE (SELECT s.code FROM (VALUES ('alabama','AL'),('alaska','AK'),('arizona','AZ'),('arkansas','AR'),('california','CA'),('colorado','CO'),
      ('connecticut','CT'),('delaware','DE'),('district of columbia','DC'),('florida','FL'),('georgia','GA'),('hawaii','HI'),('idaho','ID'),
      ('illinois','IL'),('indiana','IN'),('iowa','IA'),('kansas','KS'),('kentucky','KY'),('louisiana','LA'),('maine','ME'),('maryland','MD'),
      ('massachusetts','MA'),('michigan','MI'),('minnesota','MN'),('mississippi','MS'),('missouri','MO'),('montana','MT'),('nebraska','NE'),
      ('nevada','NV'),('new hampshire','NH'),('new jersey','NJ'),('new mexico','NM'),('new york','NY'),('north carolina','NC'),('north dakota','ND'),
      ('ohio','OH'),('oklahoma','OK'),('oregon','OR'),('pennsylvania','PA'),('rhode island','RI'),('south carolina','SC'),('south dakota','SD'),
      ('tennessee','TN'),('texas','TX'),('utah','UT'),('vermont','VT'),('virginia','VA'),('washington','WA'),('west virginia','WV'),
      ('wisconsin','WI'),('wyoming','WY'),('puerto rico','PR')) s(name, code) WHERE s.name = lower(btrim(p))) END
$$;
GRANT EXECUTE ON FUNCTION public.us_state_code(text) TO anon, authenticated, service_role;

CREATE FUNCTION public.listing_service_term(p text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT NULLIF(btrim(regexp_replace(lower(btrim(COALESCE(p, ''))), '[^a-z0-9]+', '_', 'g'), '_'), '')
$$;
GRANT EXECUTE ON FUNCTION public.listing_service_term(text) TO anon, authenticated, service_role;

CREATE INDEX IF NOT EXISTS city_geocode_lookup_lower_city ON public.city_geocode_lookup (lower(city));

CREATE FUNCTION public.requirement_plan_b_suppliers_tiered(p_text text, p_kind text, p_capability_keys jsonb, p_area jsonb, p_limit integer DEFAULT 5)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  lim integer := LEAST(GREATEST(COALESCE(p_limit, 5), 1), 20);
  paid jsonb;
  listed jsonb;
  keys text[];
  v_state text := public.us_state_code(p_area->>'state');
  v_city text := lower(NULLIF(btrim(p_area->>'city'), ''));
  v_variants text[];
  v_lat numeric;
  v_lng numeric;
BEGIN
  SELECT COALESCE(jsonb_agg(e || jsonb_build_object('tier', 'paid_for_on_nuke', 'tier_label', 'paid for on Nuke', 'record_backed', true,
      'verified', false, 'counts_as_evidence', false) ORDER BY x.ord), '[]'::jsonb)
    INTO paid FROM jsonb_array_elements(public.requirement_plan_b_suppliers(p_text, lim)) WITH ORDINALITY x(e, ord);
  keys := ARRAY(SELECT DISTINCT k->>'key' FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_capability_keys) = 'array' THEN p_capability_keys ELSE '[]'::jsonb END) k
    WHERE k->>'key' IS NOT NULL);
  IF COALESCE(p_kind, '') NOT IN ('skill', 'inspection') OR cardinality(keys) = 0 OR v_state IS NULL THEN RETURN paid; END IF;
  v_variants := ARRAY[v_state, upper(CASE v_state
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
    WHEN 'PR' THEN 'Puerto Rico' END)];
  IF v_city IS NOT NULL THEN
    SELECT g.latitude, g.longitude INTO v_lat, v_lng FROM public.city_geocode_lookup g
      WHERE lower(g.city) = v_city AND upper(btrim(g.state)) = ANY (v_variants) ORDER BY g.sample_size DESC NULLS LAST LIMIT 1;
  END IF;
  WITH orgs AS MATERIALIZED (
    SELECT o.id, o.services_offered FROM public.organizations o WHERE o.is_public IS TRUE AND upper(btrim(o.state)) = ANY (v_variants)
  ), terms AS (
    SELECT o.id, public.listing_service_term(t) AS term FROM orgs o, unnest(o.services_offered) t
    UNION SELECT oc.organization_id, public.listing_service_term(oc.capability_type) FROM public.organization_capabilities oc
      JOIN orgs o ON o.id = oc.organization_id WHERE oc.is_active IS NOT FALSE
  ), matched AS (
    SELECT t.id, array_agg(DISTINCT t.term ORDER BY t.term) AS services, array_agg(DISTINCT m.capability_key ORDER BY m.capability_key) AS keys_matched
    FROM terms t JOIN public.listing_service_capability_map m ON m.service_term = t.term AND m.capability_key = ANY (keys)
    WHERE t.id NOT IN (SELECT (e#>>'{organization,organization_id}')::uuid FROM jsonb_array_elements(paid) e WHERE e#>>'{organization,organization_id}' IS NOT NULL)
    GROUP BY t.id
  ), placed AS (
    SELECT mt.*, o.service_radius_miles AS radius, lower(NULLIF(btrim(o.city), '')) = v_city AS same_city,
      CASE WHEN v_lat IS NOT NULL AND pt.lat IS NOT NULL THEN round((3958.8 * 2 * asin(sqrt(power(sin(radians(pt.lat - v_lat) / 2), 2)
        + cos(radians(v_lat)) * cos(radians(pt.lat)) * power(sin(radians(pt.lng - v_lng) / 2), 2))))::numeric, 1) END AS miles
    FROM matched mt JOIN public.organizations o ON o.id = mt.id
    CROSS JOIN LATERAL (SELECT COALESCE(o.latitude, g.latitude) AS lat, COALESCE(o.longitude, g.longitude) AS lng
      FROM (SELECT 1) one LEFT JOIN LATERAL (SELECT g0.latitude, g0.longitude FROM public.city_geocode_lookup g0
        WHERE lower(g0.city) = lower(NULLIF(btrim(o.city), '')) AND upper(btrim(g0.state)) = ANY (v_variants)
        ORDER BY g0.sample_size DESC NULLS LAST LIMIT 1) g ON true) pt
  ), gated AS (
    SELECT * FROM placed p WHERE p.miles IS NULL OR p.miles <= COALESCE(NULLIF(p.radius, 0), 100)
    ORDER BY p.same_city IS TRUE DESC, p.miles NULLS LAST, cardinality(p.keys_matched) DESC, p.id LIMIT lim
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('organization', public.platform_organization_label(gd.id), 'profile_public', true,
      'tier', 'stated_by_listing', 'tier_label', 'stated by the business listing',
      'label', 'listed as offering ' || array_to_string(ARRAY(SELECT replace(s, '_', ' ') FROM unnest(gd.services) s), ', ') || ' — not verified',
      'services_listed', to_jsonb(gd.services), 'capability_keys_matched', to_jsonb(gd.keys_matched),
      'record_backed', false, 'verified', false, 'counts_as_evidence', false,
      'geography', jsonb_build_object('same_state', true, 'same_city', gd.same_city IS TRUE, 'distance_miles', gd.miles,
        'service_radius_miles', gd.radius, 'basis', 'listing city/state against the job area'),
      'on_nuke', n.on_nuke, 'can_receive_requests', n.on_nuke->>'state' = 'claimed',
      'role', 'plan_b_supplier', 'basis', 'public business listing mapped by the reviewed listing_service_capability_map; not verified')
      ORDER BY gd.same_city IS TRUE DESC, gd.miles NULLS LAST, cardinality(gd.keys_matched) DESC, gd.id), '[]'::jsonb)
  INTO listed
  FROM gated gd CROSS JOIN LATERAL (SELECT public.organization_on_nuke(gd.id) AS on_nuke) n;
  RETURN paid || listed;
END $$;
REVOKE ALL ON FUNCTION public.requirement_plan_b_suppliers_tiered(text, text, jsonb, jsonb, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.requirement_plan_b_suppliers_tiered(text, text, jsonb, jsonb, integer) TO anon, authenticated, service_role;

DO $edit$
DECLARE def text; anchor text; n integer;
BEGIN
  def := pg_get_functiondef('public.open_requirements_read(uuid,integer,text)'::regprocedure);
  IF position('requirement_plan_b_suppliers_tiered' IN def) > 0 THEN RAISE EXCEPTION 'open_requirements_read: already edited'; END IF;
  anchor := $a$THEN public.requirement_plan_b_suppliers(concat_ws(' ', b.q->>'description',$a$;
  n := (length(def) - length(replace(def, anchor, ''))) / length(anchor);
  IF n <> 1 THEN RAISE EXCEPTION 'open_requirements_read: plan-B anchor found % times', n; END IF;
  def := replace(def, anchor, $r$THEN public.requirement_plan_b_suppliers_tiered(concat_ws(' ', b.q->>'description',$r$);
  anchor := $a$sp->>'line_item_id' = b.q->>'line_item_id'))), 5)$a$;
  n := (length(def) - length(replace(def, anchor, ''))) / length(anchor);
  IF n <> 1 THEN RAISE EXCEPTION 'open_requirements_read: plan-B args anchor found % times', n; END IF;
  EXECUTE replace(def, anchor, $r$sp->>'line_item_id' = b.q->>'line_item_id'))), b.q->>'requirement_kind', b.capability_keys, b.area, 5)$r$);

  def := pg_get_functiondef('public.job_market_health_compute()'::regprocedure);
  IF position('requirement_plan_b_suppliers_tiered' IN def) > 0 THEN RAISE EXCEPTION 'job_market_health_compute: already edited'; END IF;
  anchor := $a$THEN public.requirement_plan_b_suppliers(concat_ws(' ', q->>'description',$a$;
  n := (length(def) - length(replace(def, anchor, ''))) / length(anchor);
  IF n <> 1 THEN RAISE EXCEPTION 'job_market_health_compute: plan-B anchor found % times', n; END IF;
  def := replace(def, anchor, $r$THEN public.requirement_plan_b_suppliers_tiered(concat_ws(' ', q->>'description',$r$);
  anchor := $a$sp->>'line_item_id' = q->>'line_item_id'))), 5)$a$;
  n := (length(def) - length(replace(def, anchor, ''))) / length(anchor);
  IF n <> 1 THEN RAISE EXCEPTION 'job_market_health_compute: plan-B args anchor found % times', n; END IF;
  def := replace(def, anchor, $r$sp->>'line_item_id' = q->>'line_item_id'))), q->>'requirement_kind', public.requirement_capability_keys(q, g.g->'specifications'),
          jsonb_build_object('city', NULLIF(btrim(g.city), ''), 'state', NULLIF(btrim(g.state), '')), 5)$r$);
  anchor := $a$      jsonb_array_length(COALESCE(r.row->'plan_b', '[]'::jsonb)) > 0 AS plan_b,$a$;
  n := (length(def) - length(replace(def, anchor, ''))) / length(anchor);
  IF n <> 1 THEN RAISE EXCEPTION 'job_market_health_compute: per anchor found % times', n; END IF;
  def := replace(def, anchor, $r$      EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(r.row->'plan_b', '[]'::jsonb)) s WHERE s->>'tier' = 'paid_for_on_nuke') AS plan_b,
      EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(r.row->'plan_b', '[]'::jsonb)) s WHERE s->>'tier' = 'stated_by_listing') AS plan_b_listing,$r$);
  anchor := $a$    'with_reachable_plan_b_supplier', (SELECT count(*) FROM jsonb_array_elements(per_req) p WHERE (p->>'plan_b_reachable')::boolean),$a$;
  n := (length(def) - length(replace(def, anchor, ''))) / length(anchor);
  IF n <> 1 THEN RAISE EXCEPTION 'job_market_health_compute: matching anchor found % times', n; END IF;
  EXECUTE replace(def, anchor, anchor || $r$
    'plan_b_by_tier', (SELECT jsonb_build_object(
        'paid_for_on_nuke', count(*) FILTER (WHERE (p->>'plan_b')::boolean),
        'stated_by_listing', count(*) FILTER (WHERE (p->>'plan_b_listing')::boolean),
        'listing_only', count(*) FILTER (WHERE (p->>'plan_b_listing')::boolean AND NOT (p->>'plan_b')::boolean),
        'any', count(*) FILTER (WHERE (p->>'plan_b')::boolean OR (p->>'plan_b_listing')::boolean),
        'none', count(*) FILTER (WHERE NOT (p->>'plan_b')::boolean AND NOT (p->>'plan_b_listing')::boolean))
      FROM jsonb_array_elements(per_req) p),$r$);

  def := pg_get_functiondef('public.job_market_health_read()'::regprocedure);
  IF position('plan_b_by_tier' IN def) > 0 THEN RAISE EXCEPTION 'job_market_health_read: already edited'; END IF;
  anchor := $a$        'with_plan_b_supplier', s.health#>'{matching,with_plan_b_supplier}',$a$;
  n := (length(def) - length(replace(def, anchor, ''))) / length(anchor);
  IF n <> 1 THEN RAISE EXCEPTION 'job_market_health_read: history anchor found % times', n; END IF;
  def := replace(def, anchor, anchor || $r$
        'with_plan_b_listing_only', s.health#>'{matching,plan_b_by_tier,listing_only}',
        'with_plan_b_any', s.health#>'{matching,plan_b_by_tier,any}',$r$);
  anchor := $a$      'published', 'aggregates only: no ids, names, handles, amounts or texts'));$a$;
  n := (length(def) - length(replace(def, anchor, ''))) / length(anchor);
  IF n <> 1 THEN RAISE EXCEPTION 'job_market_health_read: rules anchor found % times', n; END IF;
  EXECUTE replace(def, anchor, $r$      'plan_b_tiers', 'with_plan_b_supplier counts the paid_for_on_nuke tier (purchase records on Nuke); plan_b_by_tier adds stated_by_listing (a public business listing names a mapped service, same state, within its radius); listings are never evidence or a match pass',
$r$ || anchor);
END $edit$;

NOTIFY pgrst, 'reload schema';
COMMIT;
