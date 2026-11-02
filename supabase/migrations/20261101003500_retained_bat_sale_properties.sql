-- Retained BaT extractor specifications survive the listing -> sale_result kind.
-- This retains extractor testimony, not a reconstructed body/capture or new sale.
-- No replay checkpoint, queue row, source testimony, grant or public policy changes.
BEGIN;
SET LOCAL statement_timeout='5s';
SET LOCAL lock_timeout='2s';
DO $eligibility$
DECLARE fn text; d text; old text; replacement text; expected integer; occurrences integer;
BEGIN
 FOR fn,old,expected IN SELECT * FROM (VALUES
  ('public.retained_listing_identity_value_matches(public.vehicle_observations,public.vehicle_observations)', 'p.kind::text=''listing'' AND p.extraction_method=''html_match''',1),
  ('public.validate_retained_listing_property_source()', 'p.kind::text=''listing'' AND p.extraction_method=''html_match''',1),
  ('public.retained_listing_property_result_matches(uuid,uuid,uuid)', 'p.kind=''listing'' AND p.extraction_method=''html_match''',1),
  ('public.enqueue_retained_listing_properties(uuid[])', 'p.kind=''listing'' AND p.extraction_method=''html_match''',2)
 ) x(fn,old,expected) LOOP
  d:=pg_get_functiondef(fn::regprocedure);
  IF position('retained_bat_sale_properties_v1' in d)>0 THEN CONTINUE; END IF;
  occurrences:=(length(d)-length(replace(d,old,'')))/length(old);
  IF occurrences<>expected THEN RAISE EXCEPTION 'BaT sale source anchor drift: % (% vs %)',fn,occurrences,expected; END IF;
  replacement:='(p.kind=''listing'' OR (p.kind=''sale_result'' AND p.source_id=''4cdc735c-f117-42f2-889f-ba33805639a5''::uuid AND public.observation_is_public(p.kind,p.structured_data))) AND p.extraction_method=''html_match''';
  d:=replace(d,old,replacement);
  IF position(E'AS $function$\n' in d)=0 THEN RAISE EXCEPTION 'BaT sale function body anchor drift: %',fn; END IF;
  d:=replace(d,E'AS $function$\n',E'AS $function$\n-- retained_bat_sale_properties_v1\n');
  EXECUTE d;
 END LOOP;
END
$eligibility$;

DO $arrival$
DECLARE d text; old text;
BEGIN
 SELECT pg_get_triggerdef(oid) INTO d FROM pg_trigger
  WHERE tgrelid='public.vehicle_observations'::regclass AND tgname='retained_listing_property_intake';
 IF d IS NULL THEN RAISE EXCEPTION 'Retained source arrival trigger missing'; END IF;
 -- The source-key clause identifies this exact extension on reapplication.
 IF position('new.source_id = ''4cdc735c-f117-42f2-889f-ba33805639a5''::uuid' in d)>0 THEN RETURN; END IF;
 old:='WHEN (';
 IF d IS DISTINCT FROM $prior$CREATE TRIGGER retained_listing_property_intake AFTER INSERT ON public.vehicle_observations FOR EACH ROW WHEN ((((new.kind = 'listing'::observation_kind) AND ((new.extraction_method = ANY (ARRAY['html_match'::text, 'html_description_capture'::text])) OR ((new.extraction_method = 'html_parse'::text) AND (new.source_id = 'd7dad87c-0dc3-4b98-a31a-edf511618f8c'::uuid)))) OR ((new.kind = ANY (ARRAY['listing'::observation_kind, 'sale_result'::observation_kind])) AND (new.source_id = 'fee71d50-c59c-4340-b819-cd9a7d074d7f'::uuid) AND (new.extraction_method = ANY (ARRAY['public_lot_index'::text, 'next_data_json_parse'::text]))) OR ((new.kind = 'listing'::observation_kind) AND (new.extraction_method = 'retained_native_fields_v1'::text) AND (new.source_id = ANY (ARRAY['fee71d50-c59c-4340-b819-cd9a7d074d7f'::uuid, '755185e3-3d21-4373-b806-ddcbf0d5e39c'::uuid]))))) EXECUTE FUNCTION trg_enqueue_retained_listing_properties()$prior$ THEN
  RAISE EXCEPTION 'Retained source arrival trigger changed'; END IF;
 d:=replace(d,old,'WHEN ((new.kind = ''sale_result''::observation_kind AND new.extraction_method = ''html_match'' AND new.source_id = ''4cdc735c-f117-42f2-889f-ba33805639a5''::uuid AND public.observation_is_public(new.kind,new.structured_data)) OR ');
 DROP TRIGGER retained_listing_property_intake ON public.vehicle_observations;
 EXECUTE d;
END
$arrival$;
DO $profile$
DECLARE d text; old text; replacement text;
BEGIN
 d:=pg_get_functiondef('public.vehicle_profile_read(uuid)'::regprocedure);
 IF position('retained_property_profile_members_v1' in d)>0 THEN RETURN; END IF;
 old:='-- The newest readable title claim per key whose quote is still the vehicle''s title. Event time is unknown.';
 IF position(old in d)=0 THEN RAISE EXCEPTION 'Retained profile CTE anchor changed'; END IF;
 replacement:=$members$-- retained_property_profile_members_v1: the quoted extractor value must still
-- match the displayed facet, and canonical parent custody must still qualify.
retained_members AS (
 SELECT CASE o.structured_data->>'property_key'
   WHEN 'engine_configuration' THEN 'engine' WHEN 'engine_displacement_l' THEN 'engine'
   WHEN 'transmission_type' THEN 'transmission' WHEN 'drivetrain_layout' THEN 'drivetrain' END AS dimension,
   o.structured_data->>'source_value' AS value,o.observed_at,o.ingested_at,o.id,
   jsonb_build_object('value',o.structured_data->>'source_value','observed_at',o.observed_at,
     'trust',least(0.6,o.confidence_score),
     'source',jsonb_build_object('kind','listing','id',o.source_observation_id,'url',o.source_url,
       'label','Retained listing assertion','method',o.extraction_method),
     'qualification',jsonb_build_object('role','extractor_listing_claim','factory_configuration_status','unknown',
       'current_configuration_status','unknown','limitation','The date is when the source testimony was recorded. Original capture time is not established.')) AS member
 FROM v JOIN public.vehicle_observations o ON o.vehicle_id=v.id
 WHERE o.extraction_method='retained_listing_property_projection_v1'
   AND o.structured_data->>'property_key' IN('engine_configuration','engine_displacement_l','transmission_type','drivetrain_layout')
   AND jsonb_typeof(o.structured_data->'source_value')='string'
   AND EXISTS (SELECT FROM public.vehicle_observations p WHERE p.id=o.source_observation_id
     AND p.source_id='4cdc735c-f117-42f2-889f-ba33805639a5'::uuid AND p.extraction_method='html_match')
   AND public.retained_listing_property_result_matches(o.source_observation_id,o.property_id,o.id)
),
$members$||old;
 d:=replace(d,old,replacement);
 old:='END, n.member, public.vehicle_profile_claim(to_jsonb(fa.value), NULL, NULL, NULL, NULL)) AS member';
 IF position(old in d)=0 THEN RAISE EXCEPTION 'Retained profile priority anchor changed'; END IF;
 d:=replace(d,old,'END, n.member, rp.member, public.vehicle_profile_claim(to_jsonb(fa.value), NULL, NULL, NULL, NULL)) AS member');
 old:=$facet_join$LEFT JOIN LATERAL (SELECT nm.member FROM native_members nm WHERE nm.dimension=fa.dimension
    AND lower(regexp_replace(nm.value,'[[:space:]]+',' ','g'))=lower(regexp_replace(fa.value,'[[:space:]]+',' ','g'))
    ORDER BY nm.observed_at DESC NULLS LAST,nm.ingested_at DESC LIMIT 1) n ON true$facet_join$;
 -- Only the facet join changes; odometer does not use these specification claims.
 IF (length(d)-length(replace(d,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'Retained profile join anchor changed'; END IF;
 d:=replace(d,old,old||$join$
 LEFT JOIN LATERAL (SELECT rm.member FROM retained_members rm WHERE rm.dimension=fa.dimension
   AND lower(regexp_replace(rm.value,'[[:space:]]+',' ','g'))=lower(regexp_replace(fa.value,'[[:space:]]+',' ','g'))
   ORDER BY rm.observed_at DESC NULLS LAST,rm.ingested_at DESC,rm.id LIMIT 1) rp ON true$join$);
 EXECUTE d;
END
$profile$;
COMMIT;
