-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_supersede_junk_listing_images -f this-file.sql
-- Contract for 20261018210000_supersede_junk_listing_images.sql. Synthetic rows only; never production.
-- Starting from recompute_vehicle_primary_image, ensure_single_primary_image and sync_vehicle_primary_image as
-- production held them on 2026-10-18, this proves that is_junk_listing_image_url names the page furniture #1878 filters
-- and no real photo, that a dry run changes nothing, that an apply supersedes every junk row (never deletes, never edits
-- image_url) and gives a junk cover the vehicle's own best photo through the recompute (the Cars & Bids 2080 hero, not
-- another auction's 768 or 356x260 card; the Bonhams lot photo, not a flag), that a vehicle with no usable photo keeps
-- its cover and is listed, that a clean cover is left alone, that a rerun is a no-op, that the batch bound holds and
-- that only service_role may call it.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicle_images') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;
CREATE FUNCTION pg_temp.raises(p_sql text) RETURNS boolean LANGUAGE plpgsql AS $$ BEGIN
  EXECUTE p_sql; RETURN false;
EXCEPTION WHEN others THEN RETURN true;
END $$;

CREATE TYPE public.vision_gate_status AS ENUM ('pending', 'approved', 'rejected_personal', 'rejected_misattributed', 'review_needed');
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, is_public boolean, primary_image_url text);
CREATE TABLE public.vehicle_images (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, user_id uuid,
  image_url text, storage_path text, file_hash text, source text, position int,
  taken_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), is_primary boolean DEFAULT false,
  is_superseded boolean, superseded_at timestamptz, is_duplicate boolean, duplicate_of uuid, is_sensitive boolean,
  vision_gate_status public.vision_gate_status, vision_gate_agent_reasoning text, vision_gate_processed_at timestamptz,
  apple_ml_labels text[], image_vehicle_match_status text, ai_scan_metadata jsonb, file_size bigint, vehicle_zone text);
CREATE FUNCTION public.image_hero_score(meta jsonb, fsize bigint) RETURNS numeric LANGUAGE sql IMMUTABLE AS
$$ SELECT coalesce((meta->>'score')::numeric, 0) $$;
\ir helpers/recompute_vehicle_primary_image_live_20261015.sql
\ir ../migrations/20261016151000_device_triage_holds_and_public_cover.sql

-- The two vehicle_images triggers that act on is_primary, as production held them on 2026-10-18.
CREATE FUNCTION public.ensure_single_primary_image() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_primary = true THEN
    UPDATE vehicle_images SET is_primary = false WHERE vehicle_id = NEW.vehicle_id AND id != NEW.id AND is_primary = true;
  END IF;
  RETURN NEW;
END $$;
CREATE TABLE public.recompute_calls (vehicle_id uuid);
CREATE FUNCTION public.sync_vehicle_primary_image() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_vehicle uuid;
BEGIN
  IF current_setting('app.skip_image_count_trigger', true) = '1' THEN RETURN COALESCE(NEW, OLD); END IF;
  IF pg_trigger_depth() > 1 THEN RETURN COALESCE(NEW, OLD); END IF;
  v_vehicle := COALESCE(NEW.vehicle_id, OLD.vehicle_id);
  IF v_vehicle IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'UPDATE' AND NEW.vehicle_id IS NOT DISTINCT FROM OLD.vehicle_id AND NEW.is_primary IS NOT DISTINCT FROM OLD.is_primary
     AND NEW.vision_gate_status IS NOT DISTINCT FROM OLD.vision_gate_status AND NEW.is_duplicate IS NOT DISTINCT FROM OLD.is_duplicate
     AND NEW.is_superseded IS NOT DISTINCT FROM OLD.is_superseded
     AND NEW.image_vehicle_match_status IS NOT DISTINCT FROM OLD.image_vehicle_match_status
     AND NEW.image_url IS NOT DISTINCT FROM OLD.image_url AND NEW.taken_at IS NOT DISTINCT FROM OLD.taken_at THEN
    RETURN NEW;
  END IF;
  INSERT INTO recompute_calls VALUES (v_vehicle);
  PERFORM recompute_vehicle_primary_image(v_vehicle);
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER trigger_ensure_single_primary_image BEFORE INSERT OR UPDATE ON public.vehicle_images
  FOR EACH ROW EXECUTE FUNCTION public.ensure_single_primary_image();
CREATE TRIGGER trg_sync_vehicle_primary_image AFTER DELETE OR UPDATE OF is_primary, is_duplicate, image_vehicle_match_status, image_url
  ON public.vehicle_images FOR EACH ROW EXECUTE FUNCTION public.sync_vehicle_primary_image();

\ir ../migrations/20261018210000_supersede_junk_listing_images.sql
\ir ../migrations/20261018210000_supersede_junk_listing_images.sql

SELECT pg_temp.ok('junk: Cars & Bids sidebar thumbnails', bool_and(public.is_junk_listing_image_url(u))) FROM unnest(ARRAY[
  'https://media.carsandbids.com/cdn-cgi/image/width=148,height=126,quality=70/abc/photos/x.jpg',
  'https://media.carsandbids.com/cdn-cgi/image/width=80,quality=70/abc/photos/x.jpg',
  'https://media.carsandbids.com/cdn-cgi/image/width=320/abc/photos/x.jpg',
  'https://carsandbids.com/sell-page-decoration.png']) u;
SELECT pg_temp.ok('junk: Bonhams web-assets, flags, 230/650 cards and SVGs', bool_and(public.is_junk_listing_image_url(u))) FROM unnest(ARRAY[
  'https://cars.bonhams.com/_next/image.jpg?url=https%3A%2F%2Fwww.bonhams.com%2Fweb-assets%2Fflags%2Fus.png&w=32&q=75',
  'https://cars.bonhams.com/_next/image.jpg?url=https%3A%2F%2Fimg1.bonhams.com%2Fimage%3Fsrc%3DImages%2Flive%2F2023-10%2F26%2FU-5439-0-2.jpeg%26width%3D230&w=2400&q=75',
  'https://cars.bonhams.com/_next/image.jpg?url=https%3A%2F%2Fimg1.bonhams.com%2Fimage%3Fsrc%3DX%26width%3D650&w=2400&q=75',
  'https://www.bonhams.com/flags/gb.png',
  'https://www.bonhams.com/logo.svg']) u;
SELECT pg_temp.ok('not junk: the car''s own photos', NOT bool_or(public.is_junk_listing_image_url(u))) FROM unnest(ARRAY[
  'https://media.carsandbids.com/cdn-cgi/image/width=2080,quality=70/abc/photos/9nqyd4WB-IUpBLjejlF-(edit',
  'https://media.carsandbids.com/cdn-cgi/image/width=542,quality=70/abc/photos/9nqyd4WB-PRvQlfhOEH-(edit',
  'https://cars.bonhams.com/_next/image.jpg?url=https%3A%2F%2Fimg1.bonhams.com%2Fimage%3Fsrc%3DImages%2Flive%2F2022-02%2F25%2F25160832-7-35.jpg&w=2400&q=75',
  'https://images1.bonhams.com/image?src=Images/live/2022-02/25/25160832-7-35.jpg',
  'https://d2niwqq19lf86s.cloudfront.net/photos/1.jpg']) u;

-- V1 Cars & Bids: cover is a sidebar thumbnail; the 2080 hero is the car, 768 and 356x260 are other auctions' cards
-- written later. V2 Bonhams: cover is a flag; position 1 is the lot photo. V3 Bonhams: nothing but furniture.
-- V4: clean cover, one stray junk row.
INSERT INTO public.vehicles VALUES
  ('00000000-0000-4000-8000-000000000001', true, 'https://media.carsandbids.com/cdn-cgi/image/width=148,height=126,quality=70/c5/photos/thumb.jpg'),
  ('00000000-0000-4000-8000-000000000002', true, 'https://cars.bonhams.com/_next/image.jpg?url=https%3A%2F%2Fwww.bonhams.com%2Fweb-assets%2Fflags%2Fus.png&w=32&q=75'),
  ('00000000-0000-4000-8000-000000000003', true, 'https://cars.bonhams.com/_next/image.jpg?url=https%3A%2F%2Fwww.bonhams.com%2Fweb-assets%2Fflags%2Fgb.png&w=32&q=75'),
  ('00000000-0000-4000-8000-000000000004', true, 'https://images1.bonhams.com/image?src=Images/live/own.jpg');
INSERT INTO public.vehicle_images (id, vehicle_id, image_url, source, position, is_primary, created_at) VALUES
  ('00000000-0000-4000-9000-000000000101', '00000000-0000-4000-8000-000000000001', 'https://media.carsandbids.com/cdn-cgi/image/width=148,height=126,quality=70/c5/photos/thumb.jpg', 'external_import', 20, true, '2026-02-27'),
  ('00000000-0000-4000-9000-000000000102', '00000000-0000-4000-8000-000000000001', 'https://media.carsandbids.com/cdn-cgi/image/width=2080,quality=70/36/photos/hero', 'external_import', 0, false, '2026-02-27'),
  ('00000000-0000-4000-9000-000000000103', '00000000-0000-4000-8000-000000000001', 'https://media.carsandbids.com/cdn-cgi/image/width=542,quality=70/36/photos/grid', 'external_import', 1, false, '2026-02-27'),
  ('00000000-0000-4000-9000-000000000104', '00000000-0000-4000-8000-000000000001', 'https://media.carsandbids.com/cdn-cgi/image/width=768,quality=70/90/photos/other-car.jpg', 'external_import', 9, false, '2026-03-01'),
  ('00000000-0000-4000-9000-000000000105', '00000000-0000-4000-8000-000000000001', 'https://media.carsandbids.com/cdn-cgi/image/width=356,height=260,quality=70/7a/photos/card.jpg', 'external_import', 19, false, '2026-03-02'),
  ('00000000-0000-4000-9000-000000000106', '00000000-0000-4000-8000-000000000001', 'https://media.carsandbids.com/cdn-cgi/image/width=148,height=126,quality=70/c5/photos/thumb2.jpg', 'external_import', 21, false, '2026-02-27'),
  ('00000000-0000-4000-9000-000000000201', '00000000-0000-4000-8000-000000000002', 'https://cars.bonhams.com/_next/image.jpg?url=https%3A%2F%2Fwww.bonhams.com%2Fweb-assets%2Fflags%2Fus.png&w=32&q=75', 'bonhams_import', 0, true, '2026-03-01'),
  ('00000000-0000-4000-9000-000000000202', '00000000-0000-4000-8000-000000000002', 'https://cars.bonhams.com/_next/image.jpg?url=https%3A%2F%2Fimg1.bonhams.com%2Fimage%3Fsrc%3DImages%2Flive%2F2022-02%2F25%2F25160832-7-35.jpg&w=2400&q=75', 'bonhams_import', 1, false, '2026-03-01'),
  ('00000000-0000-4000-9000-000000000203', '00000000-0000-4000-8000-000000000002', 'https://cars.bonhams.com/_next/image.jpg?url=https%3A%2F%2Fimg1.bonhams.com%2Fimage%3Fsrc%3DX%26width%3D650&w=2400&q=75', 'bonhams_import', 9, false, '2026-03-05'),
  ('00000000-0000-4000-9000-000000000204', '00000000-0000-4000-8000-000000000002', 'https://images1.bonhams.com/image?src=Images/live/2022-02/25/25160832-7-35.jpg', 'bonhams_import', 17, false, '2026-03-06'),
  ('00000000-0000-4000-9000-000000000301', '00000000-0000-4000-8000-000000000003', 'https://cars.bonhams.com/_next/image.jpg?url=https%3A%2F%2Fwww.bonhams.com%2Fweb-assets%2Fflags%2Fgb.png&w=32&q=75', 'bonhams_import', 0, true, '2026-03-01'),
  ('00000000-0000-4000-9000-000000000302', '00000000-0000-4000-8000-000000000003', 'https://cars.bonhams.com/_next/image.jpg?url=https%3A%2F%2Fimg1.bonhams.com%2Fimage%3Fsrc%3DY%26width%3D230&w=2400&q=75', 'bonhams_import', 1, false, '2026-03-01'),
  ('00000000-0000-4000-9000-000000000401', '00000000-0000-4000-8000-000000000004', 'https://images1.bonhams.com/image?src=Images/live/own.jpg', 'bonhams_import', 0, true, '2026-03-01'),
  ('00000000-0000-4000-9000-000000000402', '00000000-0000-4000-8000-000000000004', 'https://www.bonhams.com/web-assets/logo.svg', 'bonhams_import', 1, false, '2026-03-01');
TRUNCATE public.recompute_calls;
CREATE TEMP TABLE before_images AS SELECT * FROM public.vehicle_images;
CREATE TEMP TABLE before_vehicles AS SELECT * FROM public.vehicles;
CREATE TEMP TABLE ids AS SELECT ARRAY(SELECT id FROM public.vehicles ORDER BY id) AS a;

-- Dry run.
CREATE TEMP TABLE dry AS SELECT public.supersede_junk_listing_images((SELECT a FROM ids), false) AS r;
SELECT pg_temp.ok('dry run reports the junk rows, junk covers, nominees and the vehicle with none',
  (r->'tally') = '{"junk_rows": 7, "superseded": 0, "junk_primary": 3, "nominated": 2, "no_usable_image": 1, "junk_primary_after": 3}'::jsonb
  AND r->'no_usable_image' = '["00000000-0000-4000-8000-000000000003"]'::jsonb) FROM dry;
SELECT pg_temp.ok('dry run changes nothing',
  NOT EXISTS (SELECT * FROM public.vehicle_images EXCEPT SELECT * FROM before_images)
  AND NOT EXISTS (SELECT * FROM public.vehicles EXCEPT SELECT * FROM before_vehicles));

-- Apply.
CREATE TEMP TABLE applied AS SELECT public.supersede_junk_listing_images((SELECT a FROM ids), true) AS r;
SELECT pg_temp.ok('apply supersedes the 7 junk rows and repairs both covers it can',
  (r->'tally') = '{"junk_rows": 7, "superseded": 7, "junk_primary": 3, "nominated": 2, "no_usable_image": 1, "junk_primary_after": 1}'::jsonb)
  FROM applied;
SELECT pg_temp.ok('every junk row is superseded, unflagged and timestamped; no other row is',
  bool_and((is_superseded IS TRUE) = public.is_junk_listing_image_url(image_url))
  AND bool_and(NOT public.is_junk_listing_image_url(image_url) OR (is_primary IS FALSE AND superseded_at IS NOT NULL)))
  FROM public.vehicle_images;
SELECT pg_temp.ok('no row deleted and no image_url edited',
  (SELECT count(*) FROM public.vehicle_images) = (SELECT count(*) FROM before_images)
  AND NOT EXISTS (SELECT b.id FROM before_images b JOIN public.vehicle_images v USING (id) WHERE v.image_url IS DISTINCT FROM b.image_url));
SELECT pg_temp.ok('Cars & Bids cover is the 2080 hero, not another auction''s card',
  primary_image_url = 'https://media.carsandbids.com/cdn-cgi/image/width=2080,quality=70/36/photos/hero')
  FROM public.vehicles WHERE id = '00000000-0000-4000-8000-000000000001';
SELECT pg_temp.ok('Cars & Bids hero is the one primary row',
  array_agg(id) = ARRAY['00000000-0000-4000-9000-000000000102'::uuid])
  FROM public.vehicle_images WHERE vehicle_id = '00000000-0000-4000-8000-000000000001' AND is_primary;
SELECT pg_temp.ok('other auctions'' 768 and 356x260 cards are not superseded by this writer',
  bool_and(COALESCE(is_superseded, false) = false))
  FROM public.vehicle_images WHERE id IN ('00000000-0000-4000-9000-000000000104', '00000000-0000-4000-9000-000000000105');
SELECT pg_temp.ok('Bonhams cover is the lot photo at gallery position 1',
  primary_image_url = 'https://cars.bonhams.com/_next/image.jpg?url=https%3A%2F%2Fimg1.bonhams.com%2Fimage%3Fsrc%3DImages%2Flive%2F2022-02%2F25%2F25160832-7-35.jpg&w=2400&q=75')
  FROM public.vehicles WHERE id = '00000000-0000-4000-8000-000000000002';
SELECT pg_temp.ok('a vehicle with no usable photo keeps its cover and is listed',
  v.primary_image_url = b.primary_image_url AND a.r->'no_usable_image' = '["00000000-0000-4000-8000-000000000003"]'::jsonb)
  FROM public.vehicles v JOIN before_vehicles b USING (id), applied a WHERE v.id = '00000000-0000-4000-8000-000000000003';
SELECT pg_temp.ok('a clean cover is left alone',
  primary_image_url = 'https://images1.bonhams.com/image?src=Images/live/own.jpg')
  FROM public.vehicles WHERE id = '00000000-0000-4000-8000-000000000004';
SELECT pg_temp.ok('the sync trigger did not recompute once per superseded row', count(*) = 0) FROM public.recompute_calls;
SELECT pg_temp.ok('the skip setting is restored after the call',
  COALESCE(current_setting('app.skip_image_count_trigger', true), '') = '');

-- Rerun.
CREATE TEMP TABLE rerun AS SELECT public.supersede_junk_listing_images((SELECT a FROM ids), true) AS r;
SELECT pg_temp.ok('a rerun is a no-op',
  (r->'tally') = '{"junk_rows": 0, "superseded": 0, "junk_primary": 1, "nominated": 0, "no_usable_image": 1, "junk_primary_after": 1}'::jsonb)
  FROM rerun;

-- Bounds and grants.
SELECT pg_temp.ok('an empty list is refused', pg_temp.raises($q$SELECT public.supersede_junk_listing_images('{}'::uuid[], false)$q$));
SELECT pg_temp.ok('more than 100 vehicles is refused', pg_temp.raises(
  $q$SELECT public.supersede_junk_listing_images(ARRAY(SELECT gen_random_uuid() FROM generate_series(1, 101)), false)$q$));
SELECT pg_temp.ok('only service_role may call the writer',
  has_function_privilege('service_role', 'public.supersede_junk_listing_images(uuid[], boolean)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.supersede_junk_listing_images(uuid[], boolean)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.supersede_junk_listing_images(uuid[], boolean)', 'EXECUTE'));
