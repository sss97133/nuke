-- Empty disposable PG17 only, as a superuser (the live view_write_guard event trigger is installed), from the repo root:
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_<n> -f this-file.sql
-- Proves the vehicle_canonical part of 20261125211500_cached_image_projection_source_key.sql: a cached image property
-- projection row that carries the typed source_observation_id (as every row re-landed or newly landed after that
-- migration does) stays canonical exactly where its untyped original was, and nothing wider is admitted: a keyed row
-- naming another photo's or another vehicle's reading, or a keyed row of another extraction method, still needs a
-- retained-listing matcher. Before the migration the keyed row is dropped (the defect). Owner, options, grants, comment,
-- columns and a dependent view are unchanged. Every id below is invented.
-- Shapes: helpers/vehicle_observations_rls_fixture.sql, helpers/vehicle_canonical_live_20261121.sql and
-- 20261122003000, which leave the view printing production's definition (md5 4d1a2e57a880181691e5bd8eb0c30002, read
-- 2026-11-25 02:20 PT); fixtures/cached_image_projection_owners_20261125.sql for the two owners the migration also patches.
-- This database has no get_field_provenance (its own contract: test_cached_image_projection_keyed_provenance.sql).
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicle_observations') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 dm_refinement_* database';
  END IF;
END $$;
SET statement_timeout = '60s';
SET lock_timeout = '3s';
\ir helpers/vehicle_observations_rls_fixture.sql
\ir helpers/vehicle_canonical_live_20261121.sql
\ir ../migrations/20261014214500_view_write_guard.sql
INSERT INTO public.platform_config (config_key, config_value)
  VALUES ('image_reading_tiers', '{"automatic": {"tier": "subscription automatic"}}');
\ir ../migrations/20261122003000_canonical_excludes_automatic_readings.sql
-- the owners declare rows of vehicle_images; this database needs only the type (the owners never run here)
CREATE TABLE public.vehicle_images (id uuid PRIMARY KEY, vehicle_id uuid REFERENCES public.vehicles(id));
\ir fixtures/cached_image_projection_owners_20261125.sql
CREATE VIEW public.t_canonical_dependent AS SELECT vehicle_id, property_id, observation_id FROM public.vehicle_canonical;

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;
CREATE FUNCTION pg_temp.def_md5() RETURNS text LANGUAGE sql SET search_path = public AS $$
  SELECT md5(pg_get_viewdef('public.vehicle_canonical'::regclass)) $$;
CREATE FUNCTION pg_temp.shape() RETURNS text LANGUAGE sql AS $$
  SELECT concat_ws(E'\n', pg_get_userbyid(c.relowner), c.relkind::text, coalesce(c.reloptions::text, '-'), coalesce(c.relacl::text, '-'),
           coalesce(obj_description(c.oid, 'pg_class'), '-'),
           (SELECT string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod), ', ' ORDER BY a.attnum)
              FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped))
    FROM pg_class c WHERE c.oid = 'public.vehicle_canonical'::regclass $$;
-- The canonical row per (vehicle, property, photo): value and which kind of row holds it (keyed or not), not its id.
CREATE FUNCTION pg_temp.canon() RETURNS text LANGUAGE sql AS $$
  SELECT string_agg(c.vehicle_id || '/' || c.property_id || '/' || c.discriminator_value || '=' || (c.structured_data->>'image_visible_paint_stage'),
                    E'\n' ORDER BY c.vehicle_id, c.property_id, c.discriminator_value)
    FROM public.vehicle_canonical c $$;
CREATE FUNCTION pg_temp.is_canonical(p_id uuid) RETURNS boolean LANGUAGE sql AS $$
  SELECT EXISTS (SELECT 1 FROM public.vehicle_canonical WHERE observation_id = p_id) $$;

-- ===== rows =====
-- ALLOW_RAW_TESTIMONY_WRITE: fixture rows in an empty disposable PG17 database, never production.
-- Two vehicles; the paint key, discriminated by photo as production registers it.
INSERT INTO public.vehicles (id, is_public) VALUES ('10000000-0000-4000-8000-00000000000a', true), ('10000000-0000-4000-8000-00000000000b', true);
INSERT INTO public.observation_properties (id, property_key, label, data_type, applies_to_kinds, discriminator_key, ratified_at) VALUES
  ('40000000-0000-4000-8000-000000000002', 'image_visible_paint_stage', 'Visible paint stage', 'enum', '{condition}', 'image_id', '2026-10-01');
-- Deep readings: a1 photo 1 and a2 photo 2 on vehicle a; b1 photo 3 and b2 photo 6 on vehicle b.
INSERT INTO public.vehicle_observations (id, vehicle_id, observed_at, kind, structured_data, extraction_method) VALUES
  ('50000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-00000000000a', '2026-11-10', 'condition',
   '{"analysis_kind":"image_deep_byok","image_id":"60000000-0000-4000-8000-000000000001","state_observations":{"paint_state":"primer"}}', 'reviewed_image_analysis_v1'),
  ('50000000-0000-4000-8000-0000000000a2', '10000000-0000-4000-8000-00000000000a', '2026-11-10', 'condition',
   '{"analysis_kind":"image_deep_byok","image_id":"60000000-0000-4000-8000-000000000002","state_observations":{"paint_state":"aged"}}', 'reviewed_image_analysis_v1'),
  ('50000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-00000000000b', '2026-11-10', 'condition',
   '{"analysis_kind":"image_deep_byok","image_id":"60000000-0000-4000-8000-000000000003","state_observations":{"paint_state":"clear"}}', 'reviewed_image_analysis_v1'),
  ('50000000-0000-4000-8000-0000000000b2', '10000000-0000-4000-8000-00000000000b', '2026-11-10', 'condition',
   '{"analysis_kind":"image_deep_byok","image_id":"60000000-0000-4000-8000-000000000006","state_observations":{"paint_state":"clear"}}', 'reviewed_image_analysis_v1');
-- A projection row: vehicle, photo, paint value, the reading structured_data names, the typed key (NULL = untyped),
-- extraction method.
CREATE FUNCTION pg_temp.row(p_id uuid, p_vehicle uuid, p_image text, p_value text, p_named uuid, p_key uuid,
  p_method text DEFAULT 'cached_byok_property_projection_v1', p_confidence numeric DEFAULT 0.6) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.vehicle_observations (id, vehicle_id, observed_at, kind, structured_data, extraction_method, property_id,
    confidence_score, source_observation_id)
  VALUES (p_id, p_vehicle, '2026-11-10', 'condition',
    jsonb_build_object('image_visible_paint_stage', p_value, 'image_id', p_image, 'property_key', 'image_visible_paint_stage',
      'analysis_kind', 'image_property_projection', 'source_observation_id', p_named),
    p_method, '40000000-0000-4000-8000-000000000002', p_confidence, p_key) $$;
-- Untyped projection rows as production holds them: c1 (photo 1, primer), c2 (photo 2, aged), c3 (vehicle b, photo 3).
SELECT pg_temp.row('20000000-0000-4000-8000-0000000000c1', '10000000-0000-4000-8000-00000000000a', '60000000-0000-4000-8000-000000000001', 'primer', '50000000-0000-4000-8000-0000000000a1', NULL);
SELECT pg_temp.row('20000000-0000-4000-8000-0000000000c2', '10000000-0000-4000-8000-00000000000a', '60000000-0000-4000-8000-000000000002', 'aged', '50000000-0000-4000-8000-0000000000a2', NULL);
SELECT pg_temp.row('20000000-0000-4000-8000-0000000000c3', '10000000-0000-4000-8000-00000000000b', '60000000-0000-4000-8000-000000000003', 'clear', '50000000-0000-4000-8000-0000000000b1', NULL);

-- ===== 1. before =====
SELECT pg_temp.ok('fixture: the view prints exactly as production''s (md5 4d1a2e57a880181691e5bd8eb0c30002)',
  pg_temp.def_md5() = '4d1a2e57a880181691e5bd8eb0c30002');
SELECT pg_temp.ok('before: the three untyped projection rows are canonical, one per vehicle and photo',
  pg_temp.is_canonical('20000000-0000-4000-8000-0000000000c1') AND pg_temp.is_canonical('20000000-0000-4000-8000-0000000000c2')
  AND pg_temp.is_canonical('20000000-0000-4000-8000-0000000000c3') AND (SELECT count(*) FROM public.vehicle_canonical) = 3);
SELECT pg_temp.shape() AS shape_before, pg_temp.canon() AS canon_before \gset
-- The re-landing, as supersede_untyped_cached_image_properties leaves it: c1 and c2 superseded by keyed successors.
UPDATE public.vehicle_observations SET is_superseded = true
 WHERE id IN ('20000000-0000-4000-8000-0000000000c1', '20000000-0000-4000-8000-0000000000c2');
SELECT pg_temp.row('20000000-0000-4000-8000-0000000000d1', '10000000-0000-4000-8000-00000000000a', '60000000-0000-4000-8000-000000000001', 'primer', '50000000-0000-4000-8000-0000000000a1', '50000000-0000-4000-8000-0000000000a1');
SELECT pg_temp.row('20000000-0000-4000-8000-0000000000d2', '10000000-0000-4000-8000-00000000000a', '60000000-0000-4000-8000-000000000002', 'aged', '50000000-0000-4000-8000-0000000000a2', '50000000-0000-4000-8000-0000000000a2');
SELECT pg_temp.ok('before: the defect reproduces; the keyed successors are dropped and vehicle a has no canonical paint',
  NOT pg_temp.is_canonical('20000000-0000-4000-8000-0000000000d1') AND NOT pg_temp.is_canonical('20000000-0000-4000-8000-0000000000d2')
  AND (SELECT count(*) FROM public.vehicle_canonical) = 1);

-- ===== 2. apply =====
SET nuke.contract_without_readers = 'on';
\ir ../migrations/20261125211500_cached_image_projection_source_key.sql
RESET nuke.contract_without_readers;
SELECT pg_temp.ok('applied: the definition changed from production''s and carries the projection branch',
  pg_temp.def_md5() <> '4d1a2e57a880181691e5bd8eb0c30002'
  AND strpos(pg_get_viewdef('public.vehicle_canonical'::regclass), 'cached_byok_property_projection_v1') > 0);
SELECT pg_temp.ok('applied: owner, kind, options, grants, comment, columns, their order and types are as before',
  pg_temp.shape() = :'shape_before');
SELECT pg_temp.ok('applied: the keyed successors are canonical where their untyped originals were; same values per vehicle and photo',
  pg_temp.is_canonical('20000000-0000-4000-8000-0000000000d1') AND pg_temp.is_canonical('20000000-0000-4000-8000-0000000000d2')
  AND pg_temp.is_canonical('20000000-0000-4000-8000-0000000000c3') AND pg_temp.canon() = :'canon_before');
SELECT pg_temp.ok('applied: the dependent view still reads it, and the view is still not auto-updatable',
  (SELECT count(*) FROM public.t_canonical_dependent) = 3 AND pg_relation_is_updatable('public.vehicle_canonical'::regclass, false) = 0);

-- ===== 3. nothing wider =====
-- Each would be canonical if it were admitted (a photo of its own, or ranked above the row it competes with).
-- e1: names a reading of another photo (key and structured_data agree on a2, photo 2; the row says photo 4)
SELECT pg_temp.row('20000000-0000-4000-8000-0000000000e1', '10000000-0000-4000-8000-00000000000a', '60000000-0000-4000-8000-000000000004', 'aged', '50000000-0000-4000-8000-0000000000a2', '50000000-0000-4000-8000-0000000000a2');
-- e2: filed on vehicle b, keyed to vehicle a's reading of photo 1
SELECT pg_temp.row('20000000-0000-4000-8000-0000000000e2', '10000000-0000-4000-8000-00000000000b', '60000000-0000-4000-8000-000000000001', 'primer', '50000000-0000-4000-8000-0000000000a1', '50000000-0000-4000-8000-0000000000a1');
-- e3: on photo 1 of vehicle a and keyed to a1 (that photo's reading), but its structured_data names a2; ranked above d1
-- (confidence 0.9), so if it were admitted it would replace d1
SELECT pg_temp.row('20000000-0000-4000-8000-0000000000e3', '10000000-0000-4000-8000-00000000000a', '60000000-0000-4000-8000-000000000001', 'aged', '50000000-0000-4000-8000-0000000000a2', '50000000-0000-4000-8000-0000000000a1', 'cached_byok_property_projection_v1', 0.9);
-- e4: another extraction method keyed to a deep reading of its photo (only a retained matcher admits it; stubbed false)
SELECT pg_temp.row('20000000-0000-4000-8000-0000000000e4', '10000000-0000-4000-8000-00000000000b', '60000000-0000-4000-8000-000000000006', 'clear', '50000000-0000-4000-8000-0000000000b2', '50000000-0000-4000-8000-0000000000b2', 'made_up_method_v1');
SELECT pg_temp.ok('nothing wider: a keyed row naming another photo''s or vehicle''s reading, a key that is not the named reading, or another method stays out',
  NOT pg_temp.is_canonical('20000000-0000-4000-8000-0000000000e1') AND NOT pg_temp.is_canonical('20000000-0000-4000-8000-0000000000e2')
  AND NOT pg_temp.is_canonical('20000000-0000-4000-8000-0000000000e3') AND NOT pg_temp.is_canonical('20000000-0000-4000-8000-0000000000e4')
  AND pg_temp.canon() = :'canon_before');
SELECT 'PASS test_cached_image_projection_keyed_canonical' AS result;
