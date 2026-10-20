-- Disposable PG17 only. Proves 20261020001000_vehicle_image_review_holds.sql: a service-only, audited, reversible hold moves
-- named public images of one vehicle to review_needed (hidden by the public read policy, still visible to the owner); other
-- vehicles, already-hidden and unknown images are skipped; nothing else on the row changes; revert restores exactly.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_%' OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicle_images') IS NOT NULL THEN
    RAISE EXCEPTION 'Empty disposable PG17 database required';
  END IF;
END $$;
SET TimeZone = 'UTC';
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub', '')::uuid $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE TYPE public.vision_gate_status AS ENUM ('pending','approved','rejected_personal','rejected_misattributed','review_needed');
CREATE TABLE public.vehicles(id uuid PRIMARY KEY, is_public boolean, owner_id uuid, user_id uuid, uploaded_by uuid);
CREATE TABLE public.vehicle_images(id uuid PRIMARY KEY, vehicle_id uuid, user_id uuid, image_url text, file_hash text, is_primary boolean DEFAULT false,
  is_sensitive boolean DEFAULT false, is_superseded boolean DEFAULT false, vision_gate_status public.vision_gate_status DEFAULT 'pending',
  vision_gate_agent_reasoning text, vision_gate_processed_at timestamptz, updated_at timestamptz DEFAULT now());
ALTER TABLE public.vehicle_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view images for public vehicles" ON public.vehicle_images FOR SELECT USING (
  COALESCE(is_sensitive, false) = false AND COALESCE(is_superseded, false) = false
  AND (vision_gate_status IS NULL OR vision_gate_status <> ALL (ARRAY['rejected_personal','rejected_misattributed','review_needed']::public.vision_gate_status[]))
  AND EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = vehicle_images.vehicle_id AND v.is_public = true));
CREATE POLICY "Users can view images for vehicles they own" ON public.vehicle_images FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.vehicles WHERE vehicles.id = vehicle_images.vehicle_id
    AND (vehicles.user_id = auth.uid() OR vehicles.uploaded_by = auth.uid() OR vehicles.owner_id = auth.uid())));
GRANT SELECT ON public.vehicles, public.vehicle_images TO anon, authenticated, service_role;
CREATE TABLE public.cover_calls(vehicle_id uuid, at timestamptz DEFAULT clock_timestamp());
CREATE FUNCTION public.recompute_vehicle_primary_image(p_vehicle_id uuid) RETURNS jsonb LANGUAGE sql AS $$
  INSERT INTO public.cover_calls(vehicle_id) VALUES (p_vehicle_id) RETURNING jsonb_build_object('vehicle_id', vehicle_id) $$;
CREATE FUNCTION public.t_assert(v boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'PASS: %', label; END $$;
CREATE FUNCTION public.t_refused(q text) RETURNS boolean LANGUAGE plpgsql AS $$ BEGIN EXECUTE q; RETURN false; EXCEPTION WHEN OTHERS THEN RETURN true; END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean,text), public.t_refused(text) TO anon, authenticated, service_role;

-- Vehicle A (public, owner O) with five images; vehicle B (public) with one.
INSERT INTO vehicles VALUES ('a0000000-0000-0000-0000-00000000000a', true, '0e000000-0000-0000-0000-00000000000e', NULL, NULL),
 ('b0000000-0000-0000-0000-00000000000b', true, NULL, NULL, NULL);
INSERT INTO vehicle_images(id,vehicle_id,image_url,file_hash,vision_gate_status,vision_gate_agent_reasoning,vision_gate_processed_at,is_primary) VALUES
 ('10000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-00000000000a','https://x.invalid/1.jpg','h1','approved','Truck exterior.','2026-05-01',true),
 ('10000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-00000000000a','https://x.invalid/2.jpg','h2','approved',NULL,NULL,false),
 ('10000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-00000000000a','https://x.invalid/3.jpg','h3',NULL,NULL,NULL,false),
 ('10000000-0000-0000-0000-000000000004','a0000000-0000-0000-0000-00000000000a','https://x.invalid/4.jpg','h4','rejected_personal','Held earlier.','2026-05-02',false),
 ('10000000-0000-0000-0000-000000000005','a0000000-0000-0000-0000-00000000000a','https://x.invalid/5.jpg','h5','approved',NULL,NULL,false),
 ('20000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-00000000000b','https://x.invalid/b1.jpg','hb','approved',NULL,NULL,false);
CREATE TEMP TABLE before_rows AS SELECT * FROM vehicle_images;
\ir ../migrations/20261020001000_vehicle_image_review_holds.sql

CREATE FUNCTION public.t_visible(p_vehicle uuid) RETURNS bigint LANGUAGE sql AS $$ SELECT count(*) FROM vehicle_images WHERE vehicle_id = p_vehicle $$;
GRANT EXECUTE ON FUNCTION public.t_visible(uuid) TO anon, authenticated;
SET ROLE anon;
SELECT set_config('request.jwt.claims','{"role":"anon"}',false);
SELECT t_visible('a0000000-0000-0000-0000-00000000000a') AS anon0 \gset
RESET ROLE;
SELECT t_assert(:'anon0'::int = 4,'baseline: visitor sees the four public images of vehicle A');

\set items '[{"image_id":"10000000-0000-0000-0000-000000000001","signals":{"human":true,"human_conf":0.91,"face":false,"face_conf":0}},{"image_id":"10000000-0000-0000-0000-000000000002","signals":{"face":true,"face_conf":0.6}},{"image_id":"10000000-0000-0000-0000-000000000003"},{"image_id":"10000000-0000-0000-0000-000000000004"},{"image_id":"20000000-0000-0000-0000-000000000001"},{"image_id":"30000000-0000-0000-0000-000000000009"},{"image_id":"10000000-0000-0000-0000-000000000001"}]'

SET ROLE service_role;
SELECT t_assert(hold_vehicle_images_for_review('a0000000-0000-0000-0000-00000000000a',:'items','apple_vision_people_v1','person detected on public vehicle gallery','run-1')
  @> '{"applied":false,"received":7,"unique_items":6,"eligible_public":3,"would_hold":3,"skipped_not_public_other_vehicle_or_unknown":3}'
 AND (SELECT count(*) FROM vehicle_images WHERE vision_gate_status = 'review_needed') = 0 AND (SELECT count(*) FROM vehicle_image_gate_changes) = 0,'dry run counts; nothing changed');
SELECT hold_vehicle_images_for_review('a0000000-0000-0000-0000-00000000000a',:'items','apple_vision_people_v1','person detected on public vehicle gallery','run-1',true) AS h1 \gset
SELECT t_assert((:'h1'::jsonb) @> '{"applied":true,"held":3,"eligible_public":3,"after_status":"review_needed","method":"apple_vision_people_v1"}','apply holds the three public images of vehicle A');
SELECT t_assert((hold_vehicle_images_for_review('a0000000-0000-0000-0000-00000000000a',:'items','apple_vision_people_v1','person detected on public vehicle gallery','run-1',true)->>'held')::int = 0,
  'rerun is a no-op');
RESET ROLE;
SELECT t_assert((SELECT array_agg(id ORDER BY id) FROM vehicle_images WHERE vision_gate_status = 'review_needed')
   = ARRAY['10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000003']::uuid[]
 AND (SELECT vision_gate_status FROM vehicle_images WHERE id = '10000000-0000-0000-0000-000000000004') = 'rejected_personal'
 AND (SELECT vision_gate_status FROM vehicle_images WHERE id = '20000000-0000-0000-0000-000000000001') = 'approved'
 AND (SELECT vision_gate_status FROM vehicle_images WHERE id = '10000000-0000-0000-0000-000000000005') = 'approved',
 'only named public images of vehicle A moved; other vehicle, already-hidden and unnamed images untouched');
SELECT t_assert(NOT EXISTS (SELECT 1 FROM vehicle_images v JOIN before_rows b USING (id)
   WHERE (v.vehicle_id, v.image_url, v.file_hash, v.is_primary, v.is_sensitive, v.is_superseded, v.user_id)
     IS DISTINCT FROM (b.vehicle_id, b.image_url, b.file_hash, b.is_primary, b.is_sensitive, b.is_superseded, b.user_id)),
 'no other column changes (vehicle, url, file_hash, flags)');
SELECT t_assert((SELECT count(*) FROM vehicle_image_gate_changes WHERE run = 'run-1') = 3
 AND EXISTS (SELECT 1 FROM vehicle_image_gate_changes WHERE image_id = '10000000-0000-0000-0000-000000000001' AND before_status = 'approved'
   AND before_reasoning = 'Truck exterior.' AND before_processed_at = '2026-05-01' AND after_status = 'review_needed'
   AND signals @> '{"human":true,"human_conf":0.91}' AND method = 'apple_vision_people_v1' AND reason = 'person detected on public vehicle gallery'
   AND actor = 'service_role')
 AND EXISTS (SELECT 1 FROM vehicle_image_gate_changes WHERE image_id = '10000000-0000-0000-0000-000000000003' AND before_status IS NULL)
 AND (SELECT vision_gate_agent_reasoning FROM vehicle_images WHERE id = '10000000-0000-0000-0000-000000000001') ~ '^Held for review \(apple_vision_people_v1, run run-1\).*Prior reasoning: Truck exterior\.$'
 AND (SELECT count(*) FROM cover_calls WHERE vehicle_id = 'a0000000-0000-0000-0000-00000000000a') = 1,
 'audit: method, reason, actor, before/after, prior reasoning and clock, signals; reasoning notes the hold; cover recomputed once');

SET ROLE anon;
SELECT set_config('request.jwt.claims','{"role":"anon"}',false);
SELECT t_assert(t_visible('a0000000-0000-0000-0000-00000000000a') = 1 AND t_visible('b0000000-0000-0000-0000-00000000000b') = 1,'visitor: held images hidden; other vehicle unchanged');
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"0e000000-0000-0000-0000-00000000000e"}',false);
SELECT t_assert(t_visible('a0000000-0000-0000-0000-00000000000a') = 5,'owner still sees every image');
RESET ROLE;

SET ROLE service_role;
SELECT t_assert(revert_vehicle_image_review_hold('run-1') @> '{"applied":false,"candidates":3}','revert dry run');
SELECT t_assert(revert_vehicle_image_review_hold('run-1', ARRAY['10000000-0000-0000-0000-000000000002']::uuid[], true) @> '{"reverted":1}','revert one named image');
SELECT t_assert(revert_vehicle_image_review_hold('run-1', NULL, true) @> '{"reverted":2}' AND revert_vehicle_image_review_hold('run-1', NULL, true) @> '{"reverted":0}',
  'revert the rest; a second revert is a no-op');
RESET ROLE;
SELECT t_assert(NOT EXISTS (SELECT 1 FROM vehicle_images v JOIN before_rows b USING (id)
   WHERE (v.vision_gate_status, v.vision_gate_agent_reasoning, v.vision_gate_processed_at, v.image_url, v.file_hash)
     IS DISTINCT FROM (b.vision_gate_status, b.vision_gate_agent_reasoning, b.vision_gate_processed_at, b.image_url, b.file_hash))
 AND (SELECT count(*) FROM vehicle_image_gate_changes WHERE reverted_at IS NOT NULL) = 3,'revert restores status, reasoning and clock exactly; audit rows marked reverted');
SET ROLE anon;
SELECT set_config('request.jwt.claims','{"role":"anon"}',false);
SELECT t_assert(t_visible('a0000000-0000-0000-0000-00000000000a') = :'anon0'::int,'visitor count back to baseline');
RESET ROLE;

SELECT t_assert(t_refused($q$SELECT hold_vehicle_images_for_review('a0000000-0000-0000-0000-00000000000a','[]','m','r','x')$q$)
  AND t_refused($q$SELECT hold_vehicle_images_for_review('a0000000-0000-0000-0000-00000000000a','[{"image_id":"nope"}]','m','r','x')$q$)
  AND t_refused($q$SELECT hold_vehicle_images_for_review('a0000000-0000-0000-0000-00000000000a','[{"image_id":"10000000-0000-0000-0000-000000000005"}]','','r','x')$q$)
  AND t_refused($q$SELECT hold_vehicle_images_for_review('c0000000-0000-0000-0000-00000000000c','[{"image_id":"10000000-0000-0000-0000-000000000005"}]','m','r','x')$q$),
  'refused: empty items, bad id, missing method, unknown vehicle');
SELECT t_assert(NOT has_function_privilege('anon','hold_vehicle_images_for_review(uuid,jsonb,text,text,text,boolean)','EXECUTE')
  AND NOT has_function_privilege('authenticated','hold_vehicle_images_for_review(uuid,jsonb,text,text,text,boolean)','EXECUTE')
  AND has_function_privilege('service_role','hold_vehicle_images_for_review(uuid,jsonb,text,text,text,boolean)','EXECUTE')
  AND NOT has_function_privilege('authenticated','revert_vehicle_image_review_hold(text,uuid[],boolean)','EXECUTE')
  AND has_function_privilege('service_role','revert_vehicle_image_review_hold(text,uuid[],boolean)','EXECUTE')
  AND NOT has_table_privilege('authenticated','public.vehicle_image_gate_changes','SELECT')
  AND NOT has_table_privilege('service_role','public.vehicle_image_gate_changes','INSERT')
  AND has_table_privilege('service_role','public.vehicle_image_gate_changes','SELECT'),'grants: service-only writers; audit readable by service only');
