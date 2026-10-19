-- Draft: explicit source-selector admission only; no replay, schedule, public grant or scalar promotion.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';

CREATE OR REPLACE FUNCTION public.qualify_cab_listing_capture(
  p_source uuid, p_snapshot uuid, p_lot uuid, p_result uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' SET timezone='UTC' AS $fn$
DECLARE
  o public.vehicle_observations%ROWTYPE;
  s public.listing_page_snapshots%ROWTYPE;
  e public.auction_events%ROWTYPE;
  src public.observation_sources%ROWTYPE;
  x public.vehicle_observations%ROWTYPE;
  raw_text text; body jsonb; listing jsonb; sections jsonb; narrative text;
  source_key text; receipt jsonb; wanted jsonb; known_at timestamptz;
BEGIN
  -- Every lookup is a caller-selected primary key; this is not discovery or a fleet census.
  SELECT * INTO o FROM public.vehicle_observations WHERE id=p_source;
  IF NOT FOUND OR o.kind::text IS DISTINCT FROM 'listing' OR o.is_superseded IS DISTINCT FROM false
    OR o.vehicle_id IS NULL OR o.extraction_method IS DISTINCT FROM 'cab_v2_api'
    OR o.source_observation_id IS NOT NULL OR o.subject_type IS DISTINCT FROM 'vehicle' OR o.subject_id IS NOT NULL
    OR o.source_snapshot_id IS NOT NULL OR o.source_vehicle_event_id IS NOT NULL
    OR (o.auction_event_id IS NOT NULL AND o.auction_event_id IS DISTINCT FROM p_lot)
    OR public.observation_is_public(o.kind,o.structured_data) IS NOT TRUE THEN
    RETURN jsonb_build_object('ok',false,'reason','original_listing_ineligible');
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.vehicles v WHERE v.id=o.vehicle_id AND v.is_public IS TRUE
    AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item') THEN
    RETURN jsonb_build_object('ok',false,'reason','parent_not_public_real_vehicle');
  END IF;
  SELECT * INTO src FROM public.observation_sources WHERE id=o.source_id;
  IF NOT FOUND OR src.slug IS NULL OR src.slug NOT IN ('cars-and-bids','cars_and_bids')
    OR ('listing'::public.observation_kind=ANY(src.supported_observations)) IS NOT TRUE THEN
    RETURN jsonb_build_object('ok',false,'reason','source_not_supported');
  END IF;
  SELECT * INTO e FROM public.auction_events WHERE id=p_lot;
  IF NOT FOUND OR e.vehicle_id IS DISTINCT FROM o.vehicle_id OR e.source IS DISTINCT FROM 'cars_and_bids'
    OR e.source_listing_id IS NULL
    OR e.source_listing_id !~ '^[A-Za-z0-9]+$' THEN
    RETURN jsonb_build_object('ok',false,'reason','presentation_identity_mismatch');
  END IF;
  SELECT * INTO s FROM public.listing_page_snapshots WHERE id=p_snapshot;
  IF NOT FOUND OR s.platform IS DISTINCT FROM 'carsandbids' OR s.success IS NOT TRUE OR s.http_status IS DISTINCT FROM 200
    OR s.html IS NULL OR octet_length(convert_to(s.html,'UTF8')) NOT BETWEEN 1 AND 2097152
    OR s.html_sha256 IS NULL OR s.html_sha256 !~ '^[0-9a-f]{64}$'
    OR encode(sha256(convert_to(s.html,'UTF8')),'hex') IS DISTINCT FROM s.html_sha256 THEN
    RETURN jsonb_build_object('ok',false,'reason','inline_capture_unverified');
  END IF;
  -- Base62 auction IDs are case sensitive. URL slugs are presentation labels, not identity.
  source_key := substring(s.listing_url from '^https://carsandbids[.]com/auctions/([A-Za-z0-9]+)(?:/[^?#]*)?(?:[?#].*)?$');
  IF source_key IS DISTINCT FROM e.source_listing_id OR source_key IS DISTINCT FROM o.source_identifier
    OR substring(o.source_url from '^https://carsandbids[.]com/auctions/([A-Za-z0-9]+)(?:/[^?#]*)?(?:[?#].*)?$') IS DISTINCT FROM source_key
    OR substring(e.source_url from '^https://carsandbids[.]com/auctions/([A-Za-z0-9]+)(?:/[^?#]*)?(?:[?#].*)?$') IS DISTINCT FROM source_key
    OR s.metadata->>'auction_id' IS DISTINCT FROM source_key THEN
    RETURN jsonb_build_object('ok',false,'reason','source_listing_identity_mismatch');
  END IF;
  raw_text := substring(s.html from '^<!-- cab-v2-api-json:[A-Za-z0-9]+ class="bid-bar (?:ended|live)" -->\n<script id="cab-v2-json" type="application/json">(.*)</script>$');
  IF raw_text IS NULL OR NOT pg_input_is_valid(raw_text,'jsonb') THEN
    RETURN jsonb_build_object('ok',false,'reason','retained_api_envelope_invalid');
  END IF;
  body:=raw_text::jsonb; listing:=body#>'{detail,listing}'; sections:=listing->'sections';
  IF body#>>'{detail,id}' IS DISTINCT FROM source_key OR jsonb_typeof(listing) IS DISTINCT FROM 'object'
    OR jsonb_typeof(sections) IS DISTINCT FROM 'object' THEN
    RETURN jsonb_build_object('ok',false,'reason','retained_api_identity_mismatch');
  END IF;
  -- Reproduce only the collector's attributed narrative, not its specification inferences.
  SELECT string_agg(CASE WHEN label IS NULL THEN value ELSE '**'||label||':**'||E'\n'||value END,E'\n\n' ORDER BY n)
  INTO narrative FROM (VALUES
    (0,NULL::text,listing->>'sub_title'),(1,'Doug''s Take',sections->>'doug'),(2,'Highlights',sections->>'highlights'),
    (3,'Equipment',sections->>'equipment'),(4,'Modifications',sections->>'modifications'),(5,'Known Flaws',sections->>'known_flaws'),
    (6,'Recent Service History',sections->>'recent_service_history'),(7,'Other Items Included',sections->>'other_items'),
    (8,'Ownership History',sections->>'ownership_history'),(9,'Seller Notes',sections->>'seller_notes')) t(n,label,value)
  WHERE value IS NOT NULL AND value<>'';
  IF narrative IS NULL OR narrative IS DISTINCT FROM o.content_text THEN
    RETURN jsonb_build_object('ok',false,'reason','original_narrative_mismatch');
  END IF;
  IF o.observed_at IS NULL OR s.fetched_at IS NULL OR o.ingested_at IS NULL OR s.created_at IS NULL
    OR NOT isfinite(o.observed_at) OR NOT isfinite(o.ingested_at) OR NOT isfinite(s.fetched_at) OR NOT isfinite(s.created_at)
    OR o.observed_at IS DISTINCT FROM s.fetched_at OR o.ingested_at<s.fetched_at OR s.created_at<s.fetched_at
    OR greatest(o.ingested_at,s.created_at)>statement_timestamp()
    OR o.confidence_score IS NULL OR o.confidence_score NOT BETWEEN 0 AND 1 THEN
    RETURN jsonb_build_object('ok',false,'reason','source_clock_or_trust_unestablished');
  END IF;
  known_at:=greatest(o.ingested_at,s.created_at);
  receipt:=jsonb_build_object('method','protected_cab_listing_capture_v1','scope','attributed_listing_narrative_only',
    'source_observation_id',o.id,'snapshot_id',s.id,'auction_event_id',e.id,'source_listing_id',source_key,
    'vehicle_id',o.vehicle_id,'source_id',o.source_id,'source_sha256',s.html_sha256,
    'narrative_sha256',encode(sha256(convert_to(narrative,'UTF8')),'hex'),
    'captured_at',s.fetched_at,'capture_ingested_at',s.created_at,'original_ingested_at',o.ingested_at,
    'source_known_at',known_at,'binding_knowledge_basis','receipt_database_ingested_at_not_historical_native_identity',
    'independent_source',false,'physical_identity_verified',false,'specification_truth','not_assessed');
  -- The publisher supplies listing evidence; Nuke's guarded derivation records
  -- provenance, not a second listing or a new publisher-provided capability.
  wanted:=jsonb_build_object('vehicle_id',o.vehicle_id,'source_id',o.source_id,'kind','provenance',
    'source_snapshot_id',s.id,'auction_event_id',e.id,'source_observation_id',o.id,'source_comment_id',NULL,'property_id',NULL,
    'source_url',o.source_url,'source_identifier','cab-listing-custody:'||o.id||':'||s.id||':'||e.id,
    'observed_at',s.fetched_at,'content_text',NULL,'extraction_method','protected_cab_listing_capture_v1',
    'structured_data',jsonb_build_object('listing_capture_receipt',receipt),'extractor_id',NULL,
    'extraction_metadata',jsonb_build_object('scope','attributed_listing_narrative_only'),
    'raw_source_ref','listing_page_snapshots:'||s.id,'subject_type','vehicle','subject_id',NULL,
    'confidence_score',least(o.confidence_score,0.8),
    'content_hash',encode(sha256(convert_to('cab-listing-capture-v1|'||o.id||'|'||s.id||'|'||e.id||'|'||s.html_sha256,'UTF8')),'hex'));
  IF p_result IS NOT NULL THEN
    SELECT * INTO x FROM public.vehicle_observations WHERE id=p_result;
    IF NOT FOUND OR x.is_superseded IS DISTINCT FROM false OR x.ingested_at IS NULL OR NOT isfinite(x.ingested_at)
      OR x.ingested_at<known_at OR x.ingested_at>statement_timestamp() OR NOT (to_jsonb(x) @> wanted) THEN
      RETURN jsonb_build_object('ok',false,'reason','stored_receipt_changed_or_withdrawn');
    END IF;
  END IF;
  RETURN jsonb_build_object('ok',true,'input',wanted||jsonb_build_object('source_slug',src.slug,'defer_analysis',true),
    'source_known_at',known_at,'result_verified',p_result IS NOT NULL);
END $fn$;
REVOKE ALL ON FUNCTION public.qualify_cab_listing_capture(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.qualify_cab_listing_capture(uuid,uuid,uuid,uuid) TO service_role;
COMMENT ON FUNCTION public.qualify_cab_listing_capture(uuid,uuid,uuid,uuid) IS
'Canonical ingest-observation qualifier/current receipt reader for one explicit Cars & Bids original listing x retained inline API capture x canonical auction lot. Uses existing auction_event_id, not the replaceable native vehicle_events head, so sanctioned native-state correction is not obstructed. PK lookups, independent UTF8 SHA/narrative reconstruction and exact base62 identity/source/parent/clocks. Returns only provenance metadata, never source text, images, handles, claims or bytes. Optional result requalifies immutable internal provenance against current custody; withdrawal/source mutation withholds it. No inference, scalar promotion, history reconstruction, source enumeration or physical truth. No writes/offload fetch; original testimony preserved. Service only; no public grant or schedule.';

-- Extend the existing source guard, never bypass it. Assert exact anchors rather than silently replace drift.
DO $patch$
DECLARE definition text; anchor text:='  IF NEW.source_vehicle_event_id IS NOT NULL THEN'; branch text; update_branch text;
BEGIN
  definition:=pg_get_functiondef('public.validate_comment_observation_source()'::regprocedure);
  IF length(definition)-length(replace(definition,anchor,''))<>length(anchor) THEN
    RAISE EXCEPTION 'canonical source guard drift: expected one episode branch';
  END IF;
  branch:=$branch$
  IF NEW.extraction_method='protected_cab_listing_capture_v1' OR NEW.structured_data ? 'listing_capture_receipt' THEN
    IF TG_OP='UPDATE' THEN
      RAISE EXCEPTION 'listing capture receipt is immutable; supersede instead' USING ERRCODE='23514';
    END IF;
    IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN
      RAISE EXCEPTION 'listing capture admission requires service role' USING ERRCODE='42501';
    END IF;
    -- Consistent trunk-first lock order; NOWAIT refuses in-flight changes.
    PERFORM 1 FROM public.vehicles WHERE id=NEW.vehicle_id FOR SHARE NOWAIT;
    PERFORM 1 FROM public.observation_sources WHERE id=NEW.source_id FOR SHARE NOWAIT;
    PERFORM 1 FROM public.vehicle_observations WHERE id=NEW.source_observation_id FOR SHARE NOWAIT;
    PERFORM 1 FROM public.auction_events WHERE id=NEW.auction_event_id FOR SHARE NOWAIT;
    PERFORM 1 FROM public.listing_page_snapshots WHERE id=NEW.source_snapshot_id FOR SHARE NOWAIT;
    DECLARE q jsonb; expected public.vehicle_observations%ROWTYPE; expected_fields jsonb;
    BEGIN
      q:=public.qualify_cab_listing_capture(NEW.source_observation_id,NEW.source_snapshot_id,NEW.auction_event_id);
      IF q->'ok' IS DISTINCT FROM 'true'::jsonb THEN
        RAISE EXCEPTION 'listing capture custody refused: %',q->>'reason' USING ERRCODE='23514';
      END IF;
      -- Normalize typed timestamps under this guard's session timezone before
      -- comparing JSON: equivalent instants must not fail on offset formatting.
      expected:=jsonb_populate_record(NULL::public.vehicle_observations,q->'input');
      SELECT jsonb_object_agg(k,to_jsonb(expected)->k) INTO expected_fields
      FROM jsonb_object_keys((q->'input')-'source_slug'-'defer_analysis') AS keys(k);
      IF NOT (to_jsonb(NEW) @> expected_fields)
        OR NEW.source_comment_id IS NOT NULL OR NEW.source_vehicle_event_id IS NOT NULL OR NEW.ingested_at IS DISTINCT FROM transaction_timestamp()
        OR NEW.is_superseded IS DISTINCT FROM false THEN
        RAISE EXCEPTION 'listing capture input differs from independently qualified receipt' USING ERRCODE='23514';
      END IF;
    END;
    RETURN NEW;
  END IF;
$branch$;
  -- Protected C&B updates allow only the existing supersession bookkeeping, even after source withdrawal.
  update_branch:=$update$
  IF TG_OP='UPDATE' AND OLD.extraction_method='protected_cab_listing_capture_v1' THEN
    IF (to_jsonb(NEW)-ARRAY['is_superseded','superseded_by','superseded_at','lineage_chain'])
      IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['is_superseded','superseded_by','superseded_at','lineage_chain']) THEN
      RAISE EXCEPTION 'listing capture receipt is immutable; supersede instead' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  $update$;
  definition:=replace(definition,'  IF TG_OP=''UPDATE'' THEN',update_branch||'  IF TG_OP=''UPDATE'' THEN');
  EXECUTE replace(definition,anchor,branch||anchor);
  -- The existing retained-source owner also guards every source_observation_id.
  -- Add the same verified branch; preserve its property/report paths verbatim.
  definition:=pg_get_functiondef('public.validate_retained_listing_property_source()'::regprocedure);
  anchor:=E'BEGIN\n';
  IF length(definition)-length(replace(definition,anchor,''))<>length(anchor) THEN
    RAISE EXCEPTION 'retained source guard drift: expected one outer block';
  END IF;
  EXECUTE replace(definition,anchor,anchor||update_branch||branch);
END $patch$;

-- Include incomplete/forged receipts, not just rows already carrying an episode key.
DROP TRIGGER trg_validate_comment_observation_source_insert ON public.vehicle_observations;
CREATE TRIGGER trg_validate_comment_observation_source_insert BEFORE INSERT ON public.vehicle_observations FOR EACH ROW
WHEN (NEW.source_comment_id IS NOT NULL OR NEW.source_vehicle_event_id IS NOT NULL
  OR NEW.extraction_method IN ('protected_archived_sale_episode_preview_v2','protected_cab_listing_capture_v1')
  OR NEW.structured_data ? 'listing_capture_receipt'
  OR NEW.structured_data->'source_sale_receipt'->>'method'='protected_archived_sale_episode_preview_v2')
EXECUTE FUNCTION public.validate_comment_observation_source();
DROP TRIGGER trg_validate_comment_observation_source_update ON public.vehicle_observations;
CREATE TRIGGER trg_validate_comment_observation_source_update
BEFORE UPDATE OF source_comment_id,vehicle_id,kind,content_text,observed_at,confidence_score,structured_data,
  source_vehicle_event_id,auction_event_id,source_snapshot_id,source_observation_id,source_id,source_identifier,source_url,content_hash,raw_source_ref,
  extraction_method,extractor_id,extraction_metadata,ingested_at,id,subject_type,subject_id,is_superseded,superseded_by
ON public.vehicle_observations FOR EACH ROW
WHEN (OLD.source_comment_id IS NOT NULL OR NEW.source_comment_id IS NOT NULL
  OR OLD.source_vehicle_event_id IS NOT NULL OR NEW.source_vehicle_event_id IS NOT NULL
  OR OLD.extraction_method='protected_cab_listing_capture_v1'
  OR NEW.extraction_method IN ('protected_archived_sale_episode_preview_v2','protected_cab_listing_capture_v1')
  OR NEW.structured_data ? 'listing_capture_receipt'
  OR NEW.structured_data->'source_sale_receipt'->>'method'='protected_archived_sale_episode_preview_v2')
EXECUTE FUNCTION public.validate_comment_observation_source();
COMMIT;
