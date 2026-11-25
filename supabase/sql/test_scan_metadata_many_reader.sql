-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_<name> -f supabase/sql/test_scan_metadata_many_reader.sql
-- Proves 20261126162500_scan_metadata_many_reader.sql (on top of 20261125200000_scan_metadata_withheld_paths.sql, whose
-- worker, compiled rules and vehicle_image_scan_metadata run here unstubbed):
--   * vehicle_image_scan_metadata_many(ids) returns, for anon, a signed-in stranger, the owner, an untied uploader, A's
--     mechanic, B's recorded owner and service_role, exactly the rows and documents of
--     select id, ai_scan_metadata from vehicle_images_public where id = any(ids): hidden photos (private car, deleted
--     car, document, pending, sensitive), an unknown id and a repeated id included.
--   * one redaction per row returned: 1,000 ids of a 2,400-photo car -> as many vehicle_image_scan_metadata calls as rows,
--     also with 13 ai_scan_metadata projections over the result (the ImageGallery select). The page's first step, its
--     ids ordered and ranged through the view without ai_scan_metadata, makes 0 calls. Before, the 13-projection page
--     read through the view made a call per photo of the car (2,160).
--   * at most platform_config vehicle_image_scan_metadata_many.max_ids (1,000) ids: 1,001 raise 54000, and so does a
--     missing config row.
--   * vehicle_image_scan_metadata(uuid): every caller's view answers byte-identical before and after; the gallery test
--     keeps vehicle_image_privacy_withheld's plan: its time per call drops to under a third (PG17 2026-11-25:
--     0.146 -> 0.012 ms); COST 1, SECURITY DEFINER, grants unchanged.
--   * the many-reader is SECURITY INVOKER, STABLE, executable by anon, authenticated and service_role, not PUBLIC.
--   * another live vehicle_images policy hash applies nothing; a second apply is a no-op; the revert restores the live
--     body (prosrc md5 1930b342..., functiondef md5 724d2e2c...) and removes the reader and its config row.
-- Which assertion fails if the fix is removed (scratchpad many_mut.py, run 2026-11-25: 8 of 8 killed): the gallery test back inside the
-- sub-select -> "privacy_withheld per call"; the reader SECURITY DEFINER, or over the table, or with the gallery test
-- added -> "same rows and documents as the view"; the cap check removed -> "1,001 ids refused"; the cap typed in ->
-- "no config row: refused"; EXECUTE left to PUBLIC -> "grants"; the policy-hash check removed -> "another live
-- vehicle_images policy hash".
-- Fixture rows only, in a disposable database. -- ALLOW_RAW_TESTIMONY_WRITE
\ir fixtures/scan_metadata_schema.sql
\ir ../migrations/20261125200000_scan_metadata_withheld_paths.sql

-- platform_config, live shape (2026-11-25): readable by everyone, written by admins and service_role.
CREATE TABLE public.platform_config (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), config_key text UNIQUE, config_value jsonb,
  description text, updated_at timestamptz DEFAULT now(), updated_by uuid);
ALTER TABLE public.platform_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_config_public_read ON public.platform_config FOR SELECT USING (true);
GRANT SELECT ON public.platform_config TO anon, authenticated;
GRANT ALL ON public.platform_config TO service_role;

-- Every fixture photo carries a reading with withheld paths and the car's plate in a kept label.
UPDATE public.vehicle_images SET ai_scan_metadata = '{"classifier": "fixture", "scene_class": "exterior", "license_plate": "TSTPLATE1",
  "classification": {"label": "exterior", "description": "TSTDESC"},
  "byok_deep_analysis": {"scene_type": "engine_bay", "build_phase_guess": "assembly", "narrative_one_line": "TSTNARR",
    "presence": {"person": false, "place_hint": "TSTPLACE"}, "agent_notes": "TSTNOTE",
    "components_seen": [{"label": "plate reads TST PL8-9"}, {"label": "chrome bumper"}]}}'::jsonb;
-- Car D: public, u1's, 2,400 photos; every tenth pending (hidden by the gallery test), every seventh uploaded by u3
-- (untied), every 97th sensitive (hidden from anon by the read policy).
INSERT INTO public.vehicles (id, is_public, user_id, license_plate) VALUES
  ('d0000000-0000-0000-0000-00000000000d', true, '00000000-0000-0000-0000-000000000001', 'tst-pl8 9');
INSERT INTO public.vehicle_images (id, vehicle_id, user_id, image_url, source, is_document, is_external, is_sensitive, vision_gate_status,
  is_primary, position, created_at, ai_scan_metadata)
SELECT ('20000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 'd0000000-0000-0000-0000-00000000000d',
       CASE WHEN n % 7 = 0 THEN '00000000-0000-0000-0000-000000000003' ELSE '00000000-0000-0000-0000-000000000001' END::uuid,
       'https://x.invalid/d' || n || '.jpg', 'user_upload', false, false, n % 97 = 0,
       CASE WHEN n % 10 = 0 THEN 'pending' ELSE 'approved' END::public.vision_gate_status, n = 1, n,
       timestamptz '2026-11-01' + n * interval '1 minute',
       jsonb_build_object('classifier', 'fixture', 'scene_class', 'exterior', 'license_plate', 'TSTPLATE' || n,
         'tier_1_analysis', jsonb_build_object('k', n), 'classification', jsonb_build_object('label', 'exterior', 'description', 'TSTDESC ' || n),
         'byok_deep_analysis', jsonb_build_object('scene_type', 'engine_bay', 'build_phase_guess', 'assembly', 'narrative_one_line', 'TSTNARR ' || n,
           'presence', jsonb_build_object('person', false, 'place_hint', 'TSTPLACE ' || n), 'agent_notes', 'TSTNOTE ' || n,
           'components_seen', jsonb_build_array(jsonb_build_object('label', 'chrome bumper'), jsonb_build_object('label', 'plate reads TST PL8-9'))))
  FROM generate_series(1, 2400) n;
ANALYZE;

SET track_functions = 'all';
-- The callers: label, request claims ('' anon, 'service', or a user id) and role.
CREATE TABLE public.mr_callers (caller text PRIMARY KEY, uid text, role_name text);
INSERT INTO public.mr_callers VALUES ('anon', '', 'anon'), ('stranger', '00000000-0000-0000-0000-000000000002', 'authenticated'),
  ('owner', '00000000-0000-0000-0000-000000000001', 'authenticated'), ('photog', '00000000-0000-0000-0000-000000000003', 'authenticated'),
  ('mechanic_a', '00000000-0000-0000-0000-000000000004', 'authenticated'), ('owner_b', '00000000-0000-0000-0000-000000000005', 'authenticated'),
  ('service', 'service', 'service_role');
-- The id sets asked: every fixture photo, an unknown id and a repeat; and car D in pages of 1,000.
CREATE TABLE public.mr_idsets (k text PRIMARY KEY, ids uuid[]);
INSERT INTO public.mr_idsets VALUES
  ('fixture', (SELECT array_agg(id ORDER BY id) FROM public.vehicle_images WHERE vehicle_id IS DISTINCT FROM 'd0000000-0000-0000-0000-00000000000d')
              || ARRAY['10000000-0000-0000-0000-000000000001', 'ffffffff-0000-0000-0000-000000000000']::uuid[]),
  ('d1', ARRAY(SELECT ('20000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid FROM generate_series(1, 1000) n)),
  ('d2', ARRAY(SELECT ('20000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid FROM generate_series(1001, 2000) n)),
  ('d3', ARRAY(SELECT ('20000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid FROM generate_series(2001, 2400) n));
-- What a caller reads: {id: document} through the view or the many-reader, and the calls it took.
CREATE TABLE public.mr_answers (phase text, caller text, k text, via text, r jsonb, n bigint, calls bigint, PRIMARY KEY (phase, caller, k, via));
GRANT SELECT, INSERT ON public.mr_answers TO anon, authenticated, service_role;
GRANT SELECT ON public.mr_idsets, public.mr_callers TO anon, authenticated, service_role;
CREATE FUNCTION pg_temp.mr_calls(p_fn text) RETURNS bigint LANGUAGE sql AS
  $$ SELECT coalesce(sum(calls), 0)::bigint FROM pg_stat_xact_user_functions WHERE funcname = p_fn $$;
CREATE FUNCTION pg_temp.mr_capture(p_phase text, p_many boolean) RETURNS void LANGUAGE plpgsql AS $$
DECLARE c record; s record; r jsonb; n bigint; c0 bigint;
BEGIN
  FOR c IN SELECT * FROM public.mr_callers LOOP
    FOR s IN SELECT * FROM public.mr_idsets LOOP
      c0 := pg_temp.mr_calls('vehicle_image_scan_metadata');
      PERFORM public.t_claims(c.uid);
      EXECUTE format('SET LOCAL ROLE %I', c.role_name);
      SELECT coalesce(jsonb_object_agg(v.id, v.ai_scan_metadata), '{}'), count(*) INTO r, n
        FROM public.vehicle_images_public v WHERE v.id = ANY (s.ids);
      RESET ROLE;
      INSERT INTO public.mr_answers VALUES (p_phase, c.caller, s.k, 'view', r, n, pg_temp.mr_calls('vehicle_image_scan_metadata') - c0);
      CONTINUE WHEN NOT p_many;
      c0 := pg_temp.mr_calls('vehicle_image_scan_metadata');
      PERFORM public.t_claims(c.uid);
      EXECUTE format('SET LOCAL ROLE %I', c.role_name);
      SELECT coalesce(jsonb_object_agg(m.image_id, m.ai_scan_metadata), '{}'), count(*) INTO r, n
        FROM public.vehicle_image_scan_metadata_many(s.ids) m;
      RESET ROLE;
      INSERT INTO public.mr_answers VALUES (p_phase, c.caller, s.k, 'many', r, n, pg_temp.mr_calls('vehicle_image_scan_metadata') - c0);
    END LOOP;
  END LOOP;
END $$;
-- vehicle_image_privacy_withheld's own time per call while anon reads car D's readings through the view.
CREATE TABLE public.mr_cost (phase text PRIMARY KEY, calls bigint, ms numeric, privacy_calls bigint, privacy_ms numeric);
CREATE FUNCTION pg_temp.mr_cost(p_phase text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE c0 bigint; p0 bigint; pt0 double precision; t0 timestamptz; n bigint;
BEGIN
  c0 := pg_temp.mr_calls('vehicle_image_scan_metadata');
  SELECT coalesce(sum(calls), 0), coalesce(sum(self_time), 0) INTO p0, pt0 FROM pg_stat_xact_user_functions WHERE funcname = 'vehicle_image_privacy_withheld';
  PERFORM public.t_claims('');
  SET LOCAL ROLE anon;
  t0 := clock_timestamp();
  SELECT count(*) FILTER (WHERE v.ai_scan_metadata IS NOT NULL) INTO n FROM public.vehicle_images_public v WHERE v.vehicle_id = 'd0000000-0000-0000-0000-00000000000d';
  RESET ROLE;
  INSERT INTO public.mr_cost
  SELECT p_phase, pg_temp.mr_calls('vehicle_image_scan_metadata') - c0, round(extract(epoch FROM clock_timestamp() - t0)::numeric * 1000, 1),
         sum(calls) - p0, round((sum(self_time) - pt0)::numeric, 1)
    FROM pg_stat_xact_user_functions WHERE funcname = 'vehicle_image_privacy_withheld';
END $$;

-- Before.
SELECT pg_temp.mr_capture('before', false);
SELECT pg_temp.mr_cost('before');
SELECT p.proacl::text AS scan_acl_before, p.proconfig::text AS scan_cfg_before FROM pg_proc p WHERE p.oid = 'public.vehicle_image_scan_metadata(uuid)'::regprocedure \gset
-- Before: the ImageGallery page read (13 projections, range 0-999) through the view runs the redaction for every photo of the car.
CREATE FUNCTION pg_temp.mr_gallery_page_calls() RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE c0 bigint; n bigint;
BEGIN
  c0 := pg_temp.mr_calls('vehicle_image_scan_metadata');
  PERFORM public.t_claims('');
  SET LOCAL ROLE anon;
  SELECT count(*) FILTER (WHERE length(row_to_json(q)::text) > 0) INTO n FROM (
    SELECT id, ai_scan_metadata->'tier_1_analysis' a1, ai_scan_metadata->'classification' a2,
           ai_scan_metadata->'deep_analysis'->'condition_detail'->'overall_score' a3, ai_scan_metadata->'deep_analysis'->>'fabrication_stage' a4,
           ai_scan_metadata->'byok_deep_analysis'->>'scene_type' a5, ai_scan_metadata->'byok_deep_analysis'->>'build_phase_guess' a6,
           ai_scan_metadata->'byok_deep_analysis'->>'narrative_one_line' a7, ai_scan_metadata->'byok_deep_analysis'->'components_seen' a8,
           ai_scan_metadata->'byok_deep_analysis'->>'prompt_version' a9, ai_scan_metadata->'byok_deep_analysis'->>'observation_id' a10,
           ai_scan_metadata->>'classifier' a11, ai_scan_metadata->>'scene_class' a12, ai_scan_metadata->>'phase' a13
      FROM public.vehicle_images_public v
     WHERE v.vehicle_id = 'd0000000-0000-0000-0000-00000000000d' AND v.vehicle_image_gallery_eligible IS TRUE
     ORDER BY v.is_primary DESC, v.position, v.created_at LIMIT 1000) q;
  RESET ROLE;
  RETURN pg_temp.mr_calls('vehicle_image_scan_metadata') - c0;
END $$;
SELECT pg_temp.mr_gallery_page_calls() AS gallery_page_calls_before \gset

-- Another live vehicle_images policy hash (the pre-#3971 one): the migration stops and applies nothing.
SELECT set_config('test.vi_policy_hash', '3af9ebbc1bebf423e3bd1e0b7c45a194', false);
\set ON_ERROR_STOP 0
\ir ../migrations/20261126162500_scan_metadata_many_reader.sql
\set ON_ERROR_STOP 1
SELECT public.t_assert(to_regprocedure('public.vehicle_image_scan_metadata_many(uuid[])') IS NULL
  AND (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.vehicle_image_scan_metadata(uuid)'::regprocedure) = '1930b342245ec8baa829ddee4ab34111'
  AND NOT EXISTS (SELECT 1 FROM public.platform_config),
  'another live vehicle_images policy hash: the migration applies nothing');
SELECT set_config('test.vi_policy_hash', 'd00a311fd7235bb19240f3fd812493c4', false);
\ir ../migrations/20261126162500_scan_metadata_many_reader.sql

-- After.
SELECT pg_temp.mr_capture('after', true);
SELECT pg_temp.mr_cost('after');

-- 1. The view: every caller's answers byte-identical before and after.
SELECT public.t_assert((SELECT count(*) FROM public.mr_answers b JOIN public.mr_answers a USING (caller, k, via)
                         WHERE b.phase = 'before' AND a.phase = 'after' AND a.via = 'view' AND a.r = b.r AND a.n = b.n) = 28,
  'view: anon, stranger, owner, untied uploader, mechanic, B''s owner and service_role read the same rows and documents before and after');
SELECT public.t_assert((SELECT bool_and(r::text NOT LIKE '%TSTPLACE%' AND r::text NOT LIKE '%TSTNOTE%') FROM public.mr_answers WHERE caller IN ('anon', 'stranger'))
  AND (SELECT r::text LIKE '%TSTPLACE%' FROM public.mr_answers WHERE phase = 'after' AND caller = 'owner' AND k = 'd1' AND via = 'many'),
  'redaction: anon and the stranger get no withheld text; the owner gets it');

-- 2. The many-reader answers what the view answers, to every caller, for every id set.
SELECT public.t_assert((SELECT count(*) FROM public.mr_answers v JOIN public.mr_answers m USING (phase, caller, k)
                         WHERE v.phase = 'after' AND v.via = 'view' AND m.via = 'many' AND m.r = v.r AND m.n = v.n) = 28,
  'same rows and documents as the view: vehicle_image_scan_metadata_many(ids) = select id, ai_scan_metadata from vehicle_images_public where id = any(ids), 7 callers x 4 id sets');
SELECT public.t_assert((SELECT n = 4 AND NOT r ?| ARRAY['10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000003',
                                                       '10000000-0000-0000-0000-000000000004', 'ffffffff-0000-0000-0000-000000000000']
                                 AND (SELECT count(*) FROM jsonb_each(r) e WHERE e.value <> 'null'::jsonb) = 1
                            FROM public.mr_answers WHERE phase = 'after' AND caller = 'anon' AND k = 'fixture' AND via = 'many')
  AND (SELECT n FROM public.mr_answers WHERE phase = 'after' AND caller = 'owner' AND k = 'fixture' AND via = 'many') = 7,
  'hidden photos: anon gets the four rows the read policies show it (unfiled, private B''s two and the unknown id absent; a repeat once), a document on shown_a only (deleted C, the document and the withheld-plate photo NULL); the owner all seven');
SELECT public.t_assert((SELECT bool_and(calls = n) FROM public.mr_answers WHERE phase = 'after' AND via = 'many'),
  'one redaction call per row returned, for every caller and id set');

-- 3. One redaction per photo returned on the page's second step, whatever it projects.
CREATE FUNCTION pg_temp.mr_two_step() RETURNS TABLE (ids_calls bigint, ids_n bigint, many_calls bigint, many_n bigint, many_ms numeric) LANGUAGE plpgsql AS $$
DECLARE c0 bigint; v_ids uuid[]; t0 timestamptz;
BEGIN
  c0 := pg_temp.mr_calls('vehicle_image_scan_metadata');
  PERFORM public.t_claims('');
  SET LOCAL ROLE anon;
  SELECT array_agg(id) INTO v_ids FROM (SELECT v.id FROM public.vehicle_images_public v
     WHERE v.vehicle_id = 'd0000000-0000-0000-0000-00000000000d' AND v.vehicle_image_gallery_eligible IS TRUE
     ORDER BY v.is_primary DESC, v.position, v.created_at LIMIT 1000) q;
  RESET ROLE;
  ids_calls := pg_temp.mr_calls('vehicle_image_scan_metadata') - c0;
  ids_n := cardinality(v_ids);
  c0 := pg_temp.mr_calls('vehicle_image_scan_metadata');
  SET LOCAL ROLE anon;
  t0 := clock_timestamp();
  SELECT count(*) FILTER (WHERE length(row_to_json(q)::text) > 0) INTO many_n FROM (
    SELECT m.image_id, m.ai_scan_metadata->'tier_1_analysis' a1, m.ai_scan_metadata->'classification' a2,
           m.ai_scan_metadata->'deep_analysis'->'condition_detail'->'overall_score' a3, m.ai_scan_metadata->'deep_analysis'->>'fabrication_stage' a4,
           m.ai_scan_metadata->'byok_deep_analysis'->>'scene_type' a5, m.ai_scan_metadata->'byok_deep_analysis'->>'build_phase_guess' a6,
           m.ai_scan_metadata->'byok_deep_analysis'->>'narrative_one_line' a7, m.ai_scan_metadata->'byok_deep_analysis'->'components_seen' a8,
           m.ai_scan_metadata->'byok_deep_analysis'->>'prompt_version' a9, m.ai_scan_metadata->'byok_deep_analysis'->>'observation_id' a10,
           m.ai_scan_metadata->>'classifier' a11, m.ai_scan_metadata->>'scene_class' a12, m.ai_scan_metadata->>'phase' a13
      FROM public.vehicle_image_scan_metadata_many(v_ids) m) q;
  many_ms := round(extract(epoch FROM clock_timestamp() - t0)::numeric * 1000, 1);
  RESET ROLE;
  many_calls := pg_temp.mr_calls('vehicle_image_scan_metadata') - c0;
  RETURN NEXT;
END $$;
SELECT * FROM pg_temp.mr_two_step() \gset ts_
SELECT public.t_assert(:ts_ids_calls = 0 AND :ts_ids_n = 1000 AND :ts_many_n = 1000 AND :ts_many_calls = 1000
  AND :'gallery_page_calls_before'::bigint > 2000,
  format('two-step page: ids through the view 0 calls; 13 projections of 1,000 readings %s calls (%s ms); the one-step page read before: %s calls',
         :ts_many_calls, :ts_many_ms, :'gallery_page_calls_before'));

-- 4. The cap.
CREATE FUNCTION pg_temp.mr_refused(p_n integer) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.t_claims('');
  SET LOCAL ROLE anon;
  PERFORM count(*) FROM public.vehicle_image_scan_metadata_many(ARRAY(SELECT gen_random_uuid() FROM generate_series(1, p_n)));
  RESET ROLE;
  RETURN 'answered';
EXCEPTION WHEN program_limit_exceeded THEN
  RETURN 'refused';
END $$;
SELECT public.t_assert(pg_temp.mr_refused(1001) = 'refused' AND pg_temp.mr_refused(1000) = 'answered',
  '1,001 ids refused (54000), 1,000 answered: platform_config vehicle_image_scan_metadata_many.max_ids');
DELETE FROM public.platform_config WHERE config_key = 'vehicle_image_scan_metadata_many';
SELECT public.t_assert(pg_temp.mr_refused(1) = 'refused', 'no config row: refused (no typed-in cap)');
INSERT INTO public.platform_config (config_key, config_value) VALUES ('vehicle_image_scan_metadata_many', '{"max_ids": 5}');
SELECT public.t_assert(pg_temp.mr_refused(6) = 'refused' AND pg_temp.mr_refused(5) = 'answered', 'the cap is read from the config row (5 -> 6 refused)');
DELETE FROM public.platform_config WHERE config_key = 'vehicle_image_scan_metadata_many';

-- 5. The gallery test keeps privacy_withheld's plan.
SELECT b.privacy_ms / b.privacy_calls AS priv_before, a.privacy_ms / a.privacy_calls AS priv_after, b.ms AS ms_before, a.ms AS ms_after,
       b.calls AS calls_before, a.calls AS calls_after
  FROM public.mr_cost b, public.mr_cost a WHERE b.phase = 'before' AND a.phase = 'after' \gset
SELECT public.t_assert(:calls_before = :calls_after AND :calls_after > 2000 AND :priv_after * 3 < :priv_before,
  format('privacy_withheld per call: %s -> %s ms; anon reading car D''s readings through the view: %s -> %s ms, %s calls both',
         round(:priv_before, 4), round(:priv_after, 4), :ms_before, :ms_after, :calls_after));

-- 6. Security, volatility, grants.
SELECT public.t_assert((SELECT prosecdef AND procost = 1 AND provolatile = 's' FROM pg_proc WHERE oid = 'public.vehicle_image_scan_metadata(uuid)'::regprocedure)
  AND (SELECT proacl::text = :'scan_acl_before' AND proconfig::text = :'scan_cfg_before' FROM pg_proc WHERE oid = 'public.vehicle_image_scan_metadata(uuid)'::regprocedure),
  'vehicle_image_scan_metadata: SECURITY DEFINER, STABLE, COST 1, same grants and search_path');
SELECT public.t_assert((SELECT NOT prosecdef AND provolatile = 's' FROM pg_proc WHERE oid = 'public.vehicle_image_scan_metadata_many(uuid[])'::regprocedure)
  AND has_function_privilege('anon', 'public.vehicle_image_scan_metadata_many(uuid[])', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.vehicle_image_scan_metadata_many(uuid[])', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.vehicle_image_scan_metadata_many(uuid[])', 'EXECUTE')
  AND NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x WHERE p.oid = 'public.vehicle_image_scan_metadata_many(uuid[])'::regprocedure AND x.grantee = 0),
  'grants: the many-reader is SECURITY INVOKER, STABLE, executable by anon, authenticated and service_role, not PUBLIC');

-- 7. A second apply is a no-op (the config row comes back as written).
\ir ../migrations/20261126162500_scan_metadata_many_reader.sql
SELECT public.t_assert((SELECT (config_value ->> 'max_ids')::integer FROM public.platform_config WHERE config_key = 'vehicle_image_scan_metadata_many') = 1000
  AND (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.vehicle_image_scan_metadata(uuid)'::regprocedure) = 'd92ac4bd51e37ba3165029559618fad4',
  'second apply: the guard takes its own body; the config row as written');

-- 8. The revert restores the live body and removes the reader and its row.
\ir revert_20261126162500_scan_metadata_many_reader.sql
SELECT public.t_assert((SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.vehicle_image_scan_metadata(uuid)'::regprocedure) = '1930b342245ec8baa829ddee4ab34111'
  AND md5(pg_get_functiondef('public.vehicle_image_scan_metadata(uuid)'::regprocedure)) = '724d2e2c15f50d57e977ab4516ac6b1d'
  AND (SELECT proacl::text = :'scan_acl_before' FROM pg_proc WHERE oid = 'public.vehicle_image_scan_metadata(uuid)'::regprocedure)
  AND to_regprocedure('public.vehicle_image_scan_metadata_many(uuid[])') IS NULL
  AND NOT EXISTS (SELECT 1 FROM public.platform_config WHERE config_key = 'vehicle_image_scan_metadata_many'),
  'revert: live body (prosrc 1930b342, functiondef 724d2e2c) and grants restored; reader and config row removed');
