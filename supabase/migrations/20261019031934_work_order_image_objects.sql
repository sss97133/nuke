-- Connect retained image-object testimony to a job without duplicating the evidence log.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='1s';
CREATE OR REPLACE FUNCTION public.read_work_order_image_objects(
  p_work_order_id uuid, p_after_observation_id uuid DEFAULT NULL, p_limit integer DEFAULT 25)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE v_vehicle uuid; result jsonb;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Page size must be 1 through 100'; END IF;
  SELECT vehicle_id INTO v_vehicle FROM public.work_orders WHERE id=p_work_order_id;
  IF NOT FOUND OR v_vehicle IS NULL THEN RAISE EXCEPTION 'Vehicle-bound work order required'; END IF;
  WITH qualified AS MATERIALIZED (
    SELECT o.id,o.source_id,o.observed_at,o.ingested_at,o.extraction_method,o.confidence_score,o.structured_data,
      vi.id AS image_id,vi.taken_at
    FROM public.vehicle_observations o
    JOIN public.vehicle_images vi ON vi.id=CASE
      WHEN o.structured_data->>'image_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN (o.structured_data->>'image_id')::uuid ELSE NULL END
      AND vi.vehicle_id=o.vehicle_id AND vi.is_external IS FALSE AND vi.vision_gate_status='approved'
    WHERE o.vehicle_id=v_vehicle AND o.kind::text='condition' AND o.is_superseded IS FALSE
      AND o.source_id IS NOT NULL AND o.structured_data->>'analysis_kind'='image_deep_byok'
      AND (o.structured_data->>'witness_image_id' IS NULL OR o.structured_data->>'witness_image_id'=vi.id::text)
      AND (p_after_observation_id IS NULL OR o.id>p_after_observation_id)
    ORDER BY o.id LIMIT p_limit+1
  ), page AS MATERIALIZED (SELECT * FROM qualified ORDER BY id LIMIT p_limit),
  atoms AS (
    SELECT p.id AS observation_id,p.image_id,'/workshop_signals/tools_visible/'||(t.ordinality-1)::text AS source_pointer,
      'tool'::text AS reported_kind,t.value AS raw_claim
    FROM page p CROSS JOIN LATERAL jsonb_array_elements(CASE
      WHEN jsonb_typeof(p.structured_data#>'{workshop_signals,tools_visible}')='array'
      THEN p.structured_data#>'{workshop_signals,tools_visible}' ELSE '[]'::jsonb END) WITH ORDINALITY t
    UNION ALL
    SELECT p.id,p.image_id,'/components_seen/'||(c.ordinality-1)::text,'component',c.value
    FROM page p CROSS JOIN LATERAL jsonb_array_elements(CASE
      WHEN jsonb_typeof(p.structured_data->'components_seen')='array'
      THEN p.structured_data->'components_seen' ELSE '[]'::jsonb END) WITH ORDINALITY c
  ), sightings AS (
    SELECT a.*,a.observation_id::text||':'||a.source_pointer AS sighting_key,
      CASE WHEN jsonb_typeof(raw_claim)='string' THEN raw_claim#>>'{}'
        WHEN jsonb_typeof(raw_claim->'label')='string' THEN raw_claim->>'label' ELSE NULL END AS label,
      CASE WHEN jsonb_typeof(raw_claim->'confidence')='number' THEN raw_claim->'confidence' ELSE NULL END AS reported_confidence,
      raw_claim->'bbox' AS source_bounding_box,
      'unresolved'::text AS physical_identity,'not_established'::text AS operation_usage
    FROM atoms a
  ), frames AS (
    SELECT p.id AS observation_id,p.image_id,p.source_id,p.observed_at,p.ingested_at,p.taken_at AS image_capture_at,
      p.extraction_method,p.confidence_score,p.structured_data->'intent' AS reported_image_intent,
      jsonb_build_object('tools',jsonb_typeof(p.structured_data#>'{workshop_signals,tools_visible}'),
        'components',jsonb_typeof(p.structured_data->'components_seen')) AS retained_array_types,
      COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.source_pointer) FROM sightings s WHERE s.observation_id=p.id),'[]'::jsonb) AS sightings,
      COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'evidence_id',ue.id,'equipment_id',e.id,'name',e.name,'manufacturer',e.manufacturer,'model',e.model,'serial_number',e.serial_number,
        'association_basis','existing_image_equipment_evidence','physical_identity','not_verified_by_this_reader',
        'reported_source_method',ue.source_method,'reported_confidence',ue.confidence,
        'reported_visible_state',ue.visible_state,'reported_use_minutes',ue.estimated_use_minutes,
        'usage_accepted',false,'job_allocation','not_established',
        'amounts',jsonb_build_object('recorded_purchase_cost',e.purchase_cost,'purchase_basis',e.source,
          'computed_asset_value',e.current_value_computed,'computed_value_basis','existing_ledger_depreciation_formula',
          'currency','not_recorded_by_equipment_ledger','market_value',NULL,'job_cost',NULL,'labor_value',NULL)
      ) ORDER BY ue.id) FROM public.equipment_usage_evidence ue JOIN public.equipment e ON e.id=ue.equipment_id
        WHERE ue.derived_from_image_id=p.image_id AND ue.vehicle_id=v_vehicle),'[]'::jsonb) AS existing_equipment_associations
    FROM page p
  )
  SELECT jsonb_build_object('work_order_id',p_work_order_id,'vehicle_id',v_vehicle,
    'source_scope','current_attributed_deep_image_observations_with_approved_same_vehicle_private_images',
    'job_attribution','vehicle_context_only','physical_identity_resolution','not_performed',
    'frames',COALESCE((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.observation_id) FROM frames f),'[]'::jsonb),
    'coverage',jsonb_build_object('observations_returned',(SELECT count(*) FROM page),
      'sightings_returned',(SELECT count(*) FROM sightings),'has_more',(SELECT count(*) FROM qualified)>p_limit,
      'photo_population','not_assessed','physical_asset_population','not_assessed'),
    'next_after_observation_id',CASE WHEN (SELECT count(*) FROM qualified)>p_limit THEN
      (SELECT id FROM page ORDER BY id DESC LIMIT 1) ELSE NULL END,
    'cost_allocated',false,'labor_value_calculated',false,'payment_authorized',false) INTO result;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.read_work_order_image_objects(uuid,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_work_order_image_objects(uuid,uuid,integer) TO service_role;
COMMENT ON FUNCTION public.read_work_order_image_objects(uuid,uuid,integer) IS 'Private bounded job-context reader of retained canonical image objects. Stable source+JSON-pointer sightings preserve repeated appearances and raw claims. Same-vehicle, approved private-image and supersession gates apply. Existing equipment associations and purchase/depreciation claims remain qualified. No physical identity merge, usage or cost accrual, labor calculation, new inference or testimony writes.';
NOTIFY pgrst,'reload schema';
COMMIT;
