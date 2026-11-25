-- relink_testimony: a signed-in photo move lands its audit row through one checked writer; nothing else can write one.
--
-- Why. relink_testimony(text,uuid,uuid,text,uuid,text) is SECURITY INVOKER and ends with INSERT INTO reattribution_audit.
-- reattribution_audit has row level security on and no policy (live 2026-11-25), so for an end user the audit insert
-- is refused (42501) and the whole move rolls back: every signed-in move has failed (the iOS photo move, agent-chat's
-- move_photo with the user's token). Only service-role calls and SECURITY DEFINER writers owned by postgres
-- (attribute_image_session, device_file_images, device_create_vehicle_profile) have written audit rows.
--
-- Shape (lead ruling 2026-11-25, after ta-skeptic2 showed an INSERT policy lets any signed-in user POST an audit row,
-- including the reason shape capture_sets_score reads as an owner-filed anchor):
--   * No INSERT policy, and INSERT on reattribution_audit is revoked from anon and authenticated. Service role and the
--     postgres-owned definer writers are unaffected.
--   * One SECURITY DEFINER writer, reattribution_audit_record_move(image, old vehicle, target, kind, note), search_path
--     pinned, EXECUTE revoked from PUBLIC and anon. It takes no actor: the actor is auth.uid(). It refuses unless the
--     move is real in this transaction: the photo row now sits on the target AND that row version was written by the
--     current transaction. A direct RPC call to it, with no move in its own transaction, lands nothing.
--     "Written by the current transaction": the row's xmin, widened to a full transaction id with the epoch of
--     pg_current_xact_id(), has pg_xact_status 'in progress'. Another session's in-progress write is not visible to this
--     snapshot (we read the committed version instead, whose xmin is committed), so a visible row version whose writer
--     is still in progress was written by this transaction or one of its subtransactions. relink_testimony's UPDATE runs
--     inside a BEGIN ... EXCEPTION block, which is a subtransaction, so xmin is the subtransaction's id, not the top-level
--     one; the contract proves the comparison holds there on PG17.
--   * The reason is stored as '<kind>: <note>' with kind a row of the key reattribution_reason_kinds (signed_in = true; one row,
--     signed_in_move; no end-user grant on the key, and its CHECK refuses the kind first_attribution). A stored reason from
--     a signed-in session therefore never begins 'first_attribution:', which is what capture_sets_score's own_filed read
--     requires; that read can be fed only by the definer writers and service role.
-- Who may move (checked in relink_testimony, before any write):
--   * target: unchanged. The actor is the caller (p_actor_user_id = auth.uid()) and user_can_edit_vehicle(target).
--   * source photo: one the caller uploaded (vehicle_images.user_id) or one on a vehicle the caller is tied to
--     (vehicle_viewer_tied). A self-granted contributor role passes the vehicle_images UPDATE policies but not the tie
--     rule, and is refused (42501).
--   * an observation: refused for any signed-in session, before any write (SQLSTATE RL001). vehicle_observations is
--     testimony no user session edits in place; an owner-moved observation is a supersession row through the sanctioned
--     writer, a separate change.
--   * service-role calls: unchanged.
--
-- Refused when the live definition changed since it was read (md5 of pg_get_functiondef, 2026-11-25, equal to
-- 20261122002500's body). Re-applying is a no-op. One new key table (reattribution_reason_kinds, one row); no other
-- table DDL; no locks on existing tables beyond the REVOKE's catalog update.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $guard$
DECLARE f text;
BEGIN
  f := md5(pg_get_functiondef('public.relink_testimony(text,uuid,uuid,text,uuid,text)'::regprocedure));
  IF f NOT IN ('95a376b1ed76d9bf2e60edfe8c1ae988', -- gitleaks:allow (function-definition fingerprint read 2026-11-25, not a secret)
               'f9b1c2e7219bc4723a3d6907fa1f95bf') THEN -- gitleaks:allow (function-definition fingerprint after this migration, not a secret)
    RAISE EXCEPTION 'relink_testimony(6, text) changed since 2026-11-25 (md5 %); review before replacement', f;
  END IF;
END
$guard$;

-- The allowed reason kinds of a signed-in audit row. Written only here (no end-user grant); a kind can never be
-- first_attribution, the prefix capture_sets_score and attribute_testimony read as an anchor.
CREATE TABLE IF NOT EXISTS public.reattribution_reason_kinds (
  kind text PRIMARY KEY CHECK (kind ~ '^[a-z][a-z_]*$' AND kind <> 'first_attribution'),
  signed_in boolean NOT NULL,
  note text NOT NULL
);
ALTER TABLE public.reattribution_reason_kinds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reattribution_reason_kinds FROM anon, authenticated;
COMMENT ON TABLE public.reattribution_reason_kinds IS
  'Allowed kinds of a reattribution_audit reason written by reattribution_audit_record_move (20261126001000). signed_in = a signed-in session may write it. Stored reason = <kind>: <note>.';
INSERT INTO public.reattribution_reason_kinds (kind, signed_in, note)
VALUES ('signed_in_move', true, 'a photo moved by a signed-in session through relink_testimony')
ON CONFLICT (kind) DO NOTHING;

CREATE OR REPLACE FUNCTION public.reattribution_audit_record_move(
  p_image_id uuid, p_old_vehicle_id uuid, p_target_vehicle_id uuid, p_kind text, p_note text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $writer$
DECLARE
  v_uid uuid := auth.uid();
  v_vehicle uuid;
  v_xmin xid;
  v_cur bigint;
  v_full bigint;
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'reattribution_audit_record_move: a signed-in session only' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.reattribution_reason_kinds k WHERE k.kind = p_kind AND k.signed_in) THEN
    RAISE EXCEPTION 'reattribution_audit_record_move: reason kind % is not allowed', p_kind USING ERRCODE = '22023';
  END IF;
  SELECT i.vehicle_id, i.xmin INTO v_vehicle, v_xmin FROM public.vehicle_images i WHERE i.id = p_image_id;
  IF NOT FOUND OR v_vehicle IS DISTINCT FROM p_target_vehicle_id THEN
    RAISE EXCEPTION 'reattribution_audit_record_move: photo % is not on vehicle %', p_image_id, p_target_vehicle_id
      USING ERRCODE = '42501';
  END IF;
  -- Widen the 32-bit xmin to a full id in the current epoch (within 2^31 of the current one), then ask its status.
  v_cur := pg_current_xact_id()::text::bigint;
  v_full := ((v_cur >> 32) << 32) | (v_xmin::text::bigint);
  IF v_full > v_cur + 2147483648 THEN v_full := v_full - 4294967296;
  ELSIF v_full < v_cur - 2147483648 THEN v_full := v_full + 4294967296;
  END IF;
  IF v_full < 3 OR pg_xact_status(v_full::text::xid8) IS DISTINCT FROM 'in progress' THEN
    RAISE EXCEPTION 'reattribution_audit_record_move: photo % was not moved by this transaction', p_image_id
      USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.reattribution_audit (observation_type, old_observation_id, old_vehicle_id,
                                          new_observation_id, new_vehicle_id, reason, actor_user_id)
  VALUES ('image', p_image_id, p_old_vehicle_id, p_image_id, p_target_vehicle_id,
          p_kind || ': ' || coalesce(p_note, ''), v_uid)
  RETURNING id INTO v_id;
  RETURN v_id;
END
$writer$;
REVOKE ALL ON FUNCTION public.reattribution_audit_record_move(uuid, uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reattribution_audit_record_move(uuid, uuid, uuid, text, text) TO authenticated, service_role;
COMMENT ON FUNCTION public.reattribution_audit_record_move(uuid, uuid, uuid, text, text) IS
  'The one writer of a signed-in session''s reattribution_audit row (20261126001000). Actor = auth.uid(); refuses unless the photo now sits on the target and that row version was written by the current transaction; reason stored as <kind>: <note>, kind a signed_in row of reattribution_reason_kinds. Called by relink_testimony.';

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
  v_uid uuid := auth.uid();
  v_image_user uuid;
  v_end_user boolean := coalesce(auth.role(), '') IN ('authenticated', 'anon');
  v_audit_reason text;
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
  -- (20261126001000) A signed-in session moves photos only. vehicle_observations is testimony that no user session edits
  -- in place; an owner-moved observation would be a supersession row through the sanctioned writer.
  IF v_end_user AND p_observation_type = 'observation' THEN
    RAISE EXCEPTION 'relink_testimony: a signed-in session cannot move an observation; observations are superseded through the sanctioned writer, not moved'
      USING ERRCODE = 'RL001';
  END IF;
  IF v_override IS NOT NULL AND p_observation_type <> 'image' THEN
    RAISE EXCEPTION 'relink_testimony: a vision-gate override applies to images only' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM vehicles WHERE id = p_target_vehicle_id AND deleted_at IS NULL AND status IS DISTINCT FROM 'merged') THEN
    RAISE EXCEPTION 'target vehicle % does not exist', p_target_vehicle_id;
  END IF;

  IF p_observation_type = 'image' THEN
    SELECT vehicle_id, COALESCE(is_primary, false), file_hash, merged_from_vehicle_id,
           vision_gate_status::text, COALESCE(user_confirmed_vehicle, false), user_id
      INTO v_old_vehicle_id, v_is_primary, v_file_hash, v_merged_from_vehicle_id, v_gate, v_confirmed, v_image_user
      FROM vehicle_images WHERE id = p_observation_id FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'image % not found', p_observation_id;
    END IF;

    -- Source side (20261126001000): a signed-in caller moves only a photo they uploaded or one on a vehicle they are
    -- tied to (vehicle_viewer_tied: owner, record owner, creator, uploader of the car, or access its owner granted).
    -- The target side is the identity check above (actor = caller, user_can_edit_vehicle on the target).
    IF v_end_user AND v_image_user IS DISTINCT FROM v_uid
       AND NOT (v_old_vehicle_id IS NOT NULL AND public.vehicle_viewer_tied(v_old_vehicle_id)) THEN
      RAISE EXCEPTION 'relink_testimony: you can move only a photo you uploaded or one on a vehicle you are tied to'
        USING ERRCODE = '42501';
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
                                  'message', format('vision gate %s on image %s: the gate trigger would keep it on %s; the signed-in owner can refile it with p_gate_override_reason, otherwise unfile it', v_gate, p_observation_id, v_old_vehicle_id),
                                  'observation_id', p_observation_id, 'vision_gate_status', v_gate);
      END IF;
      -- The override sets the flag that exempts this photo from the gate on any vehicle from now on, so only a signed-in
      -- end user, acting as himself, may set it. A service call never does: never for a personal photo, and a
      -- misattributed one needs the owner's confirmation or an unfile.
      IF v_uid IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'gate_rejected',
                                  'message', CASE WHEN v_gate = 'rejected_personal'
                                    THEN format('vision gate rejected_personal on image %s: a personal photo is never refiled by a service call; it needs the owner''s own confirmation, signed in, or an unfile', p_observation_id)
                                    ELSE format('vision gate rejected_misattributed on image %s: a service call cannot override the gate; an owner confirmation (signed in, as the actor) or an unfile is needed', p_observation_id) END,
                                  'observation_id', p_observation_id, 'vision_gate_status', v_gate);
      END IF;
      IF p_actor_user_id IS DISTINCT FROM v_uid THEN
        RAISE EXCEPTION 'relink_testimony: a gate override is recorded only for the signed-in user as the actor' USING ERRCODE = '42501';
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
               user_confirmed_vehicle_by = v_uid,
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

  v_audit_reason := p_reason || CASE WHEN v_demoted THEN ' [is_primary demoted: target already has a primary]' ELSE '' END
             || CASE WHEN v_use_override THEN format(' [vision gate %s overridden: %s]', v_gate, v_override) ELSE '' END;
  IF v_end_user THEN
    -- A signed-in session holds no INSERT on reattribution_audit. The checked writer records the move it can see this
    -- transaction made, with the caller as actor and the reason under the signed_in_move kind.
    PERFORM public.reattribution_audit_record_move(p_observation_id, v_old_vehicle_id, p_target_vehicle_id,
                                                   'signed_in_move', v_audit_reason);
  ELSE
    INSERT INTO reattribution_audit (
      observation_type, old_observation_id, old_vehicle_id,
      new_observation_id, new_vehicle_id, reason, actor_user_id)
    VALUES (
      p_observation_type, p_observation_id, v_old_vehicle_id,
      p_observation_id, p_target_vehicle_id,
      v_audit_reason,
      p_actor_user_id);
  END IF;

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
$function$
;

DROP POLICY IF EXISTS reattribution_audit_actor_insert ON public.reattribution_audit;
REVOKE INSERT ON public.reattribution_audit FROM anon, authenticated;

COMMIT;
