-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_<name> -f supabase/sql/test_photo_reading_signed_in_select_policies.sql
-- Proves 20261125183000_photo_reading_signed_in_select_policies.sql on image_angle_observations,
-- ai_angle_classifications_audit, image_spatial_metadata and image_question_answers: a signed-in stranger reads a photo's
-- reading only when the photo is gallery-eligible on a public, undeleted vehicle (never an unfiled, private-car,
-- deleted-car, document or privacy-withheld photo's); the uploader reads its own unfiled photo's reading; a viewer tied
-- to a private car who sees its photos reads their readings; anon reads none, as before, and select=* by image_id as anon
-- runs without 42501; service_role reads every row; an image_question_answers row with no photo follows its vehicle.
-- Fixture: supabase/sql/fixtures/photo_reading_select_base.sql (production's helper bodies by md5, policies, grants).
-- The four tables mirror production's columns that matter here, their foreign keys, grants and SELECT policies as read
-- on 2026-11-25.
-- Fixture rows only, in a disposable database. -- ALLOW_RAW_TESTIMONY_WRITE
\ir fixtures/photo_reading_select_base.sql

CREATE TABLE public.image_angle_observations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  image_id uuid NOT NULL REFERENCES public.vehicle_images(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  angle_id uuid NOT NULL, confidence numeric, source text NOT NULL);
CREATE INDEX image_angle_obs_image_idx ON public.image_angle_observations (image_id);
CREATE TABLE public.ai_angle_classifications_audit (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  image_id uuid NOT NULL REFERENCES public.vehicle_images(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  angle_family text NOT NULL, primary_label text NOT NULL, raw_classification jsonb NOT NULL);
CREATE INDEX idx_ai_angle_audit_image ON public.ai_angle_classifications_audit (image_id);
CREATE TABLE public.image_spatial_metadata (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  image_id uuid NOT NULL UNIQUE REFERENCES public.vehicle_images(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  part_name text);
CREATE TABLE public.image_question_answers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  image_id uuid REFERENCES public.vehicle_images(id) ON DELETE CASCADE,
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE CASCADE,
  question_key text NOT NULL, answer jsonb NOT NULL, model_used text NOT NULL);
CREATE INDEX idx_image_question_answers_image ON public.image_question_answers (image_id);

-- Production's policies and grants before the migration.
ALTER TABLE public.image_angle_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_angle_classifications_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.image_spatial_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.image_question_answers ENABLE ROW LEVEL SECURITY;
CREATE POLICY allow_authenticated_read_image_angle_observations ON public.image_angle_observations FOR SELECT TO authenticated USING (true);
CREATE POLICY allow_authenticated_read_ai_angle_classifications_audit ON public.ai_angle_classifications_audit FOR SELECT TO authenticated USING (true);
CREATE POLICY allow_authenticated_read_image_spatial_metadata ON public.image_spatial_metadata FOR SELECT TO authenticated USING (true);
CREATE POLICY allow_authenticated_read_image_question_answers ON public.image_question_answers FOR SELECT TO authenticated USING (true);
GRANT SELECT, REFERENCES, TRIGGER ON public.image_angle_observations, public.ai_angle_classifications_audit,
  public.image_spatial_metadata, public.image_question_answers TO anon, authenticated;
GRANT ALL ON public.image_angle_observations, public.ai_angle_classifications_audit, public.image_spatial_metadata,
  public.image_question_answers TO service_role;

-- One reading per photo on each table; the unfiled photo's rows carry the public car A as their vehicle stamp. The
-- question table also holds a row with no photo on A (veh_a) and on the private car B (veh_b).
INSERT INTO public.image_angle_observations (image_id, vehicle_id, angle_id, source)
SELECT vi.id, coalesce(vi.vehicle_id, 'a0000000-0000-0000-0000-00000000000a'), gen_random_uuid(), 'fixture' FROM public.vehicle_images vi;
INSERT INTO public.ai_angle_classifications_audit (image_id, vehicle_id, angle_family, primary_label, raw_classification)
SELECT vi.id, coalesce(vi.vehicle_id, 'a0000000-0000-0000-0000-00000000000a'), 'front', 'front', '{}' FROM public.vehicle_images vi;
INSERT INTO public.image_spatial_metadata (image_id, vehicle_id, part_name)
SELECT vi.id, coalesce(vi.vehicle_id, 'a0000000-0000-0000-0000-00000000000a'), 'grille' FROM public.vehicle_images vi;
INSERT INTO public.image_question_answers (image_id, vehicle_id, question_key, answer, model_used)
SELECT vi.id, coalesce(vi.vehicle_id, 'a0000000-0000-0000-0000-00000000000a'), public.t_label(vi.id), '{}', 'fixture' FROM public.vehicle_images vi;
INSERT INTO public.image_question_answers (image_id, vehicle_id, question_key, answer, model_used) VALUES
  (NULL, 'a0000000-0000-0000-0000-00000000000a', 'veh_a', '{}', 'fixture'),
  (NULL, 'b0000000-0000-0000-0000-00000000000b', 'veh_b', '{}', 'fixture');

-- The readings the current role and claims can read, as sorted photo labels (question_key for the question table).
CREATE FUNCTION public.t_seen(rel text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text;
BEGIN
  EXECUTE format('SELECT coalesce(string_agg(%s, '','' ORDER BY %s), '''') FROM public.%I',
    CASE rel WHEN 'image_question_answers' THEN 'question_key' ELSE 'public.t_label(image_id)' END,
    CASE rel WHEN 'image_question_answers' THEN 'question_key' ELSE 'public.t_label(image_id)' END, rel) INTO r;
  RETURN r;
END $$;
-- All three photo-keyed tables read the same set (s), and the question table reads s plus its vehicle rows (q).
CREATE FUNCTION public.t_four(s text, q text) RETURNS boolean LANGUAGE sql AS $$
  SELECT public.t_seen('image_angle_observations') = s AND public.t_seen('ai_angle_classifications_audit') = s
     AND public.t_seen('image_spatial_metadata') = s AND public.t_seen('image_question_answers') = q $$;
GRANT EXECUTE ON FUNCTION public.t_seen(text), public.t_four(text, text) TO anon, authenticated, service_role;

\set ALL '''deleted_c,document_a,photog_b,plate_a,private_b,shown_a,unfiled_u1'''
\set ALLQ '''deleted_c,document_a,photog_b,plate_a,private_b,shown_a,unfiled_u1,veh_a,veh_b'''

-- Before: the defect. Anon reads nothing; any signed-in user reads every reading.
SET ROLE anon; SELECT t_claims('');
SELECT t_assert(t_four('', ''), 'before: anon reads no row of the four tables');
RESET ROLE;
SET ROLE authenticated; SELECT t_claims('00000000-0000-0000-0000-000000000002');
SELECT t_assert(t_four(:ALL, :ALLQ), 'before: a signed-in stranger reads every reading, unfiled and private included');
RESET ROLE;

\ir ../migrations/20261125183000_photo_reading_signed_in_select_policies.sql
\ir ../migrations/20261125183000_photo_reading_signed_in_select_policies.sql
RESET statement_timeout; RESET lock_timeout;

SELECT t_assert((SELECT count(*) FROM pg_policies WHERE tablename IN ('image_angle_observations', 'ai_angle_classifications_audit',
    'image_spatial_metadata', 'image_question_answers')) = 4
  AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename IN ('image_angle_observations', 'ai_angle_classifications_audit',
    'image_spatial_metadata', 'image_question_answers') AND (qual = 'true' OR roles <> '{authenticated}')),
  'policies: one SELECT policy per table TO authenticated, applied twice; no open policy left');

-- Anon reads none, as before, and PostgREST's select=* by image_id runs.
SET ROLE anon; SELECT t_claims('');
SELECT t_assert(t_four('', ''), 'anon: reads no row of the four tables (unchanged)');
SELECT t_assert((SELECT count(*) FROM (SELECT * FROM public.image_angle_observations WHERE image_id = '10000000-0000-0000-0000-000000000001') s) = 0
  AND (SELECT count(*) FROM (SELECT * FROM public.image_question_answers WHERE image_id = '10000000-0000-0000-0000-000000000001') s) = 0,
  'anon: select=* by image_id runs (no 42501) and returns nothing');
RESET ROLE;

-- u2: a signed-in stranger reads only the shown photo's readings and the public car's photo-less answer.
SET ROLE authenticated; SELECT t_claims('00000000-0000-0000-0000-000000000002');
SELECT t_assert(t_four('shown_a', 'shown_a,veh_a'),
  'u2 (stranger): reads the shown photo''s readings only (not unfiled, private, deleted, document or privacy-withheld)');
SELECT t_assert((SELECT count(*) FROM (SELECT * FROM public.ai_angle_classifications_audit WHERE vehicle_id = 'a0000000-0000-0000-0000-00000000000a') s) = 1,
  'u2: filtering by the public car''s stamp returns the shown reading only, not the unfiled photo''s row stamped with it');
RESET ROLE;

-- u1: uploader and owner of A, B and C.
SET ROLE authenticated; SELECT t_claims('00000000-0000-0000-0000-000000000001');
SELECT t_assert(t_four(:ALL, :ALLQ), 'u1 (uploader, owner): reads its own unfiled photo''s readings and every reading of its cars');
RESET ROLE;

-- u3: uploaded photog_b on the private car B; not tied to B.
SET ROLE authenticated; SELECT t_claims('00000000-0000-0000-0000-000000000003');
SELECT t_assert(t_four('photog_b,shown_a', 'photog_b,shown_a,veh_a'), 'u3 (uploader of photog_b): reads its own photo''s readings, not private_b or veh_b');
RESET ROLE;

-- u4: A's mechanic (tied to A).
SET ROLE authenticated; SELECT t_claims('00000000-0000-0000-0000-000000000004');
SELECT t_assert(t_four('document_a,plate_a,shown_a', 'document_a,plate_a,shown_a,veh_a'),
  'u4 (tied to A): reads A''s document and privacy-withheld photos'' readings, nothing of B or C');
RESET ROLE;

-- u5: B's recorded owner_id (tied to the private car B, sees its photos).
SET ROLE authenticated; SELECT t_claims('00000000-0000-0000-0000-000000000005');
SELECT t_assert(t_four('photog_b,private_b,shown_a', 'photog_b,private_b,shown_a,veh_a,veh_b'), 'u5 (tied to private B): reads B''s readings');
RESET ROLE;

-- u6: B's mechanic contributor: tied, but B's photos are hidden from it, so their readings stay hidden; the photo-less
-- answer on B follows the vehicle tie.
SET ROLE authenticated; SELECT t_claims('00000000-0000-0000-0000-000000000006');
SELECT t_assert(t_four('shown_a', 'shown_a,veh_a,veh_b'), 'u6 (tied to B, B''s photos hidden): reads B''s photo-less answer only');
RESET ROLE;

-- service_role keeps every row.
SET ROLE service_role; SELECT t_claims('service');
SELECT t_assert(t_four(:ALL, :ALLQ), 'service_role: reads every row of the four tables');
RESET ROLE;

-- The revert puts back the open policies.
\ir revert_20261125183000_photo_reading_signed_in_select_policies.sql
RESET statement_timeout; RESET lock_timeout;
SET ROLE authenticated; SELECT t_claims('00000000-0000-0000-0000-000000000002');
SELECT t_assert(t_four(:ALL, :ALLQ), 'revert: a signed-in stranger reads every reading again (the pre-migration state)');
RESET ROLE;
