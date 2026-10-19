-- Historical messages name needed capabilities without always giving quantities.
-- Preserve that unknown and keep each derived requirement tied to its original quote.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';
ALTER TABLE public.work_order_resource_requirements
  ALTER COLUMN quantity DROP NOT NULL,
  ALTER COLUMN unit DROP NOT NULL,
  ADD CONSTRAINT work_resource_quantity_pair CHECK (num_nonnulls(quantity,unit) IN (0,2)),
  ADD COLUMN basis_observation_id uuid REFERENCES public.vehicle_observations(id) ON DELETE RESTRICT,
  ADD COLUMN basis_excerpt text,
  ADD CONSTRAINT work_resource_basis_pair CHECK (num_nonnulls(basis_observation_id,basis_excerpt) IN (0,2)),
  ADD CONSTRAINT work_resource_basis_excerpt CHECK (length(btrim(basis_excerpt)) BETWEEN 1 AND 2000),
  ADD CONSTRAINT work_resource_basis_not_self CHECK (basis_observation_id IS DISTINCT FROM id);
CREATE INDEX work_resource_requirements_basis ON public.work_order_resource_requirements(basis_observation_id)
  WHERE basis_observation_id IS NOT NULL;
COMMENT ON COLUMN public.work_order_resource_requirements.quantity IS 'Positive finite source-stated quantity; null with unit null means not stated. No default quantity inferred.';
COMMENT ON COLUMN public.work_order_resource_requirements.unit IS 'Source-stated quantity unit, paired with quantity; both null when not stated.';
COMMENT ON COLUMN public.work_order_resource_requirements.basis_observation_id IS 'Optional original retained work_record behind this interpretation. Same vehicle, exact quote and clock checked on admission and read; supersession/reattribution hides descendants. Not an authenticated signature.';
COMMENT ON COLUMN public.work_order_resource_requirements.basis_excerpt IS 'Exact nonempty excerpt in the original retained work_record. Presence proves citation custody, not that the interpretation is mechanically correct.';

CREATE OR REPLACE FUNCTION public.project_work_order_resource_observation(p_observation_id uuid)
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
  basis_id uuid;
  basis_quote text;
  basis_clock timestamptz;
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
  -- Retained-source links are explicit, one-hop evidence, not inferred authorship.
  -- A legacy source may lack source_id; the new interpretation must still have it.
  IF event_type='requirement' THEN
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

CREATE OR REPLACE FUNCTION public.read_work_order_resources(p_work_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
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

NOTIFY pgrst, 'reload schema';
COMMIT;
