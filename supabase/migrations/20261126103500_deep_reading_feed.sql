-- A definer reader for a car's deep photo readings, so pages stop reading vehicle_observations' image_deep_byok copies
-- directly (step A of the observation-copy close; the direct read is narrowed after the pages move).
--
-- Before (prod, read-only, 2026-11-25, claims anon, 5 id slices): 234 of 257 image_deep_byok copies on public cars are
-- readable by anon through vo_authenticated_read (observation_is_public admits kind condition), 230 of them with a
-- place description (presence.place_hint); a floor of 10,487 such copies fleet-wide. The copies carry the same reading as
-- the photo's ai_scan_metadata.byok_deep_analysis (presence, text_regions, components_seen, state_observations,
-- workshop_signals, ...) plus a 110-character content_text summary, none of it under the image rule rows of
-- 20261125200000. Readers: AnalysisStreamPage.tsx:63/90 (prints place_hint, narrative, components, damage, state,
-- workshop signals, scene) and ObservationPage.tsx (prints every key).
--
-- vehicle_deep_reading_feed(p_vehicle_id, p_before, p_limit, p_observation_id), SECURITY DEFINER, newest first by ingested_at, 1..100 rows:
--   * Anon gets nothing unless the car is public and not deleted.
--   * p_observation_id narrows the walk to one copy (the observation page), under every test below.
--   * A copy is returned only when its photo (structured_data.image_id, a uuid) is on this car and is either the
--     caller's upload, or not sensitive and gallery-eligible (vehicle_image_gallery_eligible over the base row) on the
--     public car, or the caller is tied: the visibility test of vehicle_image_scan_metadata. Registered in
--     private_row_policy_copies (vehicle_images, d00a311f..., checked live; any other live hash stops the migration).
--   * structured_data is the copy passed through image_scan_metadata_for_viewer as {byok_deep_analysis: copy} with the
--     compiled image rule rows, so a stranger gets the copy with the place, model prose, text regions and plate
--     withheld; the worker returns it whole to the uploader, a tied caller and service_role.
--   * content_text (the model's free-text summary) only to the uploader or a tied caller; NULL otherwise.
--   * Standing readings only, as the page's standingReadings filter: not superseded, and not the automatic tier
--     (image_reading_tier_is_automatic, the platform_config row the page's constant mirrors).
--   Same columns and order as the page's direct select, so the page move is a call swap.
-- Cost (prod, read-only, 2026-11-25, as anon, the reader's query without the worker, which 20261125200000 adds): the
-- car with the most copies sampled holds 3,080 standing copies, 1,272 of shown photos. Joining every copy to its photo
-- before the sort took 9.35 s cold, 345 ms warm. Walking newest first reaches the 50th shown copy at the 64th copy:
-- the copy scan and sort 101 ms warm (515 ms cold), then 64 photo lookups (0.02 ms warm, 2.4 ms cold each) and 50
-- worker calls (about 35 us each, skeptic's 05:08 measure of the #3935 worker).
-- Needs 20261125200000 live (the worker and compiled rules); the guard refuses otherwise.
-- Contract: supabase/sql/test_deep_reading_feed.sql. Revert: supabase/sql/revert_20261126103500_deep_reading_feed.sql.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $guard$
BEGIN
  IF to_regclass('public.image_scan_rules_compiled') IS NULL
     OR to_regprocedure('public.image_scan_metadata_for_viewer(jsonb, uuid, uuid, public.image_scan_rule[])') IS NULL
     OR to_regprocedure('public.vehicle_viewer_tied(uuid)') IS NULL
     OR to_regprocedure('public.vehicle_image_gallery_eligible(public.vehicle_images)') IS NULL
     OR to_regprocedure('public.image_reading_tier_is_automatic(text)') IS NULL THEN
    RAISE EXCEPTION '20261125200000 (worker and compiled rules) or a visibility helper is not live';
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.vehicle_deep_reading_feed(p_vehicle_id uuid, p_before timestamptz DEFAULT NULL,
                                                            p_limit integer DEFAULT 50, p_observation_id uuid DEFAULT NULL)
RETURNS TABLE (id uuid, observed_at timestamptz, ingested_at timestamptz, confidence public.confidence_level,
               confidence_score numeric, content_text text, structured_data jsonb)
LANGUAGE plpgsql
STABLE SECURITY DEFINER ROWS 50
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_tied boolean := COALESCE(public.vehicle_viewer_tied(p_vehicle_id), false);
  v_public boolean := EXISTS (SELECT 1 FROM public.vehicles v
                               WHERE v.id = p_vehicle_id AND v.is_public = true AND v.deleted_at IS NULL);
  v_rules public.image_scan_rule[] := COALESCE(
    (SELECT c.rules FROM public.image_scan_rules_compiled c WHERE c.surface = 'vehicle_images.ai_scan_metadata'),
    public.image_scan_rules('vehicle_images.ai_scan_metadata'));
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_n integer := 0;
  v_own boolean;
  o record;
  vi public.vehicle_images;
BEGIN
  -- deep_reading_feed_v1 (20261126103500)
  IF p_vehicle_id IS NULL OR NOT (v_public OR v_tied OR v_uid IS NOT NULL) THEN
    RETURN;
  END IF;
  -- Newest first; each copy's photo is looked up and tested only until the page is full, so the walk is the page
  -- plus the hidden copies between its rows, not every copy on the car.
  FOR o IN
    SELECT c.id, c.observed_at, c.ingested_at, c.confidence, c.confidence_score, c.content_text, c.structured_data,
           CASE WHEN c.structured_data ->> 'image_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                THEN (c.structured_data ->> 'image_id')::uuid END AS image_id
      FROM public.vehicle_observations c
     WHERE c.vehicle_id = p_vehicle_id
       AND c.kind = 'condition'::public.observation_kind
       AND c.structured_data @> '{"analysis_kind": "image_deep_byok"}'::jsonb
       AND c.is_superseded IS NOT TRUE
       AND NOT COALESCE(public.image_reading_tier_is_automatic(c.agent_tier), false)
       AND (p_before IS NULL OR c.ingested_at < p_before)
       AND (p_observation_id IS NULL OR c.id = p_observation_id)
     ORDER BY c.ingested_at DESC NULLS LAST, c.id DESC
  LOOP
    CONTINUE WHEN o.image_id IS NULL;
    SELECT * INTO vi FROM public.vehicle_images i WHERE i.id = o.image_id AND i.vehicle_id = p_vehicle_id;
    CONTINUE WHEN NOT FOUND;
    v_own := COALESCE(v_uid IS NOT NULL AND vi.user_id = v_uid, false);
    CONTINUE WHEN NOT (v_tied
                       OR v_own
                       OR COALESCE(v_public AND COALESCE(vi.is_sensitive, false) = false AND public.vehicle_image_gallery_eligible(vi), false));
    id := o.id;
    observed_at := o.observed_at;
    ingested_at := o.ingested_at;
    confidence := o.confidence;
    confidence_score := o.confidence_score;
    content_text := CASE WHEN v_tied OR v_own THEN o.content_text END;
    structured_data := public.image_scan_metadata_for_viewer(jsonb_build_object('byok_deep_analysis', o.structured_data),
                                                             vi.user_id, vi.vehicle_id, v_rules) -> 'byok_deep_analysis';
    RETURN NEXT;
    v_n := v_n + 1;
    EXIT WHEN v_n >= v_limit;
  END LOOP;
END
$function$;

REVOKE ALL ON FUNCTION public.vehicle_deep_reading_feed(uuid, timestamptz, integer, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_deep_reading_feed(uuid, timestamptz, integer, uuid) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.vehicle_deep_reading_feed(uuid, timestamptz, integer, uuid) IS
  'A car''s image_deep_byok readings, newest first: shown (or own, or tied) photos only, each passed through the image rule rows. 20261126103500.';

-- The read policies this reader restates must be the ones it was written against: vehicle_images SELECT/ALL policies
-- hash d00a311f... on production since #3971 (20261125 05:25 PT). Any other live hash stops the migration.
DO $reg$
DECLARE v_live text;
BEGIN
  IF to_regclass('public.private_row_policy_copies') IS NOT NULL THEN
    SELECT h.policy_hash INTO v_live FROM public.private_row_policy_hash('vehicle_images', 'p.cmd IN (''SELECT'', ''ALL'')') h;
    IF v_live IS DISTINCT FROM 'd00a311fd7235bb19240f3fd812493c4' THEN
      RAISE EXCEPTION 'vehicle_images read policies hash % live; vehicle_deep_reading_feed restates d00a311f...: re-read them before applying', v_live;
    END IF;
    EXECUTE $i$INSERT INTO public.private_row_policy_copies (reader, relation, policy_filter, recorded_hash, owner_lane, note)
      VALUES ('vehicle_deep_reading_feed(uuid, timestamp with time zone, integer, uuid)', 'vehicle_images', 'p.cmd IN (''SELECT'', ''ALL'')',
              'd00a311fd7235bb19240f3fd812493c4', 'ta-policies',
              '20261126103500 restates the vehicle_images read policy (shown, uploader, tied) before returning a photo''s deep reading')
      ON CONFLICT (reader, relation, policy_filter) DO NOTHING$i$;
  END IF;
END
$reg$;

DO $verify$
BEGIN
  IF NOT has_function_privilege('anon', 'public.vehicle_deep_reading_feed(uuid, timestamptz, integer, uuid)', 'EXECUTE')
     OR (SELECT prosrc FROM pg_proc WHERE oid = 'public.vehicle_deep_reading_feed(uuid, timestamptz, integer, uuid)'::regprocedure)
        !~ 'deep_reading_feed_v1' THEN
    RAISE EXCEPTION 'vehicle_deep_reading_feed was not created as expected';
  END IF;
END
$verify$;
COMMIT;
