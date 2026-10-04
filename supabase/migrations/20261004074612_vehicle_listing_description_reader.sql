-- Deliver preserved listing prose through the existing vehicle-gated reader.
-- No testimony, canonical summaries, grants, raw snapshots or policies change.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

CREATE OR REPLACE FUNCTION public.get_vehicle_specs(p_vehicle_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $function$
  WITH gate AS MATERIALIZED (
    SELECT v.* FROM public.vehicles v WHERE v.id = p_vehicle_id
      AND v.deleted_at IS NULL AND coalesce(v.listing_kind,'') <> 'non_vehicle_item'
      AND (v.is_public = true OR auth.uid() IN (v.user_id,v.owner_id,v.uploaded_by))
  ), fields(ord,label,fld) AS (VALUES
    (1,'VIN','vin'),(2,'Mileage','mileage'),(3,'Transmission','transmission'),
    (4,'Drivetrain','drivetrain'),(5,'Body','body_style'),(6,'Color','color'),
    (7,'Interior','interior_color'),(8,'Engine','engine_type'),(9,'Fuel','fuel_type')
  ), reports AS MATERIALIZED (
    SELECT c.*,o.source_id,o.observed_at,o.ingested_at,o.extraction_method,s.slug
    FROM public.vehicle_field_consensus c
    JOIN public.vehicle_observations o ON o.id = c.source_observation_id
    LEFT JOIN public.observation_sources s ON s.id = o.source_id
    WHERE c.vehicle_id = p_vehicle_id AND EXISTS (SELECT 1 FROM gate)
      AND o.vehicle_id = c.vehicle_id AND o.is_superseded IS NOT TRUE
      AND o.kind = 'listing' AND o.subject_type = 'vehicle'
      AND o.structured_data->>c.field_name IS NOT DISTINCT FROM c.consensus_value
      AND o.confidence_score IS NOT DISTINCT FROM c.consensus_confidence
      AND public.observation_is_public(o.kind,o.structured_data)
      AND o.observed_at <= c.as_of_at AND o.ingested_at <= c.as_of_at
  )
  , description_captures AS MATERIALIZED (
    -- Five most recent recorded listing prose observations, scoped through the existing
    -- vehicle/time index. This is source history, never a current-value verdict.
    SELECT o.* FROM public.vehicle_observations o
    WHERE o.vehicle_id = p_vehicle_id AND o.kind = 'listing' AND o.subject_type = 'vehicle'
      AND coalesce(o.structured_data->>'subject_type','vehicle') = 'vehicle'
      AND o.is_superseded IS NOT TRUE
      AND EXISTS (SELECT 1 FROM gate g WHERE g.is_public = true)
      AND public.observation_is_public(o.kind,o.structured_data)
      AND greatest(coalesce(length(o.content_text),0),
        CASE WHEN jsonb_typeof(o.structured_data->'description')='string'
          THEN length(o.structured_data->>'description') ELSE 0 END,
        CASE WHEN jsonb_typeof(o.structured_data->'raw_description')='string'
          THEN length(o.structured_data->>'raw_description') ELSE 0 END) >= 100
      AND o.observed_at <= statement_timestamp() AND o.ingested_at <= statement_timestamp()
    ORDER BY o.observed_at DESC,o.ingested_at DESC,o.id DESC LIMIT 5
  ), description_history AS MATERIALIZED (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'source_observation_id',o.id,'source_url',o.source_url,'text',
        CASE WHEN length(p.text) BETWEEN 100 AND 32000 AND o.source_url ~ '^https?://' THEN p.text END,
      'status',CASE WHEN o.source_url IS NULL OR o.source_url !~ '^https?://' THEN 'source_unknown'
        WHEN length(p.text) > 32000 THEN 'oversized'
        WHEN length(p.text) >= 100 THEN 'preserved' ELSE 'prose_unavailable' END,
      'source_text_field',p.field,'preserved_characters',coalesce(length(p.text),0),
      'reader_truncated',false,'source_completeness','unknown',
      'recorded_observed_at',o.observed_at,'ingested_at',o.ingested_at,
      'source_event_at',NULL,'source_event_time_status','unknown',
      'observation_time_basis',CASE WHEN o.structured_data->>'observation_time_basis'='source_capture'
        THEN 'source_capture' ELSE 'recorded_observation' END,
      'source_captured_at',CASE WHEN o.structured_data->>'observation_time_basis'='source_capture'
        AND o.structured_data->>'source_captured_at' ~ '^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}(:?\d{2})?)$'
        AND pg_catalog.pg_input_is_valid(o.structured_data->>'source_captured_at','timestamptz')
        THEN CASE WHEN (o.structured_data->>'source_captured_at')::timestamptz=o.observed_at
          THEN o.observed_at END END,
      'extraction_method',o.extraction_method,'confidence',o.confidence_score
    ) ORDER BY o.observed_at DESC,o.ingested_at DESC,o.id DESC),'[]'::jsonb) AS entries
    FROM description_captures o
    LEFT JOIN LATERAL (
      SELECT t.field,t.text FROM (VALUES
        (1,'structured_data.raw_description',CASE WHEN jsonb_typeof(o.structured_data->'raw_description')='string'
          THEN o.structured_data->>'raw_description' END),
        (2,'content_text',o.content_text),
        (3,'structured_data.description',CASE WHEN jsonb_typeof(o.structured_data->'description')='string'
          THEN o.structured_data->>'description' END)
      ) t(ord,field,text) WHERE nullif(btrim(t.text),'') IS NOT NULL
      ORDER BY length(t.text) DESC,t.ord LIMIT 1
    ) p ON true
  )
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM gate) THEN NULL ELSE coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'field',f.fld,'label',f.label,'value',nullif(btrim(to_jsonb(g)->>f.fld),''),
      'inline_source',to_jsonb(g)->>(f.fld||'_source'),
      'reported_value',CASE WHEN nullif(btrim(to_jsonb(g)->>f.fld),'') IS NULL
        AND r.resolution_method <> 'unresolved' THEN r.consensus_value END,
      'reported_conflict',r.source_observation_id IS NOT NULL AND coalesce(r.resolution_method = 'unresolved' OR (
        nullif(btrim(to_jsonb(g)->>f.fld),'') IS NOT NULL AND
        lower(btrim(to_jsonb(g)->>f.fld)) IS DISTINCT FROM lower(btrim(r.consensus_value))),false),
      'reported_count',coalesce(r.supporting_count+r.conflicting_count,0),
      'reported_source',r.slug,'source_observation_id',r.source_observation_id,
      'reported_observed_at',r.observed_at,'reported_ingested_at',r.ingested_at,
      'reported_confidence',r.consensus_confidence,'reported_method',r.extraction_method,
      'as_of_at',r.as_of_at,
      'rooted',nullif(btrim(to_jsonb(g)->>f.fld),'') IS NOT NULL AND coalesce((
        lower(btrim(to_jsonb(g)->>f.fld)) = lower(btrim(r.consensus_value))
        OR EXISTS (SELECT 1 FROM public.vehicle_images i
          WHERE i.vehicle_id = p_vehicle_id
            AND i.id = CASE WHEN to_jsonb(g)->>(f.fld||'_source_image_id')
              ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              THEN (to_jsonb(g)->>(f.fld||'_source_image_id'))::uuid END
            AND i.is_sensitive IS NOT TRUE AND i.is_superseded IS NOT TRUE
            AND i.is_duplicate IS NOT TRUE
            AND (i.vision_gate_status IS NULL OR i.vision_gate_status::text = 'approved')
            AND coalesce(i.image_vehicle_match_status,'') NOT IN ('mismatch','unrelated'))
        OR EXISTS (SELECT 1 FROM public.vehicle_field_sources fs
          WHERE fs.vehicle_id = p_vehicle_id AND fs.field_name = f.fld
            AND lower(btrim(fs.field_value)) = lower(btrim(to_jsonb(g)->>f.fld))
            AND coalesce(fs.source_type,'') NOT IN ('computed',''))
        OR EXISTS (SELECT 1 FROM public.field_evidence fe
          WHERE fe.vehicle_id = p_vehicle_id AND fe.field_name = f.fld
            AND lower(btrim(fe.proposed_value)) = lower(btrim(to_jsonb(g)->>f.fld))
            AND fe.status IN ('pending','accepted'))
      ),false),'evidence_count',coalesce(r.supporting_count+r.conflicting_count,0)) ORDER BY f.ord)
    FROM fields f CROSS JOIN gate g LEFT JOIN reports r ON r.field_name = f.fld
    WHERE nullif(btrim(to_jsonb(g)->>f.fld),'') IS NOT NULL OR r.source_observation_id IS NOT NULL
  ),'[]'::jsonb) || coalesce((
    SELECT jsonb_build_array(jsonb_build_object(
      'field','description','label','Description','value',nullif(btrim(g.description),''),
      'inline_source',g.description_source,'rooted',false,
      'source_descriptions',h.entries,'source_descriptions_limit',5,
      'source_descriptions_scope','latest_recorded_public_listing_prose_observations',
      'as_of_at',statement_timestamp()))
    FROM gate g CROSS JOIN description_history h
    WHERE nullif(btrim(g.description),'') IS NOT NULL OR jsonb_array_length(h.entries)>0
  ),'[]'::jsonb) END
$function$;
COMMENT ON FUNCTION public.get_vehicle_specs(uuid) IS
'Existing vehicle-gated specs and reported listing state plus separate description history. Canonical description/manual text is preserved. At most five latest active public native vehicle listing prose observations expose the longest stored text within each observation, up to 32000 characters without truncation. Markers do not displace prose. Original event time and original source completeness remain unknown; stored observation, attested capture and ingestion clocks are separate. No raw metadata/archive fallback, evidence acceptance or historical sale-state inference. Existing privileges unchanged.';
COMMIT;
