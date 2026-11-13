-- Library frames join the vision pool: an embedding carrier and a text-read batch for every admitted source.
--
-- Why (owner, 2026-11-06, after 20261111100000 admitted his Mac library imports to the capture-set scorer): the scorer now
-- sees the Firebird's 2026-08-26 light shoot but names no car, "no_clear_lead" on all 6 sets / 39 photos of the dry run.
-- Measured cause, this user: the two legs that name a car run only for phone-relay frames.
--   * CLIP embeddings live on image_observations rows. The relay gets a carrier row from trg_vehicle_images_clip_carrier
--     (AFTER INSERT ... WHEN source = 'capture_relay_ios'; live code applied by hand, recorded below unchanged), and the
--     local embedder (scripts/clip-embed-image-observations.py via get_clip_embed_batch) fills it. Library frames never get
--     a carrier: 2026 frames without any observation row, this user: iphoto 1,773 of 2,186; photo_auto_sync 808 of 860;
--     library_recovery 249 of 249; relay 127 of 997.
--   * OCR text reads (image_text_reads, record_image_text_reads) exist for 1,220 relay frames and 0 library frames; the
--     scorer's vin, plate and badge legs read them.
-- "this sure is a lot i have to explain when the system could be establishing this by organizing images and profiles
-- properly".
--
-- Changes:
--   1. trg_vehicle_images_clip_carrier() recorded as live. Its trigger is left as it is: replacing a trigger on
--      vehicle_images takes a table lock the arrival loop (20261108140000) refused to take on this table. Library frames
--      get their carriers from a polled backfill instead, the way arrivals are armed.
--   2. clip_carrier_backfill(p_limit): for every relay user, admitted-source frames of the last two years with no
--      observation row get the same carrier the trigger writes (ingest_image_observation, role incidental, no vehicle
--      claim). Newest first. The embedder then picks them up through get_clip_embed_batch unchanged. Measured pick for
--      this user: 262 ms for 300 rows through idx_vehicle_images_user_capture_stats + idx_image_obs_image.
--   3. image_text_read_batch(p_user, p_limit): the frames of one user, admitted sources, newest first, that have no
--      unrevoked text read; for the box-side OCR pass (scripts/photo-text-reads.py), which records through
--      record_image_text_reads as contributor agent:claude-box (probation, like agent:grok-bot: its reads are evidence for
--      the scorer, never a filing by themselves).
--   4. cron clip-carrier-backfill every 10 minutes, 300 carriers per fire.
-- Nothing is filed by this migration; a day is scored only when capture_sets_enqueue names it or a photo arrives.
-- Revert: supabase/sql/revert_20261111110000_vision_pool_library_sources.sql.
-- Contract: supabase/sql/test_vision_pool_library_sources.sql.

SET lock_timeout = '5s';
SET statement_timeout = '120s';

-- 1. Live trigger function, recorded unchanged (the trigger itself: AFTER INSERT ON vehicle_images FOR EACH ROW
--    WHEN (new.source = 'capture_relay_ios')).
CREATE OR REPLACE FUNCTION public.trg_vehicle_images_clip_carrier() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
begin
  begin
    perform ingest_image_observation(new.id, null, 'incidental', 0, 'clip_embed_carrier_v1', 'carrier_v1',
      jsonb_build_object('clip_embed_carrier_v1', jsonb_build_object('purpose','embedding carrier; no vehicle claim','origin','insert_trigger')));
  exception when others then
    raise warning 'clip carrier skipped for %: %', new.id, sqlerrm;   -- never block an upload
  end;
  return null;
end $function$;

-- 2. Carriers for library frames, polled.
CREATE OR REPLACE FUNCTION public.clip_carrier_backfill(p_limit integer DEFAULT 300) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp SET lock_timeout = '2s' AS $$
DECLARE
  r record; v_user uuid; n integer := 0; skipped integer := 0; users integer := 0;
  v_cap integer := greatest(1, least(coalesce(p_limit, 300), 2000));
BEGIN
  FOR v_user IN SELECT DISTINCT user_id FROM capture_upload_status WHERE user_id IS NOT NULL LOOP
    users := users + 1;
    FOR r IN
      SELECT vi.id
      FROM vehicle_images vi
      WHERE vi.user_id = v_user
        AND vi.source = ANY (public.capture_set_photo_sources())
        AND vi.taken_at IS NOT NULL AND vi.taken_at > now() - interval '2 years'
        AND nullif(vi.image_url, '') IS NOT NULL
        AND NOT coalesce(vi.is_duplicate, false) AND NOT coalesce(vi.is_superseded, false)
        AND NOT EXISTS (SELECT 1 FROM image_observations o WHERE o.image_id = vi.id)
      ORDER BY vi.taken_at DESC
      LIMIT v_cap - n
    LOOP
      BEGIN
        PERFORM public.ingest_image_observation(r.id, NULL, 'incidental', 0, 'clip_embed_carrier_v1', 'carrier_v1',
          jsonb_build_object('clip_embed_carrier_v1', jsonb_build_object('purpose', 'embedding carrier; no vehicle claim',
                                                                         'origin', 'library_backfill')));
        n := n + 1;
      EXCEPTION WHEN OTHERS THEN
        skipped := skipped + 1;
      END;
    END LOOP;
    EXIT WHEN n >= v_cap;
  END LOOP;
  RETURN jsonb_build_object('carriers', n, 'skipped', skipped, 'users', users, 'at', now());
END $$;
REVOKE ALL ON FUNCTION public.clip_carrier_backfill(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clip_carrier_backfill(integer) TO service_role;

-- 3. The OCR pass's work list: one user's admitted-source frames without an unrevoked text read, newest first.
CREATE OR REPLACE FUNCTION public.image_text_read_batch(p_user uuid, p_limit integer DEFAULT 200)
RETURNS TABLE(image_id uuid, image_url text, file_hash text, taken_at timestamptz, source text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT vi.id, vi.image_url, vi.file_hash, vi.taken_at, vi.source
  FROM vehicle_images vi
  WHERE vi.user_id = p_user
    AND vi.source = ANY (public.capture_set_photo_sources())
    AND vi.taken_at IS NOT NULL AND vi.taken_at > now() - interval '2 years'
    AND nullif(vi.image_url, '') IS NOT NULL
    AND NOT coalesce(vi.is_duplicate, false) AND NOT coalesce(vi.is_superseded, false)
    AND NOT EXISTS (SELECT 1 FROM image_text_reads r WHERE r.image_id = vi.id AND r.revoked_at IS NULL)
  ORDER BY vi.taken_at DESC
  LIMIT greatest(1, least(coalesce(p_limit, 200), 1000));
$$;
REVOKE ALL ON FUNCTION public.image_text_read_batch(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.image_text_read_batch(uuid, integer) TO service_role;

-- The box-side pass on the owner's Mac records as its own contributor (probation: evidence, never a filing).
INSERT INTO public.contributors (contributor_type, agent_key, agent_version, status)
SELECT 'agent', 'agent:claude-box', 'rapidocr_box_v1', 'probation'
WHERE NOT EXISTS (SELECT 1 FROM public.contributors WHERE agent_key = 'agent:claude-box');

-- 4. Schedule the carrier backfill.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'clip-carrier-backfill';
SELECT cron.schedule('clip-carrier-backfill', '*/10 * * * *',
  $c$SET statement_timeout = '110s'; SELECT public.clip_carrier_backfill(300);$c$);

-- Check: the writers exist, are service-role only, and the contributor is registered.
DO $$
BEGIN
  IF to_regprocedure('public.clip_carrier_backfill(integer)') IS NULL
     OR to_regprocedure('public.image_text_read_batch(uuid,integer)') IS NULL THEN
    RAISE EXCEPTION 'vision pool library sources: writer missing';
  END IF;
  IF has_function_privilege('anon', 'public.clip_carrier_backfill(integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.image_text_read_batch(uuid,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'vision pool library sources: writer reachable by a web role';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.contributors WHERE agent_key = 'agent:claude-box' AND status = 'probation') THEN
    RAISE EXCEPTION 'vision pool library sources: contributor agent:claude-box missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'clip-carrier-backfill') THEN
    RAISE EXCEPTION 'vision pool library sources: cron clip-carrier-backfill missing';
  END IF;
END $$;
