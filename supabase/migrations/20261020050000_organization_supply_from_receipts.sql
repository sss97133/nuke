-- Organization supply evidence from retained receipts: what businesses were actually paid for, as Plan-B supply.
--
-- On 2026-10-19 the platform's supply history lived only in retained purchase records (receipts 2,430, receipt_items 263,
-- work_order_parts 80 with a free-text supplier, payment_events 14) and none of it resolved to organizations: 12 of
-- 1,121 normalized receipt vendor names equalled an organization name, several of them wrong-domain (a food truck,
-- "unknown"). This adds a deterministic, reviewed resolver and a projection; nothing is fuzzy-matched:
--   supply_vendors + supply_vendor_aliases (reviewed 2026-10-19 from the live vendor names): a vehicle-trade business,
--     its exact normalized receipt names, and either an existing organization (by id), a website domain printed on that
--     vendor's own receipts (the stable identifier the sanctioned creator create_organization_batch keys on), or no
--     stable identifier (recorded as a counted gap, never created). Groceries, fuel, utilities, banks, insurance, DMV,
--     restaurants and private persons are not mapped. Individuals are never resolved (payment counterparties stay
--     unnamed; only rows already carrying counterparty_org_id are used).
--   supply_category_kinds: receipt line / part categories -> supply kinds. supply_requirement_keywords: requirement text
--     -> supply kinds (for matching).
--   organization_supply_evidence (service-only projection): one row per (basis row, organization, supply kind) with the
--     basis table/id, date and resolver. supply_resolve_counterparties() (service-only, idempotent) creates missing
--     domain-keyed organizations through create_organization_batch (is_public=false, receipted), then rebuilds the
--     projection. Run once here.
--   organization_supply_read(p_organization_id) (open): kinds with counts and first/last dates, source counts.
--     Never amounts, payers, receipt ids or line text. requirement_plan_b_suppliers(p_text) (open): organizations whose
--     recorded supply kinds match a requirement's text, labelled 'paid for this before on Nuke (n times)'.
--   supply_counterparty_gaps() (service-only): unresolved purchase records by vendor key.
-- Contract: supabase/sql/test_organization_supply_from_receipts.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

CREATE FUNCTION public.supply_vendor_key(p_name text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT NULLIF(btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(lower(COALESCE(p_name, '')), '[®™©]', '', 'g'),
    '[^a-z0-9&'' ]+', ' ', 'g'), '\m(store|#)\s*[0-9]+.*$', ''), '\s+', ' ', 'g')), '')
$$;

CREATE TABLE public.supply_vendors (
  vendor_slug text PRIMARY KEY CHECK (vendor_slug ~ '^[a-z0-9_]+$'),
  business_name text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('existing_organization', 'create_by_domain', 'gap_no_stable_identifier')),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE RESTRICT,
  domain text CHECK (domain IS NULL OR domain ~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$'),
  supply_kinds text[] NOT NULL CHECK (cardinality(supply_kinds) BETWEEN 1 AND 6),
  basis text NOT NULL,
  reviewed_at date NOT NULL DEFAULT '2026-10-19',
  CHECK ((decision = 'existing_organization' AND organization_id IS NOT NULL)
    OR (decision = 'create_by_domain' AND domain IS NOT NULL)
    OR (decision = 'gap_no_stable_identifier' AND organization_id IS NULL AND domain IS NULL))
);
CREATE TABLE public.supply_vendor_aliases (
  alias_key text PRIMARY KEY CHECK (alias_key = public.supply_vendor_key(alias_key)),
  vendor_slug text NOT NULL REFERENCES public.supply_vendors(vendor_slug) ON DELETE CASCADE
);
CREATE TABLE public.supply_category_kinds (
  category text PRIMARY KEY,
  supply_kind text NOT NULL
);
CREATE TABLE public.supply_requirement_keywords (
  pattern text PRIMARY KEY,
  supply_kinds text[] NOT NULL CHECK (cardinality(supply_kinds) >= 1)
);
CREATE TABLE public.organization_supply_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  basis_table text NOT NULL CHECK (basis_table IN ('receipts', 'work_order_parts', 'payment_events')),
  basis_id uuid NOT NULL,
  supply_kind text NOT NULL,
  observed_on date,
  resolver text NOT NULL CHECK (resolver IN ('reviewed_alias', 'payment_counterparty_org')),
  vendor_slug text,
  folded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (basis_table, basis_id, organization_id, supply_kind)
);
CREATE INDEX organization_supply_evidence_org ON public.organization_supply_evidence (organization_id, supply_kind);
CREATE INDEX organization_supply_evidence_kind ON public.organization_supply_evidence (supply_kind, organization_id);
DO $grants$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['supply_vendors', 'supply_vendor_aliases', 'supply_category_kinds', 'supply_requirement_keywords',
      'organization_supply_evidence'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated, service_role', t);
    EXECUTE format('GRANT SELECT ON public.%I TO service_role', t);
  END LOOP;
END $grants$;
COMMENT ON TABLE public.organization_supply_evidence IS
  'Projection: one row per (purchase record, organization, supply kind) from retained receipts, work-order parts and organization-resolved payments. Rebuilt by supply_resolve_counterparties(); service-only.';

-- Reviewed vendors (2026-10-19, from live receipts/work_order_parts; counts are receipts at review time).
-- Rows naming an existing organization land only where that organization exists (a fresh database has none).
INSERT INTO public.supply_vendors (vendor_slug, business_name, decision, organization_id, domain, supply_kinds, basis)
SELECT v.vendor_slug, v.business_name, v.decision, v.organization_id::uuid, v.domain, v.supply_kinds, v.basis FROM (VALUES
 ('holley', 'Holley', 'existing_organization', 'd0769163-47a9-4635-986c-e44a6ca86635', NULL, ARRAY['performance_parts','fuel_system_parts'], 'organization row website holley.com; 24 receipts'),
 ('wild_horses_4x4', 'Wild Horses 4x4', 'existing_organization', 'f40f60ca-e9dc-466a-9364-4ac407c4eca1', NULL, ARRAY['offroad_parts'], 'organization row website wildhorses4x4.com; receipts print wildhorses4x4.com'),
 ('ernies_upholstery', 'Ernie''s Upholstery', 'existing_organization', '40deadd4-f91f-4e92-99b5-50d42fcb0083', NULL, ARRAY['upholstery_service'], 'organization row (restoration_shop); work_order_parts supplier'),
 ('tuckers_classic_auto_parts', 'Tuckers Classic Auto Parts', 'existing_organization', '54e6ce85-a4d7-448e-8ad4-f23d3835486e', NULL, ARRAY['restoration_parts'], 'organization row website tuckersparts.com'),
 ('autozone', 'AutoZone', 'create_by_domain', NULL, 'autozone.com', ARRAY['auto_parts'], 'receipts print autozone.com; 125 receipts'),
 ('toms_offroad', 'Tom''s Offroad', 'create_by_domain', NULL, 'tomsoffroad.com', ARRAY['offroad_parts'], 'receipts print tomsoffroad.com; 35 receipts'),
 ('lmc_truck', 'LMC Truck', 'create_by_domain', NULL, 'lmctruck.com', ARRAY['restoration_parts'], 'receipts print lmctruck.com; 16 receipts'),
 ('harbor_freight', 'Harbor Freight Tools', 'create_by_domain', NULL, 'harborfreight.com', ARRAY['tools'], 'receipts print harborfreight.com; 14 receipts'),
 ('cti_industrial_supply', 'CTI Industrial Supply', 'create_by_domain', NULL, 'ctisupply.com', ARRAY['industrial_supply'], 'receipts print ctisupply.com; 8 receipts'),
 ('speedway_motors', 'Speedway Motors', 'create_by_domain', NULL, 'speedwaymotors.com', ARRAY['performance_parts'], 'receipts print speedwaymotors.com; 6 receipts'),
 ('oreilly_auto_parts', 'O''Reilly Auto Parts', 'create_by_domain', NULL, 'oreillyauto.com', ARRAY['auto_parts'], 'receipts print oreillyauto.com; 15 receipts'),
 ('american_polishing_plating', 'American Polishing & Plating', 'create_by_domain', NULL, 'americanpolishingandplating.com', ARRAY['plating_service'], 'receipts print americanpolishingandplating.com; 4 receipts'),
 ('lowes', 'Lowe''s', 'create_by_domain', NULL, 'lowes.com', ARRAY['hardware_materials'], 'receipts print lowes.com; 15 receipts'),
 ('carquest', 'Carquest Auto Parts', 'gap_no_stable_identifier', NULL, NULL, ARRAY['auto_parts'], '44 receipts; no domain printed'),
 ('snap_on', 'Snap-on', 'gap_no_stable_identifier', NULL, NULL, ARRAY['tools'], '19 receipts; no domain printed'),
 ('cj_pony_parts', 'CJ Pony Parts', 'gap_no_stable_identifier', NULL, NULL, ARRAY['restoration_parts'], '18 receipts; no domain printed'),
 ('summit_racing', 'Summit Racing', 'gap_no_stable_identifier', NULL, NULL, ARRAY['performance_parts'], '10 receipts + work_order_parts; no domain printed'),
 ('offroad_design', 'Offroad Design', 'gap_no_stable_identifier', NULL, NULL, ARRAY['offroad_parts'], '11 receipts; no domain printed'),
 ('georges_tire_auto_repair', 'George''s Tire & Auto Repair', 'gap_no_stable_identifier', NULL, NULL, ARRAY['tire_service'], '11 receipts; no domain printed'),
 ('km_racing', 'KM Racing', 'gap_no_stable_identifier', NULL, NULL, ARRAY['performance_parts'], '7 receipts; no domain printed'),
 ('rockauto', 'RockAuto', 'gap_no_stable_identifier', NULL, NULL, ARRAY['auto_parts'], 'work_order_parts supplier; no domain recorded'),
 ('lesas_auto_body_supplies', 'Lesa''s Auto Body Supplies', 'gap_no_stable_identifier', NULL, NULL, ARRAY['paint_materials'], '4 receipts; no domain printed'),
 ('champion_cooling_systems', 'Champion Cooling Systems', 'gap_no_stable_identifier', NULL, NULL, ARRAY['cooling_parts'], '3 receipts; no domain printed'),
 ('sms_auto_fabrics', 'SMS Auto Fabrics', 'gap_no_stable_identifier', NULL, NULL, ARRAY['interior_parts'], '4 receipts; domain not printed on these receipts'),
 ('davis_off_road', 'Davis Off Road', 'gap_no_stable_identifier', NULL, NULL, ARRAY['offroad_parts'], 'work_order_parts supplier; no domain recorded'),
 ('ecklers', 'Ecklers', 'gap_no_stable_identifier', NULL, NULL, ARRAY['restoration_parts'], 'work_order_parts supplier; no domain recorded')) v(vendor_slug, business_name, decision, organization_id, domain, supply_kinds, basis)
WHERE v.organization_id IS NULL OR EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = v.organization_id::uuid);
INSERT INTO public.supply_vendor_aliases (alias_key, vendor_slug)
SELECT a.* FROM (VALUES
 ('holley', 'holley'), ('holley performance products inc', 'holley'),
 ('wild horses inc', 'wild_horses_4x4'), ('wild horses 4x4', 'wild_horses_4x4'),
 ('ernie''s upholstery', 'ernies_upholstery'),
 ('tuckers classic auto parts', 'tuckers_classic_auto_parts'),
 ('autozone', 'autozone'), ('auto zone', 'autozone'),
 ('toms offroad', 'toms_offroad'), ('toms offroad inc', 'toms_offroad'),
 ('lmc truck', 'lmc_truck'),
 ('harbor freight tools', 'harbor_freight'), ('harbor freight', 'harbor_freight'),
 ('cti industrial supply', 'cti_industrial_supply'),
 ('speedway motors', 'speedway_motors'),
 ('o''reilly auto parts', 'oreilly_auto_parts'), ('o reilly auto parts', 'oreilly_auto_parts'), ('reilly auto parts', 'oreilly_auto_parts'),
 ('o''reilly', 'oreilly_auto_parts'), ('reilly parts', 'oreilly_auto_parts'),
 ('american polishing & plating', 'american_polishing_plating'),
 ('lowe''s', 'lowes'),
 ('carquest auto parts', 'carquest'), ('carquest', 'carquest'),
 ('snap on tools order', 'snap_on'),
 ('cj pony parts inc', 'cj_pony_parts'),
 ('summit racing', 'summit_racing'),
 ('offroad design', 'offroad_design'),
 ('george''s tire & auto repair', 'georges_tire_auto_repair'),
 ('km racing', 'km_racing'),
 ('rockauto', 'rockauto'),
 ('lesa''s auto body supplies inc', 'lesas_auto_body_supplies'),
 ('champion cooling systems', 'champion_cooling_systems'),
 ('sms auto fabrics', 'sms_auto_fabrics'),
 ('davis off road', 'davis_off_road'),
 ('ecklers', 'ecklers')) a(alias_key, vendor_slug)
WHERE EXISTS (SELECT 1 FROM public.supply_vendors s WHERE s.vendor_slug = a.vendor_slug);
INSERT INTO public.supply_category_kinds (category, supply_kind) VALUES
 ('suspension', 'suspension_parts'), ('engine', 'engine_parts'), ('cooling', 'cooling_parts'), ('exhaust', 'exhaust_parts'),
 ('brakes', 'brake_parts'), ('electrical', 'electrical_parts'), ('fuel_system', 'fuel_system_parts'), ('paint', 'paint_materials'),
 ('hardware', 'hardware_materials'), ('tools', 'tools'), ('interior', 'interior_parts'), ('exterior', 'body_parts'), ('body', 'body_parts'),
 ('trim', 'body_parts'), ('weatherstrip', 'body_parts'), ('drivetrain', 'drivetrain_parts'), ('steering', 'steering_parts'),
 ('fluids', 'fluids'), ('consumables', 'hardware_materials'), ('supplies', 'hardware_materials'), ('automotive_parts', 'auto_parts'),
 ('auto', 'auto_parts');
INSERT INTO public.supply_requirement_keywords (pattern, supply_kinds) VALUES
 ('exhaust|muffler|header', ARRAY['exhaust_parts']), ('brake', ARRAY['brake_parts']), ('suspension|shock|spring', ARRAY['suspension_parts']),
 ('engine|motor', ARRAY['engine_parts']), ('cooling|radiator', ARRAY['cooling_parts']), ('electrical|wiring|battery', ARRAY['electrical_parts']),
 ('fuel|carb|carburetor|injector', ARRAY['fuel_system_parts']), ('paint|primer|clear ?coat', ARRAY['paint_materials']),
 ('upholster|seat|carpet|headliner|interior', ARRAY['interior_parts','upholstery_service']), ('plating|chrome|polish', ARRAY['plating_service']),
 ('body|panel|trim|weatherstrip|rust', ARRAY['body_parts']), ('drivetrain|axle|differential|transmission', ARRAY['drivetrain_parts']),
 ('steering', ARRAY['steering_parts']), ('weld|fabricat|stainless|mild steel|sheet metal', ARRAY['industrial_supply']),
 ('tire|wheel alignment', ARRAY['tire_service']), ('tool', ARRAY['tools']);

CREATE FUNCTION public.supply_resolve_counterparties() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
DECLARE
  v record;
  org uuid;
  created integer := 0;
  linked integer := 0;
  batch jsonb;
  n_before integer;
  n_after integer;
BEGIN
  -- Only vendors with at least one current purchase record under a reviewed name are resolved or created.
  FOR v IN SELECT s.* FROM public.supply_vendors s WHERE s.decision = 'create_by_domain' AND EXISTS (
      SELECT 1 FROM public.supply_vendor_aliases a WHERE a.vendor_slug = s.vendor_slug AND (
        EXISTS (SELECT 1 FROM public.receipts r WHERE public.supply_vendor_key(r.vendor_name) = a.alias_key
          AND r.is_superseded IS NOT TRUE AND r.is_active IS NOT FALSE)
        OR EXISTS (SELECT 1 FROM public.work_order_parts p WHERE public.supply_vendor_key(p.supplier) = a.alias_key)))
    ORDER BY s.vendor_slug LOOP
    SELECT o.id INTO org FROM public.organizations o WHERE o.website = ANY (ARRAY['https://' || v.domain, 'https://' || v.domain || '/',
      'http://' || v.domain, 'http://' || v.domain || '/', 'https://www.' || v.domain, 'https://www.' || v.domain || '/',
      'http://www.' || v.domain, 'http://www.' || v.domain || '/']) ORDER BY o.created_at NULLS LAST, o.id LIMIT 1;
    IF org IS NULL THEN
      batch := public.create_organization_batch(jsonb_build_array(jsonb_build_object('business_name', v.business_name, 'website', v.domain)),
        'nuke-retained-receipts');
      created := created + COALESCE((batch->>'created')::int, 0);
      SELECT o.id INTO org FROM public.organizations o WHERE o.website = 'https://' || v.domain ORDER BY o.created_at NULLS LAST, o.id LIMIT 1;
    ELSE
      linked := linked + 1;
    END IF;
    IF org IS NOT NULL AND v.organization_id IS DISTINCT FROM org THEN
      UPDATE public.supply_vendors SET organization_id = org WHERE vendor_slug = v.vendor_slug;
    END IF;
  END LOOP;

  SELECT count(*) INTO n_before FROM public.organization_supply_evidence;
  CREATE TEMP TABLE supply_fold ON COMMIT DROP AS
  WITH vend AS (
    SELECT a.alias_key, s.vendor_slug, s.organization_id, s.supply_kinds FROM public.supply_vendor_aliases a
    JOIN public.supply_vendors s ON s.vendor_slug = a.vendor_slug WHERE s.organization_id IS NOT NULL
  ), rec AS (
    SELECT r.id, vd.organization_id, vd.vendor_slug, vd.supply_kinds,
      COALESCE(r.receipt_date, r.transaction_date, r.purchase_date, r.created_at::date) AS d
    FROM public.receipts r JOIN vend vd ON vd.alias_key = public.supply_vendor_key(r.vendor_name)
    WHERE r.is_superseded IS NOT TRUE AND r.is_active IS NOT FALSE
  ), part AS (
    SELECT p.id, vd.organization_id, vd.vendor_slug, vd.supply_kinds, p.category, p.created_at::date AS d
    FROM public.work_order_parts p JOIN vend vd ON vd.alias_key = public.supply_vendor_key(p.supplier)
  )
  SELECT DISTINCT 'receipts'::text AS basis_table, rec.id AS basis_id, rec.organization_id, k.kind AS supply_kind, rec.d AS observed_on,
    'reviewed_alias'::text AS resolver, rec.vendor_slug
  FROM rec CROSS JOIN LATERAL (SELECT unnest(rec.supply_kinds) AS kind UNION
    SELECT ck.supply_kind FROM public.receipt_items ri JOIN public.supply_category_kinds ck ON ck.category = lower(btrim(ri.category))
    WHERE ri.receipt_id = rec.id) k
  UNION
  SELECT 'work_order_parts', part.id, part.organization_id, k.kind, part.d, 'reviewed_alias', part.vendor_slug
  FROM part CROSS JOIN LATERAL (SELECT unnest(part.supply_kinds) AS kind UNION
    SELECT ck.supply_kind FROM public.supply_category_kinds ck WHERE ck.category = lower(btrim(part.category))) k
  UNION
  SELECT 'payment_events', pe.id, pe.counterparty_org_id, 'paid_counterparty', pe.paid_at::date, 'payment_counterparty_org', NULL
  FROM public.payment_events pe JOIN public.organizations o ON o.id = pe.counterparty_org_id
  WHERE pe.direction = 'out' AND pe.is_superseded IS NOT TRUE;

  DELETE FROM public.organization_supply_evidence e WHERE NOT EXISTS (SELECT 1 FROM supply_fold f
    WHERE f.basis_table = e.basis_table AND f.basis_id = e.basis_id AND f.organization_id = e.organization_id AND f.supply_kind = e.supply_kind);
  INSERT INTO public.organization_supply_evidence (organization_id, basis_table, basis_id, supply_kind, observed_on, resolver, vendor_slug)
    SELECT f.organization_id, f.basis_table, f.basis_id, f.supply_kind, f.observed_on, f.resolver, f.vendor_slug FROM supply_fold f
    ON CONFLICT (basis_table, basis_id, organization_id, supply_kind) DO UPDATE SET observed_on = EXCLUDED.observed_on, vendor_slug = EXCLUDED.vendor_slug;
  SELECT count(*) INTO n_after FROM public.organization_supply_evidence;
  DROP TABLE supply_fold;

  RETURN jsonb_build_object('organizations_created', created, 'organizations_found_by_domain', linked,
    'evidence_rows', n_after, 'evidence_rows_before', n_before,
    'organizations_with_supply', (SELECT count(DISTINCT organization_id) FROM public.organization_supply_evidence),
    'records_resolved', (SELECT count(DISTINCT (basis_table, basis_id)) FROM public.organization_supply_evidence));
END $$;
REVOKE ALL ON FUNCTION public.supply_resolve_counterparties() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.supply_resolve_counterparties() TO service_role;

CREATE FUNCTION public.organization_supply_summary(p_organization_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT jsonb_build_object(
    'kinds', COALESCE((SELECT jsonb_agg(jsonb_build_object('supply_kind', k.supply_kind, 'times', k.n, 'first_on', k.f, 'last_on', k.l)
        ORDER BY k.n DESC, k.supply_kind)
      FROM (SELECT e.supply_kind, count(DISTINCT (e.basis_table, e.basis_id)) n, min(e.observed_on) f, max(e.observed_on) l
        FROM public.organization_supply_evidence e WHERE e.organization_id = p_organization_id GROUP BY 1) k), '[]'::jsonb),
    'records', (SELECT count(DISTINCT (e.basis_table, e.basis_id)) FROM public.organization_supply_evidence e WHERE e.organization_id = p_organization_id),
    'by_source', COALESCE((SELECT jsonb_object_agg(s.basis_table, s.n) FROM (SELECT e.basis_table, count(DISTINCT e.basis_id) n
      FROM public.organization_supply_evidence e WHERE e.organization_id = p_organization_id GROUP BY 1) s), '{}'::jsonb),
    'first_on', (SELECT min(e.observed_on) FROM public.organization_supply_evidence e WHERE e.organization_id = p_organization_id),
    'last_on', (SELECT max(e.observed_on) FROM public.organization_supply_evidence e WHERE e.organization_id = p_organization_id))
$$;
REVOKE ALL ON FUNCTION public.organization_supply_summary(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.organization_supply_summary(uuid) TO service_role;

CREATE FUNCTION public.organization_supply_read(p_organization_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
DECLARE o record;
BEGIN
  SELECT x.id, x.is_public INTO o FROM public.organizations x WHERE x.id = p_organization_id;
  IF o.id IS NULL THEN RAISE EXCEPTION 'Organization unavailable' USING ERRCODE = '22023'; END IF;
  RETURN jsonb_build_object('as_of', statement_timestamp(), 'organization', public.platform_organization_label(o.id),
    'profile_public', o.is_public IS TRUE,
    'work_recorded_on_nuke', public.organization_supply_summary(o.id),
    'basis', 'purchase records retained on Nuke (receipts, work-order parts, organization-resolved payments), resolved by reviewed vendor names; times are records, not quantities',
    'withheld', jsonb_build_array('amounts paid', 'who paid', 'receipt and line ids', 'line text'));
END $$;
REVOKE ALL ON FUNCTION public.organization_supply_read(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.organization_supply_read(uuid) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.organization_supply_read(uuid) IS
  'Open: what an organization was paid for on Nuke (supply kinds with record counts and first/last dates). No amounts, payers or receipt ids.';

CREATE FUNCTION public.requirement_plan_b_suppliers(p_text text, p_limit integer DEFAULT 5) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH kinds AS (
    SELECT DISTINCT unnest(k.supply_kinds) AS kind FROM public.supply_requirement_keywords k
    WHERE lower(COALESCE(p_text, '')) ~ ('\m(' || k.pattern || ')')
  ), hits AS (
    SELECT e.organization_id, array_agg(DISTINCT e.supply_kind ORDER BY e.supply_kind) AS kinds_matched,
      count(DISTINCT (e.basis_table, e.basis_id)) AS times, min(e.observed_on) AS first_on, max(e.observed_on) AS last_on
    FROM public.organization_supply_evidence e JOIN kinds k ON k.kind = e.supply_kind GROUP BY e.organization_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('organization', public.platform_organization_label(h.organization_id),
      'profile_public', o.is_public IS TRUE, 'kinds_matched', to_jsonb(h.kinds_matched), 'times', h.times,
      'first_on', h.first_on, 'last_on', h.last_on,
      'label', 'paid for this before on Nuke (' || h.times || CASE WHEN h.times = 1 THEN ' time)' ELSE ' times)' END,
      'role', 'plan_b_supplier', 'basis', 'retained purchase records resolved to this organization; no amounts or payers')
      ORDER BY h.times DESC, h.organization_id), '[]'::jsonb)
  FROM (SELECT * FROM hits ORDER BY times DESC, organization_id LIMIT LEAST(GREATEST(COALESCE(p_limit, 5), 1), 20)) h
  JOIN public.organizations o ON o.id = h.organization_id
$$;
REVOKE ALL ON FUNCTION public.requirement_plan_b_suppliers(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.requirement_plan_b_suppliers(text, integer) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.requirement_plan_b_suppliers(text, integer) IS
  'Open helper for matching readers: organizations whose recorded supply kinds match a requirement''s text (reviewed keywords), labelled paid for this before on Nuke (n times).';

CREATE FUNCTION public.supply_counterparty_gaps() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  RETURN (WITH r AS (SELECT r.id, public.supply_vendor_key(r.vendor_name) k FROM public.receipts r
    WHERE r.is_superseded IS NOT TRUE AND r.is_active IS NOT FALSE),
  resolved AS (SELECT DISTINCT basis_id FROM public.organization_supply_evidence WHERE basis_table = 'receipts')
  SELECT jsonb_build_object(
    'receipts', (SELECT count(*) FROM r), 'receipts_resolved', (SELECT count(*) FROM resolved),
    'receipts_no_vendor_name', (SELECT count(*) FROM r WHERE r.k IS NULL),
    'named_businesses_without_identifier', COALESCE((SELECT jsonb_agg(jsonb_build_object('vendor', s.business_name, 'receipts', n.n,
        'supply_kinds', to_jsonb(s.supply_kinds)) ORDER BY n.n DESC)
      FROM public.supply_vendors s CROSS JOIN LATERAL (SELECT count(*) n FROM r JOIN public.supply_vendor_aliases a ON a.alias_key = r.k
        WHERE a.vendor_slug = s.vendor_slug) n WHERE s.decision = 'gap_no_stable_identifier'), '[]'::jsonb),
    'unmapped_vendor_keys', (SELECT count(DISTINCT r.k) FROM r WHERE r.k IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.supply_vendor_aliases a WHERE a.alias_key = r.k)),
    'unmapped_receipts', (SELECT count(*) FROM r WHERE r.k IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.supply_vendor_aliases a WHERE a.alias_key = r.k)),
    'basis', 'unmapped keys include personal purchases (groceries, fuel, utilities, banks, insurance, restaurants) and OCR noise; never auto-created'));
END $$;
REVOKE ALL ON FUNCTION public.supply_counterparty_gaps() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.supply_counterparty_gaps() TO service_role;

DO $backfill$
BEGIN
  IF to_regclass('public.receipts') IS NOT NULL AND to_regclass('public.work_order_parts') IS NOT NULL
      AND to_regclass('public.payment_events') IS NOT NULL AND to_regprocedure('public.create_organization_batch(jsonb,text,boolean)') IS NOT NULL THEN
    RAISE NOTICE 'supply_resolve_counterparties: %', public.supply_resolve_counterparties();
  END IF;
END $backfill$;

NOTIFY pgrst, 'reload schema';
COMMIT;
