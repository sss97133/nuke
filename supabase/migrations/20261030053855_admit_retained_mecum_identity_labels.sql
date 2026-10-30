-- Activate only after the decoder-only ingest-observation deployment is verified.
-- Reuse the existing source registry, typed custody checks, queue and public reader.
-- No fetch/model call, new property, new grant, source rewrite, schedule or capacity.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='1s';
DO $source_guard$
BEGIN
 IF NOT EXISTS(SELECT FROM public.observation_sources WHERE id='fee71d50-c59c-4340-b819-cd9a7d074d7f'
  AND slug='mecum' AND 'listing'=ANY(supported_observations) AND 'sale_result'=ANY(supported_observations)
  AND NOT ('specification'=ANY(supported_observations))) THEN
  RAISE EXCEPTION 'Mecum source capability changed; review activation';
 END IF;
 IF (SELECT count(*) FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND state='active'
  AND query ~ '(vehicle_observations|retained_listing_property|vehicle_canonical)')>2 THEN
  RAISE EXCEPTION 'Relevant data work active; defer activation';
 END IF;
END $source_guard$;

DO $patch_0$
DECLARE f text;
BEGIN
 f:=pg_get_functiondef('public.retained_listing_identity_value_matches(public.vehicle_observations,public.vehicle_observations)'::regprocedure);
 IF encode(sha256(convert_to(f,'UTF8')),'base64')<>'nfcsNX8kyEQCjBmBkX+GINnjYG4EV+Cte1zJExRp/QY=' THEN
  RAISE EXCEPTION 'retained_listing_identity_value_matches changed; review activation';
 END IF;

 IF (length(f)-length(replace(f,$fragment_0_0$p.kind::text='listing' AND p.extraction_method='html_match'$fragment_0_0$,'')))/length($fragment_0_0$p.kind::text='listing' AND p.extraction_method='html_match'$fragment_0_0$)<>1 THEN RAISE EXCEPTION 'Expected source gate absent'; END IF;
 f:=replace(f,$fragment_0_0$p.kind::text='listing' AND p.extraction_method='html_match'$fragment_0_0$,$replacement_0_0$(p.kind::text='listing' AND p.extraction_method='html_match' OR (p.kind::text IN('listing','sale_result') AND p.extraction_method='public_lot_index' AND p.source_id='fee71d50-c59c-4340-b819-cd9a7d074d7f'::uuid AND k IN('year','make','model') AND public.observation_is_public(p.kind,p.structured_data)))$replacement_0_0$);

 IF (length(f)-length(replace(f,$fragment_0_1$p.source_url ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$'$fragment_0_1$,'')))/length($fragment_0_1$p.source_url ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$'$fragment_0_1$)<>1 THEN RAISE EXCEPTION 'Expected source gate absent'; END IF;
 f:=replace(f,$fragment_0_1$p.source_url ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$'$fragment_0_1$,$replacement_0_1$((p.extraction_method='html_match' AND p.source_url ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$') OR (p.extraction_method='public_lot_index' AND p.source_url ~ '^https://(www[.])?mecum[.]com/lots/[0-9]+/[^/?#]+/?$'))$replacement_0_1$);

 EXECUTE f;
END $patch_0$;

DO $patch_1$
DECLARE f text;
BEGIN
 f:=pg_get_functiondef('public.retained_listing_identity_matches(public.vehicle_observations,public.vehicle_observations)'::regprocedure);
 IF encode(sha256(convert_to(f,'UTF8')),'base64')<>'DPSw/MrC/0QRYiQIe2mODXM+lTrbcgB5UfSH9odHFdE=' THEN
  RAISE EXCEPTION 'retained_listing_identity_matches changed; review activation';
 END IF;

 IF (length(f)-length(replace(f,$fragment_1_0$s.slug='bat'$fragment_1_0$,'')))/length($fragment_1_0$s.slug='bat'$fragment_1_0$)<>1 THEN RAISE EXCEPTION 'Expected source gate absent'; END IF;
 f:=replace(f,$fragment_1_0$s.slug='bat'$fragment_1_0$,$replacement_1_0$(s.slug='bat' OR (s.slug='mecum' AND p.extraction_method='public_lot_index' AND o.structured_data->>'property_key' IN('year','make','model')))$replacement_1_0$);

 EXECUTE f;
END $patch_1$;

DO $patch_2$
DECLARE f text;
BEGIN
 f:=pg_get_functiondef('public.enqueue_retained_listing_properties(uuid[])'::regprocedure);
 IF encode(sha256(convert_to(f,'UTF8')),'base64')<>'rRZ6TZfPxRls5QI1N1QhUjRz6AZfRHOK5UXqEiSMrvc=' THEN
  RAISE EXCEPTION 'enqueue_retained_listing_properties changed; review activation';
 END IF;

 IF (length(f)-length(replace(f,$fragment_2_0$ INSERT INTO public.retained_listing_property_work(source_observation_id,property_id,vehicle_id)
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
 GET DIAGNOSTICS native_count=ROW_COUNT;n:=n+native_count;$fragment_2_0$,'')))/length($fragment_2_0$ INSERT INTO public.retained_listing_property_work(source_observation_id,property_id,vehicle_id)
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
 GET DIAGNOSTICS native_count=ROW_COUNT;n:=n+native_count;$fragment_2_0$)<>1 THEN RAISE EXCEPTION 'Expected source gate absent'; END IF;
 f:=replace(f,$fragment_2_0$ INSERT INTO public.retained_listing_property_work(source_observation_id,property_id,vehicle_id)
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
 GET DIAGNOSTICS native_count=ROW_COUNT;n:=n+native_count;$fragment_2_0$,$replacement_2_0$ INSERT INTO public.retained_listing_property_work(source_observation_id,property_id,vehicle_id)
 SELECT p.id,k.id,p.vehicle_id FROM public.vehicle_observations p
 JOIN public.vehicles v ON v.id=p.vehicle_id AND v.is_public IS TRUE AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
 JOIN public.observation_sources s ON s.id=p.source_id AND s.slug IN('bat','mecum') AND 'specification'=ANY(s.supported_observations)
 CROSS JOIN(VALUES('ece619f7-c49a-44f7-999f-a41acf5d4dc3'::uuid,'year'),('8d274b73-a8a6-43bf-9036-5864d0152725'::uuid,'make'),('a79b528f-7d9d-46ca-96f9-96d899e81d10'::uuid,'model'),('9fc93dd3-3639-439a-8eed-3e9a0f846334'::uuid,'vin'))k(id,key)
 JOIN public.observation_properties r ON r.id=k.id AND r.property_key=k.key AND r.namespace='core' AND r.deprecated_at IS NULL AND r.ratified_at IS NOT NULL AND 'specification'=ANY(r.applies_to_kinds)
 WHERE p.id=ANY(p_sources) AND ((s.slug='bat' AND p.kind='listing' AND p.extraction_method='html_match') OR (s.slug='mecum' AND p.kind IN('listing','sale_result') AND p.extraction_method='public_lot_index' AND k.key IN('year','make','model') AND public.observation_is_public(p.kind,p.structured_data))) AND p.is_superseded IS FALSE
  AND p.property_id IS NULL AND p.subject_type='vehicle' AND p.subject_id IS NULL
  AND ((p.extraction_method='html_match' AND p.source_url ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$') OR (p.extraction_method='public_lot_index' AND p.source_url ~ '^https://(www[.])?mecum[.]com/lots/[0-9]+/[^/?#]+/?$')) AND p.confidence_score BETWEEN 0.6 AND 1
  AND isfinite(p.ingested_at) AND (p.observed_at IS NULL OR isfinite(p.observed_at))
  AND public.retained_listing_identity_value(k.key,p.structured_data->k.key) IS NOT NULL
 ON CONFLICT(source_observation_id,property_id) DO NOTHING;
 GET DIAGNOSTICS native_count=ROW_COUNT;n:=n+native_count;$replacement_2_0$);

 EXECUTE f;
END $patch_2$;

DO $reader$
DECLARE f text;
BEGIN
 f:=pg_get_viewdef('public.vehicle_canonical'::regclass,true);
 IF encode(sha256(convert_to(f,'UTF8')),'base64')<>'sm7Vc3fQHHRk6tKdoLfVZfItkmCRKRwwyq8Twe8xm7o=' THEN
  RAISE EXCEPTION 'Canonical reader changed; review activation';
 END IF;
 f:=replace(f,$old_join$JOIN observation_sources ds ON ds.id = dp.source_id AND ds.slug = 'bat'::text$old_join$,$new_join$JOIN observation_sources ds ON ds.id = dp.source_id AND (ds.slug = 'bat'::text OR (ds.slug = 'mecum'::text AND dp.extraction_method = 'public_lot_index'::text))$new_join$);
 EXECUTE 'CREATE OR REPLACE VIEW public.vehicle_canonical AS '||f;
END $reader$;

DO $arrival$
BEGIN
 IF NOT EXISTS(SELECT FROM pg_trigger WHERE tgrelid='public.vehicle_observations'::regclass
  AND tgname='retained_listing_property_intake' AND tgenabled='O'
  AND pg_get_triggerdef(oid)=$old_trigger$CREATE TRIGGER retained_listing_property_intake AFTER INSERT ON public.vehicle_observations FOR EACH ROW WHEN (((new.kind = 'listing'::observation_kind) AND ((new.extraction_method = ANY (ARRAY['html_match'::text, 'html_description_capture'::text])) OR ((new.extraction_method = 'html_parse'::text) AND (new.source_id = 'd7dad87c-0dc3-4b98-a31a-edf511618f8c'::uuid))))) EXECUTE FUNCTION trg_enqueue_retained_listing_properties()$old_trigger$) THEN
  RAISE EXCEPTION 'Retained arrival trigger changed; review activation';
 END IF;
 EXECUTE $new_trigger$CREATE OR REPLACE TRIGGER retained_listing_property_intake AFTER INSERT ON public.vehicle_observations FOR EACH ROW WHEN ((((new.kind = 'listing'::observation_kind) AND ((new.extraction_method = ANY (ARRAY['html_match'::text, 'html_description_capture'::text])) OR ((new.extraction_method = 'html_parse'::text) AND (new.source_id = 'd7dad87c-0dc3-4b98-a31a-edf511618f8c'::uuid))))) OR (new.kind IN ('listing'::public.observation_kind,'sale_result'::public.observation_kind) AND new.extraction_method='public_lot_index' AND new.source_id='fee71d50-c59c-4340-b819-cd9a7d074d7f'::uuid)) EXECUTE FUNCTION trg_enqueue_retained_listing_properties()$new_trigger$;
END $arrival$;
UPDATE public.observation_sources SET supported_observations=array_append(supported_observations,'specification'::public.observation_kind)
 WHERE id='fee71d50-c59c-4340-b819-cd9a7d074d7f' AND slug='mecum';
DO $locks$
BEGIN
 IF EXISTS(SELECT FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND wait_event_type='Lock') THEN
  RAISE EXCEPTION 'Lock wait detected; rollback activation';
 END IF;
END $locks$;
COMMIT;
