-- Exact existing market/media guard from 20261002050326; disposable harness only.
CREATE OR REPLACE FUNCTION public.check_observation_media_links() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE carrier public.publications%ROWTYPE; presentation public.auction_events%ROWTYPE;
  context jsonb; source_video text; source_sale text; event_listing text; event_sale_name text; source_sale_name text;
BEGIN
  IF NEW.citation_publication_id IS NOT NULL THEN
    SELECT * INTO carrier FROM public.publications WHERE id = NEW.citation_publication_id;
    source_video := NEW.structured_data #>> '{media,video_id}';
    IF carrier.platform = 'youtube' AND NEW.media_start_ms IS NOT NULL AND
      (source_video IS NULL OR carrier.platform_id IS NULL OR source_video <> carrier.platform_id) THEN
      RAISE EXCEPTION 'source video contradicts cited publication' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.auction_event_id IS NOT NULL THEN
    SELECT * INTO presentation FROM public.auction_events WHERE id = NEW.auction_event_id;
    IF presentation.id IS NOT NULL THEN
      IF NEW.vehicle_id IS NOT NULL AND presentation.vehicle_id IS NOT NULL AND
        NEW.vehicle_id <> presentation.vehicle_id THEN
        RAISE EXCEPTION 'observation chassis contradicts market event' USING ERRCODE = '23514';
      END IF;
      context := NEW.structured_data -> 'event_context';
      event_listing := COALESCE(presentation.source_listing_id, substring(presentation.source_url from '/lots/([0-9]+)'));
      IF context ->> 'source_listing_id' IS NULL OR event_listing IS NULL OR
        context ->> 'source_listing_id' <> event_listing THEN
        RAISE EXCEPTION 'source listing identity does not verify market event' USING ERRCODE = '23514';
      END IF;
      source_sale := COALESCE(context ->> 'auction_id', split_part(context ->> 'auction_source_key', ':', 2));
      IF source_sale IS NOT NULL AND presentation.raw_data ->> 'auction_id' IS NOT NULL THEN
        IF lower(source_sale) <> lower(presentation.raw_data ->> 'auction_id') THEN
          RAISE EXCEPTION 'source sale identity contradicts market event' USING ERRCODE = '23514';
        END IF;
      ELSE
        source_sale_name := regexp_replace(lower(context ->> 'auction'), '^mecum[[:space:]]+', '');
        event_sale_name := regexp_replace(lower(presentation.raw_data ->> 'auction_name'), '^mecum[[:space:]]+', '');
        IF source_sale_name IS NULL OR event_sale_name IS NULL OR source_sale_name <> event_sale_name THEN
          RAISE EXCEPTION 'source sale identity does not verify market event' USING ERRCODE = '23514';
        END IF;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
COMMENT ON FUNCTION public.check_observation_media_links() IS
  'Before append: carrier video ID, source listing+sale and any explicit chassis must agree with cited FK targets. No matching, overwrite or derived state. C15 negative-link invariant; ingest-observation is the writer.';
REVOKE ALL ON FUNCTION public.check_observation_media_links() FROM PUBLIC;
DROP TRIGGER IF EXISTS check_observation_media_links_before_insert ON public.vehicle_observations;
CREATE TRIGGER check_observation_media_links_before_insert BEFORE INSERT
  ON public.vehicle_observations FOR EACH ROW EXECUTE FUNCTION public.check_observation_media_links();
-- Existing late-binding trigger from 20261002131000_broadcast_entity_profile_fold.
CREATE TRIGGER check_observation_media_links_before_update BEFORE UPDATE OF
  citation_publication_id,auction_event_id,vehicle_id ON public.vehicle_observations
  FOR EACH ROW EXECUTE FUNCTION public.check_observation_media_links();
