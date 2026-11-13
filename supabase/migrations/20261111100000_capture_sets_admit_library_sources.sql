-- Capture sets score the owner's library frames, not only the phone relay.
--
-- Owner, 2026-11-06, looking at his Mac Photos library: the Firebird's 2026-08-26 light shoot (17 frames), the hood-bird
-- frames of 08-20, and 07-27 / 08-15 shop frames are in Nuke (source 'iphoto', landed by the album importer with EXIF
-- clocks and GPS) and have sat unfiled since they landed, with no capture-set candidate ever written for them. "this
-- sure is a lot i have to explain when the system could be establishing this by organizing images and profiles
-- properly". Measured cause: every leg of the landing chain admits one source, vi.source = 'capture_relay_ios', so a
-- frame from the Mac library (iphoto, iphoto_60d, photo_auto_sync, library_recovery) is invisible to the builder, the
-- scorer, the evidence scorer, the arm-on-arrival and arm-on-text-read steps, the landing tick and the unfiled probe.
-- For this user alone, 2026-11-06: iphoto 2,123 unfiled frames, photo_auto_sync 2,353, library_recovery 43.
--
-- Change: one immutable function names the admitted sources, and the nine source tests in seven functions read it.
-- Nothing is scored by this migration: capture_sets_arm_new_photos still arms only arrivals after its cursor, and a
-- historical day is scored only when capture_sets_enqueue(user, day, reason) names it. Patched by anchored replace on
-- the live bodies (pg_get_functiondef), refusing on drift: each function must carry exactly the expected number of
-- anchors or already be patched. Revert: supabase/sql/revert_20261111100000_capture_sets_admit_library_sources.sql.
-- No contract composes these bodies (they were recorded from the live database by 20261108140000 / 20261109000200);
-- the check block at the end is the deploy-time proof, and the first measured run is a dry landing_run on 2026-08-26.

SET lock_timeout = '5s';
SET statement_timeout = '120s';

CREATE OR REPLACE FUNCTION public.capture_set_photo_sources() RETURNS text[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog, public AS $$
  SELECT ARRAY['capture_relay_ios', 'iphoto', 'iphoto_60d', 'photo_auto_sync', 'library_recovery']
$$;
COMMENT ON FUNCTION public.capture_set_photo_sources() IS
  'vehicle_images.source values the capture-set landing chain scores: the phone relay and the owner''s own library imports (Mac Photos album importer, 60-day importer, the passive library sync, library recovery). user_upload / owner_upload stay anchors only (the scorer''s hist leg) and are not scored as arrivals.';

DO $$
DECLARE
  f record;
  def text;
  hits int;
  patched text;
  expected jsonb := '{"capture_landing_tick": 1, "capture_landing_unfiled_exists": 1, "capture_sets_arm_new_photos": 1,
                      "capture_sets_arm_on_text_read": 1, "capture_sets_build": 1, "capture_sets_score": 2,
                      "capture_sets_score_evidence": 2}'::jsonb;
  marker text := '= ANY (public.capture_set_photo_sources())';
BEGIN
  FOR f IN SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname IN (SELECT jsonb_object_keys(expected)) ORDER BY p.proname LOOP
    def := pg_get_functiondef(f.oid);
    hits := (SELECT count(*) FROM regexp_matches(def, '\m(vi|v|a)\.source = ''capture_relay_ios''', 'g'));
    IF hits = 0 AND position(marker IN def) > 0 THEN
      RAISE NOTICE '% already admits the library sources', f.proname;
      CONTINUE;
    END IF;
    IF hits <> (expected ->> f.proname)::int THEN
      RAISE EXCEPTION 'capture-set source patch refused: % carries % relay-only anchors, expected %', f.proname, hits, expected ->> f.proname;
    END IF;
    patched := regexp_replace(def, '\m(vi|v|a)\.source = ''capture_relay_ios''', '\1.source ' || marker, 'g');
    IF patched = def THEN
      RAISE EXCEPTION 'capture-set source patch made no change to %', f.proname;
    END IF;
    EXECUTE patched;
    RAISE NOTICE '% now reads capture_set_photo_sources() (% anchors)', f.proname, hits;
  END LOOP;
  -- every function named above must exist and carry the marker
  FOR f IN SELECT k AS proname FROM jsonb_object_keys(expected) k LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                    WHERE n.nspname = 'public' AND p.proname = f.proname AND position(marker IN pg_get_functiondef(p.oid)) > 0) THEN
      RAISE EXCEPTION 'capture-set source patch missing on %', f.proname;
    END IF;
  END LOOP;
END $$;

DO $$ BEGIN
  IF NOT ('iphoto' = ANY (public.capture_set_photo_sources()) AND 'capture_relay_ios' = ANY (public.capture_set_photo_sources())) THEN
    RAISE EXCEPTION 'capture_set_photo_sources did not land';
  END IF;
END $$;
