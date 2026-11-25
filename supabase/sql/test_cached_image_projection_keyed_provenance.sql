-- Actual reader on PG17, synthetic rows in an EMPTY disposable dm_refinement_* database only. Proves the
-- get_field_provenance part of 20261125211500_cached_image_projection_source_key.sql: once a cached image property
-- projection row carries the typed source_observation_id (every row re-landed by supersede_untyped_cached_image_properties
-- and every row landed after the migration), get_field_provenance answers every caller exactly as it answered for the
-- untyped original, but for the row's own id and clock; before the migration it dropped the keyed row (the defect).
-- Nothing wider: a keyed projection row whose key is not the reading its structured_data names stays out.
-- Fixture: test_field_provenance_withheld_columns.sql, which leaves the live body (sha256 of prosrc f9fa67c3..., read
-- 2026-11-25 02:20 PT) and vehicle 1111's cached projection rows landed by the batch intake; the two owners the migration
-- also patches come from fixtures/cached_image_projection_owners_20261125.sql. This database has no vehicle_canonical
-- (its own contract: test_cached_image_projection_keyed_canonical.sql).
-- Run: createdb <db>; psql -d <db> -v ON_ERROR_STOP=1 -f supabase/sql/test_cached_image_projection_keyed_provenance.sql
\set ON_ERROR_STOP on
\ir test_field_provenance_withheld_columns.sql
DO $$ BEGIN
  ASSERT (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc
          WHERE oid = 'public.get_field_provenance(uuid,text)'::regprocedure)
    = 'f9fa67c39786adb2872c2836766a19b74f891b31d0fa0f31a56c750f02bc025a', 'fixture reader is the live one';
  ASSERT (SELECT count(*) FROM public.vehicle_observations WHERE extraction_method = 'cached_byok_property_projection_v1'
          AND NOT is_superseded AND source_observation_id IS NULL) = 6, 'six untyped projection rows to re-land';
END $$;
\ir fixtures/cached_image_projection_owners_20261125.sql

-- An answer without the projection rows' own ids and clocks (a successor has a new id and ingested_at by design, and
-- trg_project_observation_image_witness gives it its own derived witness).
CREATE TABLE public.kp_ids(old_id uuid PRIMARY KEY, new_id uuid NOT NULL);
GRANT SELECT ON public.kp_ids TO anon, authenticated, service_role;
CREATE FUNCTION pg_temp.norm(p jsonb) RETURNS text LANGUAGE sql AS $$
  SELECT regexp_replace(
    (SELECT coalesce((SELECT string_agg(k.new_id::text || '>' || k.old_id::text, ',') FROM public.kp_ids k), '') || '|' ||
       (WITH RECURSIVE r(i, t) AS (
          SELECT 0, p::text
          UNION ALL
          SELECT r.i + 1, replace(r.t, k.new_id::text, k.old_id::text)
            FROM r JOIN LATERAL (SELECT * FROM public.kp_ids ORDER BY old_id OFFSET r.i LIMIT 1) k ON true)
        SELECT t FROM r ORDER BY i DESC LIMIT 1)),
    '"(ingested_at|witness_id)": "[^"]*"', '"\1": -', 'g') $$;
CREATE FUNCTION pg_temp.diff(p_a text, p_b text) RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM public.wc_answers a JOIN public.wc_answers b USING (viewer, vehicle, field)
   WHERE a.phase = p_a AND b.phase = p_b AND split_part(pg_temp.norm(a.p), '|', 2) IS DISTINCT FROM split_part(pg_temp.norm(b.p), '|', 2) $$;

-- k0: every caller, every field, with the projection rows untyped (as production holds them).
BEGIN; SELECT pg_temp.capture('k0'); COMMIT;
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM public.wc_answers WHERE phase = 'k0' AND field LIKE 'image_visible%'
          AND jsonb_array_length(p->'observations') > 0) > 0, 'the projection rows are read before (the cases are not vacuous)';
END $$;

-- The re-landing as supersede_untyped_cached_image_properties leaves it (its own contract runs the writer): each untyped
-- row superseded by a successor identical but for the key, id, clock and hash.
-- ALLOW_RAW_TESTIMONY_WRITE: fixture rows in an empty disposable PG17 database, never production.
INSERT INTO public.kp_ids
SELECT id, gen_random_uuid() FROM public.vehicle_observations
 WHERE extraction_method = 'cached_byok_property_projection_v1' AND NOT is_superseded AND source_observation_id IS NULL;
UPDATE public.vehicle_observations SET is_superseded = true WHERE id IN (SELECT old_id FROM public.kp_ids);
INSERT INTO public.vehicle_observations
SELECT (jsonb_populate_record(NULL::public.vehicle_observations, to_jsonb(o) || jsonb_build_object(
  'id', k.new_id, 'ingested_at', now(), 'is_superseded', false,
  'content_hash', encode(sha256(convert_to(o.content_hash || ':typed_source_v1', 'UTF8')), 'hex'),
  'source_observation_id', o.structured_data->>'source_observation_id'))).*
  FROM public.vehicle_observations o JOIN public.kp_ids k ON k.old_id = o.id;

-- k1: the defect, on the live body: the keyed successors are dropped.
BEGIN; SELECT pg_temp.capture('k1'); COMMIT;
DO $$ BEGIN
  ASSERT pg_temp.diff('k0', 'k1') > 0, 'the defect reproduces on the live body: keyed projection rows leave the answer';
  ASSERT (SELECT count(*) FROM public.wc_answers WHERE phase = 'k1' AND field LIKE 'image_visible%'
          AND jsonb_array_length(p->'observations') > 0) = 0, 'no caller reads a keyed projection row before the migration';
END $$;

SET nuke.contract_without_readers = 'on';
\ir ../migrations/20261125211500_cached_image_projection_source_key.sql
RESET nuke.contract_without_readers;

-- k2: after the migration every caller reads every field as at k0, but for the rows' own ids and clocks.
BEGIN; SELECT pg_temp.capture('k2'); COMMIT;
DO $$ BEGIN
  ASSERT pg_temp.diff('k0', 'k2') = 0, 'after: every caller and field answers as before the re-landing';
  ASSERT (SELECT count(*) FROM public.wc_answers WHERE phase = 'k2' AND field LIKE 'image_visible%'
          AND jsonb_array_length(p->'observations') > 0)
       = (SELECT count(*) FROM public.wc_answers WHERE phase = 'k0' AND field LIKE 'image_visible%'
          AND jsonb_array_length(p->'observations') > 0), 'after: the same answers carry projection rows';
  ASSERT (SELECT prosecdef AND proconfig = ARRAY['search_path=""'] FROM pg_proc
          WHERE oid = 'public.get_field_provenance(uuid,text)'::regprocedure), 'still SECURITY DEFINER with an empty path';
  ASSERT has_function_privilege('anon', 'public.get_field_provenance(uuid,text)', 'EXECUTE'), 'grants kept';
END $$;

-- Nothing wider: a keyed successor whose key is a reading other than the one its structured_data names.
-- ALLOW_RAW_TESTIMONY_WRITE: fixture rows in an empty disposable PG17 database, never production.
INSERT INTO public.vehicle_observations
SELECT (jsonb_populate_record(NULL::public.vehicle_observations, to_jsonb(o) || jsonb_build_object(
  -- same identity and hash as the successor (the reader checks source_identifier); no source_id, so the unique index lets it in
  'id', 'f0f0f0f0-0000-4000-8000-000000000001', 'source_id', NULL,
  'source_observation_id', (SELECT p.id FROM public.vehicle_observations p
     WHERE p.structured_data->>'analysis_kind' = 'image_deep_byok' AND p.id::text <> o.structured_data->>'source_observation_id' LIMIT 1)))).*
  FROM public.vehicle_observations o
 WHERE o.id = (SELECT k.new_id FROM public.kp_ids k
                WHERE EXISTS (SELECT 1 FROM public.wc_answers w WHERE w.phase = 'k2' AND strpos(w.p::text, k.new_id::text) > 0)
                ORDER BY k.new_id LIMIT 1);
BEGIN; SELECT pg_temp.capture('k3'); COMMIT;
DO $$ BEGIN
  -- the forged row is a copy of a read successor (same value, same reading in structured_data), so the reader's own
  -- gate on that reading would pass it; only the key decides
  ASSERT (SELECT source_observation_id::text IS DISTINCT FROM structured_data->>'source_observation_id' AND NOT is_superseded
          FROM public.vehicle_observations WHERE id = 'f0f0f0f0-0000-4000-8000-000000000001'), 'the forged row exists';
  ASSERT pg_temp.diff('k2', 'k3') = 0, 'nothing wider: a key that is not the named reading is not read; every answer as before';
END $$;

-- Nothing wider: a keyed row of another method (a retained listing projection) whose structured_data names its key.
-- It carries none of the image projection markers, so the reader's image gate does not apply to it; only a
-- retained-listing matcher may admit it, and none does (its key is a photo reading, not a listing).
-- ALLOW_RAW_TESTIMONY_WRITE: fixture rows in an empty disposable PG17 database, never production.
INSERT INTO public.vehicle_observations
SELECT (jsonb_populate_record(NULL::public.vehicle_observations, to_jsonb(o) || jsonb_build_object(
  'id', 'f0f0f0f0-0000-4000-8000-000000000002', 'source_id', NULL,
  'extraction_method', 'retained_listing_property_projection_v1',
  'structured_data', o.structured_data - 'analysis_kind' - 'projection_version'))).*
  FROM public.vehicle_observations o
 WHERE o.id = (SELECT k.new_id FROM public.kp_ids k
                WHERE EXISTS (SELECT 1 FROM public.wc_answers w WHERE w.phase = 'k2' AND strpos(w.p::text, k.new_id::text) > 0)
                ORDER BY k.new_id LIMIT 1);
BEGIN; SELECT pg_temp.capture('k4'); COMMIT;
DO $$ BEGIN
  ASSERT (SELECT source_observation_id::text = structured_data->>'source_observation_id' AND NOT is_superseded
            AND extraction_method = 'retained_listing_property_projection_v1'
          FROM public.vehicle_observations WHERE id = 'f0f0f0f0-0000-4000-8000-000000000002'), 'the retained row exists';
  ASSERT pg_temp.diff('k2', 'k4') = 0, 'nothing wider: a keyed row of another method is not admitted by the image branch';
END $$;
SELECT 'PASS test_cached_image_projection_keyed_provenance' AS result;
