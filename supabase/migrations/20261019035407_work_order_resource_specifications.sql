-- Material and process belong together in the work specification (owner, 2026-10-19).
-- A requested pair, a part record and a reported operation are separate attributed claims; the
-- reader compares them by role and key and never adjudicates substitution, competence or completion.
-- Basis custody: a retained message excerpt, or an exact component_events / work_order_parts row
-- snapshot. No FK to those owners: their rows cascade from vehicles and timeline events, and a
-- RESTRICT reference would change that behavior. A changed or removed basis withholds the row.
-- Labels are verbatim from the basis; keys are the derived interpretation (dotted, coarse to fine).
-- Part supply stays work-order scoped: work_order_parts has no typed operation link.
-- Contract: supabase/sql/test_work_order_resource_specifications.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

CREATE TABLE public.work_order_resource_specifications (
  id uuid PRIMARY KEY REFERENCES public.vehicle_observations(id) ON DELETE RESTRICT,
  work_order_id uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE RESTRICT,
  line_item_id uuid REFERENCES public.work_order_line_items(id) ON DELETE RESTRICT,
  specification_stage text NOT NULL CHECK (specification_stage IN ('requested','proposed','supplied','reported_performed')),
  material_role text CHECK (material_role IN ('workpiece','filler','consumable')),
  material_label text CHECK (length(btrim(material_label)) BETWEEN 1 AND 200),
  material_key text CHECK (material_key ~ '^[a-z0-9_]+(\.[a-z0-9_]+)*$' AND length(material_key) <= 120),
  process_label text CHECK (length(btrim(process_label)) BETWEEN 1 AND 200),
  process_key text CHECK (process_key ~ '^[a-z0-9_]+(\.[a-z0-9_]+)*$' AND length(process_key) <= 120),
  basis_observation_id uuid REFERENCES public.vehicle_observations(id) ON DELETE RESTRICT,
  basis_excerpt text CHECK (length(btrim(basis_excerpt)) BETWEEN 1 AND 2000),
  basis_component_event_id uuid,
  basis_work_order_part_id uuid,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT work_spec_material_pair CHECK (num_nonnulls(material_label,material_key,material_role) IN (0,3)),
  CONSTRAINT work_spec_process_pair CHECK (num_nonnulls(process_label,process_key) IN (0,2)),
  CONSTRAINT work_spec_states_something CHECK (material_key IS NOT NULL OR process_key IS NOT NULL),
  CONSTRAINT work_spec_basis_pair CHECK (num_nonnulls(basis_observation_id,basis_excerpt) IN (0,2)),
  CONSTRAINT work_spec_single_basis CHECK (num_nonnulls(basis_observation_id,basis_component_event_id,basis_work_order_part_id)=1),
  CONSTRAINT work_spec_basis_not_self CHECK (basis_observation_id IS DISTINCT FROM id),
  CONSTRAINT work_spec_requested_basis CHECK (specification_stage <> 'requested' OR basis_observation_id IS NOT NULL),
  CONSTRAINT work_spec_event_basis CHECK (basis_component_event_id IS NULL OR
    (specification_stage='reported_performed' AND line_item_id IS NOT NULL)),
  CONSTRAINT work_spec_part_basis CHECK (basis_work_order_part_id IS NULL OR
    (specification_stage IN ('proposed','supplied') AND line_item_id IS NULL))
);
CREATE INDEX work_resource_specifications_order ON public.work_order_resource_specifications(work_order_id, id);
CREATE INDEX work_resource_specifications_line ON public.work_order_resource_specifications(line_item_id) WHERE line_item_id IS NOT NULL;
CREATE INDEX work_resource_specifications_basis ON public.work_order_resource_specifications(basis_observation_id) WHERE basis_observation_id IS NOT NULL;
CREATE INDEX work_resource_specifications_event ON public.work_order_resource_specifications(basis_component_event_id) WHERE basis_component_event_id IS NOT NULL;
CREATE INDEX work_resource_specifications_part ON public.work_order_resource_specifications(basis_work_order_part_id) WHERE basis_work_order_part_id IS NOT NULL;
COMMENT ON TABLE public.work_order_resource_specifications IS 'One attributed material/process claim for a work order at one stage (requested, proposed, supplied, reported_performed), keyed to its immutable vehicle_observations source. Comparison only; not approval of a substitution, competence, completion or cost. Writer: project_work_order_resource_observation.';

ALTER TABLE public.work_order_resource_specifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.work_order_resource_specifications FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.work_order_resource_specifications TO service_role;
CREATE POLICY resource_service_read ON public.work_order_resource_specifications FOR SELECT TO service_role USING (true);
CREATE TRIGGER resource_immutable BEFORE UPDATE OR DELETE ON public.work_order_resource_specifications
  FOR EACH ROW EXECUTE FUNCTION public.work_order_resource_immutable();
CREATE TRIGGER resource_no_truncate BEFORE TRUNCATE ON public.work_order_resource_specifications
  FOR EACH STATEMENT EXECUTE FUNCTION public.work_order_resource_immutable();

DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='work_order_resource_specifications' LOOP
    EXECUTE format('COMMENT ON COLUMN public.work_order_resource_specifications.%I IS %L',c.column_name,
      CASE c.column_name
        WHEN 'id' THEN 'Source vehicle_observations UUID and idempotency key. Source owns testimony, method, trust and original clocks.'
        WHEN 'work_order_id' THEN 'Existing work order containing this attributed specification claim.'
        WHEN 'line_item_id' THEN 'Operation the claim names; required for a component event basis, null for part records (work-order scope only).'
        WHEN 'specification_stage' THEN 'requested (customer/scope testimony), proposed (quoted part), supplied (part recorded installed in the work order), reported_performed (recorded operation). Not completion.'
        WHEN 'material_role' THEN 'workpiece, filler or consumable; materials are compared only within the same role. Null when no material is stated.'
        WHEN 'material_label' THEN 'Material wording exactly as it appears in the basis record; checked on admission.'
        WHEN 'material_key' THEN 'Derived dotted material key, coarse to fine (stainless_steel, stainless_steel.304). Interpretation, not testimony.'
        WHEN 'process_label' THEN 'Process wording exactly as it appears in the basis record; checked on admission.'
        WHEN 'process_key' THEN 'Derived dotted process key (welding.tig). For a supplied consumable it names intended use, not performance.'
        WHEN 'basis_observation_id' THEN 'Original retained work_record quoted by this claim; same vehicle, original clock and exact excerpt checked on admission and read.'
        WHEN 'basis_excerpt' THEN 'Exact excerpt of the retained work_record containing the labels.'
        WHEN 'basis_component_event_id' THEN 'component_events row recording the operation; exact row snapshot kept in source structured_data. No FK; a changed row withholds this claim.'
        WHEN 'basis_work_order_part_id' THEN 'work_order_parts row of the same work order; exact row snapshot kept in source structured_data. No FK; a changed row withholds this claim.'
        WHEN 'recorded_at' THEN 'Projection insertion clock; distinct from observation and ingestion clocks retained on the source.'
      END);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.project_work_order_resource_observation(p_observation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  o public.vehicle_observations%ROWTYPE;
  e jsonb;
  w public.work_orders%ROWTYPE;
  operation_id uuid;
  target_id uuid;
  event_type text;
  inserted_rows integer;
  required_kind text;
  basis_id uuid;
  basis_quote text;
  basis_clock timestamptz;
  spec_stage text;
  basis_text text;
  basis_values text[];
  part_status text;
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
  IF event_type IS NULL OR event_type NOT IN ('requirement','fulfillment','attestation','specification') THEN
    RAISE EXCEPTION 'Unknown resource event type';
  END IF;
  SELECT * INTO w FROM public.work_orders WHERE id=(e->>'work_order_id')::uuid FOR SHARE;
  IF NOT FOUND OR w.vehicle_id IS NULL OR w.vehicle_id IS DISTINCT FROM o.vehicle_id THEN
    RAISE EXCEPTION 'Source and work order must identify the same vehicle';
  END IF;
  -- Retained-source links are explicit, one-hop evidence, not inferred authorship.
  -- A legacy source may lack source_id; the new interpretation must still have it.
  IF event_type IN ('requirement','specification') THEN
    basis_id := (e->>'basis_observation_id')::uuid;
    basis_quote := e->>'basis_excerpt';
    basis_clock := o.observed_at;
  ELSE
    SELECT r.basis_observation_id,r.basis_excerpt,s.observed_at
      INTO basis_id,basis_quote,basis_clock
      FROM public.work_order_resource_requirements r JOIN public.vehicle_observations s ON s.id=r.id
      WHERE r.id=CASE WHEN event_type='fulfillment' THEN (e->>'requirement_id')::uuid
        ELSE (SELECT f.requirement_id FROM public.work_order_resource_fulfillments f WHERE f.id=(e->>'fulfillment_id')::uuid) END
      FOR SHARE OF r,s;
  END IF;
  IF num_nonnulls(basis_id,basis_quote)=1 THEN RAISE EXCEPTION 'Retained basis ID and excerpt must be paired'; END IF;
  IF basis_id IS NOT NULL THEN
    IF length(btrim(basis_quote)) NOT BETWEEN 1 AND 2000 OR basis_id=o.id THEN
      RAISE EXCEPTION 'Nonempty original-source excerpt required';
    END IF;
    PERFORM 1 FROM public.vehicle_observations b WHERE b.id=basis_id AND b.kind::text='work_record'
      AND b.is_superseded IS FALSE AND b.vehicle_id=w.vehicle_id AND b.observed_at=basis_clock
      AND NOT (COALESCE(b.structured_data,'{}'::jsonb) ? 'work_order_resource')
      AND strpos(b.content_text,basis_quote)>0 FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Current same-vehicle original basis, exact excerpt and original clock required'; END IF;
  END IF;
  -- Source IDs are idempotency keys. Replays still qualify every source and parent.
  IF event_type='requirement' THEN
    operation_id := (e->>'line_item_id')::uuid;
    PERFORM 1 FROM public.work_order_line_items WHERE id=operation_id AND work_order_id=w.id FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Operation must belong to the work order'; END IF;
    INSERT INTO public.work_order_resource_requirements(id,work_order_id,line_item_id,requirement_kind,description,quantity,unit,basis_observation_id,basis_excerpt)
      VALUES(o.id,w.id,operation_id,e->>'requirement_kind',e->>'description',(e->>'quantity')::numeric,e->>'unit',basis_id,basis_quote)
      ON CONFLICT(id) DO NOTHING;
  ELSIF event_type='specification' THEN
    spec_stage := e->>'specification_stage';
    operation_id := (e->>'line_item_id')::uuid;
    IF operation_id IS NOT NULL THEN
      PERFORM 1 FROM public.work_order_line_items WHERE id=operation_id AND work_order_id=w.id FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Operation must belong to the work order'; END IF;
    END IF;
    IF num_nonnulls(basis_id,e->>'basis_component_event_id',e->>'basis_work_order_part_id')<>1 THEN
      RAISE EXCEPTION 'Exactly one specification basis required';
    END IF;
    IF basis_id IS NOT NULL THEN
      IF e ? 'basis_snapshot' THEN RAISE EXCEPTION 'A retained excerpt basis carries no record snapshot'; END IF;
      basis_text := lower(basis_quote);
      basis_values := ARRAY[basis_text];
    ELSIF e->>'basis_component_event_id' IS NOT NULL THEN
      SELECT ARRAY(SELECT lower(m.value) FROM jsonb_each_text(COALESCE(ce.metadata,'{}'::jsonb)) m WHERE m.value IS NOT NULL)
        INTO basis_values
        FROM public.component_events ce JOIN public.work_order_line_items li
          ON li.component_event_id=ce.id AND li.id=operation_id AND li.work_order_id=w.id
        WHERE ce.id=(e->>'basis_component_event_id')::uuid AND ce.work_order_id=w.id AND ce.vehicle_id=w.vehicle_id
          AND e->'basis_snapshot'=to_jsonb(ce)
        FOR SHARE OF ce,li;
      IF NOT FOUND THEN RAISE EXCEPTION 'Exact same-operation component event snapshot required'; END IF;
    ELSE
      SELECT lower(p.part_name),p.status INTO basis_text,part_status FROM public.work_order_parts p
        WHERE p.id=(e->>'basis_work_order_part_id')::uuid AND p.work_order_id=w.id
          AND e->'basis_snapshot'=to_jsonb(p) FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Exact same-work-order part snapshot required'; END IF;
      IF NOT ((spec_stage='supplied' AND part_status='installed') OR (spec_stage='proposed' AND part_status='quoted')) THEN
        RAISE EXCEPTION 'Part status does not support this specification stage';
      END IF;
      basis_values := ARRAY[basis_text];
    END IF;
    -- Event metadata labels match a whole recorded value; excerpts and part names contain them.
    IF (e->>'material_label' IS NOT NULL AND NOT EXISTS (SELECT 1 FROM unnest(basis_values) v WHERE
          CASE WHEN e->>'basis_component_event_id' IS NOT NULL THEN v=lower(e->>'material_label')
          ELSE strpos(v,lower(e->>'material_label'))>0 END))
      OR (e->>'process_label' IS NOT NULL AND NOT EXISTS (SELECT 1 FROM unnest(basis_values) v WHERE
          CASE WHEN e->>'basis_component_event_id' IS NOT NULL THEN v=lower(e->>'process_label')
          ELSE strpos(v,lower(e->>'process_label'))>0 END)) THEN
      RAISE EXCEPTION 'Specification labels must be quoted from their basis record';
    END IF;
    INSERT INTO public.work_order_resource_specifications(id,work_order_id,line_item_id,specification_stage,material_role,
      material_label,material_key,process_label,process_key,basis_observation_id,basis_excerpt,basis_component_event_id,basis_work_order_part_id)
      VALUES(o.id,w.id,operation_id,spec_stage,e->>'material_role',e->>'material_label',e->>'material_key',
      e->>'process_label',e->>'process_key',basis_id,basis_quote,(e->>'basis_component_event_id')::uuid,(e->>'basis_work_order_part_id')::uuid)
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
      OR (required_kind='facility' AND e->>'facility_organization_id' IS NOT NULL)
      OR (required_kind IN ('skill','inspection') AND e->>'performer_actor_id' IS NOT NULL)) THEN
      RAISE EXCEPTION 'Resource type does not satisfy this requirement kind';
    END IF;
    -- A retained assignment is custody evidence, not proof of capability or consent.
    IF e->>'basis_line_item_id' IS NOT NULL THEN
      PERFORM 1 FROM public.work_order_line_items li JOIN public.work_order_resource_requirements r
        ON r.line_item_id=li.id AND r.id=target_id AND r.work_order_id=w.id
        WHERE li.id=(e->>'basis_line_item_id')::uuid AND li.work_order_id=w.id
          AND li.actor_id=(e->>'performer_actor_id')::uuid
          AND e->'basis_line_item_snapshot'=to_jsonb(li) FOR SHARE OF li,r;
      IF NOT FOUND THEN RAISE EXCEPTION 'Exact same-operation actor assignment snapshot required'; END IF;
    ELSIF e ? 'basis_line_item_snapshot' THEN
      RAISE EXCEPTION 'Assignment snapshot requires its typed line-item basis';
    END IF;
    INSERT INTO public.work_order_resource_fulfillments(id,work_order_id,requirement_id,supplier_user_id,supplier_organization_id,
      user_tool_id,inventory_tool_id,equipment_id,facility_organization_id,available_from,available_until,performer_actor_id,basis_line_item_id)
      VALUES(o.id,w.id,target_id,(e->>'supplier_user_id')::uuid,(e->>'supplier_organization_id')::uuid,
      (e->>'user_tool_id')::uuid,(e->>'inventory_tool_id')::uuid,(e->>'equipment_id')::uuid,(e->>'facility_organization_id')::uuid,
      (e->>'available_from')::timestamptz,(e->>'available_until')::timestamptz,
      (e->>'performer_actor_id')::uuid,(e->>'basis_line_item_id')::uuid) ON CONFLICT(id) DO NOTHING;
  ELSE
    target_id := (e->>'fulfillment_id')::uuid;
    PERFORM 1 FROM public.work_order_resource_fulfillments f
      JOIN public.vehicle_observations fs ON fs.id=f.id JOIN public.vehicle_observations rs ON rs.id=f.requirement_id
      JOIN public.work_order_resource_requirements r ON r.id=f.requirement_id
      JOIN public.work_order_line_items li ON li.id=r.line_item_id AND li.work_order_id=w.id
      WHERE f.id=target_id AND f.work_order_id=w.id AND fs.is_superseded IS FALSE AND rs.is_superseded IS FALSE
        AND fs.vehicle_id=w.vehicle_id AND rs.vehicle_id=w.vehicle_id
        AND (f.basis_line_item_id IS NULL OR (f.basis_line_item_id=li.id AND li.actor_id=f.performer_actor_id
          AND fs.structured_data#>'{work_order_resource,basis_line_item_snapshot}'=to_jsonb(li)))
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

-- Snapshots are compared as jsonb; UTC keeps timestamp rendering independent of the caller's session.
CREATE OR REPLACE FUNCTION public.read_work_order_resources(p_work_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE result jsonb;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.work_orders WHERE id=p_work_order_id) THEN
    RAISE EXCEPTION 'Work order unavailable';
  END IF;
  WITH requirements AS (
    SELECT r.*,s.observed_at,s.ingested_at,s.source_id,s.extraction_method,s.confidence_score
    FROM public.work_order_resource_requirements r JOIN public.vehicle_observations s ON s.id=r.id
    JOIN public.work_order_line_items li ON li.id=r.line_item_id AND li.work_order_id=r.work_order_id
    JOIN public.work_orders w ON w.id=r.work_order_id AND w.vehicle_id=s.vehicle_id
    WHERE r.work_order_id=p_work_order_id AND s.is_superseded IS FALSE
      AND (r.basis_observation_id IS NULL OR EXISTS (
        SELECT 1 FROM public.vehicle_observations b WHERE b.id=r.basis_observation_id
          AND b.kind::text='work_record' AND b.is_superseded IS FALSE AND b.vehicle_id=w.vehicle_id
          AND b.observed_at=s.observed_at AND strpos(b.content_text,r.basis_excerpt)>0
          AND NOT (COALESCE(b.structured_data,'{}'::jsonb) ? 'work_order_resource')))
  ), fulfillments AS (
    SELECT f.*,s.observed_at,s.ingested_at,s.source_id,s.extraction_method,s.confidence_score,
      s.structured_data->'interpretation' AS interpretation,
      CASE WHEN f.performer_actor_id IS NOT NULL THEN jsonb_build_object(
        'actor_id',a.id,'name',a.name,'actor_type',a.actor_type,'identity_namespace','actors',
        'account_link','not_assessed','qualification','not_assessed') ELSE NULL END AS performer,
      CASE WHEN f.supplier_user_id IS NULL AND f.supplier_organization_id IS NULL THEN 'unknown'
        ELSE 'source_attributed' END AS contracting_party_status,
      CASE WHEN f.basis_line_item_id IS NULL THEN 'source_claim' ELSE 'retained_operation_assignment' END AS candidate_basis
    FROM public.work_order_resource_fulfillments f JOIN requirements r ON r.id=f.requirement_id
    LEFT JOIN public.actors a ON a.id=f.performer_actor_id
    JOIN public.vehicle_observations s ON s.id=f.id JOIN public.work_orders w ON w.id=f.work_order_id AND w.vehicle_id=s.vehicle_id
    WHERE f.work_order_id=p_work_order_id AND s.is_superseded IS FALSE
      AND (f.basis_line_item_id IS NULL OR EXISTS (
        SELECT 1 FROM public.work_order_line_items li WHERE li.id=f.basis_line_item_id AND li.id=r.line_item_id
          AND li.work_order_id=f.work_order_id AND li.actor_id=f.performer_actor_id
          AND s.structured_data#>'{work_order_resource,basis_line_item_snapshot}'=to_jsonb(li)))
  ), attestations AS (
    SELECT a.*,s.observed_at,s.ingested_at,s.source_id
    FROM public.work_order_resource_attestations a JOIN fulfillments f ON f.id=a.fulfillment_id
    JOIN public.vehicle_observations s ON s.id=a.id JOIN public.work_orders w ON w.id=a.work_order_id AND w.vehicle_id=s.vehicle_id
    WHERE a.work_order_id=p_work_order_id AND s.is_superseded IS FALSE
  ), specifications AS (
    SELECT sp.*,s.observed_at,s.ingested_at,s.source_id,s.extraction_method,s.confidence_score,
      CASE WHEN sp.basis_observation_id IS NOT NULL THEN 'retained_excerpt'
        WHEN sp.basis_component_event_id IS NOT NULL THEN 'component_event_record' ELSE 'work_order_part_record' END AS basis_kind,
      CASE WHEN sp.line_item_id IS NULL THEN 'work_order_scope' ELSE 'operation' END AS scope
    FROM public.work_order_resource_specifications sp JOIN public.vehicle_observations s ON s.id=sp.id
    JOIN public.work_orders w ON w.id=sp.work_order_id AND w.vehicle_id=s.vehicle_id
    WHERE sp.work_order_id=p_work_order_id AND s.is_superseded IS FALSE
      AND (sp.line_item_id IS NULL OR EXISTS (SELECT 1 FROM public.work_order_line_items li
        WHERE li.id=sp.line_item_id AND li.work_order_id=sp.work_order_id))
      AND CASE
        WHEN sp.basis_observation_id IS NOT NULL THEN EXISTS (
          SELECT 1 FROM public.vehicle_observations b WHERE b.id=sp.basis_observation_id
            AND b.kind::text='work_record' AND b.is_superseded IS FALSE AND b.vehicle_id=w.vehicle_id
            AND b.observed_at=s.observed_at AND strpos(b.content_text,sp.basis_excerpt)>0
            AND NOT (COALESCE(b.structured_data,'{}'::jsonb) ? 'work_order_resource'))
        WHEN sp.basis_component_event_id IS NOT NULL THEN EXISTS (
          SELECT 1 FROM public.component_events ce JOIN public.work_order_line_items li
            ON li.component_event_id=ce.id AND li.id=sp.line_item_id AND li.work_order_id=sp.work_order_id
          WHERE ce.id=sp.basis_component_event_id AND ce.work_order_id=sp.work_order_id AND ce.vehicle_id=w.vehicle_id
            AND s.structured_data#>'{work_order_resource,basis_snapshot}'=to_jsonb(ce))
        ELSE EXISTS (
          SELECT 1 FROM public.work_order_parts p WHERE p.id=sp.basis_work_order_part_id AND p.work_order_id=sp.work_order_id
            AND s.structured_data#>'{work_order_resource,basis_snapshot}'=to_jsonb(p))
      END
  ), comparisons AS (
    SELECT q.id AS requested_id,c.id AS compared_id,c.specification_stage AS compared_stage,c.basis_kind AS compared_basis_kind,
      CASE WHEN c.line_item_id IS NULL THEN 'work_order_scope_unallocated' ELSE 'same_operation' END AS operation_link,
      CASE WHEN q.material_key IS NULL OR c.material_key IS NULL THEN 'not_stated'
        WHEN q.material_role<>c.material_role THEN 'different_role_not_compared'
        WHEN q.material_key=c.material_key THEN 'same'
        WHEN starts_with(q.material_key,c.material_key||'.') OR starts_with(c.material_key,q.material_key||'.') THEN 'unresolved_specificity'
        ELSE 'different' END AS material_relation,
      CASE WHEN q.process_key IS NULL OR c.process_key IS NULL THEN 'not_stated'
        WHEN q.process_key=c.process_key THEN 'same'
        WHEN starts_with(q.process_key,c.process_key||'.') OR starts_with(c.process_key,q.process_key||'.') THEN 'unresolved_specificity'
        ELSE 'different' END AS process_relation
    FROM specifications q JOIN specifications c ON c.id<>q.id AND c.specification_stage<>'requested'
      AND (c.line_item_id IS NULL OR c.line_item_id=q.line_item_id)
    WHERE q.specification_stage='requested'
  ), summaries AS (
    SELECT q.id AS requested_id,q.line_item_id,
      CASE WHEN bool_or(c.material_relation='different' OR c.process_relation='different') THEN 'conflicting_evidence'
        WHEN bool_or(c.material_relation='same' OR c.process_relation='same') THEN 'consistent'
        WHEN bool_or(c.material_relation='unresolved_specificity' OR c.process_relation='unresolved_specificity') THEN 'unresolved'
        ELSE 'no_comparable_evidence' END AS status,
      count(c.compared_id) AS compared_claims,
      'not_established'::text AS substitution_approval,'not_established'::text AS scope_change_accepted,
      'not_assessed'::text AS qualification,'not_established'::text AS completion
    FROM specifications q LEFT JOIN comparisons c ON c.requested_id=q.id
    WHERE q.specification_stage='requested' GROUP BY q.id,q.line_item_id
  )
  SELECT jsonb_build_object('work_order_id',p_work_order_id,'as_of',statement_timestamp(),
    'requirements',COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM requirements r),'[]'::jsonb),
    'fulfillments',COALESCE((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.id) FROM fulfillments f),'[]'::jsonb),
    'attestations',COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM attestations a),'[]'::jsonb),
    'specifications',COALESCE((SELECT jsonb_agg(to_jsonb(sp) ORDER BY sp.id) FROM specifications sp),'[]'::jsonb),
    'specification_comparisons',COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.requested_id,c.compared_id) FROM comparisons c),'[]'::jsonb),
    'specification_summaries',COALESCE((SELECT jsonb_agg(to_jsonb(su) ORDER BY su.requested_id) FROM summaries su),'[]'::jsonb),
    'coverage',jsonb_build_object('recorded_requirements',(SELECT count(*) FROM requirements),
      'requirements_with_candidates',(SELECT count(DISTINCT requirement_id) FROM fulfillments),
      'recorded_specifications',(SELECT count(*) FROM specifications),
      'requested_specifications',(SELECT count(*) FROM summaries),
      'requested_specifications_compared',(SELECT count(*) FROM summaries WHERE compared_claims>0),
      'requirement_population','not_assessed','specification_population','not_assessed',
      'source_scope','explicitly_projected_work_record_observations'),
    'booking_readiness','not_assessed','permission_authority','not_assessed','capacity_reserved',false,
    'payment_authorized',false) INTO result;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.read_work_order_resources(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_work_order_resources(uuid) TO service_role;
COMMENT ON FUNCTION public.read_work_order_resources(uuid) IS 'Service-only current resource evidence graph for a work order, including material/process specification claims and their non-adjudicating comparison. Superseded, reattributed or changed-basis chains are excluded. No historical replay, exhaustive plan, permission adjudication or booking-readiness claim.';

INSERT INTO public.pipeline_registry(table_name,column_name,owned_by,description,do_not_write_directly,write_via)
VALUES ('work_order_resource_specifications','id','project_work_order_resource_observation',
  'Typed index of existing work_record specification testimony; source id is the idempotency key. No raw specification writes.',
  true,'project_work_order_resource_observation(uuid)');
NOTIFY pgrst, 'reload schema';
COMMIT;
