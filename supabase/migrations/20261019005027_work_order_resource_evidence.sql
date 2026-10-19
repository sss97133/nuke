-- Job resource evidence, first executable slice (owner requested implementation, 2026-10-19).
-- Live inspection: work_order_line_items owns operations; user_tools and tool_inventory
-- have different grains; equipment.shop_id is not an enforced FK; organizations owns shops.
-- No existing requirement/fulfillment/attestation relation was found in the live atlas.
-- These are typed, immutable indexes of testimony already admitted by ingest-observation,
-- not a second testimony intake. The source JSON is validated before any projection lands.
-- A claim of permission remains a claim. This does NOT reserve capacity, certify a license,
-- authorize payment, or turn a verification boolean into mechanic competence.
-- RLS: service-role-only backend slice. No new anon/authenticated access or source publication.
-- Contract: supabase/sql/test_work_order_resource_evidence.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

CREATE TABLE public.work_order_resource_requirements (
  id uuid PRIMARY KEY REFERENCES public.vehicle_observations(id) ON DELETE RESTRICT,
  work_order_id uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE RESTRICT,
  line_item_id uuid NOT NULL REFERENCES public.work_order_line_items(id) ON DELETE RESTRICT,
  requirement_kind text NOT NULL CHECK (requirement_kind IN ('tool','equipment','facility','skill','inspection','approval')),
  description text NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 2000),
  quantity numeric NOT NULL CHECK (quantity > 0 AND quantity < 'Infinity'::numeric),
  unit text NOT NULL CHECK (length(btrim(unit)) BETWEEN 1 AND 80),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (id, work_order_id)
);
CREATE INDEX work_resource_requirements_order ON public.work_order_resource_requirements(work_order_id, id);
CREATE INDEX work_resource_requirements_line ON public.work_order_resource_requirements(line_item_id);

CREATE TABLE public.work_order_resource_fulfillments (
  id uuid PRIMARY KEY REFERENCES public.vehicle_observations(id) ON DELETE RESTRICT,
  work_order_id uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE RESTRICT,
  requirement_id uuid NOT NULL,
  supplier_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  supplier_organization_id uuid REFERENCES public.organizations(id) ON DELETE RESTRICT,
  user_tool_id uuid REFERENCES public.user_tools(id) ON DELETE RESTRICT,
  inventory_tool_id uuid REFERENCES public.tool_inventory(id) ON DELETE RESTRICT,
  equipment_id uuid REFERENCES public.equipment(id) ON DELETE RESTRICT,
  facility_organization_id uuid REFERENCES public.organizations(id) ON DELETE RESTRICT,
  available_from timestamptz,
  available_until timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (requirement_id, work_order_id) REFERENCES public.work_order_resource_requirements(id, work_order_id) ON DELETE RESTRICT,
  UNIQUE (id, work_order_id),
  CHECK (num_nonnulls(supplier_user_id, supplier_organization_id) = 1),
  CHECK (num_nonnulls(user_tool_id, inventory_tool_id, equipment_id, facility_organization_id) = 1),
  CHECK ((available_from IS NULL AND available_until IS NULL) OR
         (available_from IS NOT NULL AND available_until IS NOT NULL AND
          isfinite(available_from) AND isfinite(available_until) AND available_from < available_until))
);
CREATE INDEX work_resource_fulfillments_order ON public.work_order_resource_fulfillments(work_order_id, requirement_id);
CREATE INDEX work_resource_fulfillments_user_tool ON public.work_order_resource_fulfillments(user_tool_id) WHERE user_tool_id IS NOT NULL;
CREATE INDEX work_resource_fulfillments_inventory ON public.work_order_resource_fulfillments(inventory_tool_id) WHERE inventory_tool_id IS NOT NULL;
CREATE INDEX work_resource_fulfillments_equipment ON public.work_order_resource_fulfillments(equipment_id) WHERE equipment_id IS NOT NULL;
CREATE INDEX work_resource_fulfillments_facility ON public.work_order_resource_fulfillments(facility_organization_id) WHERE facility_organization_id IS NOT NULL;
CREATE INDEX work_resource_fulfillments_supplier_user ON public.work_order_resource_fulfillments(supplier_user_id) WHERE supplier_user_id IS NOT NULL;
CREATE INDEX work_resource_fulfillments_supplier_org ON public.work_order_resource_fulfillments(supplier_organization_id) WHERE supplier_organization_id IS NOT NULL;

CREATE TABLE public.work_order_resource_attestations (
  id uuid PRIMARY KEY REFERENCES public.vehicle_observations(id) ON DELETE RESTRICT,
  work_order_id uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE RESTRICT,
  fulfillment_id uuid NOT NULL,
  attestor_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  attestor_organization_id uuid REFERENCES public.organizations(id) ON DELETE RESTRICT,
  attestation_kind text NOT NULL CHECK (attestation_kind IN ('condition','suitability','permission','availability','supervision','delivery','withdrawal')),
  verdict text NOT NULL CHECK (verdict IN ('supports','contradicts','unknown')),
  scope text NOT NULL CHECK (length(btrim(scope)) BETWEEN 1 AND 2000),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (fulfillment_id, work_order_id) REFERENCES public.work_order_resource_fulfillments(id, work_order_id) ON DELETE RESTRICT,
  CHECK (num_nonnulls(attestor_user_id, attestor_organization_id) = 1)
);
CREATE INDEX work_resource_attestations_order ON public.work_order_resource_attestations(work_order_id, fulfillment_id);
CREATE INDEX work_resource_attestations_user ON public.work_order_resource_attestations(attestor_user_id) WHERE attestor_user_id IS NOT NULL;
CREATE INDEX work_resource_attestations_org ON public.work_order_resource_attestations(attestor_organization_id) WHERE attestor_organization_id IS NOT NULL;

COMMENT ON TABLE public.work_order_resource_requirements IS 'One requirement claim for one work-order operation, keyed to its immutable vehicle_observations source. Not a complete plan or reservation. Writer: project_work_order_resource_observation.';
COMMENT ON TABLE public.work_order_resource_fulfillments IS 'One candidate supplier/resource arrangement for one requirement. Ownership, consent and reservation remain distinct; no payment or capacity is bound. Writer: project_work_order_resource_observation.';
COMMENT ON TABLE public.work_order_resource_attestations IS 'One reported scoped statement about a candidate arrangement. The attestor is attributed by source testimony, not authenticated by this projection. Does not grant permission. Writer: project_work_order_resource_observation.';

-- Projection tables carry typed links only. All original clocks, source, method, trust,
-- content and supersession remain on the FK source; no parallel DNA grammar is introduced.
CREATE FUNCTION public.work_order_resource_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Resource projections are immutable; supersede source testimony and project its replacement';
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['work_order_resource_requirements','work_order_resource_fulfillments','work_order_resource_attestations'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated, service_role',t);
    EXECUTE format('GRANT SELECT ON public.%I TO service_role',t);
    EXECUTE format('CREATE POLICY resource_service_read ON public.%I FOR SELECT TO service_role USING (true)',t);
    EXECUTE format('CREATE TRIGGER resource_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.work_order_resource_immutable()',t);
    EXECUTE format('CREATE TRIGGER resource_no_truncate BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.work_order_resource_immutable()',t);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.work_order_resource_immutable() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT table_name,column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name IN
      ('work_order_resource_requirements','work_order_resource_fulfillments','work_order_resource_attestations') LOOP
    EXECUTE format('COMMENT ON COLUMN public.%I.%I IS %L',c.table_name,c.column_name,
      CASE c.column_name
        WHEN 'id' THEN 'Source vehicle_observations UUID and idempotency key. Source owns testimony, method, trust and original clocks.'
        WHEN 'work_order_id' THEN 'Existing work order containing this attributed resource claim.'
        WHEN 'line_item_id' THEN 'Existing operation in the same work order; validated by the projection writer and reader.'
        WHEN 'requirement_id' THEN 'Requirement source UUID; composite FK prevents cross-work-order linking.'
        WHEN 'fulfillment_id' THEN 'Candidate arrangement source UUID; composite FK prevents cross-work-order linking.'
        WHEN 'requirement_kind' THEN 'Required capability category; tool, equipment, facility, skill, inspection or approval. No completeness implied.'
        WHEN 'description' THEN 'Requirement description copied from source testimony; not an independently verified procedure.'
        WHEN 'quantity' THEN 'Positive finite required quantity in the stated unit; no default inferred quantity.'
        WHEN 'unit' THEN 'Source-stated quantity unit; no automatic unit conversion.'
        WHEN 'supplier_user_id' THEN 'Attributed supplying auth user, mutually exclusive with supplying organization; authority not adjudicated.'
        WHEN 'supplier_organization_id' THEN 'Attributed supplying organization, mutually exclusive with supplying user; authority not adjudicated.'
        WHEN 'user_tool_id' THEN 'Existing aggregated personal inventory record, not necessarily one exclusive physical unit.'
        WHEN 'inventory_tool_id' THEN 'Existing tool depreciation/use inventory record; not equated with user_tools or tool_catalog.'
        WHEN 'equipment_id' THEN 'Existing shop equipment record; presence does not imply permission or availability.'
        WHEN 'facility_organization_id' THEN 'Organization proposed as facility provider; does not establish a specific bay, license or reservation.'
        WHEN 'available_from' THEN 'Start of source-stated candidate availability interval, UTC instant; null means unknown.'
        WHEN 'available_until' THEN 'Exclusive end of source-stated candidate availability interval, UTC instant; null means unknown.'
        WHEN 'attestor_user_id' THEN 'User attributed as making the statement; this projection does not authenticate their signature.'
        WHEN 'attestor_organization_id' THEN 'Organization attributed as making the statement; this projection does not authenticate authority to represent it.'
        WHEN 'attestation_kind' THEN 'Subject of the reported statement: condition, suitability, permission, availability, supervision, delivery or withdrawal.'
        WHEN 'verdict' THEN 'Source statement supports, contradicts or leaves unknown the explicit scope; no automatic approval.'
        WHEN 'scope' THEN 'Exact scope of the reported statement, not a blanket endorsement of a provider.'
        WHEN 'recorded_at' THEN 'Projection insertion clock; distinct from observation and ingestion clocks retained on the source.'
      END);
  END LOOP;
END $$;

CREATE FUNCTION public.project_work_order_resource_observation(p_observation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  o public.vehicle_observations%ROWTYPE;
  e jsonb;
  w public.work_orders%ROWTYPE;
  operation_id uuid;
  target_id uuid;
  event_type text;
  inserted_rows integer;
  required_kind text;
BEGIN
  -- Fixed allowlisted projection only; the source is always read from the existing log.
  SELECT * INTO o FROM public.vehicle_observations WHERE id=p_observation_id FOR SHARE;
  IF NOT FOUND OR o.kind::text <> 'work_record' OR o.is_superseded IS DISTINCT FROM false OR o.source_id IS NULL THEN
    RAISE EXCEPTION 'Current attributed work_record source required';
  END IF;
  e := o.structured_data->'work_order_resource';
  IF jsonb_typeof(e) IS DISTINCT FROM 'object' OR e->>'version' IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'work_order_resource version 1 envelope required';
  END IF;
  event_type := e->>'event_type';
  IF event_type IS NULL OR event_type NOT IN ('requirement','fulfillment','attestation') THEN
    RAISE EXCEPTION 'Unknown resource event type';
  END IF;
  SELECT * INTO w FROM public.work_orders WHERE id=(e->>'work_order_id')::uuid FOR SHARE;
  IF NOT FOUND OR w.vehicle_id IS NULL OR w.vehicle_id IS DISTINCT FROM o.vehicle_id THEN
    RAISE EXCEPTION 'Source and work order must identify the same vehicle';
  END IF;
  -- Source IDs are idempotency keys. Replays still qualify every source and parent.
  IF event_type='requirement' THEN
    operation_id := (e->>'line_item_id')::uuid;
    PERFORM 1 FROM public.work_order_line_items WHERE id=operation_id AND work_order_id=w.id FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Operation must belong to the work order'; END IF;
    INSERT INTO public.work_order_resource_requirements(id,work_order_id,line_item_id,requirement_kind,description,quantity,unit)
      VALUES(o.id,w.id,operation_id,e->>'requirement_kind',e->>'description',(e->>'quantity')::numeric,e->>'unit')
      ON CONFLICT(id) DO NOTHING;
  ELSIF event_type='fulfillment' THEN
    target_id := (e->>'requirement_id')::uuid;
    SELECT r.requirement_kind INTO required_kind
      FROM public.work_order_resource_requirements r JOIN public.vehicle_observations s ON s.id=r.id
      JOIN public.work_order_line_items li ON li.id=r.line_item_id AND li.work_order_id=w.id
      WHERE r.id=target_id AND r.work_order_id=w.id AND s.is_superseded IS FALSE AND s.vehicle_id=w.vehicle_id
      FOR SHARE OF r,s,li;
    IF NOT FOUND THEN RAISE EXCEPTION 'Current requirement in the same work order required'; END IF;
    IF NOT ((required_kind='tool' AND num_nonnulls(e->>'user_tool_id',e->>'inventory_tool_id',e->>'equipment_id')=1)
      OR (required_kind='equipment' AND e->>'equipment_id' IS NOT NULL)
      OR (required_kind='facility' AND e->>'facility_organization_id' IS NOT NULL)) THEN
      RAISE EXCEPTION 'Resource type does not satisfy this requirement kind';
    END IF;
    INSERT INTO public.work_order_resource_fulfillments(id,work_order_id,requirement_id,supplier_user_id,supplier_organization_id,
      user_tool_id,inventory_tool_id,equipment_id,facility_organization_id,available_from,available_until)
      VALUES(o.id,w.id,target_id,(e->>'supplier_user_id')::uuid,(e->>'supplier_organization_id')::uuid,
      (e->>'user_tool_id')::uuid,(e->>'inventory_tool_id')::uuid,(e->>'equipment_id')::uuid,(e->>'facility_organization_id')::uuid,
      (e->>'available_from')::timestamptz,(e->>'available_until')::timestamptz) ON CONFLICT(id) DO NOTHING;
  ELSE
    target_id := (e->>'fulfillment_id')::uuid;
    PERFORM 1 FROM public.work_order_resource_fulfillments f
      JOIN public.vehicle_observations fs ON fs.id=f.id JOIN public.vehicle_observations rs ON rs.id=f.requirement_id
      JOIN public.work_order_resource_requirements r ON r.id=f.requirement_id
      JOIN public.work_order_line_items li ON li.id=r.line_item_id AND li.work_order_id=w.id
      WHERE f.id=target_id AND f.work_order_id=w.id AND fs.is_superseded IS FALSE AND rs.is_superseded IS FALSE
        AND fs.vehicle_id=w.vehicle_id AND rs.vehicle_id=w.vehicle_id
      FOR SHARE OF f,fs,rs,r,li;
    IF NOT FOUND THEN RAISE EXCEPTION 'Current fulfillment and requirement in the same work order required'; END IF;
    INSERT INTO public.work_order_resource_attestations(id,work_order_id,fulfillment_id,attestor_user_id,attestor_organization_id,
      attestation_kind,verdict,scope)
      VALUES(o.id,w.id,target_id,(e->>'attestor_user_id')::uuid,(e->>'attestor_organization_id')::uuid,
      e->>'attestation_kind',e->>'verdict',e->>'scope') ON CONFLICT(id) DO NOTHING;
  END IF;
  GET DIAGNOSTICS inserted_rows = ROW_COUNT;
  RETURN jsonb_build_object('id',o.id,'event_type',event_type,'duplicate',inserted_rows=0);
END $$;
REVOKE ALL ON FUNCTION public.project_work_order_resource_observation(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.project_work_order_resource_observation(uuid) TO service_role;
COMMENT ON FUNCTION public.project_work_order_resource_observation(uuid) IS 'Service-only typed projection of an existing current work_record admitted through ingest-observation. Never inserts or changes testimony, permissions, bookings or payments.';

CREATE FUNCTION public.read_work_order_resources(p_work_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE result jsonb;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.work_orders WHERE id=p_work_order_id) THEN
    RAISE EXCEPTION 'Work order unavailable';
  END IF;
  WITH requirements AS (
    SELECT r.*,s.observed_at,s.ingested_at,s.source_id
    FROM public.work_order_resource_requirements r JOIN public.vehicle_observations s ON s.id=r.id
    JOIN public.work_order_line_items li ON li.id=r.line_item_id AND li.work_order_id=r.work_order_id
    JOIN public.work_orders w ON w.id=r.work_order_id AND w.vehicle_id=s.vehicle_id
    WHERE r.work_order_id=p_work_order_id AND s.is_superseded IS FALSE
  ), fulfillments AS (
    SELECT f.*,s.observed_at,s.ingested_at,s.source_id
    FROM public.work_order_resource_fulfillments f JOIN requirements r ON r.id=f.requirement_id
    JOIN public.vehicle_observations s ON s.id=f.id JOIN public.work_orders w ON w.id=f.work_order_id AND w.vehicle_id=s.vehicle_id
    WHERE f.work_order_id=p_work_order_id AND s.is_superseded IS FALSE
  ), attestations AS (
    SELECT a.*,s.observed_at,s.ingested_at,s.source_id
    FROM public.work_order_resource_attestations a JOIN fulfillments f ON f.id=a.fulfillment_id
    JOIN public.vehicle_observations s ON s.id=a.id JOIN public.work_orders w ON w.id=a.work_order_id AND w.vehicle_id=s.vehicle_id
    WHERE a.work_order_id=p_work_order_id AND s.is_superseded IS FALSE
  )
  SELECT jsonb_build_object('work_order_id',p_work_order_id,'as_of',statement_timestamp(),
    'requirements',COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM requirements r),'[]'::jsonb),
    'fulfillments',COALESCE((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.id) FROM fulfillments f),'[]'::jsonb),
    'attestations',COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM attestations a),'[]'::jsonb),
    'coverage',jsonb_build_object('recorded_requirements',(SELECT count(*) FROM requirements),
      'requirements_with_candidates',(SELECT count(DISTINCT requirement_id) FROM fulfillments),
      'requirement_population','not_assessed','source_scope','explicitly_projected_work_record_observations'),
    'booking_readiness','not_assessed','permission_authority','not_assessed','capacity_reserved',false,
    'payment_authorized',false) INTO result;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.read_work_order_resources(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_work_order_resources(uuid) TO service_role;
COMMENT ON FUNCTION public.read_work_order_resources(uuid) IS 'Service-only current resource evidence graph for a work order. Superseded or reattributed source chains are excluded. No historical replay, exhaustive plan, permission adjudication or booking-readiness claim.';

INSERT INTO public.pipeline_registry(table_name,column_name,owned_by,description,do_not_write_directly,write_via)
SELECT t,'id','project_work_order_resource_observation','Typed index of existing work_record testimony; source id is the idempotency key. No raw resource testimony writes.',true,'project_work_order_resource_observation(uuid)'
FROM unnest(ARRAY['work_order_resource_requirements','work_order_resource_fulfillments','work_order_resource_attestations']) t;
NOTIFY pgrst, 'reload schema';
COMMIT;
