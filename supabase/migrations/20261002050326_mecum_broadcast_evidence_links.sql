-- REVIEW DRAFT ONLY: not applied or pushed. Owner approval required by AGENTS.md.
-- C15 / data-machine: attach existing immutable observations to the existing media commons
-- and market-event trunk. No new testimony, identity, bid, provenance or fold table.
-- Discovery: 26 windows / 2,271 s of c9fxArnD3IY, 25 S114 caption claims, two frame points,
-- and primary Mecum lot 1159827. This earns evidence identity, relative time and relation;
-- it does NOT establish every field for 1,811 videos or an accepted-bid/visibility history.
-- Live verification: publications(platform,platform_id,platform_url) exists; publication_pages
-- is PRINTED PAGE grain; auction_events has a NOT VALID vehicle FK. Observations have no
-- vehicle, media or event FK in production. Existing vehicle_id indexes cover non-NULL links.
-- Concrete rejected old link: c9fxArnD3IY 2546 s is S114 1967 Corvette, not the Glendale 2025
-- 1970 C10 event 767e325c-6470-4b0f-b7f7-e0d6ccb5aa98.
-- Writer: ingest-observation, same auth/RLS boundary as the existing log. Existing RLS/grants
-- unchanged; no new exposed table. Reader: existing api-v1-observations by profile, publication
-- or market event. Assay: expected source keys vs landed IDs + reread duplicates; distinguish
-- exact clocks / caption cues / point samples / unresolved chassis. No live fold is claimed.
-- Later incremental audio/lot folds require a named owner, attached output and scheduled assay
-- before mining fleet activation. A SQL reader alone is not an incremental fold.
-- Deployment: one migration commit through supabase-deploy.yml, after approval and lock audit.
-- Partial indexes are CONCURRENTLY built outside a transaction; do not wrap this file in BEGIN.

SET statement_timeout = '120s';
SET lock_timeout = '5s';

-- Extend the EXISTING canonical indexed VIN reader, preserving its old one-argument API.
-- The strict overload examines at most two live candidates and returns NULL on ambiguity;
-- it never pays the unindexed raw-vin equality scan or silently chooses a duplicate chassis.
CREATE FUNCTION public.find_vehicle_by_vin(p_vin text, p_require_unique boolean)
RETURNS uuid LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
  WITH candidates AS (
    SELECT id FROM public.vehicles
    WHERE upper(btrim(vin)) = upper(btrim(p_vin)) AND deleted_at IS NULL
      AND status IS DISTINCT FROM 'merged' AND p_require_unique IS TRUE
    LIMIT 2
  )
  SELECT CASE WHEN count(*) = 1 THEN min(id::text)::uuid ELSE NULL END FROM candidates
$$;
REVOKE ALL ON FUNCTION public.find_vehicle_by_vin(text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_vehicle_by_vin(text, boolean) TO authenticated, service_role;
COMMENT ON FUNCTION public.find_vehicle_by_vin(text, boolean) IS
  'Strict overload of the existing canonical VIN reader: index-compatible upper(btrim(vin)), at most two unmerged/nondeleted candidates, unique UUID or NULL. p_require_unique must be true at the intake; no arbitrary first hit. No new index.';

ALTER TABLE public.vehicle_observations
  ADD COLUMN citation_publication_id uuid,
  ADD COLUMN auction_event_id uuid,
  ADD COLUMN media_start_ms bigint,
  ADD COLUMN media_end_ms bigint,
  ADD COLUMN media_relation text,
  ADD COLUMN media_span_semantics text,
  ADD COLUMN observed_at_basis text,
  ADD COLUMN source_event_at timestamptz,
  ADD COLUMN source_event_date date,
  ADD COLUMN source_event_time_precision text,
  ADD COLUMN source_available_at timestamptz;

ALTER TABLE public.vehicle_observations
  ADD CONSTRAINT vehicle_observations_vehicle_id_fkey
    FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) NOT VALID,
  ADD CONSTRAINT vehicle_observations_citation_publication_fkey
    FOREIGN KEY (citation_publication_id) REFERENCES public.publications(id) NOT VALID,
  ADD CONSTRAINT vehicle_observations_auction_event_fkey
    FOREIGN KEY (auction_event_id) REFERENCES public.auction_events(id) NOT VALID,
  ADD CONSTRAINT vehicle_observations_media_range_check CHECK (
    (media_start_ms IS NULL AND media_end_ms IS NULL AND media_relation IS NULL AND media_span_semantics IS NULL) OR
    (media_start_ms IS NOT NULL AND media_relation IS NOT NULL AND media_span_semantics IS NOT NULL
      AND media_start_ms >= 0 AND (media_end_ms IS NULL OR media_end_ms >= media_start_ms))
  ) NOT VALID,
  ADD CONSTRAINT vehicle_observations_media_relation_check CHECK (
    media_relation IS NULL OR media_relation IN
      ('vehicle_visible','vehicle_discussed','lot_active','screen_display','room_visible','participant_action','crowd_audio','metadata')
  ) NOT VALID,
  ADD CONSTRAINT vehicle_observations_media_semantics_check CHECK (
    media_span_semantics IS NULL OR media_span_semantics IN
      ('point_sample','caption_cue','measured_presence_interval','measured_lot_interval',
       'measured_utterance','candidate_interval')
  ) NOT VALID,
  ADD CONSTRAINT vehicle_observations_media_measured_check CHECK (
    media_span_semantics NOT IN ('measured_presence_interval','measured_lot_interval','measured_utterance')
      OR media_end_ms IS NOT NULL
  ) NOT VALID,
  ADD CONSTRAINT vehicle_observations_media_kind_check CHECK (
    (media_span_semantics <> 'caption_cue' OR media_relation = 'vehicle_discussed') AND
    (media_span_semantics <> 'measured_presence_interval' OR media_relation = 'vehicle_visible') AND
    (media_span_semantics <> 'measured_lot_interval' OR media_relation = 'lot_active') AND
    (media_span_semantics <> 'point_sample' OR media_end_ms IS NULL OR media_end_ms = media_start_ms)
  ) NOT VALID,
  ADD CONSTRAINT vehicle_observations_clock_basis_check CHECK (
    observed_at_basis IS NULL OR observed_at_basis IN
      ('event_time','source_capture_time','source_publication_time')
  ) NOT VALID,
  ADD CONSTRAINT vehicle_observations_event_precision_check CHECK (
    source_event_time_precision IS NULL OR source_event_time_precision IN ('exact','day','unknown')
  ) NOT VALID,
  ADD CONSTRAINT vehicle_observations_event_clock_check CHECK (
    (source_event_time_precision IS NULL AND source_event_at IS NULL AND source_event_date IS NULL) OR
    (source_event_time_precision IS NOT NULL AND observed_at_basis IS NOT NULL AND
      ((source_event_time_precision = 'exact' AND source_event_at IS NOT NULL) OR
       (source_event_time_precision = 'day' AND source_event_date IS NOT NULL AND source_event_at IS NULL) OR
       (source_event_time_precision = 'unknown' AND source_event_at IS NULL AND source_event_date IS NULL)))
  ) NOT VALID;

COMMENT ON COLUMN public.vehicle_observations.vehicle_id IS
  'Nullable FK to vehicles.id for the resolved physical chassis of this observation. NULL is valid unbound testimony or a room/activity claim. NOT VALID preserves existing rows pending a bounded orphan audit; new non-NULL assignments must reference an existing vehicle. NO ACTION protects testimony from cascade deletion. Assignment changes only through the sanctioned attribution primitive; the source body/hash remain immutable.';
COMMENT ON CONSTRAINT vehicle_observations_vehicle_id_fkey ON public.vehicle_observations IS
  'C15 repair of a missing trunk key: enforces future non-NULL vehicle references without scanning or rewriting the historical observation log. Historical validation is a separate bounded maintenance operation; NULL remains unresolved, never a fabricated chassis.';
COMMENT ON COLUMN public.vehicle_observations.citation_publication_id IS
  'FK to publications.id for the carrier of one source claim. For YouTube, publication platform_id is video ID. Nullable while unresolved; written only through ingest-observation. Not a copied provenance record.';
COMMENT ON COLUMN public.vehicle_observations.auction_event_id IS
  'FK to auction_events.id: one asset presentation to a room. Lot labels are scoped to that sale, never matched globally. Nullable pending exact source listing/sale resolution; not physical chassis identity.';
COMMENT ON COLUMN public.vehicle_observations.media_start_ms IS
  'Relative source-media position in integer milliseconds, grain one claim or span. NOT event/ingest wall clock. Exactness and end meaning are declared by media_span_semantics and extraction_method.';
COMMENT ON COLUMN public.vehicle_observations.media_end_ms IS
  'Relative source-media end in integer milliseconds. NULL means no defensible end. Point samples do not imply a duration; a next-caption onset is a caption-cue bound, not the last visible frame.';
COMMENT ON COLUMN public.vehicle_observations.media_relation IS
  'Claim relation: vehicle_visible, vehicle_discussed, lot_active, screen_display, room_visible, participant_action, crowd_audio, metadata. Room/activity claims never force a chassis or named person. Visibility, speech subject and active lot are separate many-to-many relations; they may disagree at one position.';
COMMENT ON COLUMN public.vehicle_observations.media_span_semantics IS
  'Evidence interval method: point_sample, caption_cue, measured_presence_interval, measured_lot_interval, measured_utterance, candidate_interval. Only measured_presence_interval supports a measured visible start/end.';
COMMENT ON COLUMN public.vehicle_observations.observed_at_basis IS
  'Meaning of the existing observed_at clock for this row: event_time, source_capture_time, source_publication_time. NULL marks unclassified legacy clocks; do not infer exact event time from capture time.';
COMMENT ON COLUMN public.vehicle_observations.source_event_at IS
  'Event-time instant (timestamptz) when the described event occurred, only when independently mapped. NULL for date-only source events; never publication/capture time plus media offset without a sourced mapping.';
COMMENT ON COLUMN public.vehicle_observations.source_event_date IS
  'Date-only source event clock, source civil date without fabricated midnight. Source venue/timezone belongs to cited context. NULL if unobserved; not sufficient for intra-day point-in-time backtests.';
COMMENT ON COLUMN public.vehicle_observations.source_event_time_precision IS
  'Event-clock precision vocabulary exact/day/unknown. NULL means legacy unclassified. exact requires source_event_at; day requires source_event_date; relative media ordering remains separate.';
COMMENT ON COLUMN public.vehicle_observations.source_available_at IS
  'Source-availability instant: earliest verified time this particular evidence edition was externally available. Publication may follow the described auction. NULL means unknown, not event time. Used to prevent post-event leakage.';
COMMENT ON COLUMN public.vehicle_observations.observed_at IS
  'Claim observation clock (timestamptz), interpreted by observed_at_basis for new media rows. Legacy writers used mixed event/capture clocks. source_event_at is the explicit event-time instant where available; never silently recast a legacy clock.';
COMMENT ON COLUMN public.vehicle_observations.ingested_at IS
  'Ingest-time clock (timestamptz): when this observation entered Nuke. Separate from source event, publication and relative media time. Used for as-of-system reconstruction.';

-- Reject internally contradictory typed links at the data layer, not only in the worker.
-- Raw unresolved source claims stay appendable. No search/fuzzy matching or automatic relinking.
CREATE FUNCTION public.check_observation_media_links() RETURNS trigger
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
CREATE TRIGGER check_observation_media_links_before_insert BEFORE INSERT
  ON public.vehicle_observations FOR EACH ROW EXECUTE FUNCTION public.check_observation_media_links();

CREATE INDEX CONCURRENTLY idx_vehicle_observations_publication_media
  ON public.vehicle_observations (citation_publication_id, media_start_ms)
  WHERE citation_publication_id IS NOT NULL;
CREATE INDEX CONCURRENTLY idx_vehicle_observations_market_event_media
  ON public.vehicle_observations (auction_event_id, media_start_ms)
  WHERE auction_event_id IS NOT NULL;

INSERT INTO public.pipeline_registry(table_name,column_name,owned_by,description,do_not_write_directly,write_via)
SELECT 'vehicle_observations', field, 'ingest-observation',
  'Source-grain media evidence link/clock from the sanctioned intake; append or supersede, never replace.',
  true, 'ingest-observation'
FROM unnest(ARRAY['citation_publication_id','auction_event_id','media_start_ms','media_end_ms',
  'media_relation','media_span_semantics','observed_at_basis','source_event_at','source_event_date',
  'source_event_time_precision','source_available_at']) AS fields(field);

-- No legacy metadata reattribution/backfill in this migration. Validate NOT VALID keys in a
-- later bounded maintenance pass after runtime checks; adding them enforces future writes now.

-- Repair the EXISTING sanctioned attribution primitive. NULL vehicle means unbound testimony,
-- not a missing row. Row lock serializes competing assignments; only relationship fields move.
-- Preserve source hash/body, every citation/provenance field and ingest time in place, and append
-- the existing reattribution_audit (including a NULL old_vehicle_id on first attribution).
-- The existing end-user actor/editor check and SECURITY INVOKER/RLS remain intact.
CREATE OR REPLACE FUNCTION public.relink_testimony(p_observation_type text, p_observation_id uuid, p_target_vehicle_id uuid, p_reason text, p_actor_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_old_vehicle_id uuid;
  v_merged_from_vehicle_id uuid;
  v_is_primary boolean;
  v_file_hash text;
  v_demoted boolean := false;
BEGIN
  -- P3.7 identity check (2026-09-27): the actor is the caller (p_actor_user_id = auth.uid()) and can edit the target vehicle; stays SECURITY INVOKER so RLS still governs the source rows. Only end-user JWTs are judged; service_role and JWT-less sessions are exempt.
  IF coalesce(auth.role(), '') IN ('authenticated', 'anon') THEN
    IF auth.uid() IS NULL OR p_actor_user_id IS DISTINCT FROM auth.uid() OR NOT public.user_can_edit_vehicle(p_target_vehicle_id, auth.uid()) THEN
      RAISE EXCEPTION 'relink_testimony: you can only relink as yourself onto a vehicle you can edit' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'relink_testimony: attribution requires a reason' USING ERRCODE = '22023';
  END IF;
  IF p_observation_type NOT IN ('image', 'observation') THEN
    RAISE EXCEPTION 'observation_type must be image or observation, got %', p_observation_type;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM vehicles WHERE id = p_target_vehicle_id AND deleted_at IS NULL AND status IS DISTINCT FROM 'merged') THEN
    RAISE EXCEPTION 'target vehicle % does not exist', p_target_vehicle_id;
  END IF;

  IF p_observation_type = 'image' THEN
    SELECT vehicle_id, COALESCE(is_primary, false), file_hash, merged_from_vehicle_id
      INTO v_old_vehicle_id, v_is_primary, v_file_hash, v_merged_from_vehicle_id
      FROM vehicle_images WHERE id = p_observation_id FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'image % not found', p_observation_id;
    END IF;

    IF v_old_vehicle_id IS NOT DISTINCT FROM p_target_vehicle_id THEN
      RETURN jsonb_build_object('success', true, 'duplicate', true, 'mode', 'already_attributed',
                                'observation_id', p_observation_id, 'vehicle_id', p_target_vehicle_id,
                                'merged_from_vehicle_id', v_merged_from_vehicle_id);
    END IF;

    -- Guard: (vehicle_id, file_hash) unique — content already on target.
    IF v_file_hash IS NOT NULL AND EXISTS (
      SELECT 1 FROM vehicle_images b
      WHERE b.vehicle_id = p_target_vehicle_id AND b.file_hash = v_file_hash
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'file_hash_exists_on_target',
                                'observation_id', p_observation_id);
    END IF;

    -- Guard: one-primary-per-vehicle unique index. Demote the MOVED row, never
    -- the target's existing primary (workflow state, not testimony content).
    IF v_is_primary AND EXISTS (
      SELECT 1 FROM vehicle_images b
      WHERE b.vehicle_id = p_target_vehicle_id
        AND b.is_primary = true
        AND COALESCE(b.is_document, false) = false
        AND COALESCE(b.is_duplicate, false) = false
    ) THEN
      v_demoted := true;
    END IF;

    UPDATE vehicle_images
       SET vehicle_id = p_target_vehicle_id,
           merged_from_vehicle_id = COALESCE(merged_from_vehicle_id, v_old_vehicle_id),
           is_primary = CASE WHEN v_demoted THEN false ELSE is_primary END,
           updated_at = NOW()
     WHERE id = p_observation_id
     RETURNING merged_from_vehicle_id INTO v_merged_from_vehicle_id;

  ELSE
    SELECT vehicle_id, merged_from_vehicle_id INTO v_old_vehicle_id, v_merged_from_vehicle_id
      FROM vehicle_observations WHERE id = p_observation_id FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'observation % not found', p_observation_id;
    END IF;

    IF v_old_vehicle_id IS NOT DISTINCT FROM p_target_vehicle_id THEN
      RETURN jsonb_build_object('success', true, 'duplicate', true, 'mode', 'already_attributed',
                                'observation_id', p_observation_id, 'vehicle_id', p_target_vehicle_id,
                                'merged_from_vehicle_id', v_merged_from_vehicle_id);
    END IF;

    IF EXISTS (
      SELECT 1 FROM vehicle_observations o JOIN auction_events e ON e.id = o.auction_event_id
      WHERE o.id = p_observation_id AND e.vehicle_id IS NOT NULL AND e.vehicle_id <> p_target_vehicle_id
    ) THEN
      RAISE EXCEPTION 'target chassis contradicts the typed market event' USING ERRCODE = '23514';
    END IF;

    UPDATE vehicle_observations
       SET vehicle_id = p_target_vehicle_id,
           merged_from_vehicle_id = COALESCE(merged_from_vehicle_id, v_old_vehicle_id),
           subject_id = CASE WHEN subject_type = 'vehicle' AND subject_id IS NOT NULL
             THEN p_target_vehicle_id ELSE subject_id END
     WHERE id = p_observation_id
     RETURNING merged_from_vehicle_id INTO v_merged_from_vehicle_id;
  END IF;

  INSERT INTO reattribution_audit (
    observation_type, old_observation_id, old_vehicle_id,
    new_observation_id, new_vehicle_id, reason, actor_user_id)
  VALUES (
    p_observation_type, p_observation_id, v_old_vehicle_id,
    p_observation_id, p_target_vehicle_id,
    p_reason || CASE WHEN v_demoted THEN ' [is_primary demoted: target already has a primary]' ELSE '' END,
    p_actor_user_id);

  RETURN jsonb_build_object(
    'success', true,
    'mode', 'relink_in_place',
    'observation_type', p_observation_type,
    'observation_id', p_observation_id,
    'old_vehicle_id', v_old_vehicle_id,
    'new_vehicle_id', p_target_vehicle_id,
    'merged_from_vehicle_id', v_merged_from_vehicle_id,
    'demoted_primary', v_demoted);
END;
$function$
;


COMMENT ON FUNCTION public.relink_testimony(text,uuid,uuid,text,uuid) IS
  'Sanctioned in-place testimony attribution: supports unbound rows, preserves all source evidence, locks one row, appends existing audit; same-target retry returns the same observation ID without another audit. Target must be live, actor/editor checks unchanged. C15.';
COMMENT ON TABLE public.reattribution_audit IS
  'Append-only attribution history. Grain one assignment/reassignment of an existing testimony row; old_vehicle_id may be NULL for first attribution. Source claim/body/hash/citations remain on the original row, referenced by old/new observation IDs.';
COMMENT ON COLUMN public.reattribution_audit.created_at IS
  'Ingest-time instant when the attribution decision was appended. It is not the historical auction event time.';
