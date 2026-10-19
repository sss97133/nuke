-- Disposable PG17 only. Synthetic fixtures; exercises the actual migration.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_%' OR to_regclass('public.vehicle_images') IS NOT NULL THEN
    RAISE EXCEPTION 'Empty disposable database required';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' $$;
GRANT USAGE ON SCHEMA auth TO PUBLIC;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE TABLE public.vehicles(id uuid PRIMARY KEY, year int, make text, model text, is_public boolean, deleted_at timestamptz);
CREATE TABLE public.vehicle_images(id uuid PRIMARY KEY, vehicle_id uuid, user_id uuid, image_url text, thumbnail_url text, medium_url text,
  taken_at timestamptz, is_external boolean, is_sensitive boolean, vision_gate_status text, is_superseded boolean);
-- Live helper (subset): the fixture keeps only the superseded and URL checks.
CREATE FUNCTION public.vehicle_image_gallery_eligible(public.vehicle_images) RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT coalesce(($1).is_superseded, false) = false AND nullif(btrim(($1).image_url), '') IS NOT NULL $$;
CREATE TABLE public.vehicle_observations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind text, structured_data jsonb, is_superseded boolean DEFAULT false,
  source_id uuid DEFAULT gen_random_uuid(), observed_at timestamptz);

INSERT INTO vehicles VALUES ('40000000-0000-0000-0000-000000000001',1972,'Chevrolet','K5 Blazer',true,NULL),
  ('40000000-0000-0000-0000-000000000002',1990,'Ford','F-250',false,NULL);
INSERT INTO vehicle_images(id,vehicle_id,user_id,image_url,thumbnail_url,taken_at,is_external,is_sensitive,vision_gate_status) VALUES
 ('50000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000a','https://img.example/1.jpg','https://img.example/1t.jpg','2026-10-01',false,false,'approved'),
 ('50000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000a','https://img.example/2.jpg',NULL,'2026-10-02',false,false,'approved'),
 ('50000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-00000000000a','https://img.example/3.jpg',NULL,'2026-10-03',false,false,'approved'),
 ('50000000-0000-0000-0000-000000000004','40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000a','https://img.example/4.jpg',NULL,'2026-10-04',false,true,'approved'),
 ('50000000-0000-0000-0000-000000000005','40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000a','https://img.example/5.jpg',NULL,'2026-10-05',false,false,'review_needed');
INSERT INTO vehicle_observations(kind,structured_data,observed_at)
SELECT 'condition', jsonb_build_object('image_id', i, 'analysis_kind', 'image_deep_byok', 'workshop_signals', jsonb_build_object('tools_visible', tv)), '2026-10-10'
FROM (VALUES ('50000000-0000-0000-0000-000000000001', '["2-post lift","floor jack"]'::jsonb),
             ('50000000-0000-0000-0000-000000000002', '["Two-Post Lift","two-post lift"]'::jsonb),
             ('50000000-0000-0000-0000-000000000003', '["floor jack"]'::jsonb),
             ('50000000-0000-0000-0000-000000000004', '["welding table"]'::jsonb),
             ('50000000-0000-0000-0000-000000000005', '["bench vise"]'::jsonb)) x(i, tv);
-- An older analysis of photo 1 is superseded and does not count.
INSERT INTO vehicle_observations(kind,structured_data,observed_at,is_superseded) VALUES
 ('condition', '{"image_id":"50000000-0000-0000-0000-000000000001","analysis_kind":"image_deep_byok","workshop_signals":{"tools_visible":["air compressor"]}}', '2026-09-01', true);

\ir ../migrations/20261020104500_tool_action_shots_read.sql

CREATE FUNCTION public.t_assert(v boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF; RAISE NOTICE 'PASS: %',label; END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean,text) TO authenticated, anon, service_role;

SET ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}',false);
SELECT user_tool_action_shots_read('10000000-0000-0000-0000-00000000000a') AS own \gset
SELECT user_tool_action_shots_read('10000000-0000-0000-0000-00000000000a','2-post lift',1) AS lift1 \gset
RESET ROLE;
SET ROLE anon;
SELECT set_config('request.jwt.claims','{"role":"anon"}',false);
SELECT user_tool_action_shots_read('10000000-0000-0000-0000-00000000000a') AS pub \gset
RESET ROLE;

SELECT t_assert((:'own'::jsonb)->'groups' @> '[{"label":"two-post lift","photos":2},{"label":"floor jack","photos":2}]'
  AND jsonb_array_length((:'own'::jsonb)->'groups') = 2,'self: labels normalized and grouped; a photo counts once per label');
SELECT t_assert(NOT :'own' ~ '(welding table|bench vise|air compressor)','sensitive, review-gated and superseded analyses are excluded');
SELECT t_assert((:'own'::jsonb)#>'{coverage}' @> '{"recent_photos":5,"images_scanned":3,"frames_analyzed":3,"photos_with_tools":3}'
  AND (SELECT g#>>'{shots,0,image_id}' FROM jsonb_array_elements((:'own'::jsonb)->'groups') g WHERE g->>'label' = 'two-post lift') = '50000000-0000-0000-0000-000000000002'
  AND (:'own'::jsonb)->'groups' @> '[{"label":"floor jack","shots":[{"image_id":"50000000-0000-0000-0000-000000000003","vehicle":{"vehicle_id":"40000000-0000-0000-0000-000000000002","label":"1990 Ford F-250"}}]}]',
  'self: own private-vehicle photo included with its vehicle; newest first');
SELECT t_assert((:'pub'::jsonb)->'groups' @> '[{"label":"floor jack","photos":1},{"label":"two-post lift","photos":2}]'
  AND NOT :'pub' ~ '(50000000-0000-0000-0000-000000000003|F-250)' AND (:'pub'::jsonb)#>'{viewer,self}' = 'false'::jsonb,
  'visitor: public-vehicle photos only; the private vehicle and its photo are absent');
SELECT t_assert((:'pub'::jsonb)->'groups' @> '[{"label":"two-post lift","shots":[{"thumbnail_url":"https://img.example/1t.jpg","vehicle":{"vehicle_id":"40000000-0000-0000-0000-000000000001"}}]}]',
  'thumbnail preferred; public vehicle id shown');
SELECT t_assert((:'lift1'::jsonb)->>'label_filter' = 'two-post lift' AND jsonb_array_length((:'lift1'::jsonb)->'groups') = 1
  AND jsonb_array_length((:'lift1'::jsonb)#>'{groups,0,shots}') = 1 AND (:'lift1'::jsonb)#>>'{groups,0,photos}' = '2',
  'label filter normalizes the query; per-label limit keeps the full photo count');
SELECT t_assert(has_function_privilege('anon','user_tool_action_shots_read(uuid,text,integer)','EXECUTE'),'reader open to anon');
