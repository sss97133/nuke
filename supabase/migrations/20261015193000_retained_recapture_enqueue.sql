-- HELD: production function change; merge only with the owner's approval.
-- A BaT re-capture of a listing page whose projection inputs equal the page's
-- immediately preceding capture repeats that publisher's assertion. It stays
-- testimony; it is not queued for projection again. Inputs compared: description
-- text plus qualification metadata (html_description_capture), or the nine fields the
-- live enqueue reads (html_match). Measured 2026-10-15 in one hour: 101 of 101
-- description parents and 20 of 20 html_match parents projected were such repeats.
-- The lookup walks at most 200 of the vehicle's latest observations on
-- (vehicle_id, observed_at DESC): one live vehicle holds 12,318 BaT listing rows, and
-- a scan on (vehicle_id, source_id, kind) exceeded 10 s; its preceding description
-- capture sat 26-46 rows back. A new property reaches existing captures through the
-- seed, not arrivals; adding an html_match field to the enqueue requires adding it
-- here. Only the arrival trigger function changes; queue, seed, drain, enqueue owners
-- and the trigger stay.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='1s';
DO $guard$
DECLARE h text;
BEGIN
 h:=encode(sha256(convert_to(pg_get_functiondef('public.trg_enqueue_retained_listing_properties()'::regprocedure),'UTF8')),'base64');
 IF h NOT IN ('xHctvFszU9qLfSOvsxFsM8FaGRLolR/n34qvRq49k1M=','h5udmNorQaKkFgXlXmflv4etoyrjn8cgqbDqIe/yhaM=') THEN
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
 IF to_regclass('public.idx_observations_vehicle_time') IS NULL THEN
  RAISE EXCEPTION 'Bounded predecessor lookup requires idx_observations_vehicle_time'; END IF;
END $guard$;

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
END $function$;
COMMENT ON FUNCTION public.trg_enqueue_retained_listing_properties() IS
'Arrival enqueue for retained listing projections. A BaT re-capture whose projection inputs (description text and qualification, or the nine html_match fields) equal the same page''s immediately preceding capture, found within the vehicle''s latest 200 observations, is kept as testimony but not projected again, provided that capture was queued (not only failed) or itself skipped. Superseded or failed predecessors, changed inputs, other pages, vehicles and methods, and predecessors beyond the walk enqueue as before. Limits: A,B,A text alternation re-queues the third; a predecessor skipped while its queued head was later withdrawn, or skipped while ineligible, does not re-queue until the inputs change or the seed revisits it. Adding an html_match field to enqueue_retained_listing_properties requires adding it here.';
COMMIT;
