-- Capture sets also land the owner's unfiled web uploads that carry a camera capture time (20261113120700).
--
-- Measured 2026-11-09: 2,443 of the owner's unsorted photos come from sources the landing chain never reads
-- (user_upload 2,261 - 2,247 of them one bulk web upload on 2025-12-06/07 - image_intake 177, direct_pull_2026_05_23 4,
-- drop-folder 1). 20261111100000 kept user_upload / owner_upload "anchors only" because a web upload is normally a photo the
-- owner filed onto a vehicle himself. These rows were never on any vehicle, so they are not anchors either: nothing ever
-- looks at them.
--
-- Change:
--   * capture_set_photo_admits(source, vehicle_id, exif) - the library sources as before, plus an UNFILED user_upload /
--     owner_upload / drop-folder / direct_pull_* frame that carries EXIF DateTimeOriginal. A frame with no camera clock
--     (taken_at = upload time; 520 of the 552 such uploads) is not admitted: it would invent a capture session on the
--     upload day. image_intake (no EXIF on any row) stays out. A FILED upload is still never a set member, so the
--     owner's hand-filed uploads are never re-scored.
--   * The six member tests read it (landing tick, unfiled probe, arrival arm, text-read arm, build, score).
--   * A machine-filed upload no longer counts as hand-filed: the scorer's anchor rule and capture_filing_trust give the
--     upload shortcut only when no capture_set_links row filed it; a landed upload anchors / vouches only through its
--     run's visual gate, like every other machine filing.
-- Nothing is scored by this migration; historical days are planned only when capture_sets_enqueue names them.
-- Patched by anchored replace on the live bodies, refusing on drift (each body must carry exactly the expected anchors or
-- already be patched); prior bodies are kept in capture_admit_uploads_prev_defs for the revert.
-- Owner note: capture landing code is Codex-owned; this is a draft for its review.
-- Revert: supabase/sql/revert_20261113120700_capture_admit_unfiled_uploads.sql

SET lock_timeout = '5s';
SET statement_timeout = '120s';

-- no SET search_path so the planner can inline it per row; every name is schema-qualified
CREATE OR REPLACE FUNCTION public.capture_set_photo_admits(p_source text, p_vehicle_id uuid, p_exif jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT p_source = ANY (public.capture_set_photo_sources())
      OR (p_vehicle_id IS NULL
          AND (p_source = ANY (ARRAY['user_upload', 'owner_upload', 'drop-folder']) OR p_source LIKE 'direct\_pull\_%')
          AND coalesce(p_exif ? 'DateTimeOriginal', false))
$$;
COMMENT ON FUNCTION public.capture_set_photo_admits(text, uuid, jsonb) IS
  'True when the capture-set landing chain scores this vehicle_images row as a member: a library source (capture_set_photo_sources), or an unfiled user_upload / owner_upload / drop-folder / direct_pull_* frame with an EXIF DateTimeOriginal (20261113120700).';
REVOKE ALL ON FUNCTION public.capture_set_photo_admits(text, uuid, jsonb) FROM PUBLIC, anon;

CREATE TABLE IF NOT EXISTS public.capture_admit_uploads_prev_defs (
  proname text PRIMARY KEY, def text NOT NULL, md5 text NOT NULL, saved_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.capture_admit_uploads_prev_defs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.capture_admit_uploads_prev_defs FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  f record; def text; patched text; hits int; want int;
  member_re text := '\m(vi|v)\.source = ANY \(public\.capture_set_photo_sources\(\)\)';
  member_new text := 'public.capture_set_photo_admits(\1.source, \1.vehicle_id, \1.exif_data)';
  anchor_old text := 'a.source in (''user_upload'',''owner_upload'')';
  anchor_new text := '(a.source in (''user_upload'',''owner_upload'') and not exists (select 1 from capture_set_links l0 where l0.image_id = a.id and l0.reverted_at is null))';
  trust_old text := 'when p_source in (''user_upload'',''owner_upload'') then 1.0';
  trust_new text := 'when p_source in (''user_upload'',''owner_upload'') and not exists (select 1 from capture_set_links l0 where l0.image_id = p_image and l0.reverted_at is null) then 1.0';
  expected jsonb := '{"capture_landing_tick": 1, "capture_landing_unfiled_exists": 1, "capture_sets_arm_new_photos": 1,
                      "capture_sets_arm_on_text_read": 1, "capture_sets_build": 1, "capture_sets_score": 1, "capture_filing_trust": 0}';
BEGIN
  FOR f IN SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname IN (SELECT jsonb_object_keys(expected)) ORDER BY p.proname LOOP
    def := pg_get_functiondef(f.oid);
    IF position('capture_set_photo_admits(' IN def) > 0 OR position(trust_new IN def) > 0 THEN
      RAISE NOTICE '% already patched', f.proname; CONTINUE;
    END IF;
    want := (expected ->> f.proname)::int;
    hits := (SELECT count(*) FROM regexp_matches(def, member_re, 'g'));
    IF hits <> want THEN
      RAISE EXCEPTION 'admit-uploads patch refused: % carries % member anchors, expected %', f.proname, hits, want;
    END IF;
    patched := regexp_replace(def, member_re, member_new, 'g');
    IF f.proname = 'capture_sets_score' THEN
      IF (length(def) - length(replace(def, anchor_old, ''))) / length(anchor_old) <> 1 THEN
        RAISE EXCEPTION 'admit-uploads patch refused: capture_sets_score upload-anchor clause drifted';
      END IF;
      patched := replace(patched, anchor_old, anchor_new);
    ELSIF f.proname = 'capture_filing_trust' THEN
      IF (length(def) - length(replace(def, trust_old, ''))) / length(trust_old) <> 1 THEN
        RAISE EXCEPTION 'admit-uploads patch refused: capture_filing_trust upload clause drifted';
      END IF;
      patched := replace(patched, trust_old, trust_new);
    END IF;
    IF patched = def THEN RAISE EXCEPTION 'admit-uploads patch made no change to %', f.proname; END IF;
    INSERT INTO public.capture_admit_uploads_prev_defs(proname, def, md5) VALUES (f.proname, def, md5(def))
      ON CONFLICT (proname) DO NOTHING;
    EXECUTE patched;
    RAISE NOTICE '% patched', f.proname;
  END LOOP;
  FOR f IN SELECT k AS proname FROM jsonb_object_keys(expected) k LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                    WHERE n.nspname = 'public' AND p.proname = f.proname
                      AND (position('capture_set_photo_admits(' IN pg_get_functiondef(p.oid)) > 0
                           OR position(trust_new IN pg_get_functiondef(p.oid)) > 0)) THEN
      RAISE EXCEPTION 'admit-uploads patch missing on %', f.proname;
    END IF;
  END LOOP;
END $$;
