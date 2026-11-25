-- Actual reader on PG17, synthetic rows in an EMPTY disposable dm_refinement_* database only. Proves
-- 20261126110500_field_provenance_private_shapes.sql: once vo_private_shape_read (20261126105000) hides a row whose
-- structured_data matches an active vehicle_observation_private_shapes row from a caller not tied to the vehicle,
-- get_field_provenance (SECURITY DEFINER, so the policy does not apply inside it) hides that row from the same callers;
-- the tied owner and the service role still read it; every other answer, for every caller, field and vehicle, is
-- unchanged; the rule rows decide at call time (deactivating the shape reopens it with no function change).
-- Fixture: test_cached_image_projection_keyed_provenance.sql, which leaves the live body (prosrc sha256 deb01cff...,
-- read 2026-11-25) and the wc_* caller harness of test_field_provenance_withheld_columns.sql.
-- Run: createdb <db>; psql -d <db> -v ON_ERROR_STOP=1 -f supabase/sql/test_field_provenance_private_shapes.sql
\set ON_ERROR_STOP on
\ir test_cached_image_projection_keyed_provenance.sql
DO $$ BEGIN
  ASSERT (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc
          WHERE oid = 'public.get_field_provenance(uuid,text)'::regprocedure)
    = 'deb01cff80782e411b1b0e22b7cde9209249f9e8aa1f25545b18c8dbd00900aa', 'fixture reader is the live one';
END $$;

-- The copy register (20261125204500's table and hash function, as live) with the reader's vehicle_observations row.
CREATE TABLE public.private_row_policy_copies (
  reader text NOT NULL, relation text NOT NULL, policy_filter text NOT NULL, recorded_hash text NOT NULL,
  owner_lane text NOT NULL, note text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(),
  active boolean NOT NULL DEFAULT true, PRIMARY KEY (reader, relation, policy_filter));
CREATE FUNCTION public.private_row_policy_hash(p_relation text, p_policy_filter text)
RETURNS TABLE (policy_hash text, policies int) LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $f$
BEGIN
  IF p_relation !~ '^[a-z_][a-z0-9_]*$' OR position(';' IN p_policy_filter) > 0 THEN
    RAISE EXCEPTION 'private_row_policy_hash: bad relation or filter';
  END IF;
  RETURN QUERY EXECUTE format(
    'SELECT md5(string_agg(p.policyname || '':'' || p.permissive || '':'' || p.cmd || '':'' || p.roles::text || '':'' || coalesce(p.qual, ''''),
                           ''|'' ORDER BY p.policyname)), count(*)::int
       FROM pg_catalog.pg_policies p WHERE p.schemaname = ''public'' AND p.tablename = %L AND (%s)', p_relation, p_policy_filter);
END $f$;
INSERT INTO public.private_row_policy_copies (reader, relation, policy_filter, recorded_hash, owner_lane, note)
SELECT 'get_field_provenance(uuid,text)', 'vehicle_observations', 'p.cmd IN (''SELECT'', ''ALL'')', h.policy_hash, 'ta-readers',
       'fixture: the copy as recorded before 105000'
  FROM public.private_row_policy_hash('vehicle_observations', 'p.cmd IN (''SELECT'', ''ALL'')') h;

-- A photo's deep reading copied onto public vehicle 1111 (owner bbbb), citing a gallery-eligible photo, carrying keys a
-- caller can ask for by name. ALLOW_RAW_TESTIMONY_WRITE: fixture row in an empty disposable PG17 database, never production.
INSERT INTO public.vehicle_observations (id, vehicle_id, kind, structured_data, is_superseded, observed_at, ingested_at,
  content_text, extraction_method, confidence_score, agent_model)
VALUES ('d0c00000-0000-4000-8000-0000000000d1', '11111111-1111-1111-1111-111111111111', 'condition',
  '{"analysis_kind":"image_deep_byok","image_id":"77777777-7777-7777-7777-000000000001","text_regions":"fixture ocr",
    "scene_type":"fixture scene","workshop_signals":"fixture signals"}',
  false, now(), now(), 'fixture deep reading', 'byok_claude_print_read_tool', 0.8, 'fixture-model');
INSERT INTO public.wc_fields (field) SELECT f FROM unnest(ARRAY['text_regions','scene_type','workshop_signals']) f
  WHERE NOT EXISTS (SELECT 1 FROM public.wc_fields w WHERE w.field = f);
-- has_deep: the answer carries the row above; has_shape: it carries any row of the seed shape (the fixture's own deep
-- readings, the cached projections' sources, are hidden too).
CREATE FUNCTION pg_temp.has_deep(p jsonb) RETURNS boolean LANGUAGE sql AS $$
  SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(p->'observations', '[]')) e
                  WHERE e->>'id' = 'd0c00000-0000-4000-8000-0000000000d1')
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(p->'image_observations', '[]')) e
                  WHERE e->>'observation_id' = 'd0c00000-0000-4000-8000-0000000000d1') $$;
CREATE TABLE public.ps_shape_ids AS SELECT id FROM public.vehicle_observations
  WHERE structured_data @> '{"analysis_kind":"image_deep_byok"}';
-- An element is the row itself by its own id (observations: id, image_observations: observation_id); a cached
-- projection that cites a shape row as its source_observation_id is the sanitized child and stays.
CREATE FUNCTION pg_temp.has_shape(p jsonb) RETURNS boolean LANGUAGE sql AS $$
  SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(p->'observations', '[]')) e
                  WHERE (e->>'id')::uuid IN (SELECT id FROM public.ps_shape_ids))
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(p->'image_observations', '[]')) e
                  WHERE (e->>'observation_id')::uuid IN (SELECT id FROM public.ps_shape_ids)) $$;

-- 20261126105000 (ta-policies) needs the feed it names; this fixture has none.
CREATE FUNCTION public.vehicle_deep_reading_feed(uuid, timestamptz, integer, uuid) RETURNS SETOF jsonb
  LANGUAGE sql STABLE AS $$ SELECT NULL::jsonb WHERE false $$;
\ir ../migrations/20261126105000_vehicle_observation_private_shapes.sql

-- 1. The policy hides the row from a direct read by anon and a stranger, not from the owner.
GRANT SELECT ON public.vehicle_observations TO anon, authenticated;   -- as live (the fixture reads only through the reader)
CREATE FUNCTION pg_temp.direct(p_role text, p_auth text, p_uid text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  PERFORM set_config('test.auth_role', p_auth, true);
  PERFORM set_config('test.auth_uid', p_uid, true);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  SELECT count(*) INTO n FROM public.vehicle_observations WHERE id = 'd0c00000-0000-4000-8000-0000000000d1';
  RESET ROLE;
  RETURN n;
END $$;
BEGIN;
DO $$ BEGIN
  ASSERT pg_temp.direct('anon', 'anon', '') = 0, '1 anon reads the deep row directly';
  ASSERT pg_temp.direct('authenticated', 'authenticated', 'cccccccc-cccc-cccc-cccc-cccccccccccc') = 0, '1 a stranger reads it';
  ASSERT pg_temp.direct('authenticated', 'authenticated', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb') = 1, '1 the owner cannot';
END $$;
COMMIT;

-- 2. The defect: with the policy live, the definer reader still serves the row to anon, a stranger and a claimless caller.
BEGIN; SELECT pg_temp.capture('pre'); COMMIT;
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM public.wc_answers WHERE phase = 'pre' AND vehicle = '11111111-1111-1111-1111-111111111111'
          AND field = 'text_regions' AND pg_temp.has_deep(p)) = 5, '2 every caller reads the deep row before the fix';
  ASSERT (SELECT count(*) FROM public.wc_answers w, jsonb_array_elements(w.p->'observations') e WHERE w.phase = 'pre'
          AND w.viewer = 'anon' AND w.vehicle = '11111111-1111-1111-1111-111111111111' AND w.field = 'text_regions'
          AND e->>'value' = 'fixture ocr') = 1,
    '2 anon reads the reading''s value before the fix';
END $$;

\ir ../migrations/20261126110500_field_provenance_private_shapes.sql
\ir ../migrations/20261126110500_field_provenance_private_shapes.sql
BEGIN; SELECT pg_temp.capture('post'); COMMIT;

DO $$
DECLARE n int;
BEGIN
  -- 3. Hidden from every caller the policy hides it from, kept for the tied owner and the service role.
  SELECT count(*) INTO n FROM public.wc_answers WHERE phase = 'post' AND viewer IN ('anon', 'untied', 'noclaims')
     AND pg_temp.has_shape(p);
  ASSERT n = 0, format('3 %s answers still carry the deep row for a caller who is not tied', n);
  ASSERT (SELECT count(*) FROM public.wc_answers a JOIN public.wc_answers b USING (viewer, vehicle, field)
          WHERE a.phase = 'pre' AND b.phase = 'post' AND a.viewer IN ('owner', 'service')
            AND a.p IS DISTINCT FROM b.p) = 0, '3 an owner or service-role answer changed';
  ASSERT (SELECT count(*) FROM public.wc_answers WHERE phase = 'post' AND viewer IN ('owner', 'service')
          AND field = 'text_regions' AND pg_temp.has_deep(p)) = 2, '3 the owner and the service role read it';
  -- 4. Every answer that did not carry the deep row is byte-identical.
  SELECT count(*) INTO n FROM public.wc_answers a JOIN public.wc_answers b USING (viewer, vehicle, field)
   WHERE a.phase = 'pre' AND b.phase = 'post' AND NOT pg_temp.has_shape(a.p) AND a.p IS DISTINCT FROM b.p;
  ASSERT n = 0, format('4 %s other answers changed', n);
  SELECT count(*) INTO n FROM public.wc_answers WHERE phase = 'pre' AND viewer IN ('anon', 'untied', 'noclaims') AND pg_temp.has_shape(p);
  ASSERT n >= 6, format('4 only %s pre answers carried a shape row for an untied caller (vacuous)', n);
  RAISE NOTICE 'PASS 3-4: % answers lost their shape rows for untied callers; owner and service answers and every other answer unchanged', n;
  SELECT count(*) INTO n FROM public.wc_answers WHERE phase = 'pre';
  ASSERT n = (SELECT count(*) FROM public.wc_answers WHERE phase = 'post') AND n > 500, format('4 answer set size %s', n);
  -- 5. The copy row is re-recorded at the live hash (this database's; production is guarded on f4734055...).
  ASSERT (SELECT recorded_hash FROM public.private_row_policy_copies WHERE reader = 'get_field_provenance(uuid,text)'
          AND relation = 'vehicle_observations')
       = (SELECT policy_hash FROM public.private_row_policy_hash('vehicle_observations', 'p.cmd IN (''SELECT'', ''ALL'')')),
    '5 copy row not at the live hash';
  ASSERT (SELECT count(*) FROM pg_proc WHERE oid = 'public.get_field_provenance(uuid,text)'::regprocedure
          AND prosecdef AND position('private_shape_rows_v1' IN prosrc) > 0
          AND (length(prosrc) - length(replace(prosrc, 'private_shape_rows_v1', ''))) / length('private_shape_rows_v1') = 1) = 1,
    '5 the term is in the definer body once (applied twice)';
  ASSERT has_function_privilege('anon', 'public.get_field_provenance(uuid,text)', 'EXECUTE'), '5 anon lost EXECUTE';
END $$;

-- 6. The rule rows decide at call time: deactivating the shape reopens the row with no function change; reactivating closes it.
UPDATE public.vehicle_observation_private_shapes SET active = false WHERE shape_key = 'image_deep_byok';
BEGIN; SELECT pg_temp.capture('off'); COMMIT;
UPDATE public.vehicle_observation_private_shapes SET active = true WHERE shape_key = 'image_deep_byok';
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM public.wc_answers WHERE phase = 'off' AND viewer = 'anon'
          AND field = 'text_regions' AND pg_temp.has_deep(p)) = 1, '6 an inactive shape row still hides the row';
END $$;

-- 7. Revert: the body returns to deb01cff... byte for byte, the copy row to 16c9e48f..., and the defect returns
--    (which is why the revert leaves the copy stale for the exposure watch). Then re-apply.
\ir revert_20261126110500_field_provenance_private_shapes.sql
BEGIN; SELECT pg_temp.capture('rev'); COMMIT;
DO $$ BEGIN
  ASSERT (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc
          WHERE oid = 'public.get_field_provenance(uuid,text)'::regprocedure)
    = 'deb01cff80782e411b1b0e22b7cde9209249f9e8aa1f25545b18c8dbd00900aa', '7 revert did not restore the body';
  ASSERT (SELECT recorded_hash FROM public.private_row_policy_copies WHERE reader = 'get_field_provenance(uuid,text)'
          AND relation = 'vehicle_observations') = '16c9e48fc1fbfbe5dc4ae10fe8947c7c', '7 revert did not restore the hash';
  ASSERT (SELECT count(*) FROM public.wc_answers a JOIN public.wc_answers b USING (viewer, vehicle, field)
          WHERE a.phase = 'pre' AND b.phase = 'rev' AND a.p IS DISTINCT FROM b.p) = 0, '7 reverted answers differ from pre';
END $$;
\ir ../migrations/20261126110500_field_provenance_private_shapes.sql
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM pg_proc WHERE oid = 'public.get_field_provenance(uuid,text)'::regprocedure
          AND position('private_shape_rows_v1' IN prosrc) > 0) = 1, '7 re-apply after revert';
END $$;

SELECT 'PASS: get_field_provenance hides private-shape rows from callers the policy hides them from' AS result;
