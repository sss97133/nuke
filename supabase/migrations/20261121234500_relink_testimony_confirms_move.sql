-- relink_testimony: confirm the move landed before recording it; refuse gate-rejected photos unless overridden.
--
-- Why. relink_testimony moves a photo with one UPDATE of vehicle_images.vehicle_id, then writes reattribution_audit
-- and returns success. Trigger a05_trg_enforce_vision_gate_filing (BEFORE UPDATE OF vision_gate_status, vehicle_id;
-- live only, its function enforce_vision_gate_filing is listed in docs/function-drift-20261107.md) fires when the row's
-- vision_gate_status is rejected_misattributed or rejected_personal. Unless NEW.user_confirmed_vehicle is true it logs
-- a 'blocked_filing' row in photo_gate_unfile_log and puts vehicle_id and is_primary back. The UPDATE succeeds, so
-- relink_testimony recorded and reported a move that did not happen. A row policy that filters the UPDATE for a
-- signed-in caller did the same. A read-only sweep of misfiled photos (2026-11-21) found 214 of its 507 car-to-car
-- moves on gate-rejected rows.
--
-- Measured history (live, 2026-11-21): photo_gate_unfile_log's first 'blocked_filing' row is 2026-11-04. No in-place
-- car-to-car image relink (old_observation_id = new_observation_id, both vehicles set) has been audited since
-- 2026-11-03, and no audit row coincides with a blocked_filing row for the same image and target. So the false
-- success is real in the code but has not yet produced an audit row.
--
-- What changes, in relink_testimony only (the (text,uuid,uuid,text,uuid,jsonb) context overload is not touched):
--   1. After its UPDATE it reads back the row's vehicle_id (RETURNING, after every BEFORE trigger) and raises when the
--      row is not on the target, so no audit row or success survives a move that did not happen. This applies to images
--      and observations.
--   2. A photo whose vision_gate_status is rejected_* and whose user_confirmed_vehicle is not already true is refused
--      (success false, error 'gate_rejected'), unless the caller passes p_gate_override_reason. The override does what
--      the trigger needs, and only that: user_confirmed_vehicle = true, with _by = the actor (null for a service caller)
--      and _at = now(), in the same UPDATE. The gate's own verdict (vision_gate_status, its reasoning) is kept. The
--      override and its reason are written into the audit row's reason. Rows already confirmed move as before.
--   3. A photo whose file_hash is already on the target keeps its refusal code 'file_hash_exists_on_target' (scripts
--      and the device-filing helper match on it). The refusal now carries the twin's id and a message that says
--      "already on target". A unique violation on idx_unique_vehicle_file_hash during the UPDATE returns the same
--      refusal instead of an obscure error.
--   Refusals stay jsonb returns, as the function already refused, because capture_set_correct and other batch callers
--   loop over photos without catching exceptions. Only the post-update mismatch raises.
--
-- Signature. Adding p_gate_override_reason text DEFAULT NULL is a new signature, so the five-argument function is
-- dropped and recreated in this transaction. Every five-argument call (positional or named, SQL or PostgREST) resolves
-- to the new one. The comment, owner, SECURITY INVOKER, search_path and the live ACL (authenticated and service_role
-- execute, no PUBLIC or anon) are re-applied. A six-argument positional call whose sixth argument is an untyped literal
-- now resolves to this function (text wins over jsonb), so a call meant for the context overload must pass jsonb typed
-- (a jsonb variable or '...'::jsonb). Every such call in this repository is typed (the profile helper is cast in this
-- change); no live function calls it positionally (pg_proc read 2026-11-21).
--
-- Refused when the live definition changed since it was read (md5 of pg_get_functiondef, 2026-11-21). Re-applying is a
-- no-op. No table DDL, no rows written.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $guard$
DECLARE f text;
BEGIN
  IF to_regprocedure('public.relink_testimony(text,uuid,uuid,text,uuid)') IS NOT NULL THEN
    f := md5(pg_get_functiondef('public.relink_testimony(text,uuid,uuid,text,uuid)'::regprocedure));
    IF f <> '0ad2ba6c3900a55247e883c046dcc17d' THEN -- gitleaks:allow (function-definition fingerprint read 2026-11-21, not a secret)
      RAISE EXCEPTION 'relink_testimony(5) changed since 2026-11-21 (md5 %); review before replacement', f;
    END IF;
  END IF;
  IF to_regprocedure('public.relink_testimony(text,uuid,uuid,text,uuid,text)') IS NOT NULL THEN
    f := md5(pg_get_functiondef('public.relink_testimony(text,uuid,uuid,text,uuid,text)'::regprocedure));
    IF f <> '0f755dbb76b82530e6e0dc7a033312bf' THEN -- gitleaks:allow (function-definition fingerprint after this migration, not a secret)
      RAISE EXCEPTION 'relink_testimony(6, text) differs from this migration''s (md5 %); review before replacement', f;
    END IF;
  END IF;
END
$guard$;

DROP FUNCTION IF EXISTS public.relink_testimony(text, uuid, uuid, text, uuid);

CREATE OR REPLACE FUNCTION public.relink_testimony(p_observation_type text, p_observation_id uuid, p_target_vehicle_id uuid, p_reason text, p_actor_user_id uuid DEFAULT NULL::uuid, p_gate_override_reason text DEFAULT NULL::text)
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
  v_gate text;
  v_confirmed boolean;
  v_override text := nullif(btrim(p_gate_override_reason), '');
  v_use_override boolean := false;
  v_twin uuid;
  v_now_vehicle_id uuid;
  v_constraint text;
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
  IF v_override IS NOT NULL AND p_observation_type <> 'image' THEN
    RAISE EXCEPTION 'relink_testimony: a vision-gate override applies to images only' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM vehicles WHERE id = p_target_vehicle_id AND deleted_at IS NULL AND status IS DISTINCT FROM 'merged') THEN
    RAISE EXCEPTION 'target vehicle % does not exist', p_target_vehicle_id;
  END IF;

  IF p_observation_type = 'image' THEN
    SELECT vehicle_id, COALESCE(is_primary, false), file_hash, merged_from_vehicle_id,
           vision_gate_status::text, COALESCE(user_confirmed_vehicle, false)
      INTO v_old_vehicle_id, v_is_primary, v_file_hash, v_merged_from_vehicle_id, v_gate, v_confirmed
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
    IF v_file_hash IS NOT NULL THEN
      SELECT b.id INTO v_twin FROM vehicle_images b
       WHERE b.vehicle_id = p_target_vehicle_id AND b.file_hash = v_file_hash
       ORDER BY b.id LIMIT 1;
      IF v_twin IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'file_hash_exists_on_target',
                                  'message', format('already on target: image %s has the same file_hash as image %s on vehicle %s', p_observation_id, v_twin, p_target_vehicle_id),
                                  'observation_id', p_observation_id, 'twin_image_id', v_twin);
      END IF;
    END IF;

    -- Guard: a05_trg_enforce_vision_gate_filing puts vehicle_id back on a rejected_* row unless user_confirmed_vehicle
    -- is true. Refuse instead of moving nothing; with an explicit override, set exactly that flag.
    IF v_gate IN ('rejected_misattributed', 'rejected_personal') AND NOT v_confirmed THEN
      IF v_override IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'gate_rejected',
                                  'message', format('vision gate %s on image %s: the gate trigger would keep it on %s; pass p_gate_override_reason to refile it', v_gate, p_observation_id, v_old_vehicle_id),
                                  'observation_id', p_observation_id, 'vision_gate_status', v_gate);
      END IF;
      v_use_override := true;
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

    BEGIN
      IF v_use_override THEN
        UPDATE vehicle_images
           SET vehicle_id = p_target_vehicle_id,
               merged_from_vehicle_id = COALESCE(merged_from_vehicle_id, v_old_vehicle_id),
               is_primary = CASE WHEN v_demoted THEN false ELSE is_primary END,
               user_confirmed_vehicle = true,
               user_confirmed_vehicle_by = p_actor_user_id,
               user_confirmed_vehicle_at = NOW(),
               updated_at = NOW()
         WHERE id = p_observation_id
         RETURNING vehicle_id, merged_from_vehicle_id INTO v_now_vehicle_id, v_merged_from_vehicle_id;
      ELSE
        UPDATE vehicle_images
           SET vehicle_id = p_target_vehicle_id,
               merged_from_vehicle_id = COALESCE(merged_from_vehicle_id, v_old_vehicle_id),
               is_primary = CASE WHEN v_demoted THEN false ELSE is_primary END,
               updated_at = NOW()
         WHERE id = p_observation_id
         RETURNING vehicle_id, merged_from_vehicle_id INTO v_now_vehicle_id, v_merged_from_vehicle_id;
      END IF;
    EXCEPTION WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
      IF v_constraint = 'idx_unique_vehicle_file_hash' THEN
        RETURN jsonb_build_object('success', false, 'error', 'file_hash_exists_on_target',
                                  'message', format('already on target: image %s has the same file_hash as a photo on vehicle %s', p_observation_id, p_target_vehicle_id),
                                  'observation_id', p_observation_id);
      END IF;
      RAISE;
    END;

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
     RETURNING vehicle_id, merged_from_vehicle_id INTO v_now_vehicle_id, v_merged_from_vehicle_id;
  END IF;

  -- The move must have landed: RETURNING shows the row after every BEFORE trigger, and no row when a policy filtered it.
  IF v_now_vehicle_id IS DISTINCT FROM p_target_vehicle_id THEN
    RAISE EXCEPTION 'relink_testimony: % % is not on vehicle % after the update (it is on %); nothing was recorded',
      p_observation_type, p_observation_id, p_target_vehicle_id, coalesce(v_now_vehicle_id::text, 'no visible row')
      USING ERRCODE = '23514',
            HINT = 'A BEFORE UPDATE trigger (such as the vision gate) or a row policy kept the row where it was.';
  END IF;

  INSERT INTO reattribution_audit (
    observation_type, old_observation_id, old_vehicle_id,
    new_observation_id, new_vehicle_id, reason, actor_user_id)
  VALUES (
    p_observation_type, p_observation_id, v_old_vehicle_id,
    p_observation_id, p_target_vehicle_id,
    p_reason || CASE WHEN v_demoted THEN ' [is_primary demoted: target already has a primary]' ELSE '' END
             || CASE WHEN v_use_override THEN format(' [vision gate %s overridden: %s]', v_gate, v_override) ELSE '' END,
    p_actor_user_id);

  RETURN jsonb_build_object(
    'success', true,
    'mode', 'relink_in_place',
    'observation_type', p_observation_type,
    'observation_id', p_observation_id,
    'old_vehicle_id', v_old_vehicle_id,
    'new_vehicle_id', p_target_vehicle_id,
    'merged_from_vehicle_id', v_merged_from_vehicle_id,
    'demoted_primary', v_demoted,
    'gate_override', v_use_override);
END;
$function$;

ALTER FUNCTION public.relink_testimony(text, uuid, uuid, text, uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.relink_testimony(text, uuid, uuid, text, uuid, text) FROM PUBLIC;
DO $acl$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.relink_testimony(text, uuid, uuid, text, uuid, text) FROM anon;
  END IF;
END $acl$;
GRANT EXECUTE ON FUNCTION public.relink_testimony(text, uuid, uuid, text, uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.relink_testimony(text, uuid, uuid, text, uuid, text) IS
  'Sanctioned in-place testimony attribution: supports unbound rows, preserves all source evidence, locks one row, appends existing audit; same-target retry returns the same observation ID without another audit. Target must be live, actor/editor checks unchanged. C15. Confirms the row sits on the target after its update and raises otherwise (no audit without a move). A gate-rejected photo not yet confirmed is refused (error gate_rejected) unless p_gate_override_reason is given, which sets user_confirmed_vehicle and is recorded in the audit reason. A file_hash twin on the target is refused as already on target (error file_hash_exists_on_target).';

NOTIFY pgrst, 'reload schema';
COMMIT;
