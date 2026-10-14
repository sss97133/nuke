-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_device_attribution -f this-file.sql
-- Proves the phone-photo failure and its fix. With the live device-attribution functions as an invoker trigger,
-- an authenticated insert of a phone-shaped frame (flat camera_make / camera_model EXIF keys, no vehicle) is
-- refused by row security on ghost_users and rolls back; after the migration the same insert lands, and the ghost
-- user and device attribution are written. A frame with no camera keys lands either way. The rows below are a
-- disposable test database's rows, never production testimony.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicle_images') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.auth_uid', true), '')::uuid $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public, auth TO authenticated;

-- The tables as production shapes them, the columns the functions touch.
CREATE TABLE public.vehicle_images (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, user_id uuid,
  source text, image_url text, exif_data jsonb, taken_at timestamptz);
CREATE TABLE public.ghost_users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), device_fingerprint text NOT NULL UNIQUE,
  camera_make text, camera_model text, lens_model text, software_version text, display_name text,
  total_contributions integer DEFAULT 0, first_seen_at timestamptz DEFAULT now(), last_seen_at timestamptz DEFAULT now());
CREATE TABLE public.device_attributions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), image_id uuid UNIQUE,
  device_fingerprint text NOT NULL, ghost_user_id uuid, uploaded_by_user_id uuid, attribution_source text DEFAULT 'exif_device',
  confidence_score integer DEFAULT 100);
-- Row security as production has it: the phone may insert and read its own frames; ghost_users and
-- device_attributions have row security and no insert policy.
ALTER TABLE public.vehicle_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_insert ON public.vehicle_images FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY own_select ON public.vehicle_images FOR SELECT USING (auth.uid() = user_id);
ALTER TABLE public.ghost_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_attributions ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.vehicle_images, public.ghost_users, public.device_attributions TO authenticated;

\ir helpers/device_attribution_live_20261014.sql
CREATE TRIGGER trg_auto_attribute_device AFTER INSERT ON public.vehicle_images
  FOR EACH ROW EXECUTE FUNCTION public.auto_attribute_image_to_device();

CREATE FUNCTION public.t_assert(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(p_ok, false) THEN RAISE EXCEPTION 'FAIL: %', p_what; END IF; END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean, text) TO authenticated;

-- 1. Before the fix: the phone's frame is refused and nothing lands.
SET ROLE authenticated;
SET test.auth_uid = '20000000-0000-0000-0000-000000000001';
DO $$
DECLARE refused boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.vehicle_images (user_id, source, image_url, exif_data, taken_at) VALUES
      ('20000000-0000-0000-0000-000000000001', 'capture_relay_ios', 'https://x/a.jpg',
       '{"camera_make": "Apple", "camera_model": "iPhone 15 Pro", "synced_by": "capture-relay-ios"}', '2026-10-01T12:00:00Z');
  EXCEPTION WHEN insufficient_privilege THEN refused := true;
  END;
  PERFORM public.t_assert(refused, 'before the fix the phone frame is refused by row security');
  PERFORM public.t_assert((SELECT count(*) FROM public.vehicle_images) = 0, 'and nothing landed');
  -- A frame with no camera keys never reaches the attribution writes, so it lands even before the fix.
  INSERT INTO public.vehicle_images (user_id, source, image_url, exif_data) VALUES
    ('20000000-0000-0000-0000-000000000001', 'capture_relay_ios', 'https://x/no-camera.jpg', '{}');
  PERFORM public.t_assert((SELECT count(*) FROM public.vehicle_images) = 1, 'a frame with no camera keys lands');
END $$;
RESET ROLE;

-- 2. The fix.
\ir ../migrations/20261014014500_device_attribution_runs_as_owner.sql

-- 3. After the fix: the same frame lands, signed into ghost_users and device_attributions.
SET ROLE authenticated;
SET test.auth_uid = '20000000-0000-0000-0000-000000000001';
DO $$ BEGIN
  INSERT INTO public.vehicle_images (user_id, source, image_url, exif_data, taken_at) VALUES
    ('20000000-0000-0000-0000-000000000001', 'capture_relay_ios', 'https://x/a.jpg',
     '{"camera_make": "Apple", "camera_model": "iPhone 15 Pro", "synced_by": "capture-relay-ios"}', '2026-10-01T12:00:00Z');
  PERFORM public.t_assert((SELECT count(*) FROM public.vehicle_images WHERE image_url = 'https://x/a.jpg') = 1, 'after the fix the phone frame lands');
  -- A second frame from the same phone reuses the ghost user.
  INSERT INTO public.vehicle_images (user_id, source, image_url, exif_data) VALUES
    ('20000000-0000-0000-0000-000000000001', 'capture_relay_ios', 'https://x/b.jpg',
     '{"camera_make": "Apple", "camera_model": "iPhone 15 Pro", "synced_by": "capture-relay-ios"}');
END $$;
RESET ROLE;
SELECT public.t_assert((SELECT count(*) FROM public.ghost_users) = 1, 'one ghost user for the device');
SELECT public.t_assert((SELECT total_contributions FROM public.ghost_users) = 2, 'two contributions from it');
SELECT public.t_assert((SELECT count(*) FROM public.device_attributions) = 2, 'both frames attributed to the device');
SELECT public.t_assert((SELECT prosecdef FROM pg_proc WHERE oid = 'public.auto_attribute_image_to_device()'::regprocedure), 'runs as its owner');
SELECT 'device attribution as owner contract: PASS' AS result;
