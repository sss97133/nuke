-- Isolated PostgreSQL 17 contract for 20261122002500_relink_override_signed_in_only.sql, applied after
-- 20261121234500_relink_testimony_confirms_move.sql on the same live fixture as test_relink_testimony_confirms_move.sql
-- (relink_testimony's five-argument body, its jsonb overload and the gate trigger verbatim, md5-checked). Synthetic rows.
-- Cases: every case of the earlier contract, with the override now made by the signed-in owner as the actor; plus
--   * a service call (no auth.uid()) with an override on a rejected_personal photo is refused (gate_rejected);
--   * a service call with an override on a rejected_misattributed photo is refused, its message names an owner
--     confirmation or an unfile, and user_confirmed_vehicle stays false with nothing written;
--   * the signed-in owner's override sets user_confirmed_vehicle with _by = his auth.uid();
--   * a signed-in user who is not the actor is refused (42501);
--   * re-applying the migration changes nothing.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
     OR to_regclass('public.vehicle_images') IS NOT NULL
     OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty, disposable dm_refinement_* database';
  END IF;
END $$;
SET statement_timeout = '60s';
SET lock_timeout = '3s';
SET TimeZone = 'UTC';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') $$;

CREATE TYPE public.vision_gate_status AS ENUM ('pending','approved','rejected_personal','rejected_misattributed','review_needed');
CREATE TABLE public.vehicles(id uuid PRIMARY KEY, deleted_at timestamptz, status text);
CREATE TABLE public.vehicle_images(id uuid PRIMARY KEY, vehicle_id uuid, user_id uuid, file_hash text,
  is_primary boolean DEFAULT false, is_document boolean, is_duplicate boolean, is_superseded boolean DEFAULT false,
  merged_from_vehicle_id uuid, vision_gate_status public.vision_gate_status DEFAULT 'pending',
  vision_gate_agent_reasoning text, user_confirmed_vehicle boolean DEFAULT false, user_confirmed_vehicle_by uuid,
  user_confirmed_vehicle_at timestamptz, is_approved boolean, approval_status text, updated_at timestamptz DEFAULT now());
CREATE UNIQUE INDEX idx_unique_vehicle_file_hash ON public.vehicle_images USING btree (vehicle_id, file_hash)
  WHERE ((file_hash IS NOT NULL) AND (vehicle_id IS NOT NULL) AND (COALESCE(is_superseded, false) = false));
CREATE TABLE public.vehicle_observations(id uuid PRIMARY KEY, vehicle_id uuid, merged_from_vehicle_id uuid,
  subject_type text, subject_id uuid, auction_event_id uuid);
CREATE TABLE public.auction_events(id uuid PRIMARY KEY, vehicle_id uuid);
CREATE TABLE public.reattribution_audit(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), observation_type text NOT NULL,
  old_observation_id uuid NOT NULL, old_vehicle_id uuid, new_observation_id uuid NOT NULL, new_vehicle_id uuid,
  reason text NOT NULL, actor_user_id uuid, created_at timestamptz DEFAULT now());
CREATE TABLE public.photo_gate_unfile_log(id bigserial PRIMARY KEY, image_id uuid, user_id uuid, action text, gate text,
  old_vehicle_id uuid, attempted_vehicle_id uuid, old_is_primary boolean, gate_reasoning text, before_image jsonb,
  run text, created_at timestamptz DEFAULT now(), reverted_at timestamptz);
CREATE TABLE public.image_vehicle_mismatches(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), image_id uuid,
  current_vehicle_id uuid, validation_status text, mismatch_reason text, mismatch_source text, resolved boolean,
  resolved_at timestamptz, resolution_action text, resolution_notes text);
CREATE FUNCTION public.user_can_edit_vehicle(p_vehicle_id uuid, p_user_id uuid) RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT true $$;
CREATE FUNCTION public.t_assert(v boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'PASS: %', label; END $$;

-- The gate trigger, verbatim (live 2026-11-21; drift, in no migration).
CREATE OR REPLACE FUNCTION public.enforce_vision_gate_filing()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF COALESCE(NEW.user_confirmed_vehicle, false) THEN RETURN NEW; END IF;
  IF NEW.vehicle_id IS DISTINCT FROM OLD.vehicle_id THEN
    INSERT INTO public.photo_gate_unfile_log(image_id,user_id,action,gate,old_vehicle_id,attempted_vehicle_id,old_is_primary,gate_reasoning,run)
    VALUES (NEW.id,NEW.user_id,'blocked_filing',NEW.vision_gate_status::text,OLD.vehicle_id,NEW.vehicle_id,OLD.is_primary,left(NEW.vision_gate_agent_reasoning,500),'trigger');
    NEW.vehicle_id := OLD.vehicle_id;
    NEW.is_primary := OLD.is_primary;
    RETURN NEW;
  END IF;
  INSERT INTO public.photo_gate_unfile_log(image_id,user_id,action,gate,old_vehicle_id,old_is_primary,gate_reasoning,before_image,run)
  VALUES (NEW.id,NEW.user_id,'unfiled',NEW.vision_gate_status::text,OLD.vehicle_id,OLD.is_primary,left(NEW.vision_gate_agent_reasoning,500),jsonb_build_object('vehicle_id',OLD.vehicle_id,'is_primary',OLD.is_primary,'is_approved',OLD.is_approved,'approval_status',OLD.approval_status,'vision_gate_status',OLD.vision_gate_status),'trigger');
  IF OLD.vehicle_id IS NOT NULL THEN
    INSERT INTO public.image_vehicle_mismatches(image_id,current_vehicle_id,validation_status,mismatch_reason,mismatch_source,resolved,resolved_at,resolution_action,resolution_notes)
    VALUES (NEW.id,OLD.vehicle_id,'mismatch','vision gate '||NEW.vision_gate_status::text||' while filed','ai_validation',true,now(),'removed_from_vehicle','auto-unfiled by enforce_vision_gate_filing; restore from photo_gate_unfile_log');
  END IF;
  NEW.vehicle_id := NULL;
  NEW.is_primary := false;
  RETURN NEW;
END $function$;
CREATE TRIGGER a05_trg_enforce_vision_gate_filing BEFORE UPDATE OF vision_gate_status, vehicle_id ON public.vehicle_images
  FOR EACH ROW WHEN (((new.vehicle_id IS NOT NULL) AND (new.vision_gate_status = ANY (ARRAY['rejected_misattributed'::vision_gate_status, 'rejected_personal'::vision_gate_status])) AND ((old.vision_gate_status IS DISTINCT FROM new.vision_gate_status) OR (old.vehicle_id IS DISTINCT FROM new.vehicle_id))))
  EXECUTE FUNCTION enforce_vision_gate_filing();

-- relink_testimony as live, both overloads (the context overload reads tables this fixture lacks).
CREATE OR REPLACE FUNCTION public.relink_testimony(p_observation_type text, p_observation_id uuid, p_target_vehicle_id uuid, p_reason text, p_actor_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_old_vehicle_id uuid;
  v_merged_from_vehicle_id uuid;
  v_is_primary boolean;
  v_file_hash text;
  v_demoted boolean := false;
BEGIN
  -- P3.7 identity check (2026-09-27): the actor is the caller (p_actor_user_id = auth.uid()) and can edit the target vehicle; stays SECURITY INVOKER so RLS still governs the source rows. Only end-user JWTs are judged; service_role and JWT-less sessions are exempt.
  IF coalesce(auth.role(), '') IN ('authenticated', 'anon') THEN
    IF auth.uid() IS NULL OR p_actor_user_id IS DISTINCT FROM auth.uid() OR NOT public.user_can_edit_vehicle(p_target_vehicle_id, auth.uid()) THEN
      RAISE EXCEPTION 'relink_testimony: you can only relink as yourself onto a vehicle you can edit' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'relink_testimony: attribution requires a reason' USING ERRCODE = '22023';
  END IF;
  IF p_observation_type NOT IN ('image', 'observation') THEN
    RAISE EXCEPTION 'observation_type must be image or observation, got %', p_observation_type;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM vehicles WHERE id = p_target_vehicle_id AND deleted_at IS NULL AND status IS DISTINCT FROM 'merged') THEN
    RAISE EXCEPTION 'target vehicle % does not exist', p_target_vehicle_id;
  END IF;

  IF p_observation_type = 'image' THEN
    SELECT vehicle_id, COALESCE(is_primary, false), file_hash, merged_from_vehicle_id
      INTO v_old_vehicle_id, v_is_primary, v_file_hash, v_merged_from_vehicle_id
      FROM vehicle_images WHERE id = p_observation_id FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'image % not found', p_observation_id;
    END IF;

    IF v_old_vehicle_id IS NOT DISTINCT FROM p_target_vehicle_id THEN
      RETURN jsonb_build_object('success', true, 'duplicate', true, 'mode', 'already_attributed',
                                'observation_id', p_observation_id, 'vehicle_id', p_target_vehicle_id,
                                'merged_from_vehicle_id', v_merged_from_vehicle_id);
    END IF;

    -- Guard: (vehicle_id, file_hash) unique — content already on target.
    IF v_file_hash IS NOT NULL AND EXISTS (
      SELECT 1 FROM vehicle_images b
      WHERE b.vehicle_id = p_target_vehicle_id AND b.file_hash = v_file_hash
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'file_hash_exists_on_target',
                                'observation_id', p_observation_id);
    END IF;

    -- Guard: one-primary-per-vehicle unique index. Demote the MOVED row, never
    -- the target's existing primary (workflow state, not testimony content).
    IF v_is_primary AND EXISTS (
      SELECT 1 FROM vehicle_images b
      WHERE b.vehicle_id = p_target_vehicle_id
        AND b.is_primary = true
        AND COALESCE(b.is_document, false) = false
        AND COALESCE(b.is_duplicate, false) = false
    ) THEN
      v_demoted := true;
    END IF;

    UPDATE vehicle_images
       SET vehicle_id = p_target_vehicle_id,
           merged_from_vehicle_id = COALESCE(merged_from_vehicle_id, v_old_vehicle_id),
           is_primary = CASE WHEN v_demoted THEN false ELSE is_primary END,
           updated_at = NOW()
     WHERE id = p_observation_id
     RETURNING merged_from_vehicle_id INTO v_merged_from_vehicle_id;

  ELSE
    SELECT vehicle_id, merged_from_vehicle_id INTO v_old_vehicle_id, v_merged_from_vehicle_id
      FROM vehicle_observations WHERE id = p_observation_id FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'observation % not found', p_observation_id;
    END IF;

    IF v_old_vehicle_id IS NOT DISTINCT FROM p_target_vehicle_id THEN
      RETURN jsonb_build_object('success', true, 'duplicate', true, 'mode', 'already_attributed',
                                'observation_id', p_observation_id, 'vehicle_id', p_target_vehicle_id,
                                'merged_from_vehicle_id', v_merged_from_vehicle_id);
    END IF;

    IF EXISTS (
      SELECT 1 FROM vehicle_observations o JOIN auction_events e ON e.id = o.auction_event_id
      WHERE o.id = p_observation_id AND e.vehicle_id IS NOT NULL AND e.vehicle_id <> p_target_vehicle_id
    ) THEN
      RAISE EXCEPTION 'target chassis contradicts the typed market event' USING ERRCODE = '23514';
    END IF;

    UPDATE vehicle_observations
       SET vehicle_id = p_target_vehicle_id,
           merged_from_vehicle_id = COALESCE(merged_from_vehicle_id, v_old_vehicle_id),
           subject_id = CASE WHEN subject_type = 'vehicle' AND subject_id IS NOT NULL
             THEN p_target_vehicle_id ELSE subject_id END
     WHERE id = p_observation_id
     RETURNING merged_from_vehicle_id INTO v_merged_from_vehicle_id;
  END IF;

  INSERT INTO reattribution_audit (
    observation_type, old_observation_id, old_vehicle_id,
    new_observation_id, new_vehicle_id, reason, actor_user_id)
  VALUES (
    p_observation_type, p_observation_id, v_old_vehicle_id,
    p_observation_id, p_target_vehicle_id,
    p_reason || CASE WHEN v_demoted THEN ' [is_primary demoted: target already has a primary]' ELSE '' END,
    p_actor_user_id);

  RETURN jsonb_build_object(
    'success', true,
    'mode', 'relink_in_place',
    'observation_type', p_observation_type,
    'observation_id', p_observation_id,
    'old_vehicle_id', v_old_vehicle_id,
    'new_vehicle_id', p_target_vehicle_id,
    'merged_from_vehicle_id', v_merged_from_vehicle_id,
    'demoted_primary', v_demoted);
END;
$function$;
SET check_function_bodies = off;
CREATE OR REPLACE FUNCTION public.relink_testimony(p_observation_type text, p_observation_id uuid, p_target_vehicle_id uuid, p_reason text, p_actor_user_id uuid, p_context jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE o public.vehicle_observations%ROWTYPE; carrier uuid; presentation uuid; org uuid; receipt jsonb; changed boolean;
  publication_platform text; publication_video text; source_video text;
BEGIN
  IF coalesce(auth.role(),'') IN ('authenticated','anon') THEN RAISE EXCEPTION 'context binding requires service writer' USING ERRCODE='42501'; END IF;
  IF p_observation_type IS DISTINCT FROM 'observation' OR p_reason IS NULL OR btrim(p_reason)='' THEN RAISE EXCEPTION 'observation context and reason required' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_context) AS k WHERE k NOT IN ('publication_id','auction_event_id','organization_subject_id')) THEN
    RAISE EXCEPTION 'unknown context key' USING ERRCODE='22023'; END IF;
  SELECT * INTO o FROM public.vehicle_observations WHERE id=p_observation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'observation not found'; END IF;
  carrier:=coalesce((p_context->>'publication_id')::uuid,o.citation_publication_id);
  presentation:=coalesce((p_context->>'auction_event_id')::uuid,o.auction_event_id);
  org:=coalesce((p_context->>'organization_subject_id')::uuid,o.subject_organization_id);
  IF (o.citation_publication_id IS NOT NULL AND carrier IS DISTINCT FROM o.citation_publication_id) OR
    (o.auction_event_id IS NOT NULL AND presentation IS DISTINCT FROM o.auction_event_id) OR
    (o.subject_organization_id IS NOT NULL AND org IS DISTINCT FROM o.subject_organization_id) THEN
    RAISE EXCEPTION 'bound context is immutable; reviewed supersession required' USING ERRCODE='23514'; END IF;
  IF org IS NOT NULL AND (o.subject_type<>'organization' OR o.subject_id IS DISTINCT FROM org) THEN
    RAISE EXCEPTION 'typed organization must agree with existing subject' USING ERRCODE='23514'; END IF;
  IF carrier IS NOT NULL THEN
    SELECT platform,platform_id INTO publication_platform,publication_video FROM public.publications WHERE id=carrier;
    IF NOT FOUND THEN RAISE EXCEPTION 'publication not found' USING ERRCODE='23503'; END IF;
    source_video:=o.structured_data#>>'{media,video_id}';
    IF (publication_platform='youtube' AND source_video IS DISTINCT FROM publication_video) OR
      (o.source_identifier LIKE 'youtube:%' AND publication_platform IS DISTINCT FROM 'youtube') THEN
      RAISE EXCEPTION 'source video contradicts carrier publication' USING ERRCODE='23514'; END IF;
  END IF;
  changed:=carrier IS DISTINCT FROM o.citation_publication_id OR presentation IS DISTINCT FROM o.auction_event_id OR org IS DISTINCT FROM o.subject_organization_id;
  IF p_target_vehicle_id IS NOT NULL AND p_target_vehicle_id IS DISTINCT FROM o.vehicle_id THEN
    receipt:=public.relink_testimony(p_observation_type,p_observation_id,p_target_vehicle_id,p_reason,p_actor_user_id);
  END IF;
  IF NOT changed THEN RETURN coalesce(receipt,jsonb_build_object('success',true,'duplicate',true,'observation_id',o.id)); END IF;
  UPDATE public.vehicle_observations SET citation_publication_id=carrier,auction_event_id=presentation,
    subject_organization_id=org,context_bound_at=coalesce(context_bound_at,clock_timestamp()) WHERE id=o.id;
  IF receipt IS NULL THEN
    INSERT INTO public.reattribution_audit(observation_type,old_observation_id,old_vehicle_id,new_observation_id,new_vehicle_id,reason,actor_user_id)
      VALUES('observation',o.id,o.vehicle_id,o.id,o.vehicle_id,p_reason,p_actor_user_id);
  END IF;
  RETURN jsonb_build_object('success',true,'duplicate',false,'observation_id',o.id,'publication_id',carrier,'auction_event_id',presentation,'organization_subject_id',org);
END $function$;
RESET check_function_bodies;
REVOKE ALL ON FUNCTION public.relink_testimony(text,uuid,uuid,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.relink_testimony(text,uuid,uuid,text,uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.relink_testimony(text,uuid,uuid,text,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.relink_testimony(text,uuid,uuid,text,uuid,jsonb) TO service_role;
COMMENT ON FUNCTION public.relink_testimony(text,uuid,uuid,text,uuid) IS 'Sanctioned in-place testimony attribution: supports unbound rows, preserves all source evidence, locks one row, appends existing audit; same-target retry returns the same observation ID without another audit. Target must be live, actor/editor checks unchanged. C15.';
SELECT t_assert(md5(pg_get_functiondef('public.relink_testimony(text,uuid,uuid,text,uuid)'::regprocedure))
  = '0ad2ba6c3900a55247e883c046dcc17d', 'the fixture body is production''s (md5 read 2026-11-21)'); -- gitleaks:allow (function-definition fingerprint, not a secret)
SELECT t_assert(md5(pg_get_functiondef('public.enforce_vision_gate_filing()'::regprocedure))
  = '0e7f7ce81dd58e791e684e01947cffda', 'the gate function is production''s (md5 read 2026-11-21)'); -- gitleaks:allow (function-definition fingerprint, not a secret)

-- Vehicles A (source), B (target), C; actor U.
INSERT INTO vehicles(id) VALUES ('a0000000-0000-0000-0000-00000000000a'), ('b0000000-0000-0000-0000-00000000000b'),
  ('c0000000-0000-0000-0000-00000000000c');
INSERT INTO vehicle_images(id, vehicle_id, file_hash, vision_gate_status, user_confirmed_vehicle, is_primary) VALUES
  ('10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'h1', 'rejected_misattributed', false, false),
  ('10000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-00000000000a', 'h2', 'rejected_personal', false, false),
  ('10000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-00000000000a', 'h3', 'rejected_misattributed', true, false),
  ('10000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-00000000000a', 'h4', 'approved', false, false),
  ('10000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'h4', 'approved', false, false),
  ('10000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-00000000000a', 'h6', 'approved', false, false),
  ('10000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-00000000000a', 'h7', 'pending', false, false),
  ('10000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-00000000000a', 'h9', 'rejected_misattributed', false, false);
INSERT INTO vehicle_observations(id, vehicle_id, subject_type, subject_id) VALUES
  ('20000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'vehicle', 'a0000000-0000-0000-0000-00000000000a');

-- Before: the false success.
DO $$ DECLARE r jsonb; BEGIN
  r := relink_testimony('image', '10000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-00000000000b', 'before', NULL);
  PERFORM t_assert((r->>'success')::boolean, 'before: the live body reports success for a gate-rejected photo');
  PERFORM t_assert((SELECT vehicle_id FROM vehicle_images WHERE id = '10000000-0000-0000-0000-000000000009')
    = 'a0000000-0000-0000-0000-00000000000a', 'before: the trigger kept the photo on its old vehicle');
  PERFORM t_assert(EXISTS (SELECT FROM reattribution_audit WHERE old_observation_id = '10000000-0000-0000-0000-000000000009'
    AND new_vehicle_id = 'b0000000-0000-0000-0000-00000000000b'), 'before: an audit row records the move that did not happen');
  PERFORM t_assert(EXISTS (SELECT FROM photo_gate_unfile_log WHERE image_id = '10000000-0000-0000-0000-000000000009'
    AND action = 'blocked_filing'), 'before: the trigger logged blocked_filing');
END $$;
DELETE FROM reattribution_audit; DELETE FROM photo_gate_unfile_log;
UPDATE vehicle_images SET merged_from_vehicle_id = NULL WHERE id = '10000000-0000-0000-0000-000000000009';

\ir ../migrations/20261121234500_relink_testimony_confirms_move.sql
SELECT t_assert(md5(pg_get_functiondef('public.relink_testimony(text,uuid,uuid,text,uuid,text)'::regprocedure))
  = '0f755dbb76b82530e6e0dc7a033312bf', 'the 20261121234500 body is the live one (md5 read 2026-11-22)'); -- gitleaks:allow (function-definition fingerprint, not a secret)
\ir ../migrations/20261122002500_relink_override_signed_in_only.sql
INSERT INTO vehicle_images(id, vehicle_id, file_hash, vision_gate_status, user_confirmed_vehicle) VALUES
  ('10000000-0000-0000-0000-000000000012', 'a0000000-0000-0000-0000-00000000000a', 'h12', 'rejected_misattributed', false),
  ('10000000-0000-0000-0000-000000000013', 'a0000000-0000-0000-0000-00000000000a', 'h13', 'rejected_personal', false);

SELECT t_assert(to_regprocedure('public.relink_testimony(text,uuid,uuid,text,uuid)') IS NULL
  AND to_regprocedure('public.relink_testimony(text,uuid,uuid,text,uuid,text)') IS NOT NULL
  AND to_regprocedure('public.relink_testimony(text,uuid,uuid,text,uuid,jsonb)') IS NOT NULL,
  'the five-argument function is replaced by the six-argument one; the context overload stays');
SELECT t_assert((SELECT NOT p.prosecdef AND p.proconfig = ARRAY['search_path=public, pg_temp']
    AND pg_get_userbyid(p.proowner) = current_user
    AND (SELECT array_agg(a ORDER BY a) FROM unnest(p.proacl::text[]) a)
      = (SELECT array_agg(a ORDER BY a) FROM unnest(ARRAY['authenticated=X/' || current_user, 'service_role=X/' || current_user,
          current_user || '=X/' || current_user]) a)
    AND obj_description(p.oid, 'pg_proc') LIKE 'Sanctioned in-place testimony attribution: supports unbound rows%'
  FROM pg_proc p WHERE p.oid = 'public.relink_testimony(text,uuid,uuid,text,uuid,text)'::regprocedure),
  'security invoker, search_path, owner, ACL (authenticated + service_role, no PUBLIC/anon) and comment kept');
SELECT t_assert(md5(pg_get_functiondef('public.relink_testimony(text,uuid,uuid,text,uuid,jsonb)'::regprocedure))
  = '143d6c5924edf2877e858762aef7de8c', 'the context overload is untouched (md5 as live)'); -- gitleaks:allow (function-definition fingerprint, not a secret)

-- Gate-rejected, no override: refused, nothing written.
DO $$ DECLARE r jsonb; BEGIN
  r := relink_testimony('image', '10000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000b', 'no override', NULL);
  PERFORM t_assert(r->>'success' = 'false' AND r->>'error' = 'gate_rejected' AND r->>'message' LIKE '%p_gate_override_reason%',
    'a gate-rejected photo is refused with gate_rejected');
  PERFORM t_assert((SELECT vehicle_id FROM vehicle_images WHERE id = '10000000-0000-0000-0000-000000000001')
    = 'a0000000-0000-0000-0000-00000000000a' AND NOT EXISTS (SELECT FROM reattribution_audit)
    AND NOT EXISTS (SELECT FROM photo_gate_unfile_log), 'the refusal writes nothing');
  r := relink_testimony('image', '10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000b', 'blank override', NULL, '   ');
  PERFORM t_assert(r->>'error' = 'gate_rejected', 'a blank override is no override (rejected_personal refused)');
END $$;

-- Service calls never override the gate.
DO $$ DECLARE r jsonb; BEGIN
  r := relink_testimony('image', '10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000b',
    'service personal', NULL, 'agent says it is the truck');
  PERFORM t_assert(r->>'success' = 'false' AND r->>'error' = 'gate_rejected' AND r->>'message' LIKE '%personal photo is never refiled by a service call%',
    'a service override on rejected_personal is refused');
  r := relink_testimony('image', '10000000-0000-0000-0000-000000000012', 'b0000000-0000-0000-0000-00000000000b',
    'service misattributed', 'd0000000-0000-0000-0000-00000000000d', 'agent says it is the truck');
  PERFORM t_assert(r->>'success' = 'false' AND r->>'error' = 'gate_rejected'
    AND r->>'message' LIKE '%owner confirmation%' AND r->>'message' LIKE '%unfile%',
    'a service override on rejected_misattributed is refused, naming an owner confirmation or an unfile');
  PERFORM t_assert((SELECT NOT user_confirmed_vehicle AND user_confirmed_vehicle_by IS NULL AND vehicle_id = 'a0000000-0000-0000-0000-00000000000a'
      AND vision_gate_status = 'rejected_misattributed' FROM vehicle_images WHERE id = '10000000-0000-0000-0000-000000000012')
    AND NOT EXISTS (SELECT FROM reattribution_audit WHERE old_observation_id IN ('10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000012'))
    AND NOT EXISTS (SELECT FROM photo_gate_unfile_log), 'the refused service overrides leave the flag false and write nothing');
END $$;

-- A signed-in user who is not the actor is refused.
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"e0000000-0000-0000-0000-00000000000e"}', false);
DO $$ BEGIN
  PERFORM relink_testimony('image', '10000000-0000-0000-0000-000000000013', 'b0000000-0000-0000-0000-00000000000b',
    'not me', 'd0000000-0000-0000-0000-00000000000d', 'override for someone else');
  RAISE EXCEPTION 'FAIL: a signed-in user overrode as another actor';
EXCEPTION WHEN insufficient_privilege THEN
  PERFORM t_assert((SELECT NOT user_confirmed_vehicle FROM vehicle_images WHERE id = '10000000-0000-0000-0000-000000000013'),
    'a signed-in user who is not the actor is refused (42501)');
END $$;

-- The signed-in owner, as the actor: moves, confirms by his id, keeps the verdict, audits the override.
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"d0000000-0000-0000-0000-00000000000d"}', false);
DO $$ DECLARE r jsonb; v record; BEGIN
  r := relink_testimony('image', '10000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000b',
    'agent visual read', 'd0000000-0000-0000-0000-00000000000d', 'frame shows the target truck');
  PERFORM t_assert((r->>'success')::boolean AND (r->>'gate_override')::boolean, 'the signed-in owner''s override moves a gate-rejected photo');
  SELECT * INTO v FROM vehicle_images WHERE id = '10000000-0000-0000-0000-000000000001';
  PERFORM t_assert(v.vehicle_id = 'b0000000-0000-0000-0000-00000000000b' AND v.user_confirmed_vehicle
    AND v.user_confirmed_vehicle_by = 'd0000000-0000-0000-0000-00000000000d' AND v.user_confirmed_vehicle_at IS NOT NULL
    AND v.vision_gate_status = 'rejected_misattributed' AND v.merged_from_vehicle_id = 'a0000000-0000-0000-0000-00000000000a',
    'the row is on the target, user_confirmed_vehicle_by = auth.uid(), gate verdict kept, lineage kept');
  PERFORM t_assert(NOT EXISTS (SELECT FROM photo_gate_unfile_log WHERE image_id = '10000000-0000-0000-0000-000000000001'),
    'the trigger logged no block');
  PERFORM t_assert((SELECT reason FROM reattribution_audit WHERE old_observation_id = '10000000-0000-0000-0000-000000000001')
    = 'agent visual read [vision gate rejected_misattributed overridden: frame shows the target truck]',
    'the audit reason records the override');
END $$;
SELECT set_config('request.jwt.claims', '', false);

-- Already confirmed: moves without an override, and the override is not used.
DO $$ DECLARE r jsonb; BEGIN
  r := relink_testimony('image', '10000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000b', 'confirmed row', NULL);
  PERFORM t_assert((r->>'success')::boolean AND NOT (r->>'gate_override')::boolean
    AND (SELECT vehicle_id FROM vehicle_images WHERE id = '10000000-0000-0000-0000-000000000003') = 'b0000000-0000-0000-0000-00000000000b',
    'a rejected photo already confirmed moves as before');
END $$;

-- Hash twin on the target: already on target.
DO $$ DECLARE r jsonb; BEGIN
  r := relink_testimony('image', '10000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000b', 'twin', NULL);
  PERFORM t_assert(r->>'success' = 'false' AND r->>'error' = 'file_hash_exists_on_target'
    AND r->>'message' LIKE 'already on target:%' AND r->>'twin_image_id' = '10000000-0000-0000-0000-000000000005',
    'a file_hash twin is refused as already on target, naming the twin');
  PERFORM t_assert(NOT EXISTS (SELECT FROM reattribution_audit WHERE old_observation_id = '10000000-0000-0000-0000-000000000004'),
    'the twin refusal writes no audit row');
END $$;

-- A BEFORE trigger that keeps the row: raise, nothing recorded.
CREATE FUNCTION public.t_keep_row() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NEW.id = '10000000-0000-0000-0000-000000000007' THEN NEW.vehicle_id := OLD.vehicle_id; END IF; RETURN NEW; END $$;
CREATE TRIGGER a99_t_keep_row BEFORE UPDATE OF vehicle_id ON public.vehicle_images FOR EACH ROW EXECUTE FUNCTION public.t_keep_row();
DO $$ BEGIN
  PERFORM relink_testimony('image', '10000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-00000000000b', 'kept', NULL);
  RAISE EXCEPTION 'FAIL: a move the trigger undid returned';
EXCEPTION WHEN check_violation THEN
  PERFORM t_assert(SQLERRM LIKE '%is not on vehicle%nothing was recorded%', 'a move that did not land raises: ' || SQLERRM);
END $$;
SELECT t_assert(NOT EXISTS (SELECT FROM reattribution_audit WHERE old_observation_id = '10000000-0000-0000-0000-000000000007'),
  'no audit row survives the undone move');
DROP TRIGGER a99_t_keep_row ON public.vehicle_images;

-- Plain move (named five arguments, as PostgREST sends), same-target retry, observation move, observation override.
DO $$ DECLARE r jsonb; BEGIN
  r := relink_testimony(p_observation_type => 'image', p_observation_id => '10000000-0000-0000-0000-000000000006',
    p_target_vehicle_id => 'b0000000-0000-0000-0000-00000000000b', p_reason => 'plain', p_actor_user_id => NULL);
  PERFORM t_assert((r->>'success')::boolean AND r->>'mode' = 'relink_in_place'
    AND (SELECT vehicle_id FROM vehicle_images WHERE id = '10000000-0000-0000-0000-000000000006') = 'b0000000-0000-0000-0000-00000000000b'
    AND (SELECT reason FROM reattribution_audit WHERE old_observation_id = '10000000-0000-0000-0000-000000000006') = 'plain',
    'a named five-argument call moves and audits as before');
  r := relink_testimony('image', '10000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000b', 'retry');
  PERFORM t_assert(r->>'mode' = 'already_attributed' AND (SELECT count(*) FROM reattribution_audit
    WHERE old_observation_id = '10000000-0000-0000-0000-000000000006') = 1, 'a same-target retry writes nothing');
  r := relink_testimony('observation', '20000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-00000000000c', 'obs', NULL);
  PERFORM t_assert((r->>'success')::boolean AND (SELECT vehicle_id = 'c0000000-0000-0000-0000-00000000000c'
    AND subject_id = 'c0000000-0000-0000-0000-00000000000c' FROM vehicle_observations WHERE id = '20000000-0000-0000-0000-000000000001'),
    'an observation moves as before');
  BEGIN
    PERFORM relink_testimony('observation', '20000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000b', 'obs', NULL, 'x');
    RAISE EXCEPTION 'FAIL: an observation override was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN PERFORM t_assert(true, 'an override for an observation is refused');
  END;
END $$;

-- Resolution: a typed jsonb sixth argument reaches the context overload (it refuses an end-user caller with 42501).
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"d0000000-0000-0000-0000-00000000000d"}', false);
DO $$ BEGIN
  PERFORM relink_testimony('observation', '20000000-0000-0000-0000-000000000001', NULL, 'ctx', NULL, '{}'::jsonb);
  RAISE EXCEPTION 'FAIL: the context overload accepted an end-user caller';
EXCEPTION WHEN insufficient_privilege THEN
  PERFORM t_assert(SQLERRM = 'context binding requires service writer', 'a typed jsonb sixth argument reaches the context overload');
END $$;
SELECT set_config('request.jwt.claims', '', false);

-- Re-apply: the guard accepts its own body and nothing changes.
SELECT md5(pg_get_functiondef('public.relink_testimony(text,uuid,uuid,text,uuid,text)'::regprocedure)) AS after_md5 \gset
\ir ../migrations/20261122002500_relink_override_signed_in_only.sql
SELECT t_assert(md5(pg_get_functiondef('public.relink_testimony(text,uuid,uuid,text,uuid,text)'::regprocedure)) = :'after_md5',
  're-applying the migration changes nothing');
SELECT t_assert(:'after_md5' = '95a376b1ed76d9bf2e60edfe8c1ae988', 'the after-fingerprint in the guard is this body''s'); -- gitleaks:allow (function-definition fingerprint, not a secret)
