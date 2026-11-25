-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_<name> -f supabase/sql/test_scan_reading_served_keys_end_user_guard.sql
-- Proves 20261126101900_scan_reading_served_keys_end_user_guard.sql:
--   * an end user (authenticated, a direct statement) cannot set a served key on INSERT, change one on UPDATE, or replace
--     the document with a non-object (42501); client keys (source, bat_url, validation) still insert and update;
--   * a SECURITY DEFINER writer an end user calls (as sync_local_vision_tags) and a direct service_role statement (the
--     pipeline's secret-key client) still write a served key;
--   * the guard fires first: an update that a later BEFORE trigger rewrites (the withdraw on a move) is judged on what the
--     user sent;
--   * the plate oracle is closed: a right and a wrong plate guess stored by an untied uploader in a client key read back
--     identically to anon and to a stranger, with no [withheld];
--   * a stranger gets only served keys (a key no rule names, on_device_vision and source withheld), the plate still
--     replaced inside a served key of a photo whose uploader is not tied; the uploader and a tied viewer get everything;
--   * a non-object document is NULL to a stranger and whole to its uploader;
--   * the served list is the rule rows: a key added there is served and refused to end users in the same statement;
--   * the revert restores the 20261125200000 bodies (md5) and the defect with them.
-- Mutants (2026-11-26, each failing a named assertion): guard on auth.role() instead of current_user -> "definer writer";
-- guard named after the withdraw trigger -> "order"; served branch dropped -> "oracle"; non-object branch
-- dropped -> "non-object"; guard without the INSERT case -> "insert"; served list hard-coded -> "served list is the rule rows";
-- trigger on INSERT only -> "update"; guard allowing only postgres -> "service_role".
-- Fixture rows only, in a disposable database. -- ALLOW_RAW_TESTIMONY_WRITE
\set ON_ERROR_STOP 1
\ir test_scan_metadata_withheld_paths.sql
\ir ../migrations/20261125200000_scan_metadata_withheld_paths.sql
SELECT public.t_assert((SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.image_scan_metadata_for_viewer(jsonb, uuid, uuid, public.image_scan_rule[])'::regprocedure)
  = 'c3ab8411de3cd842c8cafd823f90641e'
  AND (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.image_scan_rules(text)'::regprocedure) = '420fe0be7f009555945951f1876bb1dd',
  'fixture: the worker and image_scan_rules are the 20261125200000 bodies');

-- End-user writes as live: a direct insert of one's own photo, an update of one's own photo.
GRANT INSERT, UPDATE ON public.vehicle_images TO authenticated, service_role;
CREATE POLICY t_ins ON public.vehicle_images FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY t_upd ON public.vehicle_images FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
-- Stand-ins for the live BEFORE triggers the guard must precede: a00_trg_capture_relay_default_vehicle (no-op here) and
-- trg_withdraw_reviewed_image_analysis (drops the deep reading when the photo moves to another car).
CREATE FUNCTION public.t_noop() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
CREATE TRIGGER a00_trg_capture_relay_default_vehicle BEFORE INSERT ON public.vehicle_images FOR EACH ROW EXECUTE FUNCTION public.t_noop();
CREATE FUNCTION public.t_withdraw() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.vehicle_id IS DISTINCT FROM OLD.vehicle_id AND jsonb_typeof(NEW.ai_scan_metadata) = 'object' THEN
    NEW.ai_scan_metadata := NEW.ai_scan_metadata - 'byok_deep_analysis';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_withdraw_reviewed_image_analysis BEFORE UPDATE ON public.vehicle_images FOR EACH ROW EXECUTE FUNCTION public.t_withdraw();
-- A definer writer an end user may call, owned by the migration role (as sync_local_vision_tags).
CREATE FUNCTION public.t_definer_set_classification(p uuid, v jsonb) RETURNS void LANGUAGE sql SECURITY DEFINER
  SET search_path = public AS $$
  UPDATE public.vehicle_images SET ai_scan_metadata = coalesce(ai_scan_metadata, '{}'::jsonb) || jsonb_build_object('classification', v)
   WHERE id = p $$;
GRANT EXECUTE ON FUNCTION public.t_definer_set_classification(uuid, jsonb) TO authenticated;

-- t_as(uid, sql): run one statement as that caller ('' anon, else authenticated), return 'ok' or its SQLSTATE.
CREATE FUNCTION public.t_as(p_uid text, q text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text;
BEGIN
  PERFORM public.t_claims(p_uid);
  EXECUTE format('SET LOCAL ROLE %I', CASE p_uid WHEN '' THEN 'anon' ELSE 'authenticated' END);
  BEGIN
    EXECUTE q; r := 'ok';
  EXCEPTION WHEN OTHERS THEN r := SQLSTATE;
  END;
  RESET ROLE;
  RETURN r;
END $$;
-- t_read(uid, image): vehicle_image_scan_metadata as that caller, as text ('null' for NULL).
CREATE FUNCTION public.t_read(p_uid text, p_image uuid) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  PERFORM public.t_claims(p_uid);
  EXECUTE format('SET LOCAL ROLE %I', CASE p_uid WHEN '' THEN 'anon' ELSE 'authenticated' END);
  r := public.vehicle_image_scan_metadata(p_image);
  RESET ROLE;
  RETURN coalesce(r::text, 'null');
END $$;

\ir ../migrations/20261126101900_scan_reading_served_keys_end_user_guard.sql
-- re-apply: a no-op
\ir ../migrations/20261126101900_scan_reading_served_keys_end_user_guard.sql
SELECT public.t_assert((SELECT count(*) FROM public.image_scan_withheld_paths WHERE rule_kind = 'served_key') = 35,
  'migration: 35 served keys, once (re-apply adds none)');

\set u1 '00000000-0000-0000-0000-000000000001'
\set u2 '00000000-0000-0000-0000-000000000002'
\set u3 '00000000-0000-0000-0000-000000000003'
\set u4 '00000000-0000-0000-0000-000000000004'
\set car_a 'a0000000-0000-0000-0000-00000000000a'
\set car_b 'b0000000-0000-0000-0000-00000000000b'
\set p8 '10000000-0000-0000-0000-000000000008'
\set p9 '10000000-0000-0000-0000-000000000009'
-- a direct database session, as a job runs: no request claims left from the earlier contract
SELECT set_config('request.jwt.claims', '', false);
UPDATE public.vehicle_images SET ai_scan_metadata = '{"classification": {"label": "chrome bumper"}, "byok_deep_analysis": {"scene_type": "exterior"}}'
 WHERE id = :'p8';

-- 1. Insert: a served key is refused to an end user; client keys are not.
BEGIN;
SELECT public.t_as(:'u1', format($q$INSERT INTO public.vehicle_images (id, vehicle_id, user_id, image_url, source, is_document, is_external,
  vision_gate_status, ai_scan_metadata) VALUES ('10000000-0000-0000-0000-0000000000a1', %L, %L, 'https://x.invalid/a1.jpg', 'user_upload',
  false, false, 'approved', '{"byok_deep_analysis": {"narrative_one_line": "TSTPLANT"}}')$q$, :'car_a', :'u1')) AS i_byok,
       public.t_as(:'u1', format($q$INSERT INTO public.vehicle_images (id, vehicle_id, user_id, image_url, source, is_document, is_external,
  vision_gate_status, ai_scan_metadata) VALUES ('10000000-0000-0000-0000-0000000000a2', %L, %L, 'https://x.invalid/a2.jpg', 'user_upload',
  false, false, 'approved', '{"classification": {"label": "TSTPLANT"}, "source": "x"}')$q$, :'car_a', :'u1')) AS i_cls,
       public.t_as(:'u1', format($q$INSERT INTO public.vehicle_images (id, vehicle_id, user_id, image_url, source, is_document, is_external,
  vision_gate_status, ai_scan_metadata) VALUES ('10000000-0000-0000-0000-0000000000a3', %L, %L, 'https://x.invalid/a3.jpg', 'bat_auction',
  false, false, 'approved', '{"source": "bat_scraper", "bat_url": "https://x.invalid/l", "vehicle_expected": "1973 x y"}')$q$, :'car_a', :'u1')) AS i_client \gset
ROLLBACK;
SELECT public.t_assert(:'i_byok' = '42501' AND :'i_cls' = '42501' AND :'i_client' = 'ok',
  format('insert: an end user cannot set byok_deep_analysis or classification; client keys insert (%s %s %s)', :'i_byok', :'i_cls', :'i_client'));

-- 2. Update: changing a served key or replacing the document with a non-object is refused; a client key changes freely;
--    the guard judges what the user sent, before the withdraw trigger drops the deep reading on a move.
BEGIN;
SELECT public.t_as(:'u1', format($q$UPDATE public.vehicle_images SET ai_scan_metadata = jsonb_set(ai_scan_metadata, '{classification,label}', '"TSTPLANT"') WHERE id = %L$q$, :'p8')) AS u_cls,
       public.t_as(:'u1', format($q$UPDATE public.vehicle_images SET ai_scan_metadata = '["TSTARR"]' WHERE id = %L$q$, :'p8')) AS u_arr,
       public.t_as(:'u1', format($q$UPDATE public.vehicle_images SET ai_scan_metadata = ai_scan_metadata - 'classification' WHERE id = %L$q$, :'p8')) AS u_drop,
       public.t_as(:'u1', format($q$UPDATE public.vehicle_images SET ai_scan_metadata = ai_scan_metadata || '{"validation": {"status": "failed"}}' WHERE id = %L$q$, :'p8')) AS u_client \gset
ROLLBACK;
BEGIN;
SELECT public.t_as(:'u1', format($q$UPDATE public.vehicle_images SET vehicle_id = %L, ai_scan_metadata = ai_scan_metadata || '{"validation": {"status": "moved"}}' WHERE id = %L$q$, :'car_b', :'p8')) AS u_move \gset
SELECT (ai_scan_metadata ? 'byok_deep_analysis')::text AS move_kept_byok FROM public.vehicle_images WHERE id = :'p8' \gset
ROLLBACK;
SELECT public.t_assert(:'u_cls' = '42501' AND :'u_arr' = '42501' AND :'u_drop' = '42501' AND :'u_client' = 'ok',
  format('update: a served key cannot be changed, dropped or replaced by a non-object; a client key can (%s %s %s %s)', :'u_cls', :'u_arr', :'u_drop', :'u_client'));
SELECT public.t_assert(:'u_move' = 'ok' AND :'move_kept_byok' = 'false',
  format('order: the guard fires before the withdraw trigger, so a move the withdraw rewrites is allowed (%s, byok kept %s)', :'u_move', :'move_kept_byok'));
SELECT public.t_assert((SELECT t.tgname FROM pg_trigger t WHERE t.tgrelid = 'public.vehicle_images'::regclass AND NOT t.tgisinternal
                          AND (t.tgtype & 2) = 2 ORDER BY t.tgname COLLATE "C" LIMIT 1) = 'a000_guard_end_user_scan_reading',
  'order: a000_guard_end_user_scan_reading is the first BEFORE trigger (before a00_trg_capture_relay_default_vehicle)');

-- 3. A definer writer an end user calls still writes a served key.
BEGIN;
SELECT public.t_as(:'u1', format($q$SELECT public.t_definer_set_classification(%L, '{"label": "from the rpc"}')$q$, :'p9')) AS d_rpc \gset
SELECT ai_scan_metadata #>> '{classification,label}' AS d_val FROM public.vehicle_images WHERE id = :'p9' \gset
ROLLBACK;
SELECT public.t_assert(:'d_rpc' = 'ok' AND :'d_val' = 'from the rpc',
  format('definer writer: a SECURITY DEFINER function an end user calls writes classification (%s)', :'d_rpc'));

-- 3b. The pipeline's own path: a direct service_role statement (the edge functions' secret-key client) writes a served key.
BEGIN;
SELECT public.t_claims('service');
SET LOCAL ROLE service_role;
SELECT public.t_sqlstate(format($q$UPDATE public.vehicle_images SET ai_scan_metadata = ai_scan_metadata || '{"classification": {"label": "from the pipeline"}}' WHERE id = %L$q$, :'p9')) AS sr_upd \gset
RESET ROLE;
SELECT ai_scan_metadata #>> '{classification,label}' AS sr_val FROM public.vehicle_images WHERE id = :'p9' \gset
ROLLBACK;
SELECT set_config('request.jwt.claims', '', false);
SELECT public.t_assert(:'sr_upd' = 'ok' AND :'sr_val' = 'from the pipeline',
  format('service_role: a direct pipeline statement writes classification (%s)', :'sr_upd'));

-- 4. The oracle: an untied uploader (u3) stores a right and a wrong plate guess in a client key; anon and a stranger read
--    both photos the same, with no [withheld] and no guess.
BEGIN;
SELECT public.t_as(:'u3', format($q$INSERT INTO public.vehicle_images (id, vehicle_id, user_id, image_url, source, is_document, is_external,
  vision_gate_status, ai_scan_metadata) VALUES ('10000000-0000-0000-0000-0000000000b1', %L, %L, 'https://x.invalid/b1.jpg', 'user_upload',
  false, false, 'approved', '{"source": "seen TST PL8-9 here", "on_device_vision": {"labels": ["TST PL8 9"]}}')$q$, :'car_a', :'u3')) AS o_right,
       public.t_as(:'u3', format($q$INSERT INTO public.vehicle_images (id, vehicle_id, user_id, image_url, source, is_document, is_external,
  vision_gate_status, ai_scan_metadata) VALUES ('10000000-0000-0000-0000-0000000000b2', %L, %L, 'https://x.invalid/b2.jpg', 'user_upload',
  false, false, 'approved', '{"source": "seen ABC 1234 here", "on_device_vision": {"labels": ["ABC 1234"]}}')$q$, :'car_a', :'u3')) AS o_wrong \gset
SELECT public.t_read('', '10000000-0000-0000-0000-0000000000b1') AS o_anon_r, public.t_read('', '10000000-0000-0000-0000-0000000000b2') AS o_anon_w,
       public.t_read(:'u2', '10000000-0000-0000-0000-0000000000b1') AS o_str_r, public.t_read(:'u2', '10000000-0000-0000-0000-0000000000b2') AS o_str_w,
       public.t_read(:'u3', '10000000-0000-0000-0000-0000000000b1') AS o_own_r \gset
ROLLBACK;
SELECT public.t_assert(:'o_right' = 'ok' AND :'o_wrong' = 'ok' AND :'o_anon_r' = :'o_anon_w' AND :'o_str_r' = :'o_str_w'
  AND :'o_anon_r' !~ '(withheld|TST|ABC|source|on_device_vision)' AND :'o_own_r' ~ 'TST PL8-9',
  format('oracle: a right and a wrong stored guess read back the same to anon (%s / %s) and a stranger; the uploader reads theirs',
         :'o_anon_r', :'o_anon_w'));

-- 5. Default withhold: on photo 9 (uploaded by u3, not tied to car A) a stranger gets only served keys, the plate replaced
--    inside a served label; the uploader and a tied mechanic (u4) get every key.
BEGIN;
UPDATE public.vehicle_images SET ai_scan_metadata = '{"classification": {"label": "plate TST PL8-9 on the bumper"},
  "brand_new_key": "TSTNEW", "on_device_vision": {"labels": ["TSTODV"]}, "source": "TSTSRC", "provenance_corrections": [{"note": "TSTPROV"}]}'
 WHERE id = :'p9';
SELECT public.t_read('', :'p9') AS w_anon, public.t_read(:'u2', :'p9') AS w_str, public.t_read(:'u3', :'p9') AS w_own,
       public.t_read(:'u4', :'p9') AS w_mech \gset
ROLLBACK;
SELECT public.t_assert(:'w_anon' = '{"classification": {"label": "plate [withheld] on the bumper"}}' AND :'w_str' = :'w_anon',
  format('default withhold: a stranger gets classification with the plate replaced and no other key (%s)', :'w_anon'));
SELECT public.t_assert(:'w_own' ~ 'TSTNEW' AND :'w_own' ~ 'TSTODV' AND :'w_own' ~ 'TSTSRC' AND :'w_own' ~ 'TST PL8-9'
  AND :'w_mech' = :'w_own', 'default withhold: the uploader and a tied mechanic read every key as stored');

-- 6. A non-object document: NULL to a stranger, whole to its uploader.
BEGIN;
UPDATE public.vehicle_images SET ai_scan_metadata = '["TSTARR"]' WHERE id = :'p9';
SELECT public.t_read('', :'p9') AS n_anon, public.t_read(:'u3', :'p9') AS n_own \gset
ROLLBACK;
SELECT public.t_assert(:'n_anon' = 'null' AND :'n_own' = '["TSTARR"]',
  format('non-object: a stranger gets NULL, the uploader the document (%s / %s)', :'n_anon', :'n_own'));

-- 7. The served list is the rule rows: a key added there is served and refused to end users in the same statement.
BEGIN;
INSERT INTO public.image_scan_withheld_paths (surface, rule_kind, path, reason, basis)
VALUES ('vehicle_images.ai_scan_metadata', 'served_key', '{zz_new}', 'contract', 'contract');
UPDATE public.vehicle_images SET ai_scan_metadata = '{"zz_new": "TSTZZ", "classification": {"label": "x"}}' WHERE id = :'p9';
SELECT public.t_read('', :'p9') AS s_anon,
       public.t_as(:'u1', format($q$UPDATE public.vehicle_images SET ai_scan_metadata = ai_scan_metadata || '{"zz_new": "TSTPLANT"}' WHERE id = %L$q$, :'p8')) AS s_write \gset
ROLLBACK;
SELECT public.t_assert(:'s_anon' ~ 'TSTZZ' AND :'s_write' = '42501',
  format('served list is the rule rows: a new served key is served (%s) and refused to an end user (%s)', :'s_anon', :'s_write'));

-- 8. The revert restores the 20261125200000 bodies and the defect: a stranger reads the unlisted key again.
\ir revert_20261126101900_scan_reading_served_keys_end_user_guard.sql
BEGIN;
UPDATE public.vehicle_images SET ai_scan_metadata = '{"classification": {"label": "x"}, "brand_new_key": "TSTNEW"}' WHERE id = :'p9';
SELECT public.t_read('', :'p9') AS r_anon \gset
ROLLBACK;
SELECT public.t_assert(:'r_anon' ~ 'TSTNEW'
  AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'a000_guard_end_user_scan_reading')
  AND to_regprocedure('public.image_scan_served_keys()') IS NULL,
  'revert: the guard and the served list are gone and an unlisted key reaches a stranger again');

SELECT 'scan_reading_served_keys_end_user_guard contract: PASS' AS result;
