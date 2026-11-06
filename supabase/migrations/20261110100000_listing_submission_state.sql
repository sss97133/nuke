-- A vehicle's listing submission, recorded and read through the system.
--
-- The 1973 Firebird (20d21fb0) was accepted by Bring a Trailer on 2026-10-29 and its draft has been pending the
-- seller's approval since 2026-11-03, and its profile said nothing: listing_exports had no row (the submission went
-- through the browser, not the switchboard) and no reader served that table to the profile. listing_exports is read
-- and written only by its own user's row policies, so a contributor on the car could not see it either.
--
-- record_listing_submission: the writer. Service role, or a caller tied to the vehicle (owner, creator, uploader,
--   contributor with access). One row per (vehicle, platform, external listing id); a cited source and a reason;
--   every status or stage change keeps the prior state in metadata.history.
-- vehicle_listing_state: the reader. A tied viewer gets the full state (status, stage, clocks, url); anyone else
--   only a live or sold listing (an auction already public on its venue). Never an asking price or reserve.
-- vehicle_profile_read's masthead carries the reader's answer as 'listing' (patched at an anchor, as 20261031074000).
BEGIN;
SET LOCAL statement_timeout = '20s';
SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.vehicle_listing_viewer_tied(p_vehicle_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT (SELECT auth.role()) = 'service_role'
      OR EXISTS (SELECT 1 FROM public.vehicles v
                 WHERE v.id = p_vehicle_id AND (SELECT auth.uid()) IS NOT NULL
                   AND (coalesce((SELECT auth.uid()) IN (v.owner_id, v.user_id, v.created_by_user_id, v.uploaded_by), false)
                        OR public.vehicle_user_has_access(v.id, (SELECT auth.uid()))))
$f$;
COMMENT ON FUNCTION public.vehicle_listing_viewer_tied(uuid) IS
  'True for the service role and for a signed-in viewer who owns, created, uploaded or has access to the vehicle.';

CREATE OR REPLACE FUNCTION public.record_listing_submission(
  p_vehicle_id uuid, p_platform text, p_status text, p_stage text, p_stage_since timestamptz,
  p_external_listing_id text, p_external_listing_url text, p_source jsonb, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE
  c_writer     CONSTANT text := 'record_listing_submission';
  v_timeout_ms bigint := (SELECT setting::bigint FROM pg_settings WHERE name = 'statement_timeout');
  v_uid        uuid := (SELECT auth.uid());
  v_owner uuid; v_user uuid; v_creator uuid; v_uploader uuid; v_holder uuid;
  v_id uuid; v_prev_status text; v_prev_meta jsonb;
  v_now        timestamptz := now();
  v_asserted   text;
  v_state      jsonb;
BEGIN
  IF v_timeout_ms < 1 OR v_timeout_ms > 60000 THEN
    RAISE EXCEPTION '%: caller must set statement_timeout between 1 ms and 60 s (now % ms)', c_writer, v_timeout_ms;
  END IF;
  PERFORM set_config('lock_timeout', '3s', true);
  IF p_vehicle_id IS NULL THEN RAISE EXCEPTION '%: p_vehicle_id is required', c_writer; END IF;
  IF p_platform IS NULL OR p_platform NOT IN ('nzero', 'bat', 'ebay', 'craigslist', 'carscom', 'facebook', 'autotrader', 'hemmings', 'carsandbids', 'hagerty', 'other') THEN
    RAISE EXCEPTION '%: platform % is not a listing platform', c_writer, p_platform;
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('prepared', 'submitted', 'active', 'sold', 'expired', 'cancelled') THEN
    RAISE EXCEPTION '%: status % is not a listing status', c_writer, p_status;
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 10 THEN
    RAISE EXCEPTION '%: vehicle % needs a reason (at least 10 characters)', c_writer, p_vehicle_id;
  END IF;
  IF p_source IS NULL OR jsonb_typeof(p_source) <> 'object'
     OR coalesce(btrim(p_source ->> 'type'), '') = '' OR coalesce(btrim(p_source ->> 'ref'), '') = ''
     OR coalesce(btrim(p_source ->> 'title'), '') = '' THEN
    RAISE EXCEPTION '%: vehicle % has no cited source (source.type, source.ref and source.title)', c_writer, p_vehicle_id;
  END IF;
  IF NOT public.vehicle_listing_viewer_tied(p_vehicle_id) THEN
    RAISE EXCEPTION '%: the caller is not tied to vehicle %', c_writer, p_vehicle_id;
  END IF;

  SELECT owner_id, user_id, created_by_user_id, uploaded_by INTO v_owner, v_user, v_creator, v_uploader
  FROM public.vehicles WHERE id = p_vehicle_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'not_found', 'vehicle_id', p_vehicle_id); END IF;
  -- The row's user is the caller when the caller is one of the vehicle's people, else the vehicle's first person.
  v_holder := coalesce(CASE WHEN v_uid IS NOT NULL AND v_uid IN (v_owner, v_user, v_creator, v_uploader) THEN v_uid END,
                       v_owner, v_user, v_creator, v_uploader);
  IF v_holder IS NULL THEN RAISE EXCEPTION '%: vehicle % has no person to hold the listing', c_writer, p_vehicle_id; END IF;
  v_asserted := coalesce(nullif(btrim(p_source ->> 'asserted_by'), ''), nullif(current_setting('app.writer', true), ''), 'agent');
  v_state := jsonb_build_object('recorded_by', c_writer, 'stage', p_stage, 'stage_since', p_stage_since,
                                'asserted_by', v_asserted, 'source', p_source, 'reason', p_reason, 'recorded_at', v_now);

  SELECT id, status, coalesce(metadata, '{}'::jsonb) INTO v_id, v_prev_status, v_prev_meta
  FROM public.listing_exports
  WHERE vehicle_id = p_vehicle_id AND platform = p_platform AND external_listing_id IS NOT DISTINCT FROM p_external_listing_id
  ORDER BY created_at DESC LIMIT 1 FOR UPDATE;

  PERFORM set_config('app.writer', c_writer, true);
  IF v_id IS NULL THEN
    INSERT INTO public.listing_exports (vehicle_id, user_id, platform, export_format, title, description, status,
                                        external_listing_id, external_listing_url, submitted_at, activated_at, metadata)
    VALUES (p_vehicle_id, v_holder, p_platform, 'json', left(p_source ->> 'title', 200), '', p_status,
            p_external_listing_id, p_external_listing_url,
            CASE WHEN p_status IN ('submitted', 'active', 'sold') THEN coalesce(p_stage_since, v_now) END,
            CASE WHEN p_status IN ('active', 'sold') THEN coalesce(p_stage_since, v_now) END,
            v_state || jsonb_build_object('history', '[]'::jsonb))
    RETURNING id INTO v_id;
    RETURN jsonb_build_object('status', 'recorded', 'listing_export_id', v_id, 'listing_status', p_status, 'stage', p_stage);
  END IF;

  UPDATE public.listing_exports
  SET status = p_status,
      external_listing_url = coalesce(p_external_listing_url, external_listing_url),
      submitted_at = coalesce(submitted_at, CASE WHEN p_status IN ('submitted', 'active', 'sold') THEN coalesce(p_stage_since, v_now) END),
      activated_at = coalesce(activated_at, CASE WHEN p_status IN ('active', 'sold') THEN coalesce(p_stage_since, v_now) END),
      metadata = v_prev_meta || v_state || jsonb_build_object('history',
        coalesce(v_prev_meta -> 'history', '[]'::jsonb)
        || jsonb_build_array(jsonb_build_object('status', v_prev_status, 'stage', v_prev_meta ->> 'stage',
             'stage_since', v_prev_meta ->> 'stage_since', 'source', v_prev_meta -> 'source', 'until', v_now)))
  WHERE id = v_id;
  RETURN jsonb_build_object('status', 'updated', 'listing_export_id', v_id, 'listing_status', p_status, 'stage', p_stage, 'was', v_prev_status);
END $f$;
REVOKE ALL ON FUNCTION public.record_listing_submission(uuid, text, text, text, timestamptz, text, text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_listing_submission(uuid, text, text, text, timestamptz, text, text, jsonb, text) TO authenticated, service_role;
COMMENT ON FUNCTION public.record_listing_submission(uuid, text, text, text, timestamptz, text, text, jsonb, text) IS
  'Sanctioned writer for a vehicle''s listing submission on a platform: tied caller or service role, cited source and reason, one row per (vehicle, platform, external id), prior state kept in metadata.history.';

CREATE OR REPLACE FUNCTION public.vehicle_listing_state(p_vehicle_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  WITH t AS (SELECT public.vehicle_listing_viewer_tied(p_vehicle_id) AS tied),
  r AS (
    SELECT e.platform, e.status, e.metadata, e.submitted_at, e.activated_at, e.external_listing_url, e.external_listing_id,
           coalesce(e.updated_at, e.created_at) AS as_of, t.tied
    FROM public.listing_exports e CROSS JOIN t
    WHERE e.vehicle_id = p_vehicle_id AND e.status <> 'cancelled'
      AND (t.tied OR e.status IN ('active', 'sold'))
    ORDER BY (e.status IN ('active', 'sold')) DESC, coalesce(e.updated_at, e.created_at) DESC
    LIMIT 1)
  SELECT CASE WHEN r.tied THEN
           jsonb_build_object('platform', r.platform, 'status', r.status, 'stage', r.metadata ->> 'stage',
                              'stage_since', r.metadata ->> 'stage_since', 'submitted_at', r.submitted_at,
                              'activated_at', r.activated_at, 'url', r.external_listing_url,
                              'external_listing_id', r.external_listing_id, 'as_of', r.as_of, 'visibility', 'tied')
         ELSE
           jsonb_build_object('platform', r.platform, 'status', r.status, 'activated_at', r.activated_at,
                              'url', r.external_listing_url, 'as_of', r.as_of, 'visibility', 'public')
         END
  FROM r
$f$;
REVOKE ALL ON FUNCTION public.vehicle_listing_state(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_listing_state(uuid) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.vehicle_listing_viewer_tied(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_listing_viewer_tied(uuid) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.vehicle_listing_state(uuid) IS
  'The vehicle''s newest listing submission: full state for a tied viewer, only a live or sold listing for anyone else, never a price.';

-- The masthead carries it.
DO $migration$
DECLARE d text; a CONSTANT text := $a$'identity_marks', (SELECT marks FROM identity_marks)))$a$; n integer;
BEGIN
  IF to_regprocedure('public.vehicle_profile_read(uuid)') IS NULL THEN
    RAISE NOTICE 'vehicle_profile_read absent; skipped';
    RETURN;
  END IF;
  d := pg_get_functiondef(to_regprocedure('public.vehicle_profile_read(uuid)'));
  IF position('vehicle_listing_state(v.id)' in d) > 0 THEN RETURN; END IF;
  n := (length(d) - length(replace(d, a, ''))) / length(a);
  IF n <> 1 THEN RAISE EXCEPTION 'vehicle_profile_read masthead anchor drifted (found % times)', n; END IF;
  d := replace(d, a, $b$'identity_marks', (SELECT marks FROM identity_marks),
      'listing', public.vehicle_listing_state(v.id)))$b$);
  EXECUTE d;
END $migration$;

DO $check$
BEGIN
  IF to_regprocedure('public.vehicle_profile_read(uuid)') IS NOT NULL
     AND position('vehicle_listing_state(v.id)' in pg_get_functiondef(to_regprocedure('public.vehicle_profile_read(uuid)'))) = 0 THEN
    RAISE EXCEPTION 'vehicle_profile_read masthead does not carry the listing';
  END IF;
  IF NOT has_function_privilege('anon', 'public.vehicle_listing_state(uuid)', 'EXECUTE') THEN RAISE EXCEPTION 'anon cannot read listing state'; END IF;
  IF has_function_privilege('anon', 'public.record_listing_submission(uuid,text,text,text,timestamptz,text,text,jsonb,text)', 'EXECUTE') THEN RAISE EXCEPTION 'anon can write'; END IF;
END $check$;
COMMIT;
