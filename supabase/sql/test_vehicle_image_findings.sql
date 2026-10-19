-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_image_findings -f this-file.sql
-- Proves, for 20261014052000_vehicle_image_findings_reader.sql, that vehicle_image_findings hands the Image analysis card
-- exactly the rows the 26 arrow projections used to (same keys and JSON values, null keys dropped, frames with nothing
-- to report left out and still counted), for each reader: anon and a signed-in stranger get the frames the vehicle_images
-- row policies admit (not sensitive, not superseded, not held back by the vision gate, public vehicle), the owner gets
-- all of theirs and nothing of anyone else's. A blob that is not a JSON object cannot fail the read, the 5,000 cap
-- holds, and one pass over TOASTed blobs touches a fraction of the buffers the 26 projections did.
-- vehicle_images carries the five live read policies (pg_policy, 2026-10-14, after the vision-gate change).
-- The rows below are a disposable test database's rows, never production testimony.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicle_images') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
SET timezone = 'UTC';  -- PostgREST sessions are UTC; timestamps below are compared as ISO strings
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.auth_uid', true), '')::uuid $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;

CREATE TYPE public.vision_gate_status AS ENUM ('pending', 'approved', 'rejected_personal', 'rejected_misattributed', 'review_needed');
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, is_public boolean, user_id uuid, uploaded_by uuid, owner_id uuid);
CREATE TABLE public.vehicle_images (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, user_id uuid, documented_by_user_id uuid,
  image_url text, is_sensitive boolean, is_superseded boolean, vision_gate_status public.vision_gate_status,
  ai_scan_metadata jsonb, vision_analyzed_at timestamptz);
CREATE TABLE public.organization_vehicles (organization_id uuid, vehicle_id uuid);
CREATE TABLE public.organization_contributors (organization_id uuid, user_id uuid, status text);
ALTER TABLE public.vehicle_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Organization members can view org vehicle images" ON public.vehicle_images FOR SELECT
  USING (EXISTS (SELECT 1 FROM organization_vehicles ov JOIN organization_contributors oc ON ov.organization_id = oc.organization_id
                 WHERE ov.vehicle_id = vehicle_images.vehicle_id AND oc.user_id = (SELECT auth.uid()) AND oc.status = 'active'));
CREATE POLICY "Users can view images for public vehicles" ON public.vehicle_images FOR SELECT
  USING ((COALESCE(is_sensitive, false) = false) AND (COALESCE(is_superseded, false) = false)
         AND ((vision_gate_status IS NULL) OR (vision_gate_status <> ALL (ARRAY['rejected_personal'::public.vision_gate_status, 'rejected_misattributed'::public.vision_gate_status, 'review_needed'::public.vision_gate_status])))
         AND (EXISTS (SELECT 1 FROM vehicles v WHERE v.id = vehicle_images.vehicle_id AND v.is_public = true)));
CREATE POLICY "Users can view images for vehicles they own" ON public.vehicle_images FOR SELECT
  USING (EXISTS (SELECT 1 FROM vehicles WHERE vehicles.id = vehicle_images.vehicle_id
                 AND (vehicles.user_id = auth.uid() OR vehicles.uploaded_by = auth.uid() OR vehicles.owner_id = auth.uid())));
CREATE POLICY "Users can view their own images" ON public.vehicle_images FOR SELECT USING ((SELECT auth.uid()) = user_id);
CREATE POLICY users_can_view_own_unorganized_images ON public.vehicle_images FOR SELECT
  USING (vehicle_id IS NULL AND (user_id = auth.uid() OR documented_by_user_id = auth.uid()));
GRANT SELECT ON public.vehicle_images, public.vehicles, public.organization_vehicles, public.organization_contributors TO anon, authenticated;

-- The reader under test (a new function: nothing to replace, nothing to guard).
\ir ../migrations/20261014052000_vehicle_image_findings_reader.sql

CREATE FUNCTION public.t_assert(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(p_ok, false) THEN RAISE EXCEPTION 'FAIL: %', p_what; END IF; END $$;
CREATE FUNCTION public.t_buffers(p_sql text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE j text;
BEGIN
  EXECUTE 'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' || p_sql INTO j;
  RETURN ((j::jsonb -> 0 -> 'Plan' ->> 'Shared Hit Blocks')::bigint + (j::jsonb -> 0 -> 'Plan' ->> 'Shared Read Blocks')::bigint);
END $$;
-- The rows the browser used to get: the 26 arrow projections of the old read, then the null keys dropped, empty rows left out.
CREATE FUNCTION public.t_old_rows(p_vehicle uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(jsonb_agg(o ORDER BY o::text), '[]'::jsonb) FROM (
    SELECT (SELECT jsonb_object_agg(key, value) FROM jsonb_each(to_jsonb(t)) WHERE value <> 'null'::jsonb) AS o
      FROM (SELECT ai_scan_metadata->'classifier' AS classifier, ai_scan_metadata->'error' AS error, ai_scan_metadata->'vin' AS vin,
                   ai_scan_metadata->'license_plate' AS license_plate, ai_scan_metadata->'engine' AS engine, ai_scan_metadata->'engine_guess' AS engine_guess,
                   ai_scan_metadata->'engine_badge' AS engine_badge, ai_scan_metadata->'transmission' AS transmission,
                   ai_scan_metadata->'color_visible' AS color_visible, ai_scan_metadata->'interior_trim' AS interior_trim,
                   ai_scan_metadata->'odometer' AS odometer, ai_scan_metadata->'mileage_at_listing' AS mileage_at_listing, ai_scan_metadata->'source' AS source,
                   ai_scan_metadata->'part_number' AS part_number, ai_scan_metadata->'critical' AS critical, ai_scan_metadata->'privacy_concern' AS privacy_concern,
                   ai_scan_metadata->'attribution_concern' AS attribution_concern, ai_scan_metadata->'phase' AS phase, ai_scan_metadata->'scene_class' AS scene_class,
                   ai_scan_metadata->'make_guess' AS make_guess, ai_scan_metadata->'model_guess' AS model_guess, ai_scan_metadata->'year_guess' AS year_guess,
                   ai_scan_metadata->'confidence' AS confidence, ai_scan_metadata->'byok_deep_analysis'->'scene_type' AS byok_scene_type,
                   ai_scan_metadata->'byok_deep_analysis'->'build_phase_guess' AS byok_build_phase_guess,
                   ai_scan_metadata->'byok_deep_analysis'->'confidence' AS byok_confidence, vision_analyzed_at
              FROM public.vehicle_images WHERE vehicle_id = p_vehicle LIMIT 5000) t
  ) x WHERE o IS NOT NULL $$;
CREATE FUNCTION public.t_new_rows(p_vehicle uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(jsonb_agg(r ORDER BY r::text), '[]'::jsonb) FROM jsonb_array_elements(public.vehicle_image_findings(p_vehicle) -> 'rows') r $$;
CREATE FUNCTION public.t_old_total(p_vehicle uuid) RETURNS bigint LANGUAGE sql STABLE AS $$ SELECT count(*) FROM public.vehicle_images WHERE vehicle_id = p_vehicle $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean, text), public.t_buffers(text), public.t_old_rows(uuid), public.t_new_rows(uuid), public.t_old_total(uuid) TO anon, authenticated;

-- O owns the public vehicle P and the private vehicle Q. S is a signed-in stranger. R is a public vehicle with many frames.
INSERT INTO public.vehicles (id, is_public, user_id) VALUES
 ('40000000-0000-0000-0000-000000000001', true,  '30000000-0000-0000-0000-00000000000a'),
 ('40000000-0000-0000-0000-000000000002', false, '30000000-0000-0000-0000-00000000000a'),
 ('40000000-0000-0000-0000-000000000003', true,  '30000000-0000-0000-0000-00000000000a');
-- ALLOW_RAW_TESTIMONY_WRITE
INSERT INTO public.vehicle_images (id, vehicle_id, user_id, image_url, is_sensitive, is_superseded, vision_gate_status, ai_scan_metadata, vision_analyzed_at) VALUES
 -- visible frames of P
 ('50000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-00000000000a', 'https://x/a1.jpg', false, false, 'approved',
  '{"classifier":"claude-opus-4-7-byok","vin":"1GCEK14K8EJ123456","license_plate":"ABC123","engine":"350 V8","engine_guess":"350","transmission":"TH350","color_visible":"red","interior_trim":"tan","odometer":"88,000","mileage_at_listing":"88000","source":"bat","part_number":"14044","critical":"vin","privacy_concern":"plate","attribution_concern":"none","phase":"bodywork","scene_class":"exterior","make_guess":"Chevrolet","model_guess":"K5 Blazer","year_guess":1984,"confidence":0.9,"byok_deep_analysis":{"scene_type":"engine_bay","build_phase_guess":"wiring","confidence":0.8,"narrative_one_line":"x"},"error":null}',
  '2026-10-01 12:00:00+00'),
 ('50000000-0000-0000-0000-0000000000a2', '40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-00000000000a', 'https://x/a2.jpg', NULL, NULL, NULL,
  '{"byok_deep_analysis":{"scene_type":"interior","build_phase_guess":null,"confidence":0.5}}', NULL),
 ('50000000-0000-0000-0000-0000000000a3', '40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-00000000000a', 'https://x/a3.jpg', false, false, 'pending',
  '{}', NULL),
 ('50000000-0000-0000-0000-0000000000a4', '40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-00000000000a', 'https://x/a4.jpg', false, false, 'approved', NULL, NULL),
 ('50000000-0000-0000-0000-0000000000a5', '40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-00000000000a', 'https://x/a5.jpg', false, false, 'approved', '"just a string"', NULL),
 ('50000000-0000-0000-0000-0000000000a6', '40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-00000000000a', 'https://x/a6.jpg', false, false, 'approved', '[1, 2]', NULL),
 ('50000000-0000-0000-0000-0000000000a7', '40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-00000000000a', 'https://x/a7.jpg', false, false, 'approved',
  '{"vin":null,"phase":{"inner":null,"kept":1},"year_guess":null,"critical":{"a":[1,null]},"error":"timeout"}', '2026-10-02 08:30:00.123456+00'),
 ('50000000-0000-0000-0000-0000000000a8', '40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-00000000000a', 'https://x/a8.jpg', false, false, 'approved',
  '{"unrelated":"key","classifier":"caller-byok-cascade","confidence":"high"}', NULL),
 -- frames of P that only the owner may read: gated, sensitive, superseded
 ('50000000-0000-0000-0000-0000000000b1', '40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-00000000000a', 'https://x/b1.jpg', false, false, 'rejected_personal', '{"vin":"OWNERONLYVIN000001"}', NULL),
 ('50000000-0000-0000-0000-0000000000b2', '40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-00000000000a', 'https://x/b2.jpg', true,  false, 'approved', '{"license_plate":"OWNERONLY"}', NULL),
 ('50000000-0000-0000-0000-0000000000b3', '40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-00000000000a', 'https://x/b3.jpg', false, true,  'approved', '{"engine":"OWNERONLY"}', NULL),
 ('50000000-0000-0000-0000-0000000000b4', '40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-00000000000a', 'https://x/b4.jpg', false, false, 'review_needed', '{"engine":"HELD"}', NULL),
 -- the private vehicle Q
 ('50000000-0000-0000-0000-0000000000c1', '40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-00000000000a', 'https://x/c1.jpg', false, false, 'approved', '{"vin":"PRIVATEVIN000000001"}', NULL);
-- R: 5,010 visible frames (the cap), each with a metadata blob big enough to leave the heap tuple (TOAST)
INSERT INTO public.vehicle_images (vehicle_id, user_id, image_url, is_sensitive, is_superseded, vision_gate_status, ai_scan_metadata)
SELECT '40000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-00000000000a', 'https://x/r' || g || '.jpg', false, false, 'approved',
       jsonb_build_object('classifier', 'caller-byok-cascade', 'scene_class', 'exterior', 'confidence', 0.7, 'vin', 'RVIN' || (g % 7),
                          'blob', (SELECT string_agg(md5(g::text || k), '') FROM generate_series(1, 200) k))
  FROM generate_series(1, 5010) g;
VACUUM ANALYZE public.vehicle_images;

\set P '''40000000-0000-0000-0000-000000000001'''
\set Q '''40000000-0000-0000-0000-000000000002'''
\set R '''40000000-0000-0000-0000-000000000003'''


-- 1. Grants and kind of function.
SELECT public.t_assert(has_function_privilege('anon', 'public.vehicle_image_findings(uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.vehicle_image_findings(uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.vehicle_image_findings(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('public', 'public.vehicle_image_findings(uuid)', 'EXECUTE')
  AND (SELECT NOT prosecdef AND provolatile = 's' FROM pg_proc WHERE oid = 'public.vehicle_image_findings(uuid)'::regprocedure),
  'executable by anon, authenticated and service_role, not PUBLIC; security invoker, stable');

-- 2. Anon and a signed-in stranger: only what the row policies admit. P's visible frames: a1 a2 a3 a4 a5 a6 a7 a8 (8 frames).
SET ROLE anon; SET test.auth_uid = '';
SELECT public.vehicle_image_findings(:P) AS anon_p, public.t_old_rows(:P) AS anon_old_rows, public.t_new_rows(:P) AS anon_new_rows,
       public.t_old_total(:P) AS anon_old_total, public.vehicle_image_findings(:Q) AS anon_q \gset
RESET ROLE;
SELECT public.t_assert((:'anon_p'::jsonb ->> 'total')::int = 8 AND :anon_old_total = 8, format('anon: total is the 8 frames anon may read; got %s', :'anon_p'::jsonb ->> 'total'));
SELECT public.t_assert(:'anon_new_rows'::jsonb = :'anon_old_rows'::jsonb, 'anon: the rows equal the old projection rows, null keys dropped');
SELECT public.t_assert(jsonb_array_length(:'anon_new_rows'::jsonb) = 4, 'anon: four frames have something to report (a1 a2 a7 a8); the other four only count in total');
SELECT public.t_assert(:'anon_p'::text NOT LIKE '%OWNERONLY%' AND :'anon_p'::text NOT LIKE '%HELD%' AND :'anon_p'::text NOT LIKE '%PRIVATEVIN%',
  'anon: nothing from a gated, sensitive, superseded or private frame');
SELECT public.t_assert((:'anon_q'::jsonb ->> 'total')::int = 0 AND :'anon_q'::jsonb -> 'rows' = '[]'::jsonb, 'anon: the private vehicle has no frames to anon');
SET ROLE authenticated; SET test.auth_uid = '30000000-0000-0000-0000-00000000000b';
SELECT public.vehicle_image_findings(:P) AS s_p, public.t_new_rows(:P) AS s_new_rows, public.vehicle_image_findings(:Q) AS s_q \gset
RESET ROLE;
SELECT public.t_assert(:'s_p'::jsonb = :'anon_p'::jsonb AND (:'s_q'::jsonb ->> 'total')::int = 0, 'a signed-in stranger gets what anon gets');

-- 3. The owner: every frame of theirs, the gated ones included, none of anyone else's.
SET ROLE authenticated; SET test.auth_uid = '30000000-0000-0000-0000-00000000000a';
SELECT public.vehicle_image_findings(:P) AS o_p, public.t_old_rows(:P) AS o_old_rows, public.t_new_rows(:P) AS o_new_rows,
       public.vehicle_image_findings(:Q) AS o_q, public.t_old_rows(:Q) AS o_old_q, public.t_new_rows(:Q) AS o_new_q \gset
RESET ROLE;
SET test.auth_uid = '';
SELECT public.t_assert((:'o_p'::jsonb ->> 'total')::int = 12, format('owner: all 12 frames of P; got %s', :'o_p'::jsonb ->> 'total'));
SELECT public.t_assert(:'o_new_rows'::jsonb = :'o_old_rows'::jsonb AND :'o_new_q'::jsonb = :'o_old_q'::jsonb, 'owner: the rows equal the old projection rows');
SELECT public.t_assert(:'o_p'::text LIKE '%OWNERONLYVIN%' AND :'o_p'::text LIKE '%OWNERONLY"%' AND :'o_p'::text LIKE '%HELD%' AND :'o_q'::text LIKE '%PRIVATEVIN%',
  'owner: the gated, sensitive, superseded and private frames come back');

-- 4. Values pass through as they were: nested nulls kept, numbers stay numbers, a JSON null key dropped.
SELECT public.t_assert((SELECT r FROM jsonb_array_elements(:'o_p'::jsonb -> 'rows') r WHERE r ->> 'error' = 'timeout')
                         = '{"error":"timeout","phase":{"inner":null,"kept":1},"critical":{"a":[1,null]},"vision_analyzed_at":"2026-10-02T08:30:00.123456+00:00"}'::jsonb,
  'a7 reaches the card as it was stored: nested nulls kept, vin null dropped, timestamp as an ISO string');
SELECT public.t_assert((SELECT r FROM jsonb_array_elements(:'o_p'::jsonb -> 'rows') r WHERE r ->> 'vin' = '1GCEK14K8EJ123456')
                         @> '{"year_guess":1984,"confidence":0.9,"byok_scene_type":"engine_bay","byok_build_phase_guess":"wiring","byok_confidence":0.8,"vision_analyzed_at":"2026-10-01T12:00:00+00:00"}'::jsonb,
  'a1: numbers stay numbers, the byok keys are flat, the timestamp is ISO');
SELECT public.t_assert((SELECT r FROM jsonb_array_elements(:'o_p'::jsonb -> 'rows') r WHERE r ->> 'byok_scene_type' = 'interior') = '{"byok_scene_type":"interior","byok_confidence":0.5}'::jsonb,
  'a2: a null build phase is dropped');
SELECT public.t_assert(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(:'o_p'::jsonb -> 'rows') r WHERE r ? 'unrelated' OR r ? 'blob'), 'only the card''s keys come back');

-- 5. The cap, and one pass over TOASTed blobs against the 26 projections.
SET ROLE anon; SET test.auth_uid = '';
SELECT public.vehicle_image_findings(:R) AS r_cap \gset
RESET ROLE;
SELECT public.t_assert((:'r_cap'::jsonb ->> 'total')::int = 5000 AND jsonb_array_length(:'r_cap'::jsonb -> 'rows') = 5000, 'the cap is 5,000 frames, as the browser''s read had');
SET ROLE anon;
SELECT public.t_buffers('SELECT public.vehicle_image_findings(' || quote_literal('40000000-0000-0000-0000-000000000003') || '::uuid)') AS buffers_new \gset
SELECT public.t_buffers($q$SELECT ai_scan_metadata->'classifier', ai_scan_metadata->'error', ai_scan_metadata->'vin', ai_scan_metadata->'license_plate', ai_scan_metadata->'engine',
  ai_scan_metadata->'engine_guess', ai_scan_metadata->'engine_badge', ai_scan_metadata->'transmission', ai_scan_metadata->'color_visible', ai_scan_metadata->'interior_trim',
  ai_scan_metadata->'odometer', ai_scan_metadata->'mileage_at_listing', ai_scan_metadata->'source', ai_scan_metadata->'part_number', ai_scan_metadata->'critical',
  ai_scan_metadata->'privacy_concern', ai_scan_metadata->'attribution_concern', ai_scan_metadata->'phase', ai_scan_metadata->'scene_class', ai_scan_metadata->'make_guess',
  ai_scan_metadata->'model_guess', ai_scan_metadata->'year_guess', ai_scan_metadata->'confidence', ai_scan_metadata->'byok_deep_analysis'->'scene_type',
  ai_scan_metadata->'byok_deep_analysis'->'build_phase_guess', ai_scan_metadata->'byok_deep_analysis'->'confidence', vision_analyzed_at
  FROM public.vehicle_images WHERE vehicle_id = '40000000-0000-0000-0000-000000000003' LIMIT 5000$q$) AS buffers_old \gset
RESET ROLE;
SELECT public.t_assert(:buffers_new * 3 < :buffers_old, format('one pass touches a third of the buffers or less (old %s, new %s)', :buffers_old, :buffers_new));

SELECT 'vehicle_image_findings contract: PASS' AS result;
