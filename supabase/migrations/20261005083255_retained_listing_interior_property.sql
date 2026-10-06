-- A child property claim cites exactly one already-retained observation.
-- No historical replay, testimony rewrite, index build, access or schedule change.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';
-- Existing BaT source gains the specification grain under unchanged write auth.
-- Exact baseline prevents dropping concurrent kinds or silently re-tiering trust.
DO $source$
DECLARE source public.observation_sources%ROWTYPE;
BEGIN
 SELECT * INTO source FROM public.observation_sources
 WHERE id='4cdc735c-f117-42f2-889f-ba33805639a5' FOR UPDATE;
 IF NOT FOUND OR source.slug IS DISTINCT FROM 'bat'
   OR source.supported_observations::text[] IS DISTINCT FROM ARRAY['listing','sale_result','comment','bid','condition']::text[] THEN
   RAISE EXCEPTION 'BaT source kind contract changed; refusing expansion' USING ERRCODE='55000';
 END IF;
 UPDATE public.observation_sources
 SET supported_observations=array_append(supported_observations,'specification'::public.observation_kind)
 WHERE id=source.id;
END
$source$;
ALTER TABLE public.vehicle_observations ADD COLUMN source_observation_id uuid;
ALTER TABLE public.vehicle_observations ADD CONSTRAINT vehicle_observations_source_observation_id_fkey
  FOREIGN KEY (source_observation_id) REFERENCES public.vehicle_observations(id) NOT VALID;
COMMENT ON COLUMN public.vehicle_observations.source_observation_id IS
'Grain: one deterministic property projection cites one original retained observation. Nullable self-FK; new edges enforced, historical NULLs untouched. Current writer ingest-observation admits only retained BaT interior_color. Child observed_at is parent ingested_at (recording, not publication/capture); parent source observed_at is retained separately and remains unverified event time. Consumer vehicle_canonical/get_field_provenance. Not independent corroboration or factory/current verification.';

CREATE OR REPLACE FUNCTION public.validate_retained_listing_property_source()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE p public.vehicle_observations%ROWTYPE;
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
  SELECT * INTO p FROM public.vehicle_observations WHERE id=NEW.source_observation_id FOR SHARE;
  IF NOT FOUND OR p.kind::text IS DISTINCT FROM 'listing' OR p.is_superseded IS DISTINCT FROM false
    OR p.property_id IS NOT NULL OR p.subject_type IS DISTINCT FROM 'vehicle' OR p.subject_id IS NOT NULL
    OR p.extraction_method IS DISTINCT FROM 'html_match'
    OR p.source_url !~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$'
    OR p.source_url IS NULL OR p.ingested_at IS NULL OR NOT isfinite(p.ingested_at)
    OR (p.observed_at IS NOT NULL AND NOT isfinite(p.observed_at))
    OR p.confidence_score IS NULL OR p.confidence_score < 0.6 OR p.confidence_score > 1
    OR jsonb_typeof(p.structured_data->'interior_color') IS DISTINCT FROM 'string'
    OR nullif(btrim(p.structured_data->>'interior_color'),'') IS NULL
    OR length(p.structured_data->>'interior_color')>500
    OR btrim(p.structured_data->>'interior_color') ~* '^(unknown|n/a|unspecified)$'
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
    OR NEW.source_identifier IS DISTINCT FROM 'retained_listing_interior_color_v1:'||p.id::text
    OR NEW.raw_source_ref IS DISTINCT FROM 'vehicle_observations:'||p.id::text
    OR NEW.confidence_score IS NULL OR NEW.confidence_score<0 OR NEW.confidence_score>0.6
    OR NEW.structured_data->'interior_color' IS DISTINCT FROM p.structured_data->'interior_color'
    OR NEW.structured_data->>'source_observation_id' IS DISTINCT FROM p.id::text
    OR NEW.structured_data->>'claim_role' IS DISTINCT FROM 'listing_claim'
    OR NEW.structured_data->>'observed_at_basis' IS DISTINCT FROM 'source_testimony_recorded_at'
    OR NEW.structured_data->>'source_field' IS DISTINCT FROM 'interior_color'
    OR NEW.structured_data->>'property_key' IS DISTINCT FROM 'interior_color'
    OR NEW.structured_data->>'projection_version' IS DISTINCT FROM 'retained_listing_interior_color_v1'
    OR NEW.structured_data->>'analysis_kind' IS DISTINCT FROM 'retained_listing_property_projection'
    OR (NEW.structured_data->>'source_recorded_at')::timestamptz IS DISTINCT FROM p.ingested_at
    OR (NEW.structured_data->>'source_observed_at')::timestamptz IS DISTINCT FROM p.observed_at
    OR NEW.structured_data->'source_confidence_score' IS DISTINCT FROM to_jsonb(p.confidence_score)
    OR NEW.structured_data->>'source_extraction_method' IS DISTINCT FROM p.extraction_method
    OR NOT EXISTS (SELECT 1 FROM public.observation_properties r WHERE r.id=NEW.property_id
      AND r.property_key='interior_color' AND r.namespace='core' AND r.deprecated_at IS NULL
      AND 'specification'=ANY(r.applies_to_kinds)) THEN
    RAISE EXCEPTION 'retained property must match exact source tuple' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END
$fn$;
COMMENT ON FUNCTION public.validate_retained_listing_property_source() IS
'Insert admission under current parent lock: exact same-vehicle/source/value/recording-clock interior_color projection only. Enforces source tuple immutability while retaining sanctioned supersession/processing metadata. No testimony rewriting, new vocabulary, historical verification or public grants.';
REVOKE ALL ON FUNCTION public.validate_retained_listing_property_source() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER trg_retained_listing_property_source_insert BEFORE INSERT ON public.vehicle_observations
FOR EACH ROW WHEN (NEW.source_observation_id IS NOT NULL OR NEW.extraction_method='retained_listing_property_projection_v1')
EXECUTE FUNCTION public.validate_retained_listing_property_source();
CREATE TRIGGER trg_retained_listing_property_source_update BEFORE UPDATE ON public.vehicle_observations
FOR EACH ROW WHEN (OLD.source_observation_id IS NOT NULL OR NEW.source_observation_id IS NOT NULL)
EXECUTE FUNCTION public.validate_retained_listing_property_source();
INSERT INTO public.pipeline_registry(table_name,column_name,owned_by,description,do_not_write_directly,write_via)
VALUES ('vehicle_observations','source_observation_id','ingest-observation',
'One retained listing observation to one property projection; exact current parent tuple enforced at insert. Consumer vehicle_canonical/get_field_provenance; no publication or factory/current verification.',true,'ingest-observation');

-- Requalify the typed parent in both existing consumers. Preserve reader SQL,
-- signature, ACL, security mode and unrelated cached-image qualification.
DO $reader$
DECLARE reader text; view_sql text; qualification text := $gate$
 AND (o.source_observation_id IS NULL OR EXISTS (
   SELECT 1 FROM public.vehicle_observations rp
   JOIN public.observation_sources rs ON rs.id=rp.source_id AND rs.slug='bat'
   JOIN public.vehicles rv ON rv.id=rp.vehicle_id AND rv.is_public IS TRUE
     AND rv.deleted_at IS NULL AND rv.listing_kind IS DISTINCT FROM 'non_vehicle_item'
   JOIN public.observation_properties rk ON rk.id=o.property_id AND rk.property_key='interior_color'
     AND rk.namespace='core' AND rk.deprecated_at IS NULL
   WHERE rp.id=o.source_observation_id AND rp.id<>o.id AND rp.vehicle_id=o.vehicle_id
     AND rp.source_id=o.source_id AND rp.source_url=o.source_url AND rp.kind::text='listing'
     AND rp.is_superseded IS FALSE AND rp.property_id IS NULL
     AND rp.subject_type='vehicle' AND rp.subject_id IS NULL AND rp.extraction_method='html_match'
     AND rp.source_url ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$'
     AND rp.confidence_score BETWEEN 0.6 AND 1 AND isfinite(rp.ingested_at)
     AND o.kind::text='specification' AND o.extraction_method='retained_listing_property_projection_v1'
     AND o.structured_data->>'source_observation_id'=rp.id::text
     AND o.structured_data->'interior_color'=rp.structured_data->'interior_color'
     AND o.structured_data->>'claim_role'='listing_claim'
     AND o.structured_data->>'observed_at_basis'='source_testimony_recorded_at'
     AND o.observed_at=rp.ingested_at AND o.confidence_score BETWEEN 0 AND 0.6
 ))
$gate$;
BEGIN
 reader := pg_catalog.pg_get_functiondef('public.get_field_provenance(uuid,text)'::regprocedure);
 view_sql := pg_catalog.pg_get_viewdef('public.vehicle_canonical'::regclass,true);
 IF encode(sha256(convert_to(reader,'UTF8')),'base64')<>'9hpGBBoweVohVg//WGppupkI68yQcmDuT9UYVvpEvjQ='
   OR encode(sha256(convert_to(view_sql,'UTF8')),'base64')<>'QeiADjjDr+lfTGcH2WZdm6R+bCYSPuFfEoEpwhfZzxQ='
   OR cardinality(string_to_array(reader,'and o.structured_data ? p_field'))<>2
   OR cardinality(string_to_array(view_sql,'WHERE o.is_superseded = false'))<>2 THEN
   RAISE EXCEPTION 'retained property consumer contract changed; refusing replacement' USING ERRCODE='55000';
 END IF;
 EXECUTE replace(reader,'and o.structured_data ? p_field','and o.structured_data ? p_field'||qualification);
 EXECUTE 'CREATE OR REPLACE VIEW public.vehicle_canonical AS '||
   replace(view_sql,'WHERE o.is_superseded = false','WHERE o.is_superseded = false'||qualification);
END
$reader$;
COMMIT;
