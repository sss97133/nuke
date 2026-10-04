-- One nullable source-episode ancestry edge under the canonical intake.
-- No episode-v2 admission path.
-- Preserve legacy/v1/generic NULLs; no backfill, index, validation or access change.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.vehicle_observations ADD COLUMN source_vehicle_event_id uuid;
ALTER TABLE public.vehicle_observations ADD CONSTRAINT vehicle_observations_source_vehicle_event_id_fkey
  FOREIGN KEY (source_vehicle_event_id) REFERENCES public.vehicle_events(id) ON DELETE RESTRICT NOT VALID;
COMMENT ON COLUMN public.vehicle_observations.source_vehicle_event_id IS
'Nullable typed ancestry to one native vehicle_events source/listing episode, not latest vehicle price, paid-transfer truth, ownership identity or an investment ledger. Legacy/unrelated observations remain NULL. Existing ingest-observation owns the relation; only the canonical verified optional protected-v1 path may assign it; generic caller input is ignored and episode_preview_v2 is never admissible. A prospective non-NULL insert must retain the same exact public real parent, canonical source and protected source_snapshot_id under the existing custody guard, with producer-pinned current native/capture headers. Native currency/fee units and historical row availability remain unknown; captured sale day is a civil date, not an exact instant. Admission-time row locks do not freeze later mutable parent/source/event/capture state; consumers must requalify exact custody. Forward NOT VALID FK enforces new references/deletion preservation without historical validation/backfill or an observation-side index.';
INSERT INTO public.pipeline_registry(table_name,column_name,owned_by,description,do_not_write_directly,write_via)
VALUES ('vehicle_observations','source_vehicle_event_id','ingest-observation',
  'Nullable source episode ancestry under the canonical intake and existing source guard. Only the verified optional protected-v1 path may assign it; generic caller input is ignored, episode preview stays inadmissible and the schema grants no historical admission. Immutable typed tuples must be independently requalified by readers after mutable source changes.',true,'ingest-observation')
ON CONFLICT (table_name,column_name) DO NOTHING;

CREATE OR REPLACE FUNCTION public.validate_comment_observation_source()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET timezone = 'UTC'
AS $fn$
DECLARE
  c public.auction_comments%ROWTYPE;
  e public.vehicle_events%ROWTYPE;
  expected_e public.vehicle_events%ROWTYPE;
  s public.listing_page_snapshots%ROWTYPE;
  expected_s public.listing_page_snapshots%ROWTYPE;
  src public.observation_sources%ROWTYPE;
  r jsonb := NEW.structured_data->'source_sale_receipt';
  ec jsonb := NEW.extraction_metadata->'source_episode_context';
  sc jsonb := NEW.extraction_metadata->'source_snapshot_context';
  clock_key text;
  event_key text;
  listing_key text;
  capture_key text;
  receipt_key text;
  source_day date;
  parsed_at timestamptz;
  source_known_at timestamptz;
  amount numeric;
BEGIN
  -- A preview is not testimony, with or without typed keys or a forged badge.
  IF NEW.extraction_method = 'protected_archived_sale_episode_preview_v2'
    OR r->>'method' = 'protected_archived_sale_episode_preview_v2' THEN
    RAISE EXCEPTION 'episode preview cannot be admitted' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' THEN
    IF OLD.source_vehicle_event_id IS NULL AND NEW.source_vehicle_event_id IS NOT NULL THEN
      RAISE EXCEPTION 'existing testimony cannot acquire episode ancestry by update' USING ERRCODE='23514';
    END IF;
    IF OLD.source_vehicle_event_id IS NOT NULL THEN
      IF ROW(NEW.id,NEW.vehicle_id,NEW.source_vehicle_event_id,NEW.source_snapshot_id,NEW.source_comment_id,
        NEW.source_id,NEW.source_identifier,NEW.source_url,NEW.kind,NEW.observed_at,NEW.ingested_at,
        NEW.content_text,NEW.content_hash,NEW.raw_source_ref,NEW.structured_data,NEW.extraction_metadata,NEW.extraction_method,
        NEW.extractor_id,NEW.subject_type,NEW.subject_id,NEW.confidence_score)
        IS DISTINCT FROM
        ROW(OLD.id,OLD.vehicle_id,OLD.source_vehicle_event_id,OLD.source_snapshot_id,OLD.source_comment_id,
        OLD.source_id,OLD.source_identifier,OLD.source_url,OLD.kind,OLD.observed_at,OLD.ingested_at,
        OLD.content_text,OLD.content_hash,OLD.raw_source_ref,OLD.structured_data,OLD.extraction_metadata,OLD.extraction_method,
        OLD.extractor_id,OLD.subject_type,OLD.subject_id,OLD.confidence_score) THEN
        RAISE EXCEPTION 'typed episode testimony is immutable; supersede instead' USING ERRCODE='23514';
      END IF;
      -- Operating supersession does not require a mutable source to still agree.
      RETURN NEW;
    END IF;
  END IF;
  IF NEW.source_vehicle_event_id IS NOT NULL THEN
    -- Database service role is authorization; a producer/header badge is not.
    IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user <> 'service_role' THEN
      RAISE EXCEPTION 'typed episode ancestry requires service role' USING ERRCODE='42501';
    END IF;
    IF NEW.vehicle_id IS NULL OR NEW.source_id IS NULL OR NEW.source_snapshot_id IS NULL
      OR NEW.source_comment_id IS NOT NULL OR NEW.kind::text IS DISTINCT FROM 'sale_result'
      OR NEW.extraction_method IS DISTINCT FROM 'protected_archived_sale_observation_v1'
      OR r->>'method' IS DISTINCT FROM 'protected_archived_sale_observation_v1'
      OR NEW.extractor_id IS NOT NULL OR NEW.subject_type IS DISTINCT FROM 'vehicle' OR NEW.subject_id IS NOT NULL
      OR NEW.content_hash IS NULL OR NEW.content_hash !~ '^[0-9a-f]{64}$'
      OR NEW.ingested_at IS DISTINCT FROM transaction_timestamp() THEN
      RAISE EXCEPTION 'invalid typed protected sale shape or recording clock' USING ERRCODE='23514';
    END IF;
    -- Same lock order for every typed claim. NOWAIT refuses mutation in progress;
    -- acquired SHARE locks protect non-key fields through the admission commit.
    PERFORM 1 FROM public.vehicles v WHERE v.id=NEW.vehicle_id AND v.is_public IS TRUE
      AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item' FOR SHARE NOWAIT;
    IF NOT FOUND THEN RAISE EXCEPTION 'typed sale parent is not public real active vehicle' USING ERRCODE='23514'; END IF;
    SELECT * INTO src FROM public.observation_sources WHERE id=NEW.source_id FOR SHARE NOWAIT;
    IF NOT FOUND OR src.slug IS DISTINCT FROM 'bat' OR ('sale_result'::public.observation_kind=ANY(src.supported_observations)) IS NOT TRUE THEN
      RAISE EXCEPTION 'canonical sale source unsupported' USING ERRCODE='23514';
    END IF;
    SELECT * INTO e FROM public.vehicle_events WHERE id=NEW.source_vehicle_event_id FOR SHARE NOWAIT;
    IF NOT FOUND OR e.vehicle_id IS DISTINCT FROM NEW.vehicle_id OR e.source_platform IS DISTINCT FROM 'bat' THEN
      RAISE EXCEPTION 'episode parent/source relation disagrees' USING ERRCODE='23514';
    END IF;
    SELECT * INTO s FROM public.listing_page_snapshots WHERE id=NEW.source_snapshot_id FOR SHARE NOWAIT;
    IF NOT FOUND OR s.platform IS DISTINCT FROM 'bat' OR s.success IS NOT TRUE OR s.http_status IS DISTINCT FROM 200
      OR NOT pg_input_is_valid(s.metadata->>'vehicle_id','uuid')
      OR (s.metadata->>'vehicle_id')::uuid IS DISTINCT FROM NEW.vehicle_id
      OR s.metadata->'vehicle_matched' IS DISTINCT FROM 'true'::jsonb THEN
      RAISE EXCEPTION 'protected capture parent/source relation disagrees' USING ERRCODE='23514';
    END IF;
    IF jsonb_typeof(ec) IS DISTINCT FROM 'object' OR NOT ec ?& ARRAY['id','vehicle_id','source_platform','source_url',
      'source_listing_id','event_type','event_status','final_price','sold_at','ended_at','created_at','updated_at','extracted_at']
      OR jsonb_typeof(sc) IS DISTINCT FROM 'object' OR NOT sc ?& ARRAY['id','platform','listing_url','success','http_status',
      'html_sha256','fetched_at','created_at','html_storage_path','inline_body_present','metadata'] THEN
      RAISE EXCEPTION 'pinned episode and capture headers required' USING ERRCODE='23514';
    END IF;
    FOREACH clock_key IN ARRAY ARRAY['sold_at','ended_at','created_at','updated_at','extracted_at'] LOOP
      IF ec->clock_key IS DISTINCT FROM 'null'::jsonb AND
        (jsonb_typeof(ec->clock_key) IS DISTINCT FROM 'string'
          OR ec->>clock_key !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}.*(Z|[+-][0-9]{2}(:?[0-9]{2})?)$') THEN
        RAISE EXCEPTION 'native clock requires explicit zone or unknown' USING ERRCODE='23514';
      END IF;
    END LOOP;
    expected_e := jsonb_populate_record(NULL::public.vehicle_events,ec);
    IF ROW(e.id,e.vehicle_id,e.source_platform,e.source_url,e.source_listing_id,e.event_type,e.event_status,
      e.final_price,e.sold_at,e.ended_at,e.created_at,e.updated_at,e.extracted_at)
      IS DISTINCT FROM ROW(expected_e.id,expected_e.vehicle_id,expected_e.source_platform,expected_e.source_url,
      expected_e.source_listing_id,expected_e.event_type,expected_e.event_status,expected_e.final_price,
      expected_e.sold_at,expected_e.ended_at,expected_e.created_at,expected_e.updated_at,expected_e.extracted_at) THEN
      RAISE EXCEPTION 'native episode changed after producer verification' USING ERRCODE='23514';
    END IF;
    FOREACH clock_key IN ARRAY ARRAY['fetched_at','created_at'] LOOP
      IF jsonb_typeof(sc->clock_key) IS DISTINCT FROM 'string'
        OR sc->>clock_key !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}.*(Z|[+-][0-9]{2}(:?[0-9]{2})?)$' THEN
        RAISE EXCEPTION 'capture header clock requires explicit zone' USING ERRCODE='23514';
      END IF;
    END LOOP;
    expected_s := jsonb_populate_record(NULL::public.listing_page_snapshots,sc);
    IF ROW(s.id,s.platform,s.listing_url,s.success,s.http_status,s.html_sha256,s.fetched_at,s.created_at,s.html_storage_path)
      IS DISTINCT FROM ROW(expected_s.id,expected_s.platform,expected_s.listing_url,expected_s.success,
      expected_s.http_status,expected_s.html_sha256,expected_s.fetched_at,expected_s.created_at,expected_s.html_storage_path)
      OR sc->'inline_body_present' IS DISTINCT FROM to_jsonb(s.html IS NOT NULL)
      OR s.metadata->'vehicle_id' IS DISTINCT FROM expected_s.metadata->'vehicle_id'
      OR s.metadata->'vehicle_matched' IS DISTINCT FROM expected_s.metadata->'vehicle_matched'
      OR s.metadata->'parsed_at' IS DISTINCT FROM expected_s.metadata->'parsed_at' THEN
      RAISE EXCEPTION 'protected capture changed after producer verification' USING ERRCODE='23514';
    END IF;
    -- Only supported BaT listing aliases; opaque IDs remain unknown locators.
    IF e.source_url IS NULL OR s.listing_url IS NULL OR r->>'source_url' IS NULL
      OR e.source_url !~* '^https?://(www\.)?bringatrailer\.com/listing/[a-z0-9-]+/?([?#].*)?$'
      OR s.listing_url !~* '^https?://(www\.)?bringatrailer\.com/listing/[a-z0-9-]+/?([?#].*)?$'
      OR r->>'source_url' !~* '^https?://(www\.)?bringatrailer\.com/listing/[a-z0-9-]+/?([?#].*)?$' THEN
      RAISE EXCEPTION 'supported exact listing source required' USING ERRCODE='23514';
    END IF;
    event_key := lower(regexp_replace(regexp_replace(regexp_replace(e.source_url,'^https?://(www\.)?','','i'),'[?#].*$',''),'/+$',''));
    capture_key := lower(regexp_replace(regexp_replace(regexp_replace(s.listing_url,'^https?://(www\.)?','','i'),'[?#].*$',''),'/+$',''));
    receipt_key := lower(regexp_replace(regexp_replace(regexp_replace(r->>'source_url','^https?://(www\.)?','','i'),'[?#].*$',''),'/+$',''));
    IF e.source_listing_id ~* '^(https?://)?(www\.)?bringatrailer\.com/listing/[a-z0-9-]+/?([?#].*)?$' THEN
      listing_key := lower(regexp_replace(regexp_replace(regexp_replace(e.source_listing_id,'^(https?://)?(www\.)?','','i'),'[?#].*$',''),'/+$',''));
    END IF;
    IF event_key IS NULL OR event_key IS DISTINCT FROM capture_key OR event_key IS DISTINCT FROM receipt_key
      OR (listing_key IS NOT NULL AND listing_key IS DISTINCT FROM event_key)
      OR NEW.source_url IS DISTINCT FROM r->>'source_url'
      OR r->>'vehicle_id' IS DISTINCT FROM NEW.vehicle_id::text OR r->>'snapshot_id' IS DISTINCT FROM s.id::text
      OR NEW.raw_source_ref IS DISTINCT FROM 'listing_page_snapshots:'||s.id::text
      OR r->>'parser' IS DISTINCT FROM 'batParser:1.0.0:strict_sale_tuple_v1'
      OR NEW.source_identifier IS DISTINCT FROM 'archived-sale:'||s.id::text||':'||(r->>'parser') THEN
      RAISE EXCEPTION 'source episode/capture/replay tuple disagrees' USING ERRCODE='23514';
    END IF;
    IF jsonb_typeof(r->'amount') IS DISTINCT FROM 'number' OR NOT pg_input_is_valid(r->>'amount','numeric')
      OR r->>'event_day' IS NULL OR r->>'event_day' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR NOT pg_input_is_valid(r->>'event_day','date')
      OR r->>'outcome' IS DISTINCT FROM 'sold' OR r->>'event_grain' IS DISTINCT FROM 'date'
      OR r->>'currency' NOT IN ('USD','EUR','GBP') OR r->>'currency' IS NULL
      OR r->>'price_basis' IS DISTINCT FROM 'published_bid_excluding_fees'
      OR r->>'price_basis_rule' IS DISTINCT FROM 'bat_published_result_fee_separate_v1'
      OR r->>'price_basis_source' IS DISTINCT FROM 'https://bringatrailer.com/policies/'
      OR r->>'verification_basis' IS DISTINCT FROM 'producer_attested_archived_hash_parser' THEN
      RAISE EXCEPTION 'captured sale units/day/source rule unsupported' USING ERRCODE='23514';
    END IF;
    amount := (r->>'amount')::numeric; source_day := (r->>'event_day')::date;
    IF amount<=0 OR amount::text IN ('NaN','Infinity','-Infinity') OR NOT isfinite(source_day)
      OR NEW.observed_at IS DISTINCT FROM source_day::timestamp AT TIME ZONE 'UTC'
      OR lower(btrim(e.event_status)) IN ('no_sale','unsold','reserve_not_met','cancelled','withdrawn')
      OR (e.final_price IS NOT NULL AND e.final_price IS DISTINCT FROM amount)
      OR (coalesce(e.sold_at,e.ended_at) IS NOT NULL AND
        (coalesce(e.sold_at,e.ended_at) AT TIME ZONE 'UTC')::time='00:00:00'
        AND (coalesce(e.sold_at,e.ended_at) AT TIME ZONE 'UTC')::date IS DISTINCT FROM source_day) THEN
      RAISE EXCEPTION 'captured sale conflicts with native recorded state/day' USING ERRCODE='23514';
    END IF;
    FOREACH clock_key IN ARRAY ARRAY['captured_at','source_ingested_at','original_parsed_at','source_known_at'] LOOP
      IF r->>clock_key IS NULL OR r->>clock_key !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}.*(Z|[+-][0-9]{2}(:?[0-9]{2})?)$'
        OR NOT pg_input_is_valid(r->>clock_key,'timestamptz') THEN
        RAISE EXCEPTION 'captured source clock missing or unzoned' USING ERRCODE='23514';
      END IF;
    END LOOP;
    IF s.metadata->>'parsed_at' IS NULL OR s.metadata->>'parsed_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}.*(Z|[+-][0-9]{2}(:?[0-9]{2})?)$'
      OR NOT pg_input_is_valid(s.metadata->>'parsed_at','timestamptz') THEN
      RAISE EXCEPTION 'protected parse clock unestablished' USING ERRCODE='23514';
    END IF;
    parsed_at := (s.metadata->>'parsed_at')::timestamptz;
    source_known_at := greatest(s.fetched_at,s.created_at,parsed_at);
    IF NOT isfinite(s.fetched_at) OR NOT isfinite(s.created_at) OR NOT isfinite(parsed_at)
      OR s.fetched_at IS DISTINCT FROM (r->>'captured_at')::timestamptz
      OR s.created_at IS DISTINCT FROM (r->>'source_ingested_at')::timestamptz
      OR parsed_at IS DISTINCT FROM (r->>'original_parsed_at')::timestamptz
      OR source_known_at IS DISTINCT FROM (r->>'source_known_at')::timestamptz
      OR source_known_at>NEW.ingested_at THEN
      RAISE EXCEPTION 'capture clocks disagree or exceed DB recording time' USING ERRCODE='23514';
    END IF;
    IF s.html_sha256 IS NULL OR s.html_sha256 !~ '^[0-9a-f]{64}$'
      OR r->>'source_sha256' IS DISTINCT FROM s.html_sha256
      OR jsonb_typeof(r->'byte_length') IS DISTINCT FROM 'number'
      OR NOT pg_input_is_valid(r->>'byte_length','integer')
      OR (r->>'byte_length')::integer NOT BETWEEN 1 AND 2097152 THEN
      RAISE EXCEPTION 'protected body/hash size unestablished' USING ERRCODE='23514';
    END IF;
    IF s.html IS NOT NULL THEN
      IF r->>'body_source' IS DISTINCT FROM 'inline'
        OR octet_length(convert_to(s.html,'UTF8')) IS DISTINCT FROM (r->>'byte_length')::integer
        OR encode(sha256(convert_to(s.html,'UTF8')),'hex') IS DISTINCT FROM s.html_sha256 THEN
        RAISE EXCEPTION 'available inline source changed or hash disagrees' USING ERRCODE='23514';
      END IF;
    ELSIF r->>'body_source' IS DISTINCT FROM 'protected_storage' OR nullif(s.html_storage_path,'') IS NULL THEN
      RAISE EXCEPTION 'protected archived source pointer unavailable' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  -- Preserve the existing comment source contract verbatim.
  IF NEW.source_comment_id IS NULL THEN
    IF TG_OP = 'UPDATE' AND OLD.source_comment_id IS NOT NULL THEN
      RAISE EXCEPTION 'a sourced comment claim cannot lose its source link' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO c FROM public.auction_comments WHERE id = NEW.source_comment_id FOR SHARE;
  IF NOT FOUND OR c.vehicle_id IS NULL OR NEW.vehicle_id IS DISTINCT FROM c.vehicle_id
    OR c.posted_at IS NULL OR c.bid_amount IS NOT NULL OR c.comment_type = 'bid'
    OR nullif(btrim(c.comment_text), '') IS NULL
    OR NOT EXISTS (SELECT 1 FROM public.auction_events ae WHERE ae.id = c.auction_event_id AND ae.vehicle_id = c.vehicle_id)
    OR NOT EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = c.vehicle_id AND v.is_public IS TRUE) THEN
    RAISE EXCEPTION 'invalid public comment source relation' USING ERRCODE = '23514';
  END IF;
  IF NEW.kind::text IS DISTINCT FROM 'comment' OR NEW.observed_at IS DISTINCT FROM c.posted_at
    OR NEW.confidence_score IS NULL OR NEW.confidence_score < 0 OR NEW.confidence_score > 0.6
    OR NEW.structured_data->'is_inferred' IS DISTINCT FROM 'true'::jsonb
    OR nullif(btrim(NEW.content_text), '') IS NULL OR strpos(c.comment_text, NEW.content_text) = 0 THEN
    RAISE EXCEPTION 'comment claim must retain exact source quote, event clock and inferred qualification' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END
$fn$;
COMMENT ON FUNCTION public.validate_comment_observation_source() IS
'Existing canonical source guard: preserves comment quote/event/inference checks; reserves/refuses episode preview. Non-NULL prospective native sale ancestry requires database service role, existing protected-v1 shape, same parent/source/episode/snapshot, pinned headers and immutable tuple. SHARE NOWAIT locks refuse in-flight mutation and protect admission until transaction end; later mutable source changes are not prohibited and readers must requalify custody. Available inline SHA is independently checked; offloaded bytes/parser are service-producer attestation, not a database parse or object-store lock. Recording now() is transaction start, not commit/public availability. No episode-v2 writer is installed.';
-- CREATE OR REPLACE retains existing postgres ownership/service-only EXECUTE ACL.
DROP TRIGGER trg_validate_comment_observation_source_insert ON public.vehicle_observations;
CREATE TRIGGER trg_validate_comment_observation_source_insert BEFORE INSERT ON public.vehicle_observations FOR EACH ROW
WHEN (NEW.source_comment_id IS NOT NULL OR NEW.source_vehicle_event_id IS NOT NULL
  OR NEW.extraction_method='protected_archived_sale_episode_preview_v2'
  OR NEW.structured_data->'source_sale_receipt'->>'method'='protected_archived_sale_episode_preview_v2')
EXECUTE FUNCTION public.validate_comment_observation_source();
DROP TRIGGER trg_validate_comment_observation_source_update ON public.vehicle_observations;
CREATE TRIGGER trg_validate_comment_observation_source_update
BEFORE UPDATE OF source_comment_id,vehicle_id,kind,content_text,observed_at,confidence_score,structured_data,
  source_vehicle_event_id,source_snapshot_id,source_id,source_identifier,source_url,content_hash,raw_source_ref,
  extraction_method,extractor_id,extraction_metadata,ingested_at,id,subject_type,subject_id
ON public.vehicle_observations FOR EACH ROW
WHEN (OLD.source_comment_id IS NOT NULL OR NEW.source_comment_id IS NOT NULL
  OR OLD.source_vehicle_event_id IS NOT NULL OR NEW.source_vehicle_event_id IS NOT NULL
  OR NEW.extraction_method='protected_archived_sale_episode_preview_v2'
  OR NEW.structured_data->'source_sale_receipt'->>'method'='protected_archived_sale_episode_preview_v2')
EXECUTE FUNCTION public.validate_comment_observation_source();
COMMIT;
