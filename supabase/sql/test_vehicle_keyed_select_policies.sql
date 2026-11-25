-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_<name> -f supabase/sql/test_vehicle_keyed_select_policies.sql
-- Proves 20261125181500_vehicle_keyed_select_policies.sql.
--   image_tags: anon reads the tags of a public, undeleted car (no photo named) and the tags of a shown photo; never a
--   private car's or a deleted car's tags, nor the tags of an unfiled, private, deleted, document or privacy-withheld
--   photo; a signed-in stranger reads what anon reads; the creator reads its own tag on a private car (and INSERT ...
--   RETURNING works for it); a tied viewer reads its private car's tags; service_role reads every row; select=* by
--   vehicle_id runs as anon without 42501.
--   ai_scan_sessions: anon and a stranger read none; the creator reads its own; a tied viewer reads its car's sessions,
--   private included; service_role reads every row.
-- Fixture: supabase/sql/fixtures/photo_reading_select_base.sql (production's helper bodies by md5, policies, grants).
-- The two tables mirror production's columns that matter here, their foreign keys, grants and policies (every command)
-- as read on 2026-11-25.
-- Fixture rows only, in a disposable database. -- ALLOW_RAW_TESTIMONY_WRITE
\ir fixtures/photo_reading_select_base.sql

CREATE TABLE public.image_tags (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  image_id uuid REFERENCES public.vehicle_images(id) ON DELETE CASCADE,
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE CASCADE,
  tag_name text, image_url text, created_by character varying DEFAULT (auth.uid())::text,
  inserted_at timestamp NOT NULL DEFAULT now());
CREATE INDEX idx_image_tags_image_id ON public.image_tags (image_id);
CREATE INDEX idx_image_tags_vehicle_source ON public.image_tags (vehicle_id);
CREATE TABLE public.ai_scan_sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE CASCADE,
  ai_model character varying NOT NULL DEFAULT 'gpt-4o', total_api_cost_usd numeric, image_ids uuid[],
  created_by uuid REFERENCES auth.users(id));
CREATE INDEX idx_scan_sessions_vehicle ON public.ai_scan_sessions (vehicle_id);

-- Production's policies and grants before the migration.
ALTER TABLE public.image_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Image tags are publicly viewable" ON public.image_tags FOR SELECT USING (true);
CREATE POLICY "Public tag reading" ON public.image_tags FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY image_tags_select_all ON public.image_tags FOR SELECT USING (true);
CREATE POLICY image_tags_delete_creator ON public.image_tags FOR DELETE TO authenticated USING (((created_by)::text = ((SELECT auth.uid()))::text));
CREATE POLICY image_tags_delete_own ON public.image_tags FOR DELETE USING ((((SELECT auth.uid()))::text = (created_by)::text));
CREATE POLICY image_tags_insert_authenticated ON public.image_tags FOR INSERT TO authenticated WITH CHECK (((created_by)::text = ((SELECT auth.uid()))::text));
CREATE POLICY image_tags_insert_own ON public.image_tags FOR INSERT WITH CHECK ((((SELECT auth.uid()))::text = (created_by)::text));
CREATE POLICY image_tags_update_creator ON public.image_tags FOR UPDATE TO authenticated USING (((created_by)::text = ((SELECT auth.uid()))::text))
  WITH CHECK (((created_by)::text = ((SELECT auth.uid()))::text));
CREATE POLICY image_tags_update_own ON public.image_tags FOR UPDATE USING ((((SELECT auth.uid()))::text = (created_by)::text));
ALTER TABLE public.ai_scan_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can view scan sessions" ON public.ai_scan_sessions FOR SELECT USING (true);
CREATE POLICY "Service role can create scan sessions" ON public.ai_scan_sessions FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY ai_sessions_owner_policy ON public.ai_scan_sessions USING ((EXISTS (SELECT 1 FROM vehicles v
  WHERE ((v.id = ai_scan_sessions.vehicle_id) AND (v.uploaded_by = (SELECT auth.uid()))))));
GRANT SELECT, UPDATE, DELETE, REFERENCES, TRIGGER ON public.image_tags TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON public.image_tags TO authenticated;
GRANT SELECT, REFERENCES, TRIGGER ON public.ai_scan_sessions TO anon, authenticated;
GRANT ALL ON public.image_tags, public.ai_scan_sessions TO service_role;

-- Tags: one per car with no photo (veh_a, veh_b, veh_c; production's shape), one per photo (the photo's label), and
-- u3's own tag on the private car B (u3_tag_b).
INSERT INTO public.image_tags (vehicle_id, tag_name, created_by) VALUES
  ('a0000000-0000-0000-0000-00000000000a', 'veh_a', '00000000-0000-0000-0000-000000000001'),
  ('b0000000-0000-0000-0000-00000000000b', 'veh_b', '00000000-0000-0000-0000-000000000001'),
  ('c0000000-0000-0000-0000-00000000000c', 'veh_c', '00000000-0000-0000-0000-000000000001'),
  ('b0000000-0000-0000-0000-00000000000b', 'u3_tag_b', '00000000-0000-0000-0000-000000000003');
INSERT INTO public.image_tags (image_id, vehicle_id, tag_name, created_by)
SELECT vi.id, coalesce(vi.vehicle_id, 'a0000000-0000-0000-0000-00000000000a'), public.t_label(vi.id), '00000000-0000-0000-0000-000000000001'
FROM public.vehicle_images vi;
-- Sessions: one per car (label in ai_model), and u3's own session on B.
INSERT INTO public.ai_scan_sessions (vehicle_id, ai_model, created_by) VALUES
  ('a0000000-0000-0000-0000-00000000000a', 'sess_a', NULL),
  ('b0000000-0000-0000-0000-00000000000b', 'sess_b', NULL),
  ('c0000000-0000-0000-0000-00000000000c', 'sess_c', NULL),
  ('b0000000-0000-0000-0000-00000000000b', 'sess_u3', '00000000-0000-0000-0000-000000000003');

CREATE FUNCTION public.t_tags() RETURNS text LANGUAGE sql AS
$$ SELECT coalesce(string_agg(tag_name, ',' ORDER BY tag_name), '') FROM public.image_tags $$;
CREATE FUNCTION public.t_sessions() RETURNS text LANGUAGE sql AS
$$ SELECT coalesce(string_agg(ai_model, ',' ORDER BY ai_model), '') FROM public.ai_scan_sessions $$;
GRANT EXECUTE ON FUNCTION public.t_tags(), public.t_sessions() TO anon, authenticated, service_role;

\set ALLTAGS '''deleted_c,document_a,photog_b,plate_a,private_b,shown_a,u3_tag_b,unfiled_u1,veh_a,veh_b,veh_c'''
\set ALLSESS '''sess_a,sess_b,sess_c,sess_u3'''

-- Before: the defect.
SET ROLE anon; SELECT t_claims('');
SELECT t_assert(t_tags() = :ALLTAGS AND t_sessions() = :ALLSESS, 'before: anon reads all 11 tags and all 4 sessions');
RESET ROLE;

\ir ../migrations/20261125181500_vehicle_keyed_select_policies.sql
\ir ../migrations/20261125181500_vehicle_keyed_select_policies.sql
RESET statement_timeout; RESET lock_timeout;

SELECT t_assert((SELECT count(*) FROM pg_policies WHERE tablename = 'image_tags' AND cmd = 'SELECT') = 1
  AND (SELECT count(*) FROM pg_policies WHERE tablename = 'image_tags') = 7
  AND (SELECT count(*) FROM pg_policies WHERE tablename = 'ai_scan_sessions' AND cmd = 'SELECT') = 1
  AND (SELECT count(*) FROM pg_policies WHERE tablename = 'ai_scan_sessions') = 3,
  'policies: one SELECT policy per table, applied twice; the 6 write policies on image_tags and 2 on ai_scan_sessions unchanged');

-- Anon.
SET ROLE anon; SELECT t_claims('');
SELECT t_assert(t_tags() = 'shown_a,veh_a', 'anon: reads the public car''s tag and the shown photo''s tag only');
SELECT t_assert((SELECT count(*) FROM (SELECT * FROM public.image_tags WHERE vehicle_id = 'a0000000-0000-0000-0000-00000000000a') s) = 2,
  'anon: select=* by vehicle_id runs (no 42501); A''s document, plate and unfiled-stamped photo tags stay hidden');
SELECT t_assert((SELECT count(*) FROM public.image_tags WHERE vehicle_id IN ('b0000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-00000000000c')) = 0,
  'anon: no tag of the private car or the deleted car');
SELECT t_assert(t_sessions() = '', 'anon: reads no scan session');
RESET ROLE;

-- u1: owner of A, B, C and uploader of every photo but photog_b.
SET ROLE authenticated; SELECT t_claims('00000000-0000-0000-0000-000000000001');
SELECT t_assert(t_tags() = :ALLTAGS, 'u1 (owner, uploader): reads every tag');
SELECT t_assert(t_sessions() = :ALLSESS, 'u1 (tied to A, B, C): reads every session');
RESET ROLE;

-- u2: a signed-in stranger reads what anon reads.
SET ROLE authenticated; SELECT t_claims('00000000-0000-0000-0000-000000000002');
SELECT t_assert(t_tags() = 'shown_a,veh_a' AND t_sessions() = '', 'u2 (stranger): reads what anon reads');
RESET ROLE;

-- u3: created u3_tag_b and sess_u3 on the private car B, uploaded photog_b; not tied to B.
SET ROLE authenticated; SELECT t_claims('00000000-0000-0000-0000-000000000003');
SELECT t_assert(t_tags() = 'photog_b,shown_a,u3_tag_b,veh_a', 'u3 (creator, uploader): reads its own tag and its photo''s tag on B, not veh_b');
SELECT t_assert(t_sessions() = 'sess_u3', 'u3: reads its own session only');
-- INSERT ... RETURNING needs SELECT on the new row (PostgREST's return=representation).
INSERT INTO public.image_tags (vehicle_id, tag_name) VALUES ('b0000000-0000-0000-0000-00000000000b', 'u3_new_b') RETURNING tag_name \gset ins_
SELECT t_assert(:'ins_tag_name' = 'u3_new_b',
  'u3: INSERT ... RETURNING of its own tag on a private car it is not tied to succeeds (the creator reads its row)');
UPDATE public.image_tags SET tag_name = 'u3_new_b2' WHERE tag_name = 'u3_new_b' RETURNING tag_name \gset upd_
SELECT t_assert(:'upd_tag_name' = 'u3_new_b2', 'u3: updates its own tag');
RESET ROLE;

-- u6: B's mechanic contributor (tied to B; B's photos are hidden from it by vehicle_images RLS).
SET ROLE authenticated; SELECT t_claims('00000000-0000-0000-0000-000000000006');
SELECT t_assert(t_tags() = 'shown_a,u3_new_b2,u3_tag_b,veh_a,veh_b', 'u6 (tied to private B): reads B''s car tags, not B''s photo tags');
SELECT t_assert(t_sessions() = 'sess_b,sess_u3', 'u6 (tied to private B): reads B''s sessions');
RESET ROLE;

-- service_role keeps every row.
SET ROLE service_role; SELECT t_claims('service');
SELECT t_assert((SELECT count(*) FROM public.image_tags) = 12 AND t_sessions() = :ALLSESS, 'service_role: reads all 12 tags and all 4 sessions');
RESET ROLE;

-- The revert puts back the open policies.
\ir revert_20261125181500_vehicle_keyed_select_policies.sql
RESET statement_timeout; RESET lock_timeout;
SET ROLE anon; SELECT t_claims('');
SELECT t_assert((SELECT count(*) FROM public.image_tags) = 12 AND t_sessions() = :ALLSESS, 'revert: anon reads every tag and session again');
RESET ROLE;
