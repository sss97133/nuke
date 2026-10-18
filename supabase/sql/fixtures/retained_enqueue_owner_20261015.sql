-- Exact live owner read 2026-10-15 (sha256 base64 rRZ6TZfPxRls5QI1N1QhUjRz6AZfRHOK5UXqEiSMrvc=).
-- Loaded only so the arrival-trigger migration guard sees the production enqueue owner.
CREATE OR REPLACE FUNCTION public.enqueue_retained_listing_properties(p_sources uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET lock_timeout TO '500ms'
 SET statement_timeout TO '5s'
AS $function$
DECLARE n integer;native_count integer;
BEGIN
 IF p_sources IS NULL OR cardinality(p_sources)=0 THEN RETURN 0;END IF;
 IF array_ndims(p_sources)<>1 OR cardinality(p_sources)>500 OR array_position(p_sources,NULL) IS NOT NULL THEN RAISE EXCEPTION 'Expected at most500 nonnull retained source keys';END IF;
 INSERT INTO public.retained_listing_property_work(source_observation_id,property_id,vehicle_id)
 SELECT p.id,r.id,p.vehicle_id FROM public.vehicle_observations p
 JOIN public.vehicles v ON v.id=p.vehicle_id AND v.is_public IS TRUE AND v.deleted_at IS NULL
  AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
 JOIN public.observation_sources s ON s.id=p.source_id AND s.slug='bat'
 CROSS JOIN (VALUES('514cacd3-82b4-4330-b3df-e292612ee718'::uuid,'interior_color','interior_color'),
   ('efcb8c61-1ff5-4790-890e-2e09118e87e3'::uuid,'exterior_color','color'),
   ('c0f743ae-dc94-4dfd-98ef-514b76f74a9b'::uuid,'engine_configuration','engine_size'),
   ('66b2f1f6-b714-4ac0-85b6-60ba89529c1a'::uuid,'engine_displacement_l','engine_size'),
   ('235aed17-9bd3-4886-90be-9b1a8e2d1844'::uuid,'transmission_type','transmission'),
   ('32b51f19-e5cf-4f67-81d9-96c2d30885a1'::uuid,'drivetrain_layout','drivetrain')) r(id,property_key,source_field)
 JOIN public.observation_properties k ON k.id=r.id AND k.property_key=r.property_key
  AND k.namespace='core' AND k.deprecated_at IS NULL AND 'specification'=ANY(k.applies_to_kinds)
 WHERE p.id=ANY(p_sources) AND p.kind='listing' AND p.extraction_method='html_match'
 AND p.is_superseded IS FALSE AND p.property_id IS NULL AND p.subject_type='vehicle' AND p.subject_id IS NULL
 AND p.source_url ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$'
 AND isfinite(p.ingested_at) AND (p.observed_at IS NULL OR isfinite(p.observed_at))
 AND p.confidence_score BETWEEN 0.6 AND 1
 AND jsonb_typeof(p.structured_data->r.source_field)='string'
 AND nullif(btrim(p.structured_data->>r.source_field),'') IS NOT NULL
 AND length(p.structured_data->>r.source_field)<=500
 AND btrim(p.structured_data->>r.source_field) !~* '^(unknown|n/a|unspecified)$'
 AND (r.property_key IN('interior_color','exterior_color') OR
  public.retained_powertrain_value(r.property_key,p.structured_data->r.source_field) IS NOT NULL)
 ON CONFLICT(source_observation_id,property_id) DO NOTHING;
 GET DIAGNOSTICS n=ROW_COUNT;
 INSERT INTO public.retained_listing_property_work(source_observation_id,property_id,vehicle_id)
 SELECT p.id,r.id,p.vehicle_id FROM public.vehicle_observations p
 JOIN public.vehicles v ON v.id=p.vehicle_id AND v.is_public IS TRUE AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
 JOIN public.observation_sources s ON s.id=p.source_id AND s.slug='bat' AND 'specification'=ANY(s.supported_observations)
 CROSS JOIN (VALUES('c0f743ae-dc94-4dfd-98ef-514b76f74a9b'::uuid,'engine_configuration'),
  ('66b2f1f6-b714-4ac0-85b6-60ba89529c1a'::uuid,'engine_displacement_l'),('235aed17-9bd3-4886-90be-9b1a8e2d1844'::uuid,'transmission_type'),
  ('abdd7a7a-02c1-4b09-afc6-1a288207dd2d'::uuid,'mileage_miles'),
  ('514cacd3-82b4-4330-b3df-e292612ee718'::uuid,'interior_color'),('efcb8c61-1ff5-4790-890e-2e09118e87e3'::uuid,'exterior_color'),
  ('32b51f19-e5cf-4f67-81d9-96c2d30885a1'::uuid,'drivetrain_layout')) k(id,key)
 JOIN public.observation_properties r ON r.id=k.id AND r.property_key=k.key AND r.namespace='core' AND r.deprecated_at IS NULL AND (CASE WHEN k.key='mileage_miles' THEN 'condition' ELSE 'specification' END)=ANY(r.applies_to_kinds::text[])
 WHERE p.id=ANY(p_sources) AND public.retained_description_property_witness(p,k.key) IS NOT NULL
 ON CONFLICT(source_observation_id,property_id) DO NOTHING;
 GET DIAGNOSTICS native_count=ROW_COUNT;n:=n+native_count;
 INSERT INTO public.retained_listing_property_work(source_observation_id,property_id,vehicle_id)
 SELECT p.id,k.id,p.vehicle_id FROM public.vehicle_observations p
 JOIN public.vehicles v ON v.id=p.vehicle_id AND v.is_public IS TRUE AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
 JOIN public.observation_sources s ON s.id=p.source_id AND s.slug='bat' AND 'specification'=ANY(s.supported_observations)
 CROSS JOIN(VALUES('ece619f7-c49a-44f7-999f-a41acf5d4dc3'::uuid,'year'),('8d274b73-a8a6-43bf-9036-5864d0152725'::uuid,'make'),('a79b528f-7d9d-46ca-96f9-96d899e81d10'::uuid,'model'),('9fc93dd3-3639-439a-8eed-3e9a0f846334'::uuid,'vin'))k(id,key)
 JOIN public.observation_properties r ON r.id=k.id AND r.property_key=k.key AND r.namespace='core' AND r.deprecated_at IS NULL AND r.ratified_at IS NOT NULL AND 'specification'=ANY(r.applies_to_kinds)
 WHERE p.id=ANY(p_sources) AND p.kind='listing' AND p.extraction_method='html_match' AND p.is_superseded IS FALSE
  AND p.property_id IS NULL AND p.subject_type='vehicle' AND p.subject_id IS NULL
  AND p.source_url ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$' AND p.confidence_score BETWEEN 0.6 AND 1
  AND isfinite(p.ingested_at) AND (p.observed_at IS NULL OR isfinite(p.observed_at))
  AND public.retained_listing_identity_value(k.key,p.structured_data->k.key) IS NOT NULL
 ON CONFLICT(source_observation_id,property_id) DO NOTHING;
 GET DIAGNOSTICS native_count=ROW_COUNT;n:=n+native_count;
 INSERT INTO public.retained_listing_property_work(source_observation_id,property_id,vehicle_id)
 SELECT p.id,r.id,p.vehicle_id FROM public.vehicle_observations p
 JOIN public.vehicles v ON v.id=p.vehicle_id AND v.is_public IS TRUE AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
 JOIN public.observation_sources s ON s.id=p.source_id AND s.slug='craigslist' AND 'listing'=ANY(s.supported_observations)
 JOIN public.observation_properties r ON r.id='abdd7a7a-02c1-4b09-afc6-1a288207dd2d'::uuid AND r.property_key='mileage_miles' AND r.namespace='core' AND r.data_type='integer' AND r.unit='miles' AND r.label='Odometer Reading (mi)' AND r.ratified_at IS NOT NULL AND r.deprecated_at IS NULL AND 'listing'=ANY(r.applies_to_kinds)
 WHERE p.id=ANY(p_sources) AND public.observation_is_public(p.kind,p.structured_data) AND public.retained_craigslist_odometer_witness(p) IS NOT NULL
 ON CONFLICT(source_observation_id,property_id) DO NOTHING;
 GET DIAGNOSTICS native_count=ROW_COUNT;n:=n+native_count;
 INSERT INTO public.retained_listing_property_work(source_observation_id,property_id,vehicle_id)
 SELECT p.id,r.id,p.vehicle_id FROM public.vehicle_observations p
 JOIN public.vehicles v ON v.id=p.vehicle_id AND v.is_public IS TRUE AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
 JOIN public.observation_sources src ON src.id=p.source_id AND src.slug='craigslist' AND 'listing'=ANY(src.supported_observations)
 JOIN public.observation_properties r ON r.id='ece619f7-c49a-44f7-999f-a41acf5d4dc3'::uuid AND r.property_key='year' AND r.namespace='core' AND r.data_type='integer' AND r.unit IS NULL AND r.label='Model Year' AND r.ratified_at IS NOT NULL AND r.deprecated_at IS NULL AND 'listing'=ANY(r.applies_to_kinds)
 WHERE p.id=ANY(p_sources) AND public.observation_is_public(p.kind,p.structured_data) AND public.retained_craigslist_year_witness(p) IS NOT NULL
 ON CONFLICT(source_observation_id,property_id) DO NOTHING;
 GET DIAGNOSTICS native_count=ROW_COUNT;n:=n+native_count;
 INSERT INTO public.retained_listing_property_work(source_observation_id,property_id,vehicle_id)
 SELECT p.id,r.id,p.vehicle_id FROM public.vehicle_observations p
 JOIN public.vehicles v ON v.id=p.vehicle_id AND v.is_public IS TRUE AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
 JOIN public.observation_sources src ON src.id=p.source_id AND src.slug='bat' AND 'specification'=ANY(src.supported_observations)
 JOIN public.observation_properties r ON r.id='ece619f7-c49a-44f7-999f-a41acf5d4dc3'::uuid AND r.property_key='year' AND r.namespace='core' AND r.data_type='integer' AND r.unit IS NULL AND r.label='Model Year' AND r.ratified_at IS NOT NULL AND r.deprecated_at IS NULL AND 'specification'=ANY(r.applies_to_kinds)
 WHERE p.id=ANY(p_sources) AND public.observation_is_public(p.kind,p.structured_data) AND public.retained_description_property_witness(p,'year') IS NOT NULL
 ON CONFLICT(source_observation_id,property_id) DO NOTHING;
 GET DIAGNOSTICS native_count=ROW_COUNT;n:=n+native_count;
 INSERT INTO public.retained_listing_property_work(source_observation_id,property_id,vehicle_id)
 SELECT p.id,r.id,p.vehicle_id FROM public.vehicle_observations p
 JOIN public.vehicles v ON v.id=p.vehicle_id AND v.is_public IS TRUE AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
 JOIN public.observation_sources s ON s.id=p.source_id AND s.slug='bat' AND 'specification'=ANY(s.supported_observations)
 CROSS JOIN(VALUES('8d274b73-a8a6-43bf-9036-5864d0152725'::uuid,'make','Make'),('a79b528f-7d9d-46ca-96f9-96d899e81d10'::uuid,'model','Model'))k(id,key,label)
 JOIN public.observation_properties r ON r.id=k.id AND r.property_key=k.key AND r.label=k.label AND r.data_type='string' AND r.unit IS NULL AND r.namespace='core' AND r.deprecated_at IS NULL AND r.ratified_at IS NOT NULL AND 'specification'=ANY(r.applies_to_kinds)
 WHERE p.id=ANY(p_sources) AND public.observation_is_public(p.kind,p.structured_data) AND public.retained_description_property_witness(p,k.key) IS NOT NULL
 ON CONFLICT(source_observation_id,property_id) DO NOTHING;
 GET DIAGNOSTICS native_count=ROW_COUNT;RETURN n+native_count;

END $function$
;
