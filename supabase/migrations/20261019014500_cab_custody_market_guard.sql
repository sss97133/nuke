-- Listing custody cites a lot, not an asserted sale. Keep legacy media/sale
-- validation intact and independently requalify the exact protected receipt.
SET lock_timeout = '2s';
SET statement_timeout = '10s';
DO $patch$
DECLARE definition text; anchor text := E'BEGIN\n  IF NEW.citation_publication_id IS NOT NULL THEN';
  branch text := $branch$
BEGIN
  IF NEW.extraction_method = 'protected_cab_listing_capture_v1'
    OR (TG_OP = 'UPDATE' AND OLD.extraction_method = 'protected_cab_listing_capture_v1') THEN
    IF TG_OP = 'UPDATE' AND OLD.extraction_method = 'protected_cab_listing_capture_v1' THEN
      IF (to_jsonb(NEW)-ARRAY['is_superseded','superseded_by','superseded_at','lineage_chain'])
        IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['is_superseded','superseded_by','superseded_at','lineage_chain']) THEN
        RAISE EXCEPTION 'listing capture receipt is immutable; supersede instead' USING ERRCODE='23514';
      END IF;
      RETURN NEW;
    END IF;
    IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user <> 'service_role' THEN
      RAISE EXCEPTION 'listing capture admission requires service role' USING ERRCODE='42501';
    END IF;
    DECLARE q jsonb; expected public.vehicle_observations%ROWTYPE; expected_fields jsonb;
    BEGIN
      q := public.qualify_cab_listing_capture(NEW.source_observation_id,NEW.source_snapshot_id,NEW.auction_event_id);
      IF q->'ok' IS DISTINCT FROM 'true'::jsonb THEN
        RAISE EXCEPTION 'listing capture custody refused: %',q->>'reason' USING ERRCODE='23514';
      END IF;
      expected := jsonb_populate_record(NULL::public.vehicle_observations,q->'input');
      SELECT jsonb_object_agg(k,to_jsonb(expected)->k) INTO expected_fields
        FROM jsonb_object_keys((q->'input')-'source_slug'-'defer_analysis') AS keys(k);
      IF NOT (to_jsonb(NEW) @> expected_fields)
        OR NEW.citation_publication_id IS NOT NULL OR NEW.media_start_ms IS NOT NULL
        OR NEW.media_end_ms IS NOT NULL OR NEW.media_relation IS NOT NULL OR NEW.media_span_semantics IS NOT NULL THEN
        RAISE EXCEPTION 'listing capture is not the qualified narrative-only receipt' USING ERRCODE='23514';
      END IF;
    END;
    -- Both source-custody guards still run, including their row locks.
    RETURN NEW;
  END IF;
  IF NEW.citation_publication_id IS NOT NULL THEN
$branch$;
BEGIN
  SELECT pg_get_functiondef('public.check_observation_media_links()'::regprocedure) INTO definition;
  IF (length(definition)-length(replace(definition,anchor,'')))/length(anchor) <> 1 THEN
    RAISE EXCEPTION 'market link guard drift: expected one citation branch';
  END IF;
  EXECUTE replace(definition,anchor,branch);
END $patch$;
