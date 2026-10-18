-- Extend the existing retained listing property grain; no new schema, sources or vocabulary.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';
DO $contract$
BEGIN
 IF encode(sha256(convert_to(pg_get_functiondef('public.validate_retained_listing_property_source()'::regprocedure),'UTF8')),'base64') <> 'XKGqaE7TIW/ry9quawPFGbVrBfu64vNT5+/5MCg/LHc=' THEN
 RAISE EXCEPTION 'retained source owner changed' USING ERRCODE='55000'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.observation_properties WHERE id='efcb8c61-1ff5-4790-890e-2e09118e87e3'
 AND property_key='exterior_color' AND namespace='core' AND deprecated_at IS NULL AND 'specification'=ANY(applies_to_kinds)) THEN
 RAISE EXCEPTION 'exterior property contract changed' USING ERRCODE='55000'; END IF;
END
$contract$;
CREATE OR REPLACE FUNCTION public.validate_retained_listing_property_source()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE p public.vehicle_observations%ROWTYPE; v_property_key text; source_field text; projection_mode text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Corrections use sanctioned supersession; never mutate the derived tuple.
    IF OLD.source_observation_id IS NOT NULL AND
      ROW(NEW.id,NEW.source_observation_id,NEW.vehicle_id,NEW.kind,NEW.property_id,NEW.subject_type,NEW.subject_id,
        NEW.source_id,NEW.source_url,NEW.source_identifier,NEW.raw_source_ref,NEW.observed_at,NEW.ingested_at,
        NEW.extraction_method,NEW.confidence_score,NEW.structured_data,NEW.content_hash,NEW.content_text)
      IS DISTINCT FROM
      ROW(OLD.id,OLD.source_observation_id,OLD.vehicle_id,OLD.kind,OLD.property_id,OLD.subject_type,OLD.subject_id,
        OLD.source_id,OLD.source_url,OLD.source_identifier,OLD.raw_source_ref,OLD.observed_at,OLD.ingested_at,
        OLD.extraction_method,OLD.confidence_score,OLD.structured_data,OLD.content_hash,OLD.content_text) THEN
      RAISE EXCEPTION 'retained property source tuple is immutable' USING ERRCODE='23514';
    END IF;
    IF OLD.source_observation_id IS NOT DISTINCT FROM NEW.source_observation_id THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'retained source links are assigned only on insert' USING ERRCODE='23514';
  END IF;
  IF NEW.source_observation_id IS NULL THEN
    IF NEW.extraction_method='retained_listing_property_projection_v1' THEN
      RAISE EXCEPTION 'retained projection requires typed source' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  v_property_key := NEW.structured_data->>'property_key';
  IF v_property_key='interior_color' THEN
    source_field := 'interior_color'; projection_mode := 'retained_listing_interior_color_v1';
  ELSIF v_property_key='exterior_color' THEN
    source_field := 'color'; projection_mode := 'retained_listing_exterior_color_v1';
  ELSE
    RAISE EXCEPTION 'unsupported retained property' USING ERRCODE='23514';
  END IF;
  SELECT * INTO p FROM public.vehicle_observations WHERE id=NEW.source_observation_id FOR SHARE;
  IF NOT FOUND OR p.kind::text IS DISTINCT FROM 'listing' OR p.is_superseded IS DISTINCT FROM false
    OR p.property_id IS NOT NULL OR p.subject_type IS DISTINCT FROM 'vehicle' OR p.subject_id IS NOT NULL
    OR p.extraction_method IS DISTINCT FROM 'html_match'
    OR p.source_url !~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$'
    OR p.source_url IS NULL OR p.ingested_at IS NULL OR NOT isfinite(p.ingested_at)
    OR (p.observed_at IS NOT NULL AND NOT isfinite(p.observed_at))
    OR p.confidence_score IS NULL OR p.confidence_score < 0.6 OR p.confidence_score > 1
    OR jsonb_typeof(p.structured_data->source_field) IS DISTINCT FROM 'string'
    OR nullif(btrim(p.structured_data->>source_field),'') IS NULL
    OR length(p.structured_data->>source_field)>500
    OR btrim(p.structured_data->>source_field) ~* '^(unknown|n/a|unspecified)$'
    OR NOT EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id=p.vehicle_id AND v.is_public IS TRUE
      AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item')
    OR NOT EXISTS (SELECT 1 FROM public.observation_sources s WHERE s.id=p.source_id AND s.slug='bat') THEN
    RAISE EXCEPTION 'ineligible retained listing source' USING ERRCODE='23514';
  END IF;
  IF NEW.vehicle_id IS DISTINCT FROM p.vehicle_id OR NEW.source_id IS DISTINCT FROM p.source_id
    OR NEW.source_url IS DISTINCT FROM p.source_url OR NEW.kind::text IS DISTINCT FROM 'specification'
    OR NEW.subject_type IS DISTINCT FROM 'vehicle' OR NEW.subject_id IS NOT NULL
    OR NEW.observed_at IS DISTINCT FROM p.ingested_at
    OR NEW.extraction_method IS DISTINCT FROM 'retained_listing_property_projection_v1'
    OR NEW.source_identifier IS DISTINCT FROM projection_mode||':'||p.id::text
    OR NEW.raw_source_ref IS DISTINCT FROM 'vehicle_observations:'||p.id::text
    OR NEW.confidence_score IS NULL OR NEW.confidence_score<0 OR NEW.confidence_score>0.6
    OR NEW.structured_data->v_property_key IS DISTINCT FROM p.structured_data->source_field
    OR NEW.structured_data->>'source_observation_id' IS DISTINCT FROM p.id::text
    OR NEW.structured_data->>'claim_role' IS DISTINCT FROM 'listing_claim'
    OR NEW.structured_data->>'observed_at_basis' IS DISTINCT FROM 'source_testimony_recorded_at'
    OR NEW.structured_data->>'source_field' IS DISTINCT FROM source_field
    OR NEW.structured_data->>'property_key' IS DISTINCT FROM v_property_key
    OR NEW.structured_data->>'projection_version' IS DISTINCT FROM projection_mode
    OR NEW.structured_data->>'analysis_kind' IS DISTINCT FROM 'retained_listing_property_projection'
    OR (NEW.structured_data->>'source_recorded_at')::timestamptz IS DISTINCT FROM p.ingested_at
    OR (NEW.structured_data->>'source_observed_at')::timestamptz IS DISTINCT FROM p.observed_at
    OR NEW.structured_data->'source_confidence_score' IS DISTINCT FROM to_jsonb(p.confidence_score)
    OR NEW.structured_data->>'source_extraction_method' IS DISTINCT FROM p.extraction_method
    OR NOT EXISTS (SELECT 1 FROM public.observation_properties r WHERE r.id=NEW.property_id
      AND r.property_key=v_property_key AND r.namespace='core' AND r.deprecated_at IS NULL
      AND 'specification'=ANY(r.applies_to_kinds)) THEN
    RAISE EXCEPTION 'retained property must match exact source tuple' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END
$fn$;
COMMENT ON FUNCTION public.validate_retained_listing_property_source() IS
'Existing insert owner admits exact retained listing interior_color or extractor color to exterior_color. Same source FK, unknown roles/event time, immutable source tuple; sanctioned metadata/supersession unchanged. No inference or independent corroboration.';
COMMENT ON COLUMN public.vehicle_observations.source_observation_id IS
'One retained listing observation to one property projection, current ingest-observation writer: interior_color or color to exterior_color. Nullable enforced self-FK; historical rows untouched. Child observed_at is parent recording clock, not source event time. Source per-field parsing/heuristics may be unknown. Consumers vehicle_canonical/get_field_provenance; no independent corroboration or factory/current verification.';
DO $readers$
DECLARE reader text; view_sql text;
BEGIN
 reader := pg_get_functiondef('public.get_field_provenance(uuid,text)'::regprocedure);
 view_sql := pg_get_viewdef('public.vehicle_canonical'::regclass,true);
 IF encode(sha256(convert_to(reader,'UTF8')),'base64') <> 'EyC//hVc0fqmEXnnXJnFFfhKtmVhtrqRaASOwiW7ypg='
 OR encode(sha256(convert_to(view_sql,'UTF8')),'base64') <> 'KU8wWChUQ7LeStl0hWBdckiGKCxPOISQ8v4kx6tWr8g=' THEN
 RAISE EXCEPTION 'retained consumer contract changed' USING ERRCODE='55000'; END IF;
 reader := replace(reader,$old$rk.property_key='interior_color'$old$,$new$rk.property_key IN ('interior_color','exterior_color')$new$);
 reader := replace(reader,$old$o.structured_data->'interior_color'=rp.structured_data->'interior_color'$old$,
 $new$o.structured_data->rk.property_key=rp.structured_data->(CASE rk.property_key WHEN 'exterior_color' THEN 'color' ELSE 'interior_color' END)$new$);
 view_sql := replace(view_sql,$old$rk.property_key = 'interior_color'::text$old$,$new$rk.property_key IN ('interior_color','exterior_color')$new$);
 view_sql := replace(view_sql,$old$(o.structured_data -> 'interior_color'::text) = (rp.structured_data -> 'interior_color'::text)$old$,
 $new$(o.structured_data -> rk.property_key) = (rp.structured_data -> (CASE rk.property_key WHEN 'exterior_color' THEN 'color' ELSE 'interior_color' END))$new$);
 EXECUTE reader;
 EXECUTE 'CREATE OR REPLACE VIEW public.vehicle_canonical AS '||view_sql;
END
$readers$;
COMMIT;
