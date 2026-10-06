-- Isolated PostgreSQL 17 regression: synthetic rows and placeholder keys only, never production data.
-- Contract for migration 20261006111500_reattribute_observation_existing_twin.sql.
-- Break 1: reattribute_observation raised unique_observation for any observation whose key (source_id, source_identifier, kind,
-- content_hash) has no NULL part, because the copy collides with its own source row: the index is table-wide and the source keeps its
-- key. The migration copies such a row under a derived content_hash.
-- Break 2: a row the index does not protect (a NULL source_id or source_identifier) moved even when the target already held the same
-- observation, piling a duplicate onto it. The migration supersedes the source toward the existing row instead of copying.
-- unique_observation is modelled as it is live: UNIQUE (source_id, source_identifier, kind, content_hash), NULLs distinct, no vehicle
-- column. A fully keyed row therefore cannot have a twin; only NULL-keyed rows can.
-- The frozen writer below is a dependency fixture, not a rule change: the body live on 2026-10-06 (compacted text), measured by
-- pg_get_functiondef on production, so the drift guard of the migration can match it.
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database() NOT IN ('dm_reattribute_existing_twin_ci')
   OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='auth')
   OR EXISTS(SELECT 1 FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN ('r','p','v','m')) THEN
 RAISE EXCEPTION 'Refusing fixtures outside isolated DB'; END IF;
END $$;
SET statement_timeout='30s';
SET lock_timeout='3s';

-- Every column the writer reads or writes, nothing else.
CREATE TABLE public.vehicles(id uuid PRIMARY KEY);
CREATE TABLE public.vehicle_images(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid, user_id uuid, image_url text, image_type text, image_category text,
  category text, position integer, caption text, is_primary boolean, created_at timestamptz, updated_at timestamptz,
  file_name text, source text, exif_data jsonb, file_hash text, file_size bigint, taken_at timestamptz,
  latitude numeric, longitude numeric, location_name text, apple_ml_labels jsonb,
  photographer_attribution text, documented_by_device text, documented_by_user_id uuid,
  storage_path text, thumbnail_url text, medium_url text, large_url text,
  merged_from_vehicle_id uuid, is_superseded boolean DEFAULT false,
  superseded_by uuid REFERENCES public.vehicle_images(id), superseded_at timestamptz, vision_gate_status text);
CREATE TABLE public.vehicle_observations(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid, kind text NOT NULL, source_id uuid, source_identifier text, source_url text,
  content_text text, content_hash text, structured_data jsonb, confidence text,
  observed_at timestamptz, ingested_at timestamptz DEFAULT now(), observer_id uuid, observer_raw text,
  submitted_by_user_id uuid, agent_tier text, agent_model text, extraction_method text,
  rank integer, merged_from_vehicle_id uuid, is_superseded boolean DEFAULT false,
  superseded_by uuid, superseded_at timestamptz,
  CONSTRAINT unique_observation UNIQUE (source_id, source_identifier, kind, content_hash));
CREATE TABLE public.reattribution_audit(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  observation_type text NOT NULL CHECK (observation_type IN ('image','observation')),
  old_observation_id uuid NOT NULL, old_vehicle_id uuid REFERENCES public.vehicles(id),
  new_observation_id uuid NOT NULL, new_vehicle_id uuid REFERENCES public.vehicles(id),
  reason text NOT NULL, actor_user_id uuid, created_at timestamptz DEFAULT now());

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF; RAISE NOTICE 'PASS %', label;
END $$;

-- Rows differ only by id, vehicle and key so that two runs of the writer on identical shapes can be compared.
CREATE FUNCTION pg_temp.seed_obs(p_id uuid, p_vehicle uuid, p_ident text, p_hash text, p_kind text DEFAULT 'listing', p_source uuid DEFAULT '00000000-0000-0000-0000-0000000000f1') RETURNS uuid LANGUAGE plpgsql AS $$ BEGIN
  INSERT INTO public.vehicle_observations (id, vehicle_id, kind, source_id, source_identifier, source_url, content_text, content_hash,
    structured_data, confidence, observed_at, ingested_at, observer_id, observer_raw, submitted_by_user_id, agent_tier, agent_model,
    extraction_method, rank)
  VALUES (p_id, p_vehicle, p_kind, p_source, p_ident, 'https://example.invalid/placeholder', 'text placeholder', p_hash,
    '{"seed":"placeholder"}', 'medium', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z', '00000000-0000-0000-0000-0000000000e1',
    'observer placeholder', '00000000-0000-0000-0000-0000000000e2', 'tier placeholder', 'model placeholder', 'method placeholder', 5);
  RETURN p_id;
END $$;
CREATE FUNCTION pg_temp.seed_img(p_id uuid, p_vehicle uuid) RETURNS uuid LANGUAGE plpgsql AS $$ BEGIN
  INSERT INTO public.vehicle_images (id, vehicle_id, user_id, image_url, image_type, image_category, category, position, caption, is_primary,
    created_at, updated_at, file_name, source, exif_data, file_hash, file_size, taken_at, latitude, longitude, location_name, apple_ml_labels,
    photographer_attribution, documented_by_device, documented_by_user_id, storage_path, thumbnail_url, medium_url, large_url, vision_gate_status)
  VALUES (p_id, p_vehicle, '00000000-0000-0000-0000-0000000000e2', 'https://example.invalid/image.jpg', 'photo', 'exterior', 'front', 3,
    'caption placeholder', false, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'image.jpg', 'upload', '{"exif":"placeholder"}',
    'file-hash-placeholder', 1024, '2025-12-31T00:00:00Z', 36.1, -115.1, 'location placeholder', '["label"]', 'photographer placeholder',
    'device placeholder', '00000000-0000-0000-0000-0000000000e2', 'storage/placeholder.jpg', 'https://example.invalid/t.jpg',
    'https://example.invalid/m.jpg', 'https://example.invalid/l.jpg', 'passed');
  RETURN p_id;
END $$;
-- Comparable shapes: everything except what legitimately differs between two runs.
CREATE FUNCTION pg_temp.obs_copy_shape(p_id uuid) RETURNS jsonb LANGUAGE sql AS $$
  SELECT to_jsonb(o) - 'id' - 'ingested_at' - 'vehicle_id' FROM public.vehicle_observations o WHERE o.id = p_id $$;
CREATE FUNCTION pg_temp.obs_source_shape(p_id uuid) RETURNS jsonb LANGUAGE sql AS $$
  SELECT to_jsonb(o) - 'id' - 'superseded_at' - 'superseded_by' FROM public.vehicle_observations o WHERE o.id = p_id $$;
CREATE FUNCTION pg_temp.img_copy_shape(p_id uuid) RETURNS jsonb LANGUAGE sql AS $$
  SELECT to_jsonb(i) - 'id' - 'updated_at' - 'vehicle_id' FROM public.vehicle_images i WHERE i.id = p_id $$;
CREATE FUNCTION pg_temp.img_source_shape(p_id uuid) RETURNS jsonb LANGUAGE sql AS $$
  SELECT to_jsonb(i) - 'id' - 'superseded_at' - 'superseded_by' FROM public.vehicle_images i WHERE i.id = p_id $$;
CREATE FUNCTION pg_temp.result_shape(r jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT r - 'old_observation_id' - 'new_observation_id' - 'new_vehicle_id' - 'superseded_at' - 'merged_into_existing' $$;
CREATE FUNCTION pg_temp.result_keys(r jsonb) RETURNS text[] LANGUAGE sql AS $$
  SELECT coalesce(array_agg(k ORDER BY k), '{}') FROM jsonb_object_keys(r) k $$;
CREATE FUNCTION pg_temp.audit_shape(p_old uuid) RETURNS jsonb LANGUAGE sql AS $$
  SELECT to_jsonb(a) - 'id' - 'created_at' - 'old_observation_id' - 'new_observation_id' - 'new_vehicle_id' FROM public.reattribution_audit a WHERE a.old_observation_id = p_old $$;
CREATE TEMP TABLE baseline(label text PRIMARY KEY, copy_shape jsonb, source_shape jsonb, result jsonb, audit jsonb);

INSERT INTO public.vehicles(id) VALUES
  ('00000000-0000-0000-0000-0000000000a0'),  -- A: source vehicle
  ('00000000-0000-0000-0000-0000000000b0'),  -- B: target vehicle
  ('00000000-0000-0000-0000-0000000000b1'),  -- B2: second target vehicle, holds nothing before case (a)
  ('00000000-0000-0000-0000-0000000000c0');  -- C: bulk source vehicle

-- Frozen live writer (pg_get_functiondef as installed on 2026-10-06, verbatim) so the guard can match it.
CREATE OR REPLACE FUNCTION public.reattribute_observation(p_observation_type text, p_observation_id uuid, p_target_vehicle_id uuid, p_reason text, p_actor_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE v_old_vehicle_id UUID; v_already_superseded BOOLEAN; v_found BOOLEAN := false; v_new_observation_id UUID;
BEGIN
  IF p_observation_type NOT IN ('image', 'observation') THEN RAISE EXCEPTION 'observation_type must be image or observation, got %', p_observation_type; END IF;
  IF NOT EXISTS (SELECT 1 FROM vehicles WHERE id = p_target_vehicle_id) THEN RAISE EXCEPTION 'target vehicle % does not exist', p_target_vehicle_id; END IF;
  IF p_observation_type = 'image' THEN
    SELECT true, vehicle_id, COALESCE(is_superseded, false) INTO v_found, v_old_vehicle_id, v_already_superseded FROM vehicle_images WHERE id = p_observation_id;
  ELSE
    SELECT true, vehicle_id, COALESCE(is_superseded, false) INTO v_found, v_old_vehicle_id, v_already_superseded FROM vehicle_observations WHERE id = p_observation_id;
  END IF;
  IF NOT v_found THEN RAISE EXCEPTION '% % not found', p_observation_type, p_observation_id; END IF;
  IF v_already_superseded THEN RETURN jsonb_build_object('success', false, 'error', 'already_superseded', 'observation_id', p_observation_id); END IF;
  IF v_old_vehicle_id IS NOT DISTINCT FROM p_target_vehicle_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'target_same_as_current', 'observation_id', p_observation_id, 'vehicle_id', v_old_vehicle_id); END IF;
  IF p_observation_type = 'image' THEN
    INSERT INTO vehicle_images (
      vehicle_id, user_id, image_url, image_type, image_category, category, position, caption, is_primary, created_at, updated_at,
      file_name, source, exif_data, file_hash, file_size, taken_at, latitude, longitude, location_name, apple_ml_labels,
      photographer_attribution, documented_by_device, documented_by_user_id, storage_path, thumbnail_url, medium_url, large_url,
      merged_from_vehicle_id, is_superseded, superseded_by, vision_gate_status)
    SELECT p_target_vehicle_id, user_id, image_url, image_type, image_category, category, position, caption, is_primary, created_at, NOW(),
      file_name, source, exif_data, file_hash, file_size, taken_at, latitude, longitude, location_name, apple_ml_labels,
      photographer_attribution, documented_by_device, documented_by_user_id, storage_path, thumbnail_url, medium_url, large_url,
      v_old_vehicle_id, false, NULL, 'pending'
    FROM vehicle_images WHERE id = p_observation_id RETURNING id INTO v_new_observation_id;
    UPDATE vehicle_images SET is_superseded = true, superseded_at = NOW(), superseded_by = v_new_observation_id WHERE id = p_observation_id;
  ELSE
    INSERT INTO vehicle_observations (
      vehicle_id, kind, source_id, source_identifier, source_url, content_text, content_hash, structured_data, confidence,
      observed_at, ingested_at, observer_id, observer_raw, submitted_by_user_id, agent_tier, agent_model, extraction_method,
      rank, merged_from_vehicle_id, is_superseded, superseded_by)
    SELECT p_target_vehicle_id, kind, source_id, source_identifier, source_url, content_text, content_hash, structured_data, confidence,
      observed_at, NOW(), observer_id, observer_raw, submitted_by_user_id, agent_tier, agent_model, extraction_method,
      rank, v_old_vehicle_id, false, NULL
    FROM vehicle_observations WHERE id = p_observation_id RETURNING id INTO v_new_observation_id;
    UPDATE vehicle_observations SET is_superseded = true, superseded_at = NOW(), superseded_by = v_new_observation_id WHERE id = p_observation_id;
  END IF;
  INSERT INTO reattribution_audit (observation_type, old_observation_id, old_vehicle_id, new_observation_id, new_vehicle_id, reason, actor_user_id)
  VALUES (p_observation_type, p_observation_id, v_old_vehicle_id, v_new_observation_id, p_target_vehicle_id, p_reason, p_actor_user_id);
  RETURN jsonb_build_object('success', true, 'observation_type', p_observation_type, 'old_observation_id', p_observation_id, 'old_vehicle_id', v_old_vehicle_id,
    'new_observation_id', v_new_observation_id, 'new_vehicle_id', p_target_vehicle_id, 'merged_from_vehicle_id', v_old_vehicle_id, 'reason', p_reason, 'superseded_at', NOW());
END; $function$;
-- Production restricts execution to the service role; whatever the ACL is, the migration must leave it alone.
REVOKE EXECUTE ON FUNCTION public.reattribute_observation(text, uuid, uuid, text, uuid) FROM PUBLIC;
CREATE TEMP TABLE acl_before AS
  SELECT proacl::text AS acl, prosecdef, proconfig::text AS config FROM pg_proc WHERE oid = 'public.reattribute_observation(text,uuid,uuid,text,uuid)'::regprocedure;

DO $$ DECLARE f text; BEGIN
  f := md5(pg_get_functiondef('public.reattribute_observation(text,uuid,uuid,text,uuid)'::regprocedure));
  RAISE NOTICE 'fixture fingerprint %', f;
  PERFORM pg_temp.ok('fixture reproduces the live fingerprint', f = '5b39ee293216ed647d7f09f8a53beb58'); -- gitleaks:allow (fingerprint)
END $$;

-- 0. THE BREAK, reproduced on the frozen live writer: a fully keyed observation with no twin anywhere cannot move.
SELECT pg_temp.seed_obs('00000000-0000-0000-0001-000000000001', '00000000-0000-0000-0000-0000000000a0', 'lot-placeholder-1', 'hash-placeholder-1');
DO $$ DECLARE c text; BEGIN
  BEGIN
    PERFORM public.reattribute_observation('observation', '00000000-0000-0000-0001-000000000001', '00000000-0000-0000-0000-0000000000b0', 'contract', NULL);
    RAISE EXCEPTION 'Contract failed: the frozen live writer moved a fully keyed observation';
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS c = CONSTRAINT_NAME;
    PERFORM pg_temp.ok('frozen live writer raises unique_observation on a fully keyed row', c = 'unique_observation');
  END;
  PERFORM pg_temp.ok('the failed call changed nothing: B holds no observation, the source is live, no audit row',
    (SELECT count(*) FROM public.vehicle_observations WHERE vehicle_id = '00000000-0000-0000-0000-0000000000b0') = 0
    AND (SELECT NOT is_superseded FROM public.vehicle_observations WHERE id = '00000000-0000-0000-0001-000000000001')
    AND (SELECT count(*) FROM public.reattribution_audit) = 0);
END $$;

-- 1. Baseline: what the frozen live writer does today for the calls that succeed (a NULL key part, and an image).
SELECT pg_temp.seed_obs('00000000-0000-0000-0001-000000000011', '00000000-0000-0000-0000-0000000000a0', NULL, 'hash-null-placeholder');
SELECT pg_temp.seed_img('00000000-0000-0000-0002-000000000011', '00000000-0000-0000-0000-0000000000a0');
DO $$ DECLARE r jsonb; cid uuid; BEGIN
  r := public.reattribute_observation('observation', '00000000-0000-0000-0001-000000000011', '00000000-0000-0000-0000-0000000000b0', 'contract baseline', '00000000-0000-0000-0000-0000000000e3');
  cid := (r ->> 'new_observation_id')::uuid;
  INSERT INTO baseline VALUES ('observation', pg_temp.obs_copy_shape(cid), pg_temp.obs_source_shape('00000000-0000-0000-0001-000000000011'),
    r, pg_temp.audit_shape('00000000-0000-0000-0001-000000000011'));
  r := public.reattribute_observation('image', '00000000-0000-0000-0002-000000000011', '00000000-0000-0000-0000-0000000000b0', 'contract baseline', '00000000-0000-0000-0000-0000000000e3');
  cid := (r ->> 'new_observation_id')::uuid;
  INSERT INTO baseline VALUES ('image', pg_temp.img_copy_shape(cid), pg_temp.img_source_shape('00000000-0000-0000-0002-000000000011'),
    r, pg_temp.audit_shape('00000000-0000-0000-0002-000000000011'));
  PERFORM pg_temp.ok('baseline captured from the frozen live writer', (SELECT count(*) FROM baseline) = 2);
END $$;

-- 1b. THE SECOND BREAK, reproduced on the frozen live writer: the target already holds the same observation (a NULL identifier, so the
-- index lets both rows live) and the writer copies the source onto it anyway.
SELECT pg_temp.seed_obs('00000000-0000-0000-0004-000000000001', '00000000-0000-0000-0000-0000000000a0', NULL, 'twin-hash-0');
SELECT pg_temp.seed_obs('00000000-0000-0000-0004-000000000002', '00000000-0000-0000-0000-0000000000b0', NULL, 'twin-hash-0');
DO $$ BEGIN
  PERFORM public.reattribute_observation('observation', '00000000-0000-0000-0004-000000000001', '00000000-0000-0000-0000-0000000000b0', 'contract', NULL);
  PERFORM pg_temp.ok('frozen live writer piles a second live copy of the same observation onto the target',
    (SELECT count(*) FROM public.vehicle_observations WHERE vehicle_id = '00000000-0000-0000-0000-0000000000b0'
       AND content_hash = 'twin-hash-0' AND NOT is_superseded) = 2);
END $$;

\ir ../migrations/20261006111500_reattribute_observation_existing_twin.sql

DO $$ DECLARE f text; a record; BEGIN
  f := md5(pg_get_functiondef('public.reattribute_observation(text,uuid,uuid,text,uuid)'::regprocedure));
  RAISE NOTICE 'post-migration fingerprint %', f;
  PERFORM pg_temp.ok('migration installs the expected body', f = '11ee320156c4847f36dbd53d81a8c119'); -- gitleaks:allow (fingerprint)
  SELECT proacl::text AS acl, prosecdef, proconfig::text AS config INTO a FROM pg_proc WHERE oid = 'public.reattribute_observation(text,uuid,uuid,text,uuid)'::regprocedure;
  PERFORM pg_temp.ok('migration leaves the ACL, security mode and settings alone',
    a.acl IS NOT DISTINCT FROM (SELECT acl FROM acl_before) AND a.prosecdef = (SELECT prosecdef FROM acl_before)
    AND a.config IS NOT DISTINCT FROM (SELECT config FROM acl_before));
END $$;

-- Re-running the migration is a no-op (the guard accepts the post-apply fingerprint).
\ir ../migrations/20261006111500_reattribute_observation_existing_twin.sql

DO $$ BEGIN
  PERFORM pg_temp.ok('re-applying keeps the same body',
    md5(pg_get_functiondef('public.reattribute_observation(text,uuid,uuid,text,uuid)'::regprocedure)) = '11ee320156c4847f36dbd53d81a8c119'); -- gitleaks:allow (fingerprint)
END $$;

-- (a) A move that works today is unchanged: same copy, same key, same audit, same result apart from the new flag. The target (B2) holds
-- nothing, so the row has no twin there; the baseline copy sits on B.
SELECT pg_temp.seed_obs('00000000-0000-0000-0001-000000000012', '00000000-0000-0000-0000-0000000000a0', NULL, 'hash-null-placeholder');
DO $$ DECLARE r jsonb; cid uuid; b record; n_before int; BEGIN
  SELECT count(*) INTO n_before FROM public.vehicle_observations;
  r := public.reattribute_observation('observation', '00000000-0000-0000-0001-000000000012', '00000000-0000-0000-0000-0000000000b1', 'contract baseline', '00000000-0000-0000-0000-0000000000e3');
  cid := (r ->> 'new_observation_id')::uuid;
  SELECT * INTO b FROM baseline WHERE label = 'observation';
  PERFORM pg_temp.ok('(a) a normal move still inserts exactly one copy, on the target', (SELECT count(*) FROM public.vehicle_observations) = n_before + 1
    AND (SELECT vehicle_id FROM public.vehicle_observations WHERE id = cid) = '00000000-0000-0000-0000-0000000000b1');
  PERFORM pg_temp.ok('(a) the copy is identical to the frozen writer''s copy, key included', pg_temp.obs_copy_shape(cid) = b.copy_shape);
  PERFORM pg_temp.ok('(a) the source is superseded exactly as before', pg_temp.obs_source_shape('00000000-0000-0000-0001-000000000012') = b.source_shape
    AND (SELECT superseded_by FROM public.vehicle_observations WHERE id = '00000000-0000-0000-0001-000000000012') = cid
    AND (SELECT superseded_at IS NOT NULL FROM public.vehicle_observations WHERE id = '00000000-0000-0000-0001-000000000012'));
  PERFORM pg_temp.ok('(a) one audit row, same shape, naming the copy',
    (SELECT count(*) FROM public.reattribution_audit WHERE old_observation_id = '00000000-0000-0000-0001-000000000012') = 1
    AND pg_temp.audit_shape('00000000-0000-0000-0001-000000000012') = b.audit
    AND (SELECT new_observation_id FROM public.reattribution_audit WHERE old_observation_id = '00000000-0000-0000-0001-000000000012') = cid);
  PERFORM pg_temp.ok('(a) same result apart from the new flag, which is false',
    pg_temp.result_shape(r) = pg_temp.result_shape(b.result)
    AND pg_temp.result_keys(r - 'merged_into_existing') = pg_temp.result_keys(b.result)
    AND (r ? 'merged_into_existing') AND (r ->> 'merged_into_existing') = 'false' AND (r ->> 'success') = 'true');
END $$;

-- (c) THE BREAK, after the migration: the same fully keyed row that raised above now moves.
DO $$ DECLARE r jsonb; cid uuid; c record; s record; derived text; n_before int; BEGIN
  SELECT count(*) INTO n_before FROM public.vehicle_observations;
  r := public.reattribute_observation('observation', '00000000-0000-0000-0001-000000000001', '00000000-0000-0000-0000-0000000000b0', 'contract', '00000000-0000-0000-0000-0000000000e3');
  cid := (r ->> 'new_observation_id')::uuid;
  SELECT * INTO c FROM public.vehicle_observations WHERE id = cid;
  SELECT * INTO s FROM public.vehicle_observations WHERE id = '00000000-0000-0000-0001-000000000001';
  derived := encode(sha256(convert_to('hash-placeholder-1:reattributed:' || '00000000-0000-0000-0000-0000000000a0', 'UTF8')), 'hex');
  PERFORM pg_temp.ok('(c) the call that used to raise succeeds and merged_into_existing is false',
    (r ->> 'success') = 'true' AND (r ->> 'merged_into_existing') = 'false');
  PERFORM pg_temp.ok('(c) exactly one copy was written, on the target, carrying lineage',
    (SELECT count(*) FROM public.vehicle_observations) = n_before + 1
    AND c.vehicle_id = '00000000-0000-0000-0000-0000000000b0' AND c.merged_from_vehicle_id = '00000000-0000-0000-0000-0000000000a0'
    AND c.is_superseded IS NOT TRUE AND c.superseded_by IS NULL);
  PERFORM pg_temp.ok('(c) the copy keeps source, identifier, kind and content, and carries the derived hash',
    c.source_id = s.source_id AND c.source_identifier = s.source_identifier AND c.kind = s.kind
    AND c.content_text = s.content_text AND c.structured_data = s.structured_data AND c.source_url = s.source_url
    AND c.observed_at = s.observed_at AND c.rank = s.rank
    AND c.content_hash = derived AND c.content_hash <> s.content_hash AND c.content_hash IS NOT NULL);
  PERFORM pg_temp.ok('(c) the source keeps its key and is superseded toward the copy, never deleted',
    s.content_hash = 'hash-placeholder-1' AND s.vehicle_id = '00000000-0000-0000-0000-0000000000a0'
    AND s.is_superseded AND s.superseded_by = cid AND s.superseded_at IS NOT NULL);
  PERFORM pg_temp.ok('(c) one audit row names the old row, the copy, both vehicles, the reason and the actor',
    (SELECT count(*) FROM public.reattribution_audit WHERE old_observation_id = s.id) = 1
    AND EXISTS (SELECT 1 FROM public.reattribution_audit a WHERE a.old_observation_id = s.id AND a.new_observation_id = cid
      AND a.observation_type = 'observation' AND a.old_vehicle_id = '00000000-0000-0000-0000-0000000000a0'
      AND a.new_vehicle_id = '00000000-0000-0000-0000-0000000000b0' AND a.reason = 'contract'
      AND a.actor_user_id = '00000000-0000-0000-0000-0000000000e3'));
  r := public.reattribute_observation('observation', s.id, '00000000-0000-0000-0000-0000000000b0', 'contract', NULL);
  PERFORM pg_temp.ok('(c) a second call is refused as already superseded and writes nothing',
    (r ->> 'success') = 'false' AND (r ->> 'error') = 'already_superseded'
    AND (SELECT count(*) FROM public.vehicle_observations) = n_before + 1
    AND (SELECT count(*) FROM public.reattribution_audit WHERE old_observation_id = s.id) = 1);
END $$;

-- (f) The shape that failed in production: 20 observations in one statement, 18 fully keyed and 2 with a NULL key part.
SELECT pg_temp.seed_obs(('00000000-0000-0000-0003-' || lpad(i::text, 12, '0'))::uuid, '00000000-0000-0000-0000-0000000000c0',
  CASE WHEN i > 18 THEN NULL ELSE 'bulk-lot-' || i END, 'bulk-hash-' || i) FROM generate_series(1, 20) i;
DO $$ DECLARE n_ok int; BEGIN
  SELECT count(*) INTO n_ok FROM (
    SELECT public.reattribute_observation('observation', o.id, '00000000-0000-0000-0000-0000000000b0', 'contract bulk', NULL) AS r
      FROM public.vehicle_observations o WHERE o.vehicle_id = '00000000-0000-0000-0000-0000000000c0' ORDER BY o.id) q
   WHERE (q.r ->> 'success') = 'true' AND (q.r ->> 'merged_into_existing') = 'false';
  PERFORM pg_temp.ok('(f) all 20 observations moved in one statement', n_ok = 20);
  PERFORM pg_temp.ok('(f) 20 copies live on the target with lineage, none left live on the source',
    (SELECT count(*) FROM public.vehicle_observations WHERE vehicle_id = '00000000-0000-0000-0000-0000000000b0'
       AND merged_from_vehicle_id = '00000000-0000-0000-0000-0000000000c0' AND NOT is_superseded) = 20
    AND (SELECT count(*) FROM public.vehicle_observations WHERE vehicle_id = '00000000-0000-0000-0000-0000000000c0' AND NOT is_superseded) = 0
    AND (SELECT count(*) FROM public.vehicle_observations WHERE vehicle_id = '00000000-0000-0000-0000-0000000000c0' AND is_superseded) = 20);
  PERFORM pg_temp.ok('(f) the 18 fully keyed copies carry derived hashes and stay fully keyed; the 2 NULL-keyed copies keep their key',
    (SELECT count(*) FROM public.vehicle_observations s JOIN public.vehicle_observations c ON c.id = s.superseded_by
       WHERE s.vehicle_id = '00000000-0000-0000-0000-0000000000c0' AND s.source_identifier IS NOT NULL
         AND c.content_hash = encode(sha256(convert_to(s.content_hash || ':reattributed:' || '00000000-0000-0000-0000-0000000000c0', 'UTF8')), 'hex')
         AND c.content_hash <> s.content_hash AND c.source_id IS NOT NULL AND c.source_identifier IS NOT NULL) = 18
    AND (SELECT count(*) FROM public.vehicle_observations s JOIN public.vehicle_observations c ON c.id = s.superseded_by
       WHERE s.vehicle_id = '00000000-0000-0000-0000-0000000000c0' AND s.source_identifier IS NULL
         AND c.content_hash = s.content_hash AND c.source_identifier IS NULL) = 2);
  PERFORM pg_temp.ok('(f) 20 audit rows, one per source, and no source key was altered',
    (SELECT count(*) FROM public.reattribution_audit WHERE reason = 'contract bulk') = 20
    AND (SELECT count(*) FROM public.vehicle_observations s WHERE s.vehicle_id = '00000000-0000-0000-0000-0000000000c0'
          AND s.content_hash = 'bulk-hash-' || right(s.id::text, 12)::int) = 20);
END $$;

-- (d) The image branch is unchanged: same copy, same audit, same result with no new key.
SELECT pg_temp.seed_img('00000000-0000-0000-0002-000000000012', '00000000-0000-0000-0000-0000000000a0');
DO $$ DECLARE r jsonb; cid uuid; b record; BEGIN
  r := public.reattribute_observation('image', '00000000-0000-0000-0002-000000000012', '00000000-0000-0000-0000-0000000000b0', 'contract baseline', '00000000-0000-0000-0000-0000000000e3');
  cid := (r ->> 'new_observation_id')::uuid;
  SELECT * INTO b FROM baseline WHERE label = 'image';
  PERFORM pg_temp.ok('(d) the image copy is identical to the frozen writer''s copy', pg_temp.img_copy_shape(cid) = b.copy_shape
    AND (SELECT merged_from_vehicle_id FROM public.vehicle_images WHERE id = cid) = '00000000-0000-0000-0000-0000000000a0'
    AND (SELECT vision_gate_status FROM public.vehicle_images WHERE id = cid) = 'pending');
  PERFORM pg_temp.ok('(d) the source image is superseded toward the copy', pg_temp.img_source_shape('00000000-0000-0000-0002-000000000012') = b.source_shape
    AND (SELECT superseded_by FROM public.vehicle_images WHERE id = '00000000-0000-0000-0002-000000000012') = cid);
  PERFORM pg_temp.ok('(d) same audit shape, and the image result has exactly the keys it had before',
    pg_temp.audit_shape('00000000-0000-0000-0002-000000000012') = b.audit
    AND pg_temp.result_shape(r) = pg_temp.result_shape(b.result) AND pg_temp.result_keys(r) = pg_temp.result_keys(b.result)
    AND NOT (r ? 'merged_into_existing'));
END $$;

-- (e) Early returns and refusals are untouched.
DO $$ DECLARE r jsonb; cid uuid; refused boolean := false; n_obs int; n_audit int; BEGIN
  cid := (SELECT id FROM public.vehicle_observations WHERE vehicle_id = '00000000-0000-0000-0000-0000000000b0' AND NOT is_superseded ORDER BY id LIMIT 1);
  r := public.reattribute_observation('observation', cid, '00000000-0000-0000-0000-0000000000b0', 'contract', NULL);
  PERFORM pg_temp.ok('(e) moving onto the vehicle it is already on is refused without writing',
    (r ->> 'success') = 'false' AND (r ->> 'error') = 'target_same_as_current' AND NOT (r ? 'merged_into_existing'));
  BEGIN PERFORM public.reattribute_observation('observation', cid, '00000000-0000-0000-0000-0000000000d0', 'contract', NULL);
    RAISE EXCEPTION 'Contract failed: a missing target vehicle was accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'target vehicle % does not exist' THEN RAISE; END IF; RAISE NOTICE 'PASS (e) missing target vehicle refused'; END;
  -- The live not-found check never fires (SELECT ... INTO leaves the flag NULL when no row matches), so a missing observation is
  -- refused only by the audit row's NOT NULL. The contract pins that it is still refused and writes nothing, not the message.
  n_obs := (SELECT count(*) FROM public.vehicle_observations);
  n_audit := (SELECT count(*) FROM public.reattribution_audit);
  BEGIN PERFORM public.reattribute_observation('observation', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a0', 'contract', NULL);
  EXCEPTION WHEN OTHERS THEN refused := true; END;
  PERFORM pg_temp.ok('(e) a missing observation is still refused and nothing is written',
    refused AND (SELECT count(*) FROM public.vehicle_observations) = n_obs AND (SELECT count(*) FROM public.reattribution_audit) = n_audit);
  BEGIN PERFORM public.reattribute_observation('comment', cid, '00000000-0000-0000-0000-0000000000a0', 'contract', NULL);
    RAISE EXCEPTION 'Contract failed: an unsupported type was accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'observation_type must be image or observation%' THEN RAISE; END IF; RAISE NOTICE 'PASS (e) unsupported type refused'; END;
END $$;

-- (g) A fully keyed row cannot have a twin: under the live index a same-key row on the target cannot exist beside its source.
DO $$ DECLARE c text; BEGIN
  BEGIN
    PERFORM pg_temp.seed_obs('00000000-0000-0000-0001-000000000099', '00000000-0000-0000-0000-0000000000b0', 'lot-placeholder-1', 'hash-placeholder-1');
    RAISE EXCEPTION 'Contract failed: the live index accepted a same-key twin beside its source';
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS c = CONSTRAINT_NAME;
    PERFORM pg_temp.ok('(g) under the live index a fully keyed row on the target cannot exist beside its source', c = 'unique_observation');
  END;
END $$;

-- (b) THE TARGET ALREADY HOLDS THE SAME OBSERVATION: a live row of the same kind and content hash whose source_id and source_identifier
-- are the same, a NULL matching a NULL. Only NULL-keyed rows can be twins (the index lets both live); the source is superseded toward
-- the twin and nothing is copied.
SELECT pg_temp.seed_obs('00000000-0000-0000-0004-000000000011', '00000000-0000-0000-0000-0000000000a0', NULL, 'twin-hash-1');
SELECT pg_temp.seed_obs('00000000-0000-0000-0004-000000000012', '00000000-0000-0000-0000-0000000000b0', NULL, 'twin-hash-1');
DO $$ DECLARE r jsonb; n_obs int; n_audit int; twin_before jsonb; BEGIN
  SELECT count(*) INTO n_obs FROM public.vehicle_observations;
  SELECT count(*) INTO n_audit FROM public.reattribution_audit;
  twin_before := to_jsonb((SELECT o FROM public.vehicle_observations o WHERE o.id = '00000000-0000-0000-0004-000000000012'));
  r := public.reattribute_observation('observation', '00000000-0000-0000-0004-000000000011', '00000000-0000-0000-0000-0000000000b0', 'contract twin', '00000000-0000-0000-0000-0000000000e3');
  PERFORM pg_temp.ok('(b) a live twin on the target: the call succeeds and reports merged_into_existing true',
    (r ->> 'success') = 'true' AND (r ->> 'merged_into_existing') = 'true'
    AND (r ->> 'new_observation_id') = '00000000-0000-0000-0004-000000000012' AND (r ->> 'new_vehicle_id') = '00000000-0000-0000-0000-0000000000b0'
    AND (r ->> 'merged_from_vehicle_id') = '00000000-0000-0000-0000-0000000000a0');
  PERFORM pg_temp.ok('(b) no row was inserted', (SELECT count(*) FROM public.vehicle_observations) = n_obs);
  PERFORM pg_temp.ok('(b) the source is superseded toward the twin, key and content untouched, never deleted',
    (SELECT is_superseded AND superseded_by = '00000000-0000-0000-0004-000000000012' AND superseded_at IS NOT NULL
        AND vehicle_id = '00000000-0000-0000-0000-0000000000a0' AND content_hash = 'twin-hash-1' AND source_identifier IS NULL
       FROM public.vehicle_observations WHERE id = '00000000-0000-0000-0004-000000000011'));
  PERFORM pg_temp.ok('(b) the twin is not modified',
    to_jsonb((SELECT o FROM public.vehicle_observations o WHERE o.id = '00000000-0000-0000-0004-000000000012')) = twin_before);
  PERFORM pg_temp.ok('(b) one audit row names the twin as the new observation',
    (SELECT count(*) FROM public.reattribution_audit) = n_audit + 1
    AND EXISTS (SELECT 1 FROM public.reattribution_audit a WHERE a.old_observation_id = '00000000-0000-0000-0004-000000000011'
      AND a.new_observation_id = '00000000-0000-0000-0004-000000000012' AND a.observation_type = 'observation'
      AND a.old_vehicle_id = '00000000-0000-0000-0000-0000000000a0' AND a.new_vehicle_id = '00000000-0000-0000-0000-0000000000b0'
      AND a.reason = 'contract twin' AND a.actor_user_id = '00000000-0000-0000-0000-0000000000e3'));
  r := public.reattribute_observation('observation', '00000000-0000-0000-0004-000000000011', '00000000-0000-0000-0000-0000000000b0', 'contract twin', NULL);
  PERFORM pg_temp.ok('(b) a second call is refused as already superseded and writes nothing',
    (r ->> 'error') = 'already_superseded' AND (SELECT count(*) FROM public.reattribution_audit) = n_audit + 1
    AND (SELECT count(*) FROM public.vehicle_observations) = n_obs);
END $$;
-- a NULL source_id matches a NULL source_id
SELECT pg_temp.seed_obs('00000000-0000-0000-0004-000000000021', '00000000-0000-0000-0000-0000000000a0', 'twin-lot-3', 'twin-hash-3', 'listing', NULL);
SELECT pg_temp.seed_obs('00000000-0000-0000-0004-000000000022', '00000000-0000-0000-0000-0000000000b0', 'twin-lot-3', 'twin-hash-3', 'listing', NULL);
DO $$ DECLARE r jsonb; n_obs int; BEGIN
  SELECT count(*) INTO n_obs FROM public.vehicle_observations;
  r := public.reattribute_observation('observation', '00000000-0000-0000-0004-000000000021', '00000000-0000-0000-0000-0000000000b0', 'contract twin', NULL);
  PERFORM pg_temp.ok('(b) a NULL source_id matches a NULL source_id: merged, nothing inserted',
    (r ->> 'merged_into_existing') = 'true' AND (r ->> 'new_observation_id') = '00000000-0000-0000-0004-000000000022'
    AND (SELECT count(*) FROM public.vehicle_observations) = n_obs);
END $$;
-- a superseded row is not a twin
SELECT pg_temp.seed_obs('00000000-0000-0000-0004-000000000031', '00000000-0000-0000-0000-0000000000a0', NULL, 'twin-hash-4');
SELECT pg_temp.seed_obs('00000000-0000-0000-0004-000000000032', '00000000-0000-0000-0000-0000000000b0', NULL, 'twin-hash-4');
UPDATE public.vehicle_observations SET is_superseded = true WHERE id = '00000000-0000-0000-0004-000000000032';
DO $$ DECLARE r jsonb; n_obs int; BEGIN
  SELECT count(*) INTO n_obs FROM public.vehicle_observations;
  r := public.reattribute_observation('observation', '00000000-0000-0000-0004-000000000031', '00000000-0000-0000-0000-0000000000b0', 'contract twin', NULL);
  PERFORM pg_temp.ok('(b) a superseded row is not a twin: a copy is written, key unchanged, and merged_into_existing is false',
    (r ->> 'merged_into_existing') = 'false' AND (r ->> 'new_observation_id') <> '00000000-0000-0000-0004-000000000032'
    AND (SELECT count(*) FROM public.vehicle_observations) = n_obs + 1
    AND (SELECT content_hash = 'twin-hash-4' AND source_identifier IS NULL FROM public.vehicle_observations WHERE id = (r ->> 'new_observation_id')::uuid));
END $$;
-- a missing content hash never matches
SELECT pg_temp.seed_obs('00000000-0000-0000-0004-000000000041', '00000000-0000-0000-0000-0000000000a0', NULL, NULL);
SELECT pg_temp.seed_obs('00000000-0000-0000-0004-000000000042', '00000000-0000-0000-0000-0000000000b0', NULL, NULL);
DO $$ DECLARE r jsonb; n_obs int; BEGIN
  SELECT count(*) INTO n_obs FROM public.vehicle_observations;
  r := public.reattribute_observation('observation', '00000000-0000-0000-0004-000000000041', '00000000-0000-0000-0000-0000000000b0', 'contract twin', NULL);
  PERFORM pg_temp.ok('(b) a missing content hash never matches: a copy is written and merged_into_existing is false',
    (r ->> 'merged_into_existing') = 'false' AND (SELECT count(*) FROM public.vehicle_observations) = n_obs + 1);
END $$;
-- a different identifier is a different observation, even with the same hash (the fully keyed source gets a derived hash)
SELECT pg_temp.seed_obs('00000000-0000-0000-0004-000000000051', '00000000-0000-0000-0000-0000000000a0', 'twin-lot-6a', 'twin-hash-6');
SELECT pg_temp.seed_obs('00000000-0000-0000-0004-000000000052', '00000000-0000-0000-0000-0000000000b0', 'twin-lot-6b', 'twin-hash-6');
DO $$ DECLARE r jsonb; n_obs int; BEGIN
  SELECT count(*) INTO n_obs FROM public.vehicle_observations;
  r := public.reattribute_observation('observation', '00000000-0000-0000-0004-000000000051', '00000000-0000-0000-0000-0000000000b0', 'contract twin', NULL);
  PERFORM pg_temp.ok('(b) a different identifier is not a twin: a copy is written under a derived hash',
    (r ->> 'merged_into_existing') = 'false' AND (SELECT count(*) FROM public.vehicle_observations) = n_obs + 1
    AND (SELECT content_hash <> 'twin-hash-6' AND source_identifier = 'twin-lot-6a' FROM public.vehicle_observations WHERE id = (r ->> 'new_observation_id')::uuid));
END $$;
-- a NULL identifier does not match a present one
SELECT pg_temp.seed_obs('00000000-0000-0000-0004-000000000061', '00000000-0000-0000-0000-0000000000a0', NULL, 'twin-hash-7');
SELECT pg_temp.seed_obs('00000000-0000-0000-0004-000000000062', '00000000-0000-0000-0000-0000000000b0', 'twin-lot-7', 'twin-hash-7');
DO $$ DECLARE r jsonb; n_obs int; BEGIN
  SELECT count(*) INTO n_obs FROM public.vehicle_observations;
  r := public.reattribute_observation('observation', '00000000-0000-0000-0004-000000000061', '00000000-0000-0000-0000-0000000000b0', 'contract twin', NULL);
  PERFORM pg_temp.ok('(b) a NULL identifier does not match a present one: a copy is written, key unchanged',
    (r ->> 'merged_into_existing') = 'false' AND (SELECT count(*) FROM public.vehicle_observations) = n_obs + 1
    AND (SELECT content_hash = 'twin-hash-7' AND source_identifier IS NULL FROM public.vehicle_observations WHERE id = (r ->> 'new_observation_id')::uuid));
END $$;

-- the same hash under a different kind is a different observation
SELECT pg_temp.seed_obs('00000000-0000-0000-0004-000000000071', '00000000-0000-0000-0000-0000000000a0', NULL, 'twin-hash-8', 'comment');
SELECT pg_temp.seed_obs('00000000-0000-0000-0004-000000000072', '00000000-0000-0000-0000-0000000000b0', NULL, 'twin-hash-8', 'listing');
DO $$ DECLARE r jsonb; n_obs int; BEGIN
  SELECT count(*) INTO n_obs FROM public.vehicle_observations;
  r := public.reattribute_observation('observation', '00000000-0000-0000-0004-000000000071', '00000000-0000-0000-0000-0000000000b0', 'contract twin', NULL);
  PERFORM pg_temp.ok('(b) a different kind is not a twin: a copy is written',
    (r ->> 'merged_into_existing') = 'false' AND (SELECT count(*) FROM public.vehicle_observations) = n_obs + 1
    AND (SELECT kind = 'comment' FROM public.vehicle_observations WHERE id = (r ->> 'new_observation_id')::uuid));
END $$;
-- the same observation on a third vehicle is not a twin on the target
SELECT pg_temp.seed_obs('00000000-0000-0000-0004-000000000081', '00000000-0000-0000-0000-0000000000a0', NULL, 'twin-hash-9');
SELECT pg_temp.seed_obs('00000000-0000-0000-0004-000000000082', '00000000-0000-0000-0000-0000000000c0', NULL, 'twin-hash-9');
DO $$ DECLARE r jsonb; n_obs int; BEGIN
  SELECT count(*) INTO n_obs FROM public.vehicle_observations;
  r := public.reattribute_observation('observation', '00000000-0000-0000-0004-000000000081', '00000000-0000-0000-0000-0000000000b0', 'contract twin', NULL);
  PERFORM pg_temp.ok('(b) a live row on another vehicle is not a twin on the target: a copy is written there',
    (r ->> 'merged_into_existing') = 'false' AND (SELECT count(*) FROM public.vehicle_observations) = n_obs + 1
    AND (SELECT vehicle_id = '00000000-0000-0000-0000-0000000000b0' FROM public.vehicle_observations WHERE id = (r ->> 'new_observation_id')::uuid));
END $$;
-- a different (present) source is a different observation, even with the same identifier and hash
SELECT pg_temp.seed_obs('00000000-0000-0000-0004-000000000091', '00000000-0000-0000-0000-0000000000a0', NULL, 'twin-hash-10');
SELECT pg_temp.seed_obs('00000000-0000-0000-0004-000000000092', '00000000-0000-0000-0000-0000000000b0', NULL, 'twin-hash-10', 'listing', '00000000-0000-0000-0000-0000000000f2');
DO $$ DECLARE r jsonb; n_obs int; BEGIN
  SELECT count(*) INTO n_obs FROM public.vehicle_observations;
  r := public.reattribute_observation('observation', '00000000-0000-0000-0004-000000000091', '00000000-0000-0000-0000-0000000000b0', 'contract twin', NULL);
  PERFORM pg_temp.ok('(b) a different source is not a twin: a copy is written',
    (r ->> 'merged_into_existing') = 'false' AND (SELECT count(*) FROM public.vehicle_observations) = n_obs + 1);
END $$;

-- Drift: a body that is neither the live fingerprint nor the migrated one is refused and nothing is replaced.
CREATE OR REPLACE FUNCTION public.reattribute_observation(p_observation_type text, p_observation_id uuid, p_target_vehicle_id uuid, p_reason text, p_actor_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql AS $function$ BEGIN RETURN jsonb_build_object('drifted', true); END; $function$;
\echo expected: the next ERROR is the drift guard of the migration refusing a body it does not recognise
\set ON_ERROR_STOP off
\ir ../migrations/20261006111500_reattribute_observation_existing_twin.sql
\set ON_ERROR_STOP on
DO $$ BEGIN
  PERFORM pg_temp.ok('drift guard refused the unknown body and replaced nothing',
    public.reattribute_observation('observation', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a0', 'contract') = jsonb_build_object('drifted', true));
END $$;

SELECT 'reattribute observation existing twin contract: all passed' AS result;
