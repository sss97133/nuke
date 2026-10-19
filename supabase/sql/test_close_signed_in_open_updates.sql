-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_signed_in_open_updates -f this-file.sql
-- Proves that after 20261014213000_close_signed_in_open_updates.sql a signed-in stranger (any account: sign-up is open
-- and anonymous sign-in is on) can no longer rewrite rows on the 11 tables or read the acquisition pipeline and the
-- contact inbox, while each real writer still writes: a library upload still maintains the reference tables through
-- the live triggers (now definers), an active admin reads and updates the inbox and edits the deck, the vehicle's
-- editors (uploader, user, owner, permitted contributor) write its field sources, the owner keeps the sale
-- settings, and the service role writes everything; and that the live policies let the stranger do each of those.
-- Starts from the live policies and grants as read on 2026-10-14 and the live trigger functions
-- (helpers/library_document_triggers_live_20261014.sql). The seeds are a disposable database's rows.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.oem_vehicle_specs') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
-- auth.uid() and auth.role() read the request's claims, as production's do.
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'owp_table_owner') THEN CREATE ROLE owp_table_owner NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role, owp_table_owner;
GRANT CREATE ON SCHEMA public TO owp_table_owner;
-- Signs in as a user id ('' signs out), as PostgREST sets the claims.
CREATE FUNCTION public.t_as(p_uid text) RETURNS void LANGUAGE sql AS
$$ SELECT set_config('request.jwt.claims', CASE WHEN p_uid = '' THEN '' ELSE json_build_object('sub', p_uid, 'role', 'authenticated')::text END, false) $$;
GRANT EXECUTE ON FUNCTION public.t_as(text) TO anon, authenticated, service_role;

SET ROLE owp_table_owner;
CREATE TABLE public.admin_users (user_id uuid, is_active boolean);
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, uploaded_by uuid, user_id uuid, owner_id uuid);
CREATE TABLE public.vehicle_user_permissions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid NOT NULL, user_id uuid NOT NULL, is_active boolean);
GRANT SELECT ON public.admin_users, public.vehicles, public.vehicle_user_permissions TO anon, authenticated, service_role;

-- The reference tables the library triggers maintain, and library_documents with its live insert policy.
CREATE TABLE public.oem_vehicle_specs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), make text NOT NULL, model text NOT NULL,
  year_start integer NOT NULL, year_end integer, series text, body_style text, source text, notes text, updated_at timestamptz,
  source_library_id uuid, source_documents uuid[], confidence_score integer);
CREATE TABLE public.reference_libraries (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), year integer NOT NULL, make text NOT NULL,
  model text, series text, body_style text, notes text, document_count integer DEFAULT 0, created_by uuid, updated_at timestamptz, oem_spec_id uuid);
CREATE TABLE public.reference_coverage (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), make text NOT NULL, model_family text NOT NULL,
  year_range_start integer NOT NULL, year_range_end integer NOT NULL, topic text NOT NULL, coverage_status text,
  coverage_percentage integer DEFAULT 0, available_documents uuid[], last_assessed timestamptz, updated_at timestamptz);
CREATE TABLE public.library_documents (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), library_id uuid NOT NULL, document_type text NOT NULL,
  title text NOT NULL, file_url text NOT NULL DEFAULT 'https://files.example/doc', uploaded_by uuid NOT NULL);
ALTER TABLE public.oem_vehicle_specs ENABLE ROW LEVEL SECURITY;
CREATE POLICY oem_specs_write ON public.oem_vehicle_specs TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY oem_specs_read ON public.oem_vehicle_specs FOR SELECT USING (true);
ALTER TABLE public.reference_libraries ENABLE ROW LEVEL SECURITY;
CREATE POLICY libraries_authenticated_insert ON public.reference_libraries FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY lib_read ON public.reference_libraries FOR SELECT USING (true);
CREATE POLICY libraries_public_read ON public.reference_libraries FOR SELECT USING (true);
CREATE POLICY libraries_authenticated_update ON public.reference_libraries FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
ALTER TABLE public.reference_coverage ENABLE ROW LEVEL SECURITY;
CREATE POLICY coverage_auth_update ON public.reference_coverage TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY coverage_read_all ON public.reference_coverage FOR SELECT USING (true);
ALTER TABLE public.library_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY docs_upload ON public.library_documents FOR INSERT WITH CHECK (uploaded_by = (SELECT auth.uid()));
CREATE POLICY docs_read ON public.library_documents FOR SELECT USING (true);
\ir helpers/library_document_triggers_live_20261014.sql

-- The reference and admin tables, verbatim policies.
CREATE TABLE public.paint_codes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), make text NOT NULL DEFAULT 'GM', code text NOT NULL, name text NOT NULL DEFAULT 'Paint');
ALTER TABLE public.paint_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY paint_codes_insert ON public.paint_codes FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY paint_codes_read ON public.paint_codes FOR SELECT USING (true);
CREATE POLICY paint_codes_update ON public.paint_codes FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE TABLE public.gm_paint_codes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL, name text NOT NULL DEFAULT 'Paint');
ALTER TABLE public.gm_paint_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY gm_paint_codes_insert ON public.gm_paint_codes FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY gm_paint_codes_read ON public.gm_paint_codes FOR SELECT USING (true);
CREATE POLICY gm_paint_codes_update ON public.gm_paint_codes FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE TABLE public.vehicle_production_data (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), make text NOT NULL, model text NOT NULL DEFAULT 'Model', year integer NOT NULL DEFAULT 1970);
ALTER TABLE public.vehicle_production_data ENABLE ROW LEVEL SECURITY;
CREATE POLICY vehicle_production_data_write ON public.vehicle_production_data USING (auth.role() = 'authenticated');
CREATE POLICY vehicle_production_data_read ON public.vehicle_production_data FOR SELECT USING (true);
CREATE TABLE public.vehicle_sale_settings (vehicle_id uuid PRIMARY KEY, for_sale boolean);
ALTER TABLE public.vehicle_sale_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage settings for vehicles they own" ON public.vehicle_sale_settings
  USING (EXISTS (SELECT 1 FROM vehicles WHERE vehicles.id = vehicle_sale_settings.vehicle_id AND vehicles.uploaded_by = (SELECT auth.uid())));
CREATE POLICY authenticated_full_access ON public.vehicle_sale_settings TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Users can view settings for vehicles they own" ON public.vehicle_sale_settings FOR SELECT
  USING (EXISTS (SELECT 1 FROM vehicles WHERE vehicles.id = vehicle_sale_settings.vehicle_id AND vehicles.uploaded_by = (SELECT auth.uid())));
CREATE TABLE public.acquisition_pipeline (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), seller_contact text, offer_amount numeric);
ALTER TABLE public.acquisition_pipeline ENABLE ROW LEVEL SECURITY;
CREATE POLICY authenticated_read ON public.acquisition_pipeline FOR SELECT TO authenticated USING (true);
CREATE POLICY authenticated_update ON public.acquisition_pipeline FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE TABLE public.contact_inbox (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email_id text NOT NULL DEFAULT 'e', from_address text NOT NULL,
  to_address text NOT NULL DEFAULT 'info@nuke.example', status text DEFAULT 'new');
ALTER TABLE public.contact_inbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service can insert contact inbox" ON public.contact_inbox FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "Admins can read contact inbox" ON public.contact_inbox FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can update contact inbox" ON public.contact_inbox FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Service can update contact inbox" ON public.contact_inbox FOR UPDATE TO service_role USING (true);
CREATE TABLE public.deck_slides (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), deck_id text NOT NULL, slide_index integer NOT NULL,
  slide_type text NOT NULL DEFAULT 'title', content jsonb, updated_by uuid);
ALTER TABLE public.deck_slides ENABLE ROW LEVEL SECURITY;
CREATE POLICY deck_slides_insert ON public.deck_slides FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY deck_slides_read ON public.deck_slides FOR SELECT USING (true);
CREATE POLICY deck_slides_update_signed_in ON public.deck_slides FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) IS NOT NULL) WITH CHECK (updated_by = (SELECT auth.uid()));
CREATE TABLE public.vehicle_field_sources (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, field_name text NOT NULL,
  source_type text NOT NULL DEFAULT 'user_input', field_value text);
CREATE UNIQUE INDEX vehicle_field_sources_vehicle_field ON public.vehicle_field_sources (vehicle_id, field_name);
ALTER TABLE public.vehicle_field_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Vehicle contributors can add field sources" ON public.vehicle_field_sources FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM vehicles v WHERE v.id = vehicle_field_sources.vehicle_id AND v.user_id = (SELECT auth.uid()))
    OR EXISTS (SELECT 1 FROM vehicle_user_permissions vup WHERE vup.vehicle_id = vehicle_field_sources.vehicle_id AND vup.user_id = (SELECT auth.uid()) AND vup.is_active = true));
CREATE POLICY "insert/update by authenticated" ON public.vehicle_field_sources FOR INSERT TO authenticated WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY vfs_insert_auth ON public.vehicle_field_sources FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Public read access to field sources" ON public.vehicle_field_sources FOR SELECT USING (true);
CREATE POLICY "Vehicle contributors can update field sources" ON public.vehicle_field_sources FOR UPDATE
  USING (EXISTS (SELECT 1 FROM vehicles v WHERE v.id = vehicle_field_sources.vehicle_id AND v.user_id = (SELECT auth.uid()))
    OR EXISTS (SELECT 1 FROM vehicle_user_permissions vup WHERE vup.vehicle_id = vehicle_field_sources.vehicle_id AND vup.user_id = (SELECT auth.uid()) AND vup.is_active = true));
CREATE POLICY "update by authenticated" ON public.vehicle_field_sources FOR UPDATE TO authenticated
  USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY vfs_update_auth ON public.vehicle_field_sources FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
-- Grants as live: everything to the API roles, except anon's writes on reference_libraries and deck_slides (revoked
-- by 20261014183000 and 20261014174500) and authenticated's delete and truncate there.
GRANT ALL ON public.oem_vehicle_specs, public.reference_libraries, public.reference_coverage, public.library_documents,
  public.paint_codes, public.gm_paint_codes, public.vehicle_production_data, public.vehicle_sale_settings,
  public.acquisition_pipeline, public.contact_inbox, public.deck_slides, public.vehicle_field_sources
  TO anon, authenticated, service_role;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.reference_libraries, public.deck_slides FROM anon;
REVOKE DELETE, TRUNCATE ON public.reference_libraries, public.deck_slides FROM authenticated;
RESET ROLE;

-- Seeds. Admin A1 (active) and A9 (inactive); stranger X; vehicles V1 (uploaded by O), V2 (user U), V3 (contributor K
-- holds a permission); library L1 (1979 Chevrolet C10) with coverage for its body panels; one row in each table.
INSERT INTO public.admin_users VALUES ('20000000-0000-0000-0000-0000000000a1', true), ('20000000-0000-0000-0000-0000000000a9', false);
INSERT INTO public.vehicles VALUES
 ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000b1', NULL, NULL),
 ('10000000-0000-0000-0000-000000000002', NULL, '20000000-0000-0000-0000-0000000000b2', NULL),
 ('10000000-0000-0000-0000-000000000003', NULL, NULL, NULL);
-- ALLOW_RAW_TESTIMONY_WRITE: a seed row in this disposable PG17 test database, never production.
INSERT INTO public.vehicle_user_permissions (vehicle_id, user_id, is_active) VALUES
 ('10000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-0000000000c1', true);
INSERT INTO public.reference_libraries (id, year, make, series, body_style) VALUES ('30000000-0000-0000-0000-000000000001', 1979, 'Chevrolet', 'C10', 'Pickup');
INSERT INTO public.reference_coverage (make, model_family, year_range_start, year_range_end, topic, coverage_status)
  VALUES ('Chevrolet', 'C10', 1973, 1987, 'body_panels', 'missing');
INSERT INTO public.oem_vehicle_specs (make, model, year_start) VALUES ('Ford', 'Bronco', 1966);
INSERT INTO public.paint_codes (code) VALUES ('70');
INSERT INTO public.gm_paint_codes (code) VALUES ('70');
INSERT INTO public.vehicle_production_data (make) VALUES ('Chevrolet');
INSERT INTO public.vehicle_sale_settings VALUES ('10000000-0000-0000-0000-000000000001', false);
INSERT INTO public.acquisition_pipeline (seller_contact, offer_amount) VALUES ('seller@example.com', 18000);
INSERT INTO public.contact_inbox (from_address) VALUES ('investor@example.com');
INSERT INTO public.deck_slides (deck_id, slide_index, content) VALUES ('synthetic-deck', 0, '{"title": "One"}');
INSERT INTO public.vehicle_field_sources (vehicle_id, field_name, field_value) VALUES ('10000000-0000-0000-0000-000000000001', 'vin', 'SYNTH0000000000001');

CREATE FUNCTION public.t_assert(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(p_ok, false) THEN RAISE EXCEPTION 'FAIL: %', p_what; END IF; END $$;
CREATE FUNCTION public.t_refused(p_sql text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN false;
EXCEPTION WHEN insufficient_privilege THEN RETURN true;
END $$;
CREATE FUNCTION public.t_rows(p_sql text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint; BEGIN EXECUTE p_sql; GET DIAGNOSTICS n = ROW_COUNT; RETURN n; END $$;
CREATE FUNCTION public.t_count(p_tbl text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint; BEGIN EXECUTE format('SELECT count(*) FROM public.%I', p_tbl) INTO n; RETURN n; END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean, text), public.t_refused(text), public.t_rows(text), public.t_count(text)
  TO anon, authenticated, service_role;
-- One harmless rewrite per table (a slide edit carries its editor, as the deck page sends it).
CREATE TABLE public.t_tables (tbl text PRIMARY KEY, set_clause text NOT NULL);
INSERT INTO public.t_tables VALUES ('oem_vehicle_specs', 'notes = notes'), ('reference_libraries', 'notes = notes'),
  ('reference_coverage', 'coverage_status = coverage_status'), ('paint_codes', 'name = name'), ('gm_paint_codes', 'name = name'),
  ('vehicle_production_data', 'model = model'), ('vehicle_sale_settings', 'for_sale = for_sale'),
  ('acquisition_pipeline', 'seller_contact = seller_contact'), ('contact_inbox', 'status = status'),
  ('deck_slides', 'slide_type = slide_type, updated_by = auth.uid()'), ('vehicle_field_sources', 'field_value = field_value');
GRANT SELECT ON public.t_tables TO anon, authenticated, service_role;

-- 1. Before: a signed-in stranger rewrites every row of the 11 tables and reads the pipeline and the inbox.
SET ROLE authenticated;
SELECT public.t_as('20000000-0000-0000-0000-0000000000f9');
BEGIN;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM public.t_tables LOOP
    PERFORM public.t_assert(public.t_rows(format('UPDATE public.%I SET %s', r.tbl, r.set_clause)) = 1,
      format('before: a stranger rewrites every %s row', r.tbl));
  END LOOP;
END $$;
SELECT public.t_assert(public.t_count('acquisition_pipeline') = 1 AND public.t_count('contact_inbox') = 1, 'before: a stranger reads the pipeline and the inbox');
ROLLBACK;
RESET ROLE;

-- 2. Apply the migration as the table owner, twice (the second run is a no-op).
SET ROLE owp_table_owner;
\ir ../migrations/20261014213000_close_signed_in_open_updates.sql
\ir ../migrations/20261014213000_close_signed_in_open_updates.sql
RESET ROLE;

-- 3. The stranger: no rewrite anywhere (refused, or no row), no pipeline or inbox row, no field source or slide;
--    anon holds no write grant.
SET ROLE authenticated;
SELECT public.t_as('20000000-0000-0000-0000-0000000000f9');
DO $$
DECLARE r record; v_refused boolean; v_rows bigint;
BEGIN
  FOR r IN SELECT * FROM public.t_tables LOOP
    BEGIN
      v_rows := public.t_rows(format('UPDATE public.%I SET %s', r.tbl, r.set_clause));
      v_refused := false;
    EXCEPTION WHEN insufficient_privilege THEN v_refused := true; v_rows := 0;
    END;
    PERFORM public.t_assert(v_refused OR v_rows = 0, format('a stranger rewrites no %s row', r.tbl));
  END LOOP;
END $$;
SELECT public.t_assert(public.t_count('acquisition_pipeline') = 0 AND public.t_count('contact_inbox') = 0, 'a stranger reads no pipeline or inbox row');
SELECT public.t_assert(public.t_refused($q$INSERT INTO public.vehicle_field_sources (vehicle_id, field_name, field_value) VALUES ('10000000-0000-0000-0000-000000000001', 'mileage', '1')$q$),
  'a stranger adds no field source to another''s vehicle');
SELECT public.t_assert(public.t_refused($q$INSERT INTO public.deck_slides (deck_id, slide_index) VALUES ('synthetic-deck', 9)$q$), 'a stranger adds no slide');
SELECT public.t_assert(public.t_refused($q$INSERT INTO public.paint_codes (code) VALUES ('99')$q$) AND public.t_refused($q$DELETE FROM public.oem_vehicle_specs$q$),
  'reference tables take no client write');
RESET ROLE;
SELECT public.t_assert(NOT has_table_privilege('anon', 'public.' || tbl, 'INSERT,UPDATE,DELETE,TRUNCATE'), 'anon holds no write on ' || tbl) FROM public.t_tables;

-- 4. A library upload by a signed-in user (not an admin) still maintains the reference tables, through the definers.
SET ROLE authenticated;
SELECT public.t_as('20000000-0000-0000-0000-0000000000d1');
SELECT public.t_assert(public.t_rows($q$INSERT INTO public.library_documents (library_id, document_type, title, uploaded_by) VALUES ('30000000-0000-0000-0000-000000000001', 'Assembly Manual', '1979 C/K assembly manual', '20000000-0000-0000-0000-0000000000d1')$q$) = 1,
  'a signed-in user uploads a library document');
RESET ROLE;
SELECT public.t_assert((SELECT document_count FROM public.reference_libraries WHERE id = '30000000-0000-0000-0000-000000000001') = 1
  AND (SELECT oem_spec_id IS NOT NULL FROM public.reference_libraries WHERE id = '30000000-0000-0000-0000-000000000001'),
  'the library''s count and spec link were maintained');
SELECT public.t_assert(EXISTS (SELECT 1 FROM public.oem_vehicle_specs WHERE make = 'Chevrolet' AND source = 'Reference Library' AND cardinality(source_documents) = 1),
  'the OEM spec was created and linked');
SELECT public.t_assert((SELECT coverage_status FROM public.reference_coverage WHERE topic = 'body_panels') = 'partial', 'the coverage was updated');
SELECT public.t_assert(p.prosecdef AND p.proconfig = ARRAY['search_path=public'], p.proname || ' is a definer with search_path public')
FROM pg_proc p WHERE p.proname IN ('link_document_to_specs', 'trigger_update_library_stats', 'update_coverage_on_upload');

-- 5. An active admin reads the pipeline and the inbox, marks an inbox item, and edits the deck, attributed; an
--    inactive admin row counts for nothing.
SET ROLE authenticated;
SELECT public.t_as('20000000-0000-0000-0000-0000000000a1');
SELECT public.t_assert(public.t_count('acquisition_pipeline') = 1 AND public.t_count('contact_inbox') = 1, 'an admin reads the pipeline and the inbox');
SELECT public.t_assert(public.t_rows($q$UPDATE public.contact_inbox SET status = 'read'$q$) = 1, 'an admin marks the inbox item read');
SELECT public.t_assert(public.t_rows($q$UPDATE public.deck_slides SET content = '{"title": "One, edited"}', updated_by = '20000000-0000-0000-0000-0000000000a1'$q$) = 1, 'an admin edits a slide, attributed');
SELECT public.t_assert(public.t_refused($q$UPDATE public.deck_slides SET content = '{"title": "unattributed"}', updated_by = NULL$q$), 'an unattributed edit is refused');
SELECT public.t_assert(public.t_rows($q$INSERT INTO public.deck_slides (deck_id, slide_index) VALUES ('synthetic-deck', 1)$q$) = 1, 'an admin adds a slide');
SELECT public.t_assert(public.t_refused($q$UPDATE public.acquisition_pipeline SET offer_amount = 1$q$), 'the pipeline is written by the service role only');
SELECT public.t_as('20000000-0000-0000-0000-0000000000a9');
SELECT public.t_assert(public.t_count('contact_inbox') = 0, 'an inactive admin reads no inbox row');
RESET ROLE;

-- 6. Field sources: the uploader, the vehicle's user and a permitted contributor write theirs (insert and upsert).
SET ROLE authenticated;
SELECT public.t_as('20000000-0000-0000-0000-0000000000b1');
SELECT public.t_assert(public.t_rows($q$INSERT INTO public.vehicle_field_sources (vehicle_id, field_name, field_value) VALUES ('10000000-0000-0000-0000-000000000001', 'vin', 'SYNTH0000000000002') ON CONFLICT (vehicle_id, field_name) DO UPDATE SET field_value = EXCLUDED.field_value$q$) = 1,
  'the uploader upserts a field source');
SELECT public.t_as('20000000-0000-0000-0000-0000000000b2');
SELECT public.t_assert(public.t_rows($q$INSERT INTO public.vehicle_field_sources (vehicle_id, field_name, field_value) VALUES ('10000000-0000-0000-0000-000000000002', 'mileage', '41000')$q$) = 1,
  'the vehicle''s user adds a field source');
SELECT public.t_assert(public.t_rows($q$UPDATE public.vehicle_field_sources SET field_value = 'tampered' WHERE vehicle_id = '10000000-0000-0000-0000-000000000001'$q$) = 0,
  'and cannot touch another vehicle''s');
SELECT public.t_as('20000000-0000-0000-0000-0000000000c1');
SELECT public.t_assert(public.t_rows($q$INSERT INTO public.vehicle_field_sources (vehicle_id, field_name, field_value) VALUES ('10000000-0000-0000-0000-000000000003', 'color', 'Red')$q$) = 1,
  'a permitted contributor adds a field source');
SELECT public.t_assert(public.t_refused($q$UPDATE public.vehicle_field_sources SET vehicle_id = '10000000-0000-0000-0000-000000000001' WHERE vehicle_id = '10000000-0000-0000-0000-000000000003'$q$),
  'a contributor cannot move a field source onto a vehicle they cannot edit');
RESET ROLE;

-- 7. The owner keeps the sale settings; the service role writes everything.
SET ROLE authenticated;
SELECT public.t_as('20000000-0000-0000-0000-0000000000b1');
SELECT public.t_assert(public.t_rows($q$UPDATE public.vehicle_sale_settings SET for_sale = true$q$) = 1, 'the uploader updates their sale settings');
RESET ROLE;
SET ROLE service_role;
SELECT public.t_as('');
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM public.t_tables LOOP
    PERFORM public.t_assert(public.t_rows(format('UPDATE public.%I SET %s', r.tbl, r.set_clause)) >= 1, format('the service role still writes %s', r.tbl));
  END LOOP;
END $$;
RESET ROLE;

-- 8. Drift stops the migration, and it changes nothing: a policy that is neither the 2026-10-14 read nor absent.
SET ROLE owp_table_owner;
CREATE POLICY paint_codes_update ON public.paint_codes FOR UPDATE TO authenticated USING (false);
GRANT UPDATE ON public.gm_paint_codes TO anon;
\set ON_ERROR_STOP off
\ir ../migrations/20261014213000_close_signed_in_open_updates.sql
\set ON_ERROR_STOP on
SELECT public.t_assert(has_table_privilege('anon', 'public.gm_paint_codes', 'UPDATE'), 'drift: the migration changed nothing');
RESET ROLE;

SELECT 'signed-in open updates contract: all checks passed' AS result;
