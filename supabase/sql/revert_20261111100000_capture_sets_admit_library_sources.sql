-- Revert of 20261111100000_capture_sets_admit_library_sources.sql: the seven landing-chain functions go back to the
-- phone relay as their only scored source, then the sources function is dropped. Anchored on the marker the migration
-- wrote; a body without it is left alone.
SET lock_timeout = '5s';
SET statement_timeout = '120s';

DO $$
DECLARE f record; def text; patched text;
BEGIN
  FOR f IN SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname IN ('capture_landing_tick', 'capture_landing_unfiled_exists', 'capture_sets_arm_new_photos',
                                                         'capture_sets_arm_on_text_read', 'capture_sets_build', 'capture_sets_score', 'capture_sets_score_evidence') LOOP
    def := pg_get_functiondef(f.oid);
    patched := replace(def, '= ANY (public.capture_set_photo_sources())', '= ''capture_relay_ios''');
    IF patched <> def THEN EXECUTE patched; RAISE NOTICE '% back to the relay-only source', f.proname; END IF;
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS public.capture_set_photo_sources();
