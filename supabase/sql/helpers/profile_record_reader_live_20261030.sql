-- Dependency fixture: exact installed bulk record reader, inspected2026-10-30.
-- The source-claim page under test calls this unmodified owner for record metadata.
CREATE OR REPLACE FUNCTION public.get_vehicle_specs(p_vehicle_ids uuid[], p_include_typed_claims boolean DEFAULT false)
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '10s'
AS $function$
BEGIN
 IF p_vehicle_ids IS NULL OR cardinality(p_vehicle_ids)=0 THEN RETURN;END IF;
 IF array_ndims(p_vehicle_ids)<>1 OR cardinality(p_vehicle_ids)>200 OR array_position(p_vehicle_ids,NULL) IS NOT NULL THEN
  RAISE EXCEPTION 'Expected at most200 nonnull vehicle keys' USING ERRCODE='22023';END IF;
 IF p_include_typed_claims IS NULL OR (p_include_typed_claims AND cardinality(p_vehicle_ids)>20) THEN RAISE EXCEPTION 'Typed custody reads require at most20 vehicle keys' USING ERRCODE='22023';END IF;
 RETURN QUERY
 WITH requested AS MATERIALIZED(SELECT id,min(ord) AS ord FROM unnest(p_vehicle_ids) WITH ORDINALITY x(id,ord) GROUP BY id),
 gate AS MATERIALIZED(SELECT v.id,r.ord,v.created_at,v.updated_at,
  jsonb_build_object('year',v.year,'make',v.make,'model',v.model,'vin',v.vin,'trim',v.trim,'mileage',v.mileage,
   'color',v.color,'interior_color',v.interior_color,'transmission',v.transmission,'drivetrain',v.drivetrain,
   'engine_type',v.engine_type,'engine_size',v.engine_size,'body_style',v.body_style) AS retained_fields
  FROM requested r JOIN public.vehicles v ON v.id=r.id
  WHERE v.is_public IS TRUE AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'),
 field_contracts(key,data_type) AS(VALUES('year','integer'),('make','string'),('model','string'),('vin','string'),('trim','string'),
  ('mileage','integer'),('color','string'),('interior_color','string'),('transmission','string'),('drivetrain','string'),
  ('engine_type','string'),('engine_size','string'),('body_style','string'))
 SELECT jsonb_build_object('schema_version','vehicle_data_model_v1','vehicle_id',g.id,'read_at',statement_timestamp(),
  'grain','stored_vehicle_record','physical_identity_status','unresolved',
  'retained_record',jsonb_build_object('origin_relation','vehicles','row_created_at',g.created_at,'row_updated_at',g.updated_at,
   'clock_basis','record_maintenance_not_source_event_or_capture','source_attribution_status','unassayed',
   'factory_configuration_status','unknown','current_configuration_status','unknown',
   'property_bindings',public.retained_vehicle_record_property_bindings(g.retained_fields),
   'attributes',(SELECT jsonb_object_agg(f.key,jsonb_build_object('value',g.retained_fields->f.key,'data_type',f.data_type,
    'origin_column',f.key,'unit',NULL,'unit_status','not_established','value_status',CASE WHEN g.retained_fields->f.key IS NULL OR g.retained_fields->f.key='null'::jsonb THEN 'unrecorded' ELSE 'retained_record_value' END)) FROM field_contracts f)),
  'typed_claims_status',CASE WHEN p_include_typed_claims THEN 'current_core_scope_read' ELSE 'not_requested' END,
  'typed_claims',CASE WHEN p_include_typed_claims THEN coalesce((
   SELECT jsonb_agg(jsonb_build_object('property_id',r.id,'property_key',r.property_key,'data_type',r.data_type,'unit',r.unit,
    'value',c.structured_data->r.property_key,'status','current_canonical_claim','observation_id',c.observation_id,
    'source_id',o.source_id,'source_url',o.source_url,'source_observation_id',o.source_observation_id,
    'kind',o.kind,'extraction_method',o.extraction_method,'confidence_score',o.confidence_score,
    'observed_at',o.observed_at,'ingested_at',o.ingested_at,
    'qualifiers',jsonb_strip_nulls(jsonb_build_object(
     'claim_role',c.structured_data->'claim_role','source_profile',c.structured_data->'source_profile',
     'observed_at_basis',c.structured_data->'observed_at_basis','source_event_time_status',c.structured_data->'source_event_time_status',
     'source_recorded_at',c.structured_data->'source_recorded_at','source_observed_at',c.structured_data->'source_observed_at',
     'source_value',c.structured_data->'source_value','normalization_version',c.structured_data->'normalization_version',
     'source_subject_label',c.structured_data->'source_subject_label','source_make_label',c.structured_data->'source_make_label',
     'model_label_scope',c.structured_data->'model_label_scope','identity_resolution_status',c.structured_data->'identity_resolution_status',
     'factory_configuration_status',c.structured_data->'factory_configuration_status','current_configuration_status',c.structured_data->'current_configuration_status',
     'independent_source',c.structured_data->'independent_source','reported_precision_miles',c.structured_data->'reported_precision_miles',
     'value_is_approximate',c.structured_data->'value_is_approximate','reading_role',c.structured_data->'reading_role',
     'true_mileage_status',c.structured_data->'true_mileage_status','limitation',c.structured_data->'limitation')))
    ORDER BY r.property_key)
   FROM (SELECT * FROM public.vehicle_canonical vc WHERE vc.vehicle_id=g.id OFFSET 0)c
   JOIN public.vehicle_observations o ON o.id=c.observation_id AND o.vehicle_id=g.id AND public.observation_is_public(o.kind,o.structured_data)
   JOIN public.observation_properties r ON r.id=c.property_id AND r.namespace='core' AND r.ratified_at IS NOT NULL AND r.deprecated_at IS NULL
    AND r.property_key IN('year','make','model','vin','interior_color','exterior_color','engine_configuration','engine_displacement_l','transmission_type','drivetrain_layout','mileage_miles')
   WHERE CASE WHEN r.data_type IN('string','enum') THEN jsonb_typeof(c.structured_data->r.property_key)='string'
    WHEN r.data_type='numeric' THEN jsonb_typeof(c.structured_data->r.property_key)='number'
    WHEN r.data_type='integer' THEN CASE WHEN jsonb_typeof(c.structured_data->r.property_key)='number'
     THEN (c.structured_data->>r.property_key)::numeric=trunc((c.structured_data->>r.property_key)::numeric) ELSE false END
    ELSE false END),'[]'::jsonb) ELSE '[]'::jsonb END,
  'model_scope',jsonb_build_object('retained_record_fields',13,'record_binding_property_keys',11,'canonical_property_keys',11,'complete_vehicle_model',false,
   'source_event_history','not_reconstructed','retained_metadata_is_typed_testimony',false))
 FROM gate g ORDER BY g.ord;
END $function$
;

