-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_<name> -f supabase/sql/test_photo_reading_anon_select_policies.sql
-- Proves 20261125180000_photo_reading_anon_select_policies.sql. On image_vehicle_mismatches and
-- image_condition_observations a photo's reading is readable by anon only when the photo is gallery-eligible on a public,
-- undeleted vehicle; never for an unfiled photo, a private car's photo, a deleted car's photo, a document or a photo the
-- privacy rule withholds; the uploader reads its own unfiled photo's reading; a viewer tied to a private car who sees
-- its photos reads their readings; a signed-in stranger reads only what anon reads; service_role reads every row; and
-- anon reads through PostgREST's shapes (select=* by image_id) without 42501. The vehicle is the photo's, not the
-- table's stamp: a reading of the unfiled photo stamped with the public car's id stays hidden. appraisal_canon_checks
-- (a materialized view) is refused to anon and authenticated (42501) and kept for service_role.
-- Fixture: supabase/sql/fixtures/photo_reading_select_base.sql (production's helper bodies by md5, policies, grants).
-- The two tables and the materialized view mirror production's columns that matter here, their foreign keys, grants and
-- SELECT policies as read on 2026-11-25.
-- Fixture rows only, in a disposable database. -- ALLOW_RAW_TESTIMONY_WRITE
\ir fixtures/photo_reading_select_base.sql

CREATE TABLE public.observation_sources (id uuid PRIMARY KEY, slug text UNIQUE);
CREATE TABLE public.vehicle_observations (id uuid PRIMARY KEY, vehicle_id uuid REFERENCES public.vehicles(id),
  source_id uuid REFERENCES public.observation_sources(id), structured_data jsonb, observed_at timestamptz DEFAULT now());
-- guardrail-allow(center-key-fk): image_vehicle_mismatches.suggested_vehicle_id: mirrors production, which holds no foreign key on it
CREATE TABLE public.image_vehicle_mismatches (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  image_id uuid NOT NULL REFERENCES public.vehicle_images(id) ON DELETE CASCADE,
  current_vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  suggested_vehicle_id uuid, mismatch_reason text, resolved boolean DEFAULT false,
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL);
CREATE TABLE public.image_condition_observations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  image_id uuid NOT NULL REFERENCES public.vehicle_images(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  descriptor_id uuid NOT NULL, severity numeric, zone text, source text NOT NULL);
CREATE INDEX idx_ico_image ON public.image_condition_observations (image_id);
CREATE INDEX idx_ico_vehicle ON public.image_condition_observations (vehicle_id);
CREATE INDEX idx_image_vehicle_mismatches_curr_vid ON public.image_vehicle_mismatches (current_vehicle_id);
-- Production's definition (pg_get_viewdef, 2026-11-25).
CREATE MATERIALIZED VIEW public.appraisal_canon_checks AS
 SELECT vo.id AS observation_id, vo.vehicle_id, ((vo.structured_data ->> 'image_id'::text))::uuid AS image_id,
    (vo.structured_data ->> 'image_url'::text) AS image_url, (p.value ->> 'part'::text) AS part,
    (c.value ->> 'canon_ref'::text) AS canon_ref, (c.value ->> 'verdict'::text) AS verdict,
    "left"((c.value ->> 'evidence'::text), 500) AS evidence,
    (NULLIF((p.value ->> 'confidence'::text), ''::text))::numeric AS confidence,
    (vo.structured_data ->> 'method'::text) AS method, vo.observed_at
   FROM ((vehicle_observations vo
     CROSS JOIN LATERAL jsonb_array_elements(COALESCE(((vo.structured_data -> 'observation'::text) -> 'parts'::text), '[]'::jsonb)) p(value))
     CROSS JOIN LATERAL jsonb_array_elements(COALESCE((p.value -> 'canon_checks'::text), '[]'::jsonb)) c(value))
  WHERE ((vo.source_id = ( SELECT observation_sources.id FROM observation_sources
          WHERE (observation_sources.slug = 'nuke-vision'::text))) AND ((vo.structured_data ->> 'layer'::text) = 'observe'::text))
  WITH NO DATA;

-- Production's policies and grants before the migration.
ALTER TABLE public.image_vehicle_mismatches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can view mismatches" ON public.image_vehicle_mismatches FOR SELECT USING (true);
CREATE POLICY "Service role can manage mismatches" ON public.image_vehicle_mismatches TO service_role USING (true);
ALTER TABLE public.image_condition_observations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read image_condition_observations" ON public.image_condition_observations FOR SELECT USING (true);
CREATE POLICY "Service role manage image_condition_observations" ON public.image_condition_observations
  USING ((auth.role() = 'service_role'::text));
GRANT SELECT, REFERENCES, TRIGGER ON public.image_vehicle_mismatches TO anon, authenticated;
GRANT ALL ON public.image_condition_observations TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.appraisal_canon_checks TO anon, authenticated;
GRANT ALL ON public.image_vehicle_mismatches, public.image_condition_observations, public.appraisal_canon_checks,
  public.vehicle_observations, public.observation_sources TO service_role;

-- One reading per photo on each table. The unfiled photo's rows carry the public car A as their vehicle stamp (2,066
-- of production's condition rows carry a vehicle_id that is not their photo's).
INSERT INTO public.image_vehicle_mismatches (image_id, current_vehicle_id, mismatch_reason)
SELECT vi.id, coalesce(vi.vehicle_id, 'a0000000-0000-0000-0000-00000000000a'), 'fixture' FROM public.vehicle_images vi;
INSERT INTO public.image_condition_observations (image_id, vehicle_id, descriptor_id, source)
SELECT vi.id, coalesce(vi.vehicle_id, 'a0000000-0000-0000-0000-00000000000a'), gen_random_uuid(), 'fixture' FROM public.vehicle_images vi;
INSERT INTO public.observation_sources VALUES ('50000000-0000-0000-0000-000000000001', 'nuke-vision');
INSERT INTO public.vehicle_observations (id, vehicle_id, source_id, structured_data)
SELECT gen_random_uuid(), vi.vehicle_id, '50000000-0000-0000-0000-000000000001',
  jsonb_build_object('layer', 'observe', 'image_id', vi.id, 'observation',
    jsonb_build_object('parts', jsonb_build_array(jsonb_build_object('part', 'grille', 'canon_checks', jsonb_build_array(jsonb_build_object('verdict', 'ok'))))))
FROM public.vehicle_images vi;
REFRESH MATERIALIZED VIEW public.appraisal_canon_checks;

-- The readings the current role and claims can read, as sorted photo labels.
CREATE FUNCTION public.t_seen(rel text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text;
BEGIN
  EXECUTE format('SELECT coalesce(string_agg(public.t_label(image_id), '','' ORDER BY public.t_label(image_id)), '''') FROM public.%I', rel) INTO r;
  RETURN r;
END $$;
-- Whether the current role is refused the relation outright (42501).
CREATE FUNCTION public.t_refused(rel text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('SELECT count(*) FROM public.%I', rel);
  RETURN false;
EXCEPTION WHEN insufficient_privilege THEN RETURN true;
END $$;
GRANT EXECUTE ON FUNCTION public.t_seen(text), public.t_refused(text) TO anon, authenticated, service_role;

\set ALL '''deleted_c,document_a,photog_b,plate_a,private_b,shown_a,unfiled_u1'''

-- Before: the defect. Anon reads every reading, the unfiled photo's included, and the materialized view.
SET ROLE anon; SELECT t_claims('');
SELECT t_assert(t_seen('image_vehicle_mismatches') = :ALL AND t_seen('image_condition_observations') = :ALL
  AND t_seen('appraisal_canon_checks') = :ALL, 'before: anon reads all 7 readings on both tables and the materialized view');
RESET ROLE;

\ir ../migrations/20261125180000_photo_reading_anon_select_policies.sql
\ir ../migrations/20261125180000_photo_reading_anon_select_policies.sql
RESET statement_timeout; RESET lock_timeout;

SELECT t_assert((SELECT count(*) FROM pg_policies WHERE tablename = 'image_vehicle_mismatches' AND cmd = 'SELECT') = 1
  AND (SELECT count(*) FROM pg_policies WHERE tablename = 'image_condition_observations' AND cmd = 'SELECT') = 1
  AND (SELECT count(*) FROM pg_policies WHERE tablename = 'image_vehicle_mismatches' AND cmd = 'ALL' AND roles = '{service_role}') = 1
  AND (SELECT count(*) FROM pg_policies WHERE tablename = 'image_condition_observations' AND cmd = 'ALL') = 1
  AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename IN ('image_vehicle_mismatches', 'image_condition_observations')
                    AND cmd = 'SELECT' AND qual = 'true'),
  'policies: one SELECT policy per table, applied twice; the ALL policies are unchanged');

-- Anon.
SET ROLE anon; SELECT t_claims('');
SELECT t_assert(t_seen('image_vehicle_mismatches') = 'shown_a' AND t_seen('image_condition_observations') = 'shown_a',
  'anon: reads the shown photo''s readings only (not unfiled, private, deleted, document or privacy-withheld)');
SELECT t_assert((SELECT count(*) FROM public.image_condition_observations WHERE vehicle_id = 'a0000000-0000-0000-0000-00000000000a') = 1
  AND (SELECT count(*) FROM public.image_vehicle_mismatches WHERE current_vehicle_id = 'a0000000-0000-0000-0000-00000000000a') = 1,
  'anon: filtering by the public car''s stamp returns the shown reading only, not the unfiled photo''s row stamped with it');
SELECT t_assert((SELECT count(*) FROM (SELECT * FROM public.image_condition_observations WHERE image_id = '10000000-0000-0000-0000-000000000001') s) = 1
  AND (SELECT count(*) FROM (SELECT * FROM public.image_vehicle_mismatches WHERE image_id = '10000000-0000-0000-0000-000000000001') s) = 1,
  'anon: select=* by image_id runs (no 42501) and returns the shown photo''s reading');
SELECT t_assert(t_refused('appraisal_canon_checks'), 'anon: appraisal_canon_checks is refused (42501)');
RESET ROLE;

-- u1: uploader and owner of A, B and C.
SET ROLE authenticated; SELECT t_claims('00000000-0000-0000-0000-000000000001');
SELECT t_assert(t_seen('image_vehicle_mismatches') = :ALL AND t_seen('image_condition_observations') = :ALL,
  'u1 (uploader, owner): reads its own unfiled photo''s readings and every reading of its cars');
SELECT t_assert(t_refused('appraisal_canon_checks'), 'u1: appraisal_canon_checks is refused (42501)');
RESET ROLE;

-- u2: a signed-in stranger reads only what anon reads.
SET ROLE authenticated; SELECT t_claims('00000000-0000-0000-0000-000000000002');
SELECT t_assert(t_seen('image_vehicle_mismatches') = 'shown_a' AND t_seen('image_condition_observations') = 'shown_a',
  'u2 (stranger): reads what anon reads');
RESET ROLE;

-- u3: uploaded photog_b on the private car B; not tied to B.
SET ROLE authenticated; SELECT t_claims('00000000-0000-0000-0000-000000000003');
SELECT t_assert(t_seen('image_condition_observations') = 'photog_b,shown_a',
  'u3 (uploader of photog_b): reads its own photo''s reading on a private car, not private_b');
RESET ROLE;

-- u4: A's mechanic (tied to A).
SET ROLE authenticated; SELECT t_claims('00000000-0000-0000-0000-000000000004');
SELECT t_assert(t_seen('image_condition_observations') = 'document_a,plate_a,shown_a',
  'u4 (tied to A): reads A''s document and privacy-withheld photos'' readings, nothing of B or C');
RESET ROLE;

-- u5: B's recorded owner_id (tied to the private car B, sees its photos).
SET ROLE authenticated; SELECT t_claims('00000000-0000-0000-0000-000000000005');
SELECT t_assert(t_seen('image_vehicle_mismatches') = 'photog_b,private_b,shown_a'
  AND t_seen('image_condition_observations') = 'photog_b,private_b,shown_a',
  'u5 (tied to private B): reads B''s readings');
RESET ROLE;

-- u6: B's mechanic contributor. Tied, but vehicle_images RLS hides B's photos from it, so their readings stay hidden too
-- (a reading is never shown where its photo is not).
SET ROLE authenticated; SELECT t_claims('00000000-0000-0000-0000-000000000006');
SELECT t_assert(t_seen('image_condition_observations') = 'shown_a',
  'u6 (tied to B, B''s photos hidden by vehicle_images RLS): reads no reading of B');
RESET ROLE;

-- service_role keeps every row.
SET ROLE service_role; SELECT t_claims('service');
SELECT t_assert(t_seen('image_vehicle_mismatches') = :ALL AND t_seen('image_condition_observations') = :ALL
  AND t_seen('appraisal_canon_checks') = :ALL, 'service_role: reads all 7 readings on both tables and the materialized view');
RESET ROLE;

SELECT t_assert((SELECT count(*) FROM public.image_vehicle_mismatches) = 7 AND (SELECT count(*) FROM public.image_condition_observations) = 7,
  'no row changed');

-- The revert puts back the open policies and the grants.
\ir revert_20261125180000_photo_reading_anon_select_policies.sql
RESET statement_timeout; RESET lock_timeout;
SET ROLE anon; SELECT t_claims('');
SELECT t_assert(t_seen('image_vehicle_mismatches') = :ALL AND t_seen('image_condition_observations') = :ALL
  AND t_seen('appraisal_canon_checks') = :ALL, 'revert: anon reads all 7 again (the pre-migration state)');
RESET ROLE;
