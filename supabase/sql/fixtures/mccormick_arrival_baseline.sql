-- Existing arrival owner and predicate, before the source routing extension.
CREATE OR REPLACE FUNCTION public.trg_enqueue_retained_listing_properties()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE r record; prior public.vehicle_observations%ROWTYPE;
BEGIN
 -- One listing assertion is projected once: when the page's immediately preceding
 -- capture carries the same projection inputs, this capture repeats it.
 IF NEW.extraction_method IN('html_description_capture','html_match') AND NEW.vehicle_id IS NOT NULL
  AND NEW.source_url IS NOT NULL AND NEW.observed_at IS NOT NULL
  AND (NEW.extraction_method='html_match' OR NEW.content_text IS NOT NULL) THEN
  FOR r IN SELECT e.id,e.kind,e.source_id,e.extraction_method,e.source_url FROM public.vehicle_observations e
   WHERE e.vehicle_id=NEW.vehicle_id AND e.vehicle_id IS NOT NULL AND e.observed_at<=NEW.observed_at
   ORDER BY e.observed_at DESC LIMIT 200 LOOP
   CONTINUE WHEN r.id=NEW.id OR r.kind IS DISTINCT FROM NEW.kind OR r.source_id IS DISTINCT FROM NEW.source_id
    OR r.extraction_method IS DISTINCT FROM NEW.extraction_method OR r.source_url IS DISTINCT FROM NEW.source_url;
   SELECT * INTO prior FROM public.vehicle_observations WHERE id=r.id;
   IF prior.is_superseded IS FALSE AND prior.content_text IS NOT DISTINCT FROM NEW.content_text
    AND (CASE WHEN NEW.extraction_method='html_description_capture' THEN
     jsonb_build_array(prior.structured_data->'extractor',prior.structured_data->'source_text_field',prior.structured_data->'description_capture',
      prior.structured_data->'extractor_input_truncated',prior.structured_data->'source_capture_basis',prior.structured_data->'observation_time_basis',
      prior.structured_data->'source_event_time_status')
     =jsonb_build_array(NEW.structured_data->'extractor',NEW.structured_data->'source_text_field',NEW.structured_data->'description_capture',
      NEW.structured_data->'extractor_input_truncated',NEW.structured_data->'source_capture_basis',NEW.structured_data->'observation_time_basis',
      NEW.structured_data->'source_event_time_status')
    ELSE
     jsonb_build_array(prior.structured_data->'interior_color',prior.structured_data->'color',prior.structured_data->'engine_size',
      prior.structured_data->'transmission',prior.structured_data->'drivetrain',prior.structured_data->'year',prior.structured_data->'make',
      prior.structured_data->'model',prior.structured_data->'vin')
     =jsonb_build_array(NEW.structured_data->'interior_color',NEW.structured_data->'color',NEW.structured_data->'engine_size',
      NEW.structured_data->'transmission',NEW.structured_data->'drivetrain',NEW.structured_data->'year',NEW.structured_data->'make',
      NEW.structured_data->'model',NEW.structured_data->'vin')
    END)
    -- The prior capture was queued (and not only failed) or itself skipped as a repeat.
    AND (NOT EXISTS(SELECT 1 FROM public.retained_listing_property_work w WHERE w.source_observation_id=prior.id)
     OR EXISTS(SELECT 1 FROM public.retained_listing_property_work w WHERE w.source_observation_id=prior.id AND w.status<>'failed')) THEN
    RETURN NEW;
   END IF;
   EXIT;
  END LOOP;
 END IF;
 PERFORM public.enqueue_retained_listing_properties(NEW.id);RETURN NEW;
END $function$
;
CREATE TRIGGER retained_listing_property_intake AFTER INSERT ON public.vehicle_observations FOR EACH ROW WHEN ((((new.kind = 'sale_result'::observation_kind) AND (new.extraction_method = 'html_match'::text) AND (new.source_id = '4cdc735c-f117-42f2-889f-ba33805639a5'::uuid) AND observation_is_public(new.kind, new.structured_data)) OR (((new.kind = 'listing'::observation_kind) AND ((new.extraction_method = ANY (ARRAY['html_match'::text, 'html_description_capture'::text])) OR ((new.extraction_method = 'html_parse'::text) AND (new.source_id = 'd7dad87c-0dc3-4b98-a31a-edf511618f8c'::uuid)))) OR ((new.kind = ANY (ARRAY['listing'::observation_kind, 'sale_result'::observation_kind])) AND (new.source_id = 'fee71d50-c59c-4340-b819-cd9a7d074d7f'::uuid) AND (new.extraction_method = ANY (ARRAY['public_lot_index'::text, 'next_data_json_parse'::text]))) OR ((new.kind = 'listing'::observation_kind) AND (new.extraction_method = 'retained_native_fields_v1'::text) AND (new.source_id = ANY (ARRAY['fee71d50-c59c-4340-b819-cd9a7d074d7f'::uuid, '755185e3-3d21-4373-b806-ddcbf0d5e39c'::uuid])))))) EXECUTE FUNCTION trg_enqueue_retained_listing_properties();
