-- Disposable PG17 only. Proves 20261020190500_gallery_eligible_without_exif_column.sql: with exif_data withheld from anon,
-- anon can filter on vehicle_image_gallery_eligible (approved and pending BaT frames), still cannot read exif_data, and
-- authenticated is unaffected.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_%' OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicle_images') IS NOT NULL THEN
    RAISE EXCEPTION 'Empty disposable PG17 database required';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE TABLE public.vehicles(id uuid PRIMARY KEY, is_public boolean);
CREATE TABLE public.auction_events(id uuid PRIMARY KEY, vehicle_id uuid, source text, source_url text);
CREATE TABLE public.vehicle_images(id uuid PRIMARY KEY, vehicle_id uuid, image_url text, source text, exif_data jsonb,
  is_document boolean, is_duplicate boolean, is_superseded boolean, image_vehicle_match_status text, vision_gate_status text,
  is_sensitive boolean DEFAULT false, is_external boolean, is_approved boolean, approval_status text, verification_status text,
  redaction_level text, user_id uuid);
GRANT SELECT ON public.vehicles, public.auction_events TO anon, authenticated;
GRANT SELECT ON public.vehicle_images TO anon, authenticated;
-- the state before the fix: the 20261014050000 helper and a function that reads exif_data as the caller
CREATE FUNCTION public.bat_pending_image_has_listing(p_vehicle_id uuid, p_exif jsonb) RETURNS boolean LANGUAGE sql STABLE SET search_path TO '' AS $f$
  SELECT EXISTS (SELECT 1 FROM public.vehicles v JOIN public.auction_events e ON e.vehicle_id=v.id
    WHERE v.id=p_vehicle_id AND v.is_public IS TRUE AND e.source='bat'
      AND jsonb_typeof(p_exif->'listing_urls')='array' AND (p_exif->'listing_urls') ? e.source_url); $f$;
CREATE FUNCTION public.vehicle_image_gallery_eligible(vehicle_images) RETURNS boolean LANGUAGE sql STABLE AS $f$
  SELECT coalesce(($1).is_document,false)=false AND CASE
    WHEN ($1).vision_gate_status IS NULL OR ($1).vision_gate_status='approved' THEN true
    WHEN ($1).vision_gate_status='pending' THEN public.bat_pending_image_has_listing(($1).vehicle_id, ($1).exif_data)
    ELSE false END; $f$;
GRANT EXECUTE ON FUNCTION public.bat_pending_image_has_listing(uuid,jsonb), public.vehicle_image_gallery_eligible(vehicle_images) TO anon, authenticated;
INSERT INTO vehicles VALUES ('a0000000-0000-0000-0000-00000000000a', true);
INSERT INTO auction_events VALUES ('e0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-00000000000a','bat','https://bringatrailer.com/listing/x/');
INSERT INTO vehicle_images(id,vehicle_id,image_url,vision_gate_status,exif_data,source,is_external,is_approved,approval_status,verification_status,redaction_level) VALUES
 ('10000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-00000000000a','https://x.invalid/1.jpg','approved',NULL,NULL,NULL,NULL,NULL,NULL,NULL),
 ('10000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-00000000000a','https://bringatrailer.com/wp-content/uploads/2.jpg','pending','{"listing_urls":["https://bringatrailer.com/listing/x/"],"location":{"latitude":1}}','bat_import',true,true,'approved','approved','none'),
 ('10000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-00000000000a','https://bringatrailer.com/wp-content/uploads/3.jpg','pending','{"listing_urls":["https://other"]}','bat_import',true,true,'approved','approved','none');
CREATE FUNCTION public.t_assert(v boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'PASS: %', label; END $$;
CREATE FUNCTION public.t_refused(q text) RETURNS boolean LANGUAGE plpgsql AS $$ BEGIN EXECUTE q; RETURN false; EXCEPTION WHEN insufficient_privilege THEN RETURN true; END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean,text), public.t_refused(text) TO anon, authenticated;

-- withhold exif_data from anon as 20261020190000 does
REVOKE SELECT ON public.vehicle_images FROM anon;
GRANT SELECT (id, vehicle_id, image_url, source, is_document, is_duplicate, is_superseded, image_vehicle_match_status, vision_gate_status,
  is_sensitive, is_external, is_approved, approval_status, verification_status, redaction_level, user_id) ON public.vehicle_images TO anon;

SET ROLE anon;
SELECT t_assert(t_refused('SELECT id FROM public.vehicle_images WHERE vehicle_image_gallery_eligible(vehicle_images)'),'before the fix: anon gallery filter is refused');
RESET ROLE;

\ir ../migrations/20261020190500_gallery_eligible_without_exif_column.sql
\ir ../migrations/20261020190500_gallery_eligible_without_exif_column.sql

SET ROLE anon;
SELECT t_assert((SELECT array_agg(id ORDER BY id) FROM public.vehicle_images_public WHERE vehicle_image_gallery_eligible(vehicle_images_public))
  = ARRAY['10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002']::uuid[],
  'anon: view gate works; approved and matching pending frame in, non-matching pending frame out');
SELECT t_assert(t_refused('SELECT exif_data FROM public.vehicle_images') AND t_refused('SELECT * FROM public.vehicle_images')
  AND NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'vehicle_images_public' AND column_name = 'exif_data'),'anon: exif_data and whole-row table reads still refused');
SELECT t_assert(t_refused('INSERT INTO public.vehicle_images_public(id) VALUES (gen_random_uuid())'),'anon: view is read-only');
RESET ROLE;
SET ROLE authenticated;
SELECT t_assert((SELECT count(*) FROM public.vehicle_images_public WHERE vehicle_image_gallery_eligible(vehicle_images_public)) = 2,'authenticated: same answer on the view');
RESET ROLE;
\ir ../migrations/20261015170000_gallery_eligible_listing_capture_photos.sql
-- Disposable database only: real PW publication state and negative boundaries.
INSERT INTO vehicle_images(id,vehicle_id,image_url,source,vision_gate_status,is_external,is_approved,approval_status,verification_status,redaction_level)
SELECT ('20000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'a0000000-0000-0000-0000-00000000000a','https://cdn.purplewave.com/photo.jpg','purplewave','pending',true,true,'pending','approved','none' FROM generate_series(1,14) n;
UPDATE vehicle_images SET user_id='a0000000-0000-0000-0000-00000000000a' WHERE id='20000000-0000-0000-0000-000000000002';
UPDATE vehicle_images SET is_external=false WHERE id='20000000-0000-0000-0000-000000000003';
UPDATE vehicle_images SET is_sensitive=true WHERE id='20000000-0000-0000-0000-000000000004';
UPDATE vehicle_images SET is_approved=false WHERE id='20000000-0000-0000-0000-000000000005';
UPDATE vehicle_images SET approval_status='rejected' WHERE id='20000000-0000-0000-0000-000000000006';
UPDATE vehicle_images SET verification_status='pending' WHERE id='20000000-0000-0000-0000-000000000007';
UPDATE vehicle_images SET redaction_level='full' WHERE id='20000000-0000-0000-0000-000000000008';
UPDATE vehicle_images SET image_url='http://cdn.purplewave.com/photo.jpg' WHERE id='20000000-0000-0000-0000-000000000009';
UPDATE vehicle_images SET vision_gate_status='review_needed' WHERE id='20000000-0000-0000-0000-000000000010';
UPDATE vehicle_images SET is_document=true WHERE id='20000000-0000-0000-0000-000000000011';
UPDATE vehicle_images SET is_duplicate=true WHERE id='20000000-0000-0000-0000-000000000012';
UPDATE vehicle_images SET is_superseded=true WHERE id='20000000-0000-0000-0000-000000000013';
UPDATE vehicle_images SET image_vehicle_match_status='mismatch' WHERE id='20000000-0000-0000-0000-000000000014';
SET ROLE anon;
SELECT t_assert((SELECT count(*) FROM vehicle_images_public WHERE source='purplewave' AND vehicle_image_gallery_eligible(vehicle_images_public))=0,'before repair: retained listing photos hidden');
RESET ROLE;
\ir ../migrations/20261109012457_public_listing_gallery_parity.sql
\ir ../migrations/20261109012457_public_listing_gallery_parity.sql
SELECT t_assert(NOT EXISTS(SELECT FROM vehicle_images i JOIN vehicle_images_public p USING(id) WHERE vehicle_image_gallery_eligible(i) IS DISTINCT FROM vehicle_image_gallery_eligible(p)),'public and canonical gates agree for every fixture');
SET ROLE anon;
SELECT t_assert((SELECT array_agg(id) FROM vehicle_images_public WHERE source='purplewave' AND vehicle_image_gallery_eligible(vehicle_images_public))=ARRAY['20000000-0000-0000-0000-000000000001']::uuid[],'anonymous admits only public listing capture; uploads and unsafe verdicts remain hidden');
SELECT t_assert(t_refused('SELECT exif_data FROM vehicle_images') AND t_refused('INSERT INTO vehicle_images_public(id) VALUES(gen_random_uuid())'),'private EXIF and writes still refused');
RESET ROLE;
-- Eligibility never replaces the caller's row visibility policy.
INSERT INTO vehicles VALUES ('b0000000-0000-0000-0000-00000000000b', false);
INSERT INTO vehicle_images(id,vehicle_id,image_url,source,vision_gate_status,is_external,is_approved,approval_status,verification_status,redaction_level)
VALUES ('30000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-00000000000b','https://cdn.purplewave.com/private.jpg','purplewave','pending',true,true,'pending','approved','none');
ALTER TABLE vehicle_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY fixture_public_vehicle ON vehicle_images FOR SELECT USING (EXISTS(SELECT FROM vehicles v WHERE v.id=vehicle_id AND v.is_public));
SET ROLE anon;
SELECT t_assert((SELECT count(*) FROM vehicle_images_public WHERE vehicle_image_gallery_eligible(vehicle_images_public) AND vehicle_id='b0000000-0000-0000-0000-00000000000b')=0,'security-invoker public view still honors private vehicle RLS');
RESET ROLE;
