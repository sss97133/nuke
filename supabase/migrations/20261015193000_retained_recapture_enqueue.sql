-- HELD: production function change; merge only with the owner's approval.
-- A BaT re-capture of the same listing page whose projection inputs equal an earlier,
-- current, already-queued capture repeats that publisher's assertion. It stays
-- testimony; it is not queued for projection again. Inputs compared: description
-- text plus qualification metadata (html_description_capture), or the nine fields the
-- live enqueue reads (html_match). Measured 2026-10-15 in one hour: 101 of 101
-- description parents and 20 of 20 html_match parents projected were such repeats.
-- A new property reaches existing captures through the seed, not arrivals; adding an
-- html_match field to the enqueue requires adding it here. Only the arrival trigger
-- function changes; the queue, seed, drain, enqueue owners and the trigger stay.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='1s';
DO $guard$
DECLARE h text;
BEGIN
 h:=encode(sha256(convert_to(pg_get_functiondef('public.trg_enqueue_retained_listing_properties()'::regprocedure),'UTF8')),'base64');
 IF h NOT IN ('xHctvFszU9qLfSOvsxFsM8FaGRLolR/n34qvRq49k1M=','x8cX0VjA+z5Ot4zhpf9WNQP9WkIlRMhbq94O3qeNCHM=') THEN
  RAISE EXCEPTION 'Retained arrival trigger owner drift; integrate reviewed migrations first'; END IF;
 IF (SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid='public.vehicle_observations'::regclass AND tgname='retained_listing_property_intake')
  IS DISTINCT FROM 'CREATE TRIGGER retained_listing_property_intake AFTER INSERT ON public.vehicle_observations FOR EACH ROW WHEN (((new.kind = ''listing''::observation_kind) AND ((new.extraction_method = ANY (ARRAY[''html_match''::text, ''html_description_capture''::text])) OR ((new.extraction_method = ''html_parse''::text) AND (new.source_id = ''d7dad87c-0dc3-4b98-a31a-edf511618f8c''::uuid))))) EXECUTE FUNCTION trg_enqueue_retained_listing_properties()' THEN
  RAISE EXCEPTION 'Retained arrival trigger definition drift'; END IF;
 IF (SELECT NOT prosecdef FROM pg_proc WHERE oid='public.trg_enqueue_retained_listing_properties()'::regprocedure) THEN
  RAISE EXCEPTION 'Retained arrival trigger security contract drift'; END IF;
 -- The html_match field list mirrors this enqueue owner (current, or held #1361's version).
 IF encode(sha256(convert_to(pg_get_functiondef('public.enqueue_retained_listing_properties(uuid[])'::regprocedure),'UTF8')),'base64')
  NOT IN ('rRZ6TZfPxRls5QI1N1QhUjRz6AZfRHOK5UXqEiSMrvc=','jNq1ma51Jc5Cm3k+7HqzNjyC/E0fKuNTJ10dpknu9JY=') THEN
  RAISE EXCEPTION 'Retained enqueue owner changed; review the compared projection inputs'; END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.trg_enqueue_retained_listing_properties()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
 -- One listing assertion is projected once: a re-capture of the same page whose
 -- projection inputs equal an earlier current, queued capture repeats it.
 IF NEW.extraction_method IN('html_description_capture','html_match') AND NEW.source_url IS NOT NULL
  AND (NEW.extraction_method='html_match' OR NEW.content_text IS NOT NULL) AND EXISTS(
  SELECT 1 FROM public.vehicle_observations e
  WHERE e.vehicle_id=NEW.vehicle_id AND e.source_id=NEW.source_id AND e.kind=NEW.kind
   AND e.extraction_method=NEW.extraction_method AND e.source_url=NEW.source_url AND e.id<>NEW.id
   AND e.is_superseded IS FALSE AND e.content_text IS NOT DISTINCT FROM NEW.content_text
   AND CASE WHEN NEW.extraction_method='html_description_capture' THEN
    jsonb_build_array(e.structured_data->'extractor',e.structured_data->'source_text_field',e.structured_data->'description_capture',
     e.structured_data->'extractor_input_truncated',e.structured_data->'source_capture_basis',e.structured_data->'observation_time_basis',
     e.structured_data->'source_event_time_status')
    =jsonb_build_array(NEW.structured_data->'extractor',NEW.structured_data->'source_text_field',NEW.structured_data->'description_capture',
     NEW.structured_data->'extractor_input_truncated',NEW.structured_data->'source_capture_basis',NEW.structured_data->'observation_time_basis',
     NEW.structured_data->'source_event_time_status')
   ELSE
    jsonb_build_array(e.structured_data->'interior_color',e.structured_data->'color',e.structured_data->'engine_size',
     e.structured_data->'transmission',e.structured_data->'drivetrain',e.structured_data->'year',e.structured_data->'make',
     e.structured_data->'model',e.structured_data->'vin')
    =jsonb_build_array(NEW.structured_data->'interior_color',NEW.structured_data->'color',NEW.structured_data->'engine_size',
     NEW.structured_data->'transmission',NEW.structured_data->'drivetrain',NEW.structured_data->'year',NEW.structured_data->'make',
     NEW.structured_data->'model',NEW.structured_data->'vin')
   END
   AND EXISTS(SELECT 1 FROM public.retained_listing_property_work w
    WHERE w.source_observation_id=e.id AND w.status IN('pending','claimed','skipped','done'))) THEN
  RETURN NEW;
 END IF;
 PERFORM public.enqueue_retained_listing_properties(NEW.id);RETURN NEW;
END $function$;
COMMENT ON FUNCTION public.trg_enqueue_retained_listing_properties() IS
'Arrival enqueue for retained listing projections. A BaT re-capture of the same listing page whose projection inputs (description text and qualification, or the nine html_match fields) equal an earlier current, already-queued capture is kept as testimony but not projected again. Failed earlier work, superseded captures, changed inputs, other pages, vehicles and methods enqueue as before. Adding an html_match field to enqueue_retained_listing_properties requires adding it here.';
COMMIT;
