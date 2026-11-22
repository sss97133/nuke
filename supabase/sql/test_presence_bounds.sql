-- Contract: 20261122011000. user_presence_blocks reads every record of one user's photo stream (filed or not, with or
-- without a picture) into time blocks of one kind (a gap over 3 h starts a new one) on local days in the given zone;
-- vehicle_presence_bounds turns them into a floor (minutes on this vehicle) and a ceiling (day spans with this vehicle or
-- an unknown-subject site block, minus the time nearest a block on another vehicle or away). Cases: an unfiled at-site
-- photo raises the ceiling and not the floor; a photo of another car the same day lowers it; a picture-less away record
-- lowers it; a no-location-only day adds nothing; a gap over 3 h splits a block and is not floor; local day edges follow
-- the zone; a stranger, anon, or the owner naming another user's stream is refused; an empty range returns zeros; no
-- coordinate leaves either reader. Also: grants, replay is a no-op, revert, the guard refuses without the index or the
-- edit helper, re-apply.
-- Disposable PG17 only, synthetic rows only (made-up ids, places and times). user_can_edit_vehicle is a fixture over the
-- vehicle's owner columns only (production also admits contributors, roles and organisations).
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR current_setting('server_version_num')::int / 10000 <> 17
    OR EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r','p','v','m')) THEN
    RAISE EXCEPTION 'Refusing fixtures outside an empty disposable PG17 database';
  END IF;
END $$;
SET statement_timeout = '120s';
SET lock_timeout = '3s';
SET TIME ZONE 'UTC';
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text $$;
GRANT USAGE ON SCHEMA auth TO PUBLIC;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE FUNCTION public.t_assert(cond boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF; RAISE NOTICE 'PASS %', label; END $$;
CREATE FUNCTION public.t_refused(sql text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE sql; RETURN false; EXCEPTION WHEN insufficient_privilege THEN RETURN true; END $$;
CREATE FUNCTION public.t_as(sub text, role text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', jsonb_strip_nulls(jsonb_build_object('sub', nullif(sub, ''), 'role', role))::text, false) $$;

-- ===== fixture tables: the columns the readers read
CREATE TABLE public.vehicles(id uuid PRIMARY KEY, user_id uuid, owner_id uuid, uploaded_by uuid);
CREATE TABLE public.vehicle_images(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, vehicle_id uuid,
  taken_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), image_url text, latitude numeric, longitude numeric,
  ai_scan_metadata jsonb);
CREATE INDEX idx_vehicle_images_user_contrib_day ON public.vehicle_images (user_id, COALESCE(taken_at, created_at));
CREATE TABLE public.user_sites(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, name text,
  lat double precision, lon double precision, radius_m integer NOT NULL DEFAULT 150);
CREATE FUNCTION public.user_can_edit_vehicle(p_vehicle_id uuid, p_user_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM vehicles v WHERE v.id = p_vehicle_id
                   AND p_user_id IN (v.uploaded_by, v.user_id, v.owner_id)) $$;

-- Owner U, his car V, another car W he also films, a stranger X. One site; "away" is ~11 km off it.
INSERT INTO public.vehicles VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', NULL),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-00000000000a', NULL, NULL);
INSERT INTO public.user_sites(user_id, name, lat, lon, radius_m) VALUES ('00000000-0000-0000-0000-00000000000a', 'shop', 10.0, 20.0, 150);
CREATE FUNCTION public.t_img(ts text, v text, la numeric, lo numeric, url text DEFAULT 'x.jpg', t text DEFAULT 'vehicle_interior')
RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.vehicle_images(user_id, vehicle_id, taken_at, image_url, latitude, longitude, ai_scan_metadata)
  VALUES ('00000000-0000-0000-0000-00000000000a', v::uuid, ts::timestamptz, url, la, lo,
          CASE WHEN t IS NULL THEN NULL ELSE jsonb_build_object('classification', jsonb_build_object('image_type', t)) END) $$;

\ir ../migrations/20261122011000_presence_bounds.sql
-- Bounds for V on 2026-03-02..03 Pacific (PST, UTC-8), read by the owner.
CREATE FUNCTION public.t_bounds() RETURNS TABLE(f numeric, c numeric, fb int, cd int, recs int, other numeric, away numeric)
LANGUAGE sql AS $$
  SELECT floor_minutes, ceiling_minutes, floor_blocks, ceiling_days, records, minutes_removed_other_vehicle, minutes_removed_away
    FROM public.vehicle_presence_bounds('00000000-0000-0000-0000-0000000000a1', '2026-03-02', '2026-03-03', 'America/Los_Angeles') $$;
SELECT public.t_as('00000000-0000-0000-0000-00000000000a', 'authenticated');

-- ===== step 0: three photos of V at the site, 09:00-10:00 local (17:00-18:00 UTC)
SELECT public.t_img('2026-03-02 17:00+00', '00000000-0000-0000-0000-0000000000a1', 10.0, 20.0);
SELECT public.t_img('2026-03-02 17:30+00', '00000000-0000-0000-0000-0000000000a1', 10.0, 20.0);
SELECT public.t_img('2026-03-02 18:00+00', '00000000-0000-0000-0000-0000000000a1', 10.0, 20.0);
SELECT public.t_assert((SELECT f = 60 AND c = 60 AND fb = 1 AND cd = 1 AND recs = 3 FROM public.t_bounds()),
  'on the car only: floor = ceiling = 60 min');

-- ===== step 1: an unfiled photo at the site at 12:00 raises the ceiling, not the floor
SELECT public.t_img('2026-03-02 20:00+00', NULL, 10.0005, 20.0005, 'x.jpg', 'other');
SELECT public.t_assert((SELECT f = 60 AND c = 180 FROM public.t_bounds()),
  'unfiled at-site photo: floor 60 stays, ceiling 60 -> 180');

-- ===== step 2: a photo of another car W at 11:00 lowers the ceiling by the time nearest it
SELECT public.t_img('2026-03-02 19:00+00', '00000000-0000-0000-0000-0000000000b2', 10.0, 20.0);
SELECT public.t_assert((SELECT f = 60 AND c = 120 AND other = 60 FROM public.t_bounds()),
  'another car the same day: ceiling 180 -> 120 (10:30-11:30 belongs to W)');

-- ===== step 3: a record away from every site, with no picture, at 11:45 lowers it again
SELECT public.t_img('2026-03-02 19:45+00', NULL, 10.1, 20.0, '', NULL);
SELECT public.t_assert((SELECT f = 60 AND c = 97.5 AND away = 30 AND other = 52.5 FROM public.t_bounds()),
  'picture-less away record: ceiling 120 -> 97.5');
SELECT public.t_assert((SELECT b.kind = 'away' AND b.no_image_count = 1 AND b.photo_count = 1 AND b.first_read_types = '{"unread": 1}'
    FROM public.user_presence_blocks('00000000-0000-0000-0000-00000000000a', '2026-03-02', '2026-03-02', 'America/Los_Angeles') b
   WHERE b.block_start = '2026-03-02 19:45+00'),
  'the away record is its own block, counted with no image and type unread');
SELECT public.t_assert((SELECT array_agg(b.kind ORDER BY b.block_start) = ARRAY['on_vehicle','on_vehicle','away','at_site_unknown_subject']
    FROM public.user_presence_blocks('00000000-0000-0000-0000-00000000000a', '2026-03-02', '2026-03-02', 'America/Los_Angeles') b),
  'blocks of the day in order: V, W, away, site');

-- ===== step 4: a day with only a no-location record adds nothing to either bound
SELECT public.t_img('2026-03-03 18:00+00', NULL, NULL, NULL);
SELECT public.t_assert((SELECT f = 60 AND c = 97.5 AND cd = 1 AND recs = 7 FROM public.t_bounds()),
  'no-location-only day: counted as a record, adds no ceiling');

-- ===== step 5: a gap over 3 h on V starts a new block and is not floor
SELECT public.t_img('2026-03-03 22:00+00', '00000000-0000-0000-0000-0000000000a1', 10.0, 20.0);
SELECT public.t_img('2026-03-03 22:20+00', '00000000-0000-0000-0000-0000000000a1', 10.0, 20.0);
SELECT public.t_img('2026-03-04 02:00+00', '00000000-0000-0000-0000-0000000000a1', 10.0, 20.0);  -- 18:00 local, 3 h 40 later
SELECT public.t_assert((SELECT f = 80 AND fb = 3 AND cd = 2 FROM public.t_bounds()),
  'gap over 3 h: two blocks on 03-03, floor adds only the 20 min inside them');

-- ===== step 6: local day edges follow the zone
SELECT public.t_img('2026-03-02 07:30+00', NULL, 10.0, 20.0);  -- 2026-03-01 23:30 local: outside the range
SELECT public.t_img('2026-03-04 07:59+00', NULL, NULL, NULL);  -- 2026-03-03 23:59 local: inside
SELECT public.t_assert((SELECT recs = 11 FROM public.t_bounds()), 'day edges in the given zone, not UTC');

-- ===== access
SELECT public.t_as('00000000-0000-0000-0000-00000000000f', 'authenticated');
SELECT public.t_assert(public.t_refused($q$SELECT * FROM public.user_presence_blocks('00000000-0000-0000-0000-00000000000a', '2026-03-02', '2026-03-03', 'UTC')$q$)
  AND public.t_refused($q$SELECT * FROM public.vehicle_presence_bounds('00000000-0000-0000-0000-0000000000a1', '2026-03-02', '2026-03-03', 'UTC')$q$),
  'a stranger is refused by both readers');
SELECT public.t_as('', 'anon');
SELECT public.t_assert(public.t_refused($q$SELECT * FROM public.vehicle_presence_bounds('00000000-0000-0000-0000-0000000000a1', '2026-03-02', '2026-03-03', 'UTC')$q$),
  'a caller with no user is refused');
SELECT public.t_as('00000000-0000-0000-0000-00000000000a', 'authenticated');
SELECT public.t_assert(public.t_refused($q$SELECT * FROM public.vehicle_presence_bounds('00000000-0000-0000-0000-0000000000a1', '2026-03-02', '2026-03-03', 'UTC', '00000000-0000-0000-0000-00000000000f')$q$),
  'the owner may not name another user''s stream');
SELECT public.t_as('', 'service_role');
SELECT public.t_assert((SELECT floor_minutes = 80 AND ceiling_minutes > 0 FROM public.vehicle_presence_bounds(
    '00000000-0000-0000-0000-0000000000a1', '2026-03-02', '2026-03-03', 'America/Los_Angeles')),
  'service role reads the owner''s stream by default');
SELECT public.t_as('00000000-0000-0000-0000-00000000000a', 'authenticated');

-- ===== empty range returns zeros
SELECT public.t_assert((SELECT floor_minutes = 0 AND ceiling_minutes = 0 AND records = 0 AND floor_blocks = 0 AND ceiling_days = 0
    AND days_in_range = 31 AND days_with_record = 0
    FROM public.vehicle_presence_bounds('00000000-0000-0000-0000-0000000000a1', '2025-01-01', '2025-01-31', 'America/Los_Angeles'))
  AND (SELECT days_in_range = 0 AND records = 0 FROM public.vehicle_presence_bounds('00000000-0000-0000-0000-0000000000a1', '2026-03-03', '2026-03-02', 'UTC'))
  AND NOT EXISTS (SELECT 1 FROM public.user_presence_blocks('00000000-0000-0000-0000-00000000000a', '2025-01-01', '2025-01-31', 'UTC')),
  'empty range: zeros and no blocks');

-- ===== no coordinate in either result
SELECT public.t_assert(NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proargnames) n
   WHERE p.proname IN ('user_presence_blocks', 'vehicle_presence_bounds') AND n ~* '(lat|lon|coord|site_name)'),
  'no coordinate or site name in the readers'' columns');

-- ===== grants
SELECT public.t_assert(NOT has_function_privilege('anon', 'public.user_presence_blocks(uuid,date,date,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.vehicle_presence_bounds(uuid,date,date,text,uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.vehicle_presence_bounds(uuid,date,date,text,uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.user_presence_blocks(uuid,date,date,text)', 'EXECUTE')
  AND NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.proname IN ('user_presence_blocks', 'vehicle_presence_bounds')
                    AND a.grantee = 0)
  AND (SELECT bool_and(prosecdef) FROM pg_proc WHERE proname IN ('user_presence_blocks', 'vehicle_presence_bounds')),
  'grants: PUBLIC and anon nothing, authenticated and service role execute; SECURITY DEFINER');

-- ===== replay is a no-op
CREATE TABLE public.t_state AS SELECT (SELECT md5(string_agg(prosrc, '' ORDER BY proname)) FROM pg_proc
  WHERE proname IN ('user_presence_blocks', 'vehicle_presence_bounds')) AS m, (SELECT c FROM public.t_bounds()) AS c;
\ir ../migrations/20261122011000_presence_bounds.sql
SELECT public.t_assert((SELECT md5(string_agg(prosrc, '' ORDER BY proname)) FROM pg_proc
  WHERE proname IN ('user_presence_blocks', 'vehicle_presence_bounds')) = (SELECT m FROM public.t_state)
  AND (SELECT c FROM public.t_bounds()) = (SELECT c FROM public.t_state), 'replay: no change');

-- ===== revert
DROP FUNCTION public.t_bounds();
\ir revert_20261122011000_presence_bounds.sql
SELECT public.t_assert(to_regprocedure('public.user_presence_blocks(uuid,date,date,text)') IS NULL
  AND to_regprocedure('public.vehicle_presence_bounds(uuid,date,date,text,uuid)') IS NULL, 'revert: both readers removed');

-- ===== refused: without the index, or without the edit helper; nothing is created
DROP INDEX public.idx_vehicle_images_user_contrib_day;
\set ON_ERROR_STOP off
\ir ../migrations/20261122011000_presence_bounds.sql
\set ON_ERROR_STOP on
SELECT public.t_assert(to_regprocedure('public.user_presence_blocks(uuid,date,date,text)') IS NULL, 'refused: no index, nothing created');
CREATE INDEX idx_vehicle_images_user_contrib_day ON public.vehicle_images (user_id, COALESCE(taken_at, created_at));
ALTER FUNCTION public.user_can_edit_vehicle(uuid, uuid) RENAME TO t_moved_can_edit;
\set ON_ERROR_STOP off
\ir ../migrations/20261122011000_presence_bounds.sql
\set ON_ERROR_STOP on
SELECT public.t_assert(to_regprocedure('public.vehicle_presence_bounds(uuid,date,date,text,uuid)') IS NULL, 'refused: no edit helper, nothing created');
ALTER FUNCTION public.t_moved_can_edit(uuid, uuid) RENAME TO user_can_edit_vehicle;

-- ===== re-apply
\ir ../migrations/20261122011000_presence_bounds.sql
SELECT public.t_assert((SELECT md5(string_agg(prosrc, '' ORDER BY proname)) FROM pg_proc
  WHERE proname IN ('user_presence_blocks', 'vehicle_presence_bounds')) = (SELECT m FROM public.t_state), 're-apply: the same readers');
