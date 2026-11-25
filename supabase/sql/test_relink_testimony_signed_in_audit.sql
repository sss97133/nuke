-- Isolated PostgreSQL 17 contract for 20261126001000_relink_testimony_signed_in_audit.sql.
-- It first runs test_relink_override_signed_in_only.sql, which builds the live fixture and leaves relink_testimony at the
-- live body (md5 95a376b1ed76d9bf2e60edfe8c1ae988). Then it adds what the live database has and that fixture does not:
-- row level security on reattribution_audit with no policy, and on vehicle_images. The caller is a real authenticated
-- session (SET ROLE authenticated), not a superuser with claims, which is how the refused audit insert went unseen.
-- Synthetic rows only. Cases:
--   * before: the owner's own signed-in move is refused at the audit insert (42501) and the photo stays;
--   * after: the owner's move lands the photo and exactly one audit row (actor = the owner, reason 'signed_in_move: ...');
--   * a stranger's move of the owner's photo is refused; a move onto a vehicle the caller cannot edit is refused (42501);
--   * an editor of the source who is not tied to it is refused (42501);
--   * a signed-in observation move is refused up front with SQLSTATE RL001, nothing written;
--   * a direct audit insert (the REST POST) is refused (42501), naming oneself or another actor;
--   * a direct call to the writer with no move in its transaction is refused; a disallowed reason kind is refused;
--   * the writer's "written by this transaction" test holds when the move ran in a subtransaction (xmin is the
--     subtransaction's id, not the top-level one);
--   * a reason shaped like capture_sets_score's owner-filed anchor, sent through a signed-in move, is stored under the
--     signed_in_move kind and does not match that read;
--   * the uploader moves their own photo; a signed-in user reads no audit rows; re-applying changes nothing.
-- Runs from any directory: every include is relative to this file (\ir).
\ir test_relink_override_signed_in_only.sql

-- Live state the base fixture leaves out.
-- can_edit models user_can_edit_vehicle (which counts any vehicle_contributor_roles row, self-granted or not);
-- tied models vehicle_viewer_tied (the reviewed tie rule: a grant must come from the car's owner).
CREATE TABLE public.vehicle_ties_fx(vehicle_id uuid, user_id uuid, can_edit boolean, tied boolean);
CREATE OR REPLACE FUNCTION public.user_can_edit_vehicle(p_vehicle_id uuid, p_user_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS
$$ SELECT EXISTS (SELECT 1 FROM public.vehicle_ties_fx t WHERE t.vehicle_id = p_vehicle_id AND t.user_id = p_user_id AND t.can_edit) $$;
CREATE FUNCTION public.vehicle_viewer_tied(p_vehicle_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS
$$ SELECT CASE WHEN auth.role() = 'service_role' THEN true WHEN auth.uid() IS NULL THEN false
               ELSE EXISTS (SELECT 1 FROM public.vehicle_ties_fx t WHERE t.vehicle_id = p_vehicle_id AND t.user_id = auth.uid() AND t.tied) END $$;
GRANT EXECUTE ON FUNCTION public.user_can_edit_vehicle(uuid, uuid), public.vehicle_viewer_tied(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.relink_testimony(text,uuid,uuid,text,uuid,text) TO authenticated;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO authenticated;

ALTER TABLE public.reattribution_audit ENABLE ROW LEVEL SECURITY;           -- live: on, no policy
GRANT SELECT, INSERT ON public.reattribution_audit TO authenticated;          -- live: granted
ALTER TABLE public.vehicle_images ENABLE ROW LEVEL SECURITY;
GRANT SELECT, UPDATE ON public.vehicle_images, public.vehicle_observations TO authenticated;
GRANT SELECT ON public.vehicles, public.auction_events TO authenticated;
GRANT INSERT ON public.photo_gate_unfile_log, public.image_vehicle_mismatches TO authenticated;
CREATE POLICY images_read_fx ON public.vehicle_images FOR SELECT USING (true);
-- The live "users_can_update_own_images" shape: the uploader, or the owner of the car the row is on.
CREATE POLICY images_update_fx ON public.vehicle_images FOR UPDATE
  USING ((SELECT auth.uid()) = user_id OR public.user_can_edit_vehicle(vehicle_id, (SELECT auth.uid())));

-- O owns E (source) and F (target). S is a stranger who owns G. U uploaded a photo that sits on G.
INSERT INTO vehicles(id) VALUES ('e0000000-0000-0000-0000-00000000000e'), ('f0000000-0000-0000-0000-00000000000f'),
  ('70000000-0000-0000-0000-000000000007');
INSERT INTO vehicle_ties_fx VALUES
  ('e0000000-0000-0000-0000-00000000000e', '0a000000-0000-0000-0000-0000000000a0', true, true),
  ('f0000000-0000-0000-0000-00000000000f', '0a000000-0000-0000-0000-0000000000a0', true, true),
  ('70000000-0000-0000-0000-000000000007', '05000000-0000-0000-0000-000000000050', true, true),
  ('f0000000-0000-0000-0000-00000000000f', '0b000000-0000-0000-0000-0000000000b0', true, true),   -- U may edit F
  -- C holds a self-granted contributor role on E: the row policy lets C lock the photo, the tie rule does not tie C.
  ('e0000000-0000-0000-0000-00000000000e', '0c000000-0000-0000-0000-0000000000c0', true, false),
  ('70000000-0000-0000-0000-000000000007', '0c000000-0000-0000-0000-0000000000c0', true, true);
INSERT INTO vehicle_images(id, vehicle_id, user_id, file_hash, vision_gate_status) VALUES
  ('30000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-00000000000e', '0a000000-0000-0000-0000-0000000000a0', 'k1', 'approved'),
  ('30000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000007', '0b000000-0000-0000-0000-0000000000b0', 'k2', 'approved'),
  ('30000000-0000-0000-0000-000000000003', 'e0000000-0000-0000-0000-00000000000e', '0a000000-0000-0000-0000-0000000000a0', 'k3', 'approved'),
  -- uploaded by U, on O's car E: O moves it (tied to E); O is not the uploader, so a stated source must be tied.
  ('30000000-0000-0000-0000-000000000004', 'e0000000-0000-0000-0000-00000000000e', '0b000000-0000-0000-0000-0000000000b0', 'k4', 'approved');
INSERT INTO vehicle_observations(id, vehicle_id, subject_type, subject_id) VALUES
  ('40000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-00000000000e', 'vehicle', 'e0000000-0000-0000-0000-00000000000e');
DELETE FROM reattribution_audit;

CREATE FUNCTION pg_temp.as_user(p_sub uuid) RETURNS void LANGUAGE sql AS
$$ SELECT set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, false) $$;
CREATE FUNCTION pg_temp.try_move(p_kind text, p_id uuid, p_target uuid, p_actor uuid, p_reason text DEFAULT 'contract move')
RETURNS text LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  r := public.relink_testimony(p_kind, p_id, p_target, p_reason, p_actor, NULL::text);
  RETURN 'ok ' || coalesce(r->>'success', '?');
EXCEPTION WHEN OTHERS THEN RETURN 'refused ' || SQLSTATE || ': ' || SQLERRM;
END $$;
CREATE FUNCTION pg_temp.try_insert_forged() RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  -- ALLOW_RAW_TESTIMONY_WRITE: contract fixture; proves a direct insert naming another actor is refused.
  INSERT INTO public.reattribution_audit(observation_type, old_observation_id, new_observation_id, reason, actor_user_id)
  VALUES ('image', gen_random_uuid(), gen_random_uuid(), 'forged', '05000000-0000-0000-0000-000000000050');
  RETURN 'inserted';
EXCEPTION WHEN insufficient_privilege THEN RETURN 'refused ' || SQLSTATE;
END $$;
CREATE FUNCTION pg_temp.try_insert_self_anchor() RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  -- ALLOW_RAW_TESTIMONY_WRITE: contract fixture; the direct POST shape ta-skeptic2 forged, actor = the caller.
  INSERT INTO public.reattribution_audit(observation_type, old_observation_id, new_observation_id, new_vehicle_id, reason, actor_user_id)
  VALUES ('image', gen_random_uuid(), gen_random_uuid(), 'f0000000-0000-0000-0000-00000000000f',
          'first_attribution: forged signal=owner_session_confirm', auth.uid());
  RETURN 'inserted';
EXCEPTION WHEN insufficient_privilege THEN RETURN 'refused ' || SQLSTATE;
END $$;
CREATE FUNCTION pg_temp.try_writer(p_image uuid, p_old uuid, p_target uuid, p_kind text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.reattribution_audit_record_move(p_image, p_old, p_target, p_kind, 'direct call');
  RETURN 'inserted';
EXCEPTION WHEN OTHERS THEN RETURN 'refused ' || SQLSTATE || ': ' || SQLERRM;
END $$;
-- The move runs in a subtransaction (a BEGIN ... EXCEPTION block, as in relink_testimony), then the writer is called.
CREATE FUNCTION pg_temp.subxact_proof() RETURNS text LANGUAGE plpgsql AS $$
DECLARE x xid; sub boolean; r uuid;
BEGIN
  BEGIN
    -- ALLOW_RAW_TESTIMONY_WRITE: contract fixture; a synthetic photo moved inside a subtransaction.
    UPDATE public.vehicle_images SET vehicle_id = 'f0000000-0000-0000-0000-00000000000f',
           merged_from_vehicle_id = coalesce(merged_from_vehicle_id, 'e0000000-0000-0000-0000-00000000000e')
     WHERE id = '30000000-0000-0000-0000-000000000003';
  EXCEPTION WHEN OTHERS THEN RAISE;
  END;
  SELECT xmin INTO x FROM public.vehicle_images WHERE id = '30000000-0000-0000-0000-000000000003';
  sub := x::text::bigint <> (pg_current_xact_id()::text::bigint & 4294967295);
  r := public.reattribution_audit_record_move('30000000-0000-0000-0000-000000000003', 'e0000000-0000-0000-0000-00000000000e',
                                              'f0000000-0000-0000-0000-00000000000f', 'signed_in_move', 'subtransaction proof');
  RETURN 'subxact=' || sub || ' writer=' || (r IS NOT NULL);
END $$;
-- ta-skeptic2's should-fix: after a real move in one transaction, the writer is called again for the same photo, and
-- with a stated source equal to the target or one the caller is not tied to.
CREATE FUNCTION pg_temp.second_row_after_move() RETURNS text LANGUAGE plpgsql AS $$
DECLARE r jsonb; again text; same text; untied text;
BEGIN
  r := public.relink_testimony('image', '30000000-0000-0000-0000-000000000004', 'f0000000-0000-0000-0000-00000000000f',
                               'move then repeat', '0a000000-0000-0000-0000-0000000000a0', NULL::text);
  again := pg_temp.try_writer('30000000-0000-0000-0000-000000000004', 'e0000000-0000-0000-0000-00000000000e',
                              'f0000000-0000-0000-0000-00000000000f', 'signed_in_move');
  same := pg_temp.try_writer('30000000-0000-0000-0000-000000000004', 'f0000000-0000-0000-0000-00000000000f',
                             'f0000000-0000-0000-0000-00000000000f', 'signed_in_move');
  untied := pg_temp.try_writer('30000000-0000-0000-0000-000000000004', '70000000-0000-0000-0000-000000000007',
                               'f0000000-0000-0000-0000-00000000000f', 'signed_in_move');
  RETURN (r->>'success') || ' | ' || again || ' | ' || same || ' | ' || untied;
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated;

-- Before: the owner's own move is refused at the audit insert.
SELECT pg_temp.as_user('0a000000-0000-0000-0000-0000000000a0');
SET ROLE authenticated;
SELECT pg_temp.try_move('image', '30000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000f',
  '0a000000-0000-0000-0000-0000000000a0') AS before_owner_move \gset
RESET ROLE;
SELECT t_assert(:'before_owner_move' LIKE 'refused 42501:%row-level security%reattribution_audit%',
  'before: the owner''s signed-in move is refused at the audit insert');
SELECT t_assert((SELECT vehicle_id FROM vehicle_images WHERE id = '30000000-0000-0000-0000-000000000001') = 'e0000000-0000-0000-0000-00000000000e'
  AND NOT EXISTS (SELECT FROM reattribution_audit), 'before: the photo stayed and no audit row exists');

SELECT set_config('request.jwt.claims', '', false);
\ir ../migrations/20261126001000_relink_testimony_signed_in_audit.sql

-- A stranger moves the owner's photo onto the stranger's own car: refused, nothing written.
SELECT pg_temp.as_user('05000000-0000-0000-0000-000000000050');
SET ROLE authenticated;
SELECT pg_temp.try_move('image', '30000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000007',
  '05000000-0000-0000-0000-000000000050') AS stranger_source \gset
SELECT pg_temp.try_move('image', '30000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000f',
  '05000000-0000-0000-0000-000000000050') AS stranger_target \gset
SELECT pg_temp.try_move('observation', '40000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000007',
  '05000000-0000-0000-0000-000000000050') AS stranger_observation \gset
RESET ROLE;
-- Live, a stranger cannot even lock the row (the UPDATE policies apply to SELECT ... FOR UPDATE): "not found".
SELECT t_assert(:'stranger_source' LIKE 'refused %', 'a stranger''s move of the owner''s photo is refused');
SELECT t_assert(:'stranger_target' LIKE 'refused 42501:%vehicle you can edit%', 'a move onto a vehicle the caller cannot edit is refused');
SELECT t_assert(:'stranger_observation' LIKE 'refused RL001:%', 'a stranger''s observation move is refused up front (RL001)');

-- A self-granted contributor passes the row policy on the source but is not tied to it: the function refuses.
SELECT pg_temp.as_user('0c000000-0000-0000-0000-0000000000c0');
SET ROLE authenticated;
SELECT pg_temp.try_move('image', '30000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000007',
  '0c000000-0000-0000-0000-0000000000c0') AS contributor_source \gset
RESET ROLE;
SELECT t_assert(:'contributor_source' LIKE 'refused 42501:%photo you uploaded or one on a vehicle you are tied to%',
  'an editor of the source who is not tied to it is refused by the function');
SELECT t_assert((SELECT vehicle_id FROM vehicle_images WHERE id = '30000000-0000-0000-0000-000000000001') = 'e0000000-0000-0000-0000-00000000000e'
  AND (SELECT vehicle_id FROM vehicle_observations WHERE id = '40000000-0000-0000-0000-000000000001') = 'e0000000-0000-0000-0000-00000000000e'
  AND NOT EXISTS (SELECT FROM reattribution_audit), 'the refusals wrote nothing');

-- The owner's move lands, with exactly one audit row naming the owner.
SELECT pg_temp.as_user('0a000000-0000-0000-0000-0000000000a0');
SET ROLE authenticated;
SELECT pg_temp.try_move('image', '30000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000f',
  '0a000000-0000-0000-0000-0000000000a0') AS owner_move \gset
SELECT count(*) AS owner_reads_audit FROM reattribution_audit \gset
SELECT pg_temp.try_insert_forged() AS forged \gset
SELECT pg_temp.try_insert_self_anchor() AS forged_self \gset
SELECT pg_temp.try_writer('30000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-00000000000e',
  'f0000000-0000-0000-0000-00000000000f', 'signed_in_move') AS writer_no_move \gset
SELECT pg_temp.try_writer('30000000-0000-0000-0000-000000000003', 'e0000000-0000-0000-0000-00000000000e',
  'f0000000-0000-0000-0000-00000000000f', 'signed_in_move') AS writer_not_on_target \gset
SELECT pg_temp.try_writer('30000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-00000000000e',
  'f0000000-0000-0000-0000-00000000000f', 'first_attribution') AS writer_bad_kind \gset
SELECT pg_temp.try_move('observation', '40000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000f',
  '0a000000-0000-0000-0000-0000000000a0') AS owner_observation \gset
SELECT pg_temp.subxact_proof() AS subxact \gset
SELECT pg_temp.second_row_after_move() AS repeat_case \gset
RESET ROLE;
SELECT t_assert(:'owner_move' = 'ok true', 'the owner''s signed-in move succeeds');
SELECT t_assert((SELECT vehicle_id FROM vehicle_images WHERE id = '30000000-0000-0000-0000-000000000001') = 'f0000000-0000-0000-0000-00000000000f',
  'the photo is on the target');
SELECT t_assert((SELECT count(*) FROM reattribution_audit WHERE old_observation_id = '30000000-0000-0000-0000-000000000001'
  AND old_vehicle_id = 'e0000000-0000-0000-0000-00000000000e' AND new_vehicle_id = 'f0000000-0000-0000-0000-00000000000f'
  AND actor_user_id = '0a000000-0000-0000-0000-0000000000a0' AND reason = 'signed_in_move: contract move') = 1,
  'exactly one audit row for the move, actor = the owner, reason under the signed_in_move kind');
SELECT t_assert(:'writer_no_move' LIKE 'refused 42501:%not moved by this transaction%', 'a direct writer call with no move in its transaction is refused');
SELECT t_assert(:'writer_not_on_target' LIKE 'refused 42501:%is not on vehicle%', 'a direct writer call for a photo not on the target is refused');
SELECT t_assert(:'writer_bad_kind' LIKE 'refused 22023:%not allowed%', 'a reason kind other than signed_in_move is refused');
SELECT t_assert(:'owner_observation' LIKE 'refused RL001:%cannot move an observation%', 'a signed-in observation move is refused up front (RL001)');
SELECT t_assert((SELECT vehicle_id FROM vehicle_observations WHERE id = '40000000-0000-0000-0000-000000000001') = 'e0000000-0000-0000-0000-00000000000e',
  'the refused observation move wrote nothing');
SELECT t_assert(:'subxact' = 'subxact=true writer=true', 'the writer accepts a move made in a subtransaction (xmin is not the top-level id)');
SELECT t_assert(split_part(:'repeat_case', ' | ', 1) = 'true', 'the owner moves a photo onto F in one transaction');
SELECT t_assert(split_part(:'repeat_case', ' | ', 2) LIKE 'refused 42501:%already has its audit row in this transaction%',
  'a second writer call for the same photo in that transaction is refused');
SELECT t_assert(split_part(:'repeat_case', ' | ', 3) LIKE 'refused 42501:%is not a source%', 'a stated source equal to the target is refused');
SELECT t_assert(split_part(:'repeat_case', ' | ', 4) LIKE 'refused 42501:%is not a source%',
  'a stated source the caller is not tied to (and the photo is not theirs) is refused');
SELECT t_assert((SELECT count(*) FROM reattribution_audit WHERE new_observation_id = '30000000-0000-0000-0000-000000000004') = 1,
  'exactly one audit row for that photo');
SELECT t_assert((SELECT count(*) FROM reattribution_audit) = 3, 'three audit rows: the owner''s two moves and the subtransaction proof');
SELECT t_assert(:owner_reads_audit = 0, 'a signed-in user reads no audit rows (no SELECT policy)');
SELECT t_assert(:'forged' = 'refused 42501', 'a direct audit insert naming another actor is refused (42501)');
SELECT t_assert(:'forged_self' = 'refused 42501', 'a direct audit insert naming oneself (the REST POST) is refused (42501)');
SELECT t_assert(NOT EXISTS (SELECT FROM reattribution_audit WHERE reason LIKE 'first_attribution:%'), 'no forged anchor row landed');

-- The uploader moves their own photo off a car they are not tied to, onto one they may edit.
SELECT pg_temp.as_user('0b000000-0000-0000-0000-0000000000b0');
SET ROLE authenticated;
-- The reason is the anchor shape capture_sets_score's own_filed read looks for.
SELECT pg_temp.try_move('image', '30000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-00000000000f',
  '0b000000-0000-0000-0000-0000000000b0', 'first_attribution: forged run signal=owner_session_confirm') AS uploader_move \gset
RESET ROLE;
SELECT t_assert(:'uploader_move' = 'ok true' AND (SELECT vehicle_id FROM vehicle_images WHERE id = '30000000-0000-0000-0000-000000000002')
  = 'f0000000-0000-0000-0000-00000000000f', 'the uploader moves their own photo');
-- capture_sets_score's own_filed predicate, verbatim (live 2026-11-25).
SELECT t_assert(NOT EXISTS (SELECT 1 FROM reattribution_audit ra WHERE ra.observation_type = 'image'
    AND ra.reason LIKE 'first\_attribution:%' ESCAPE '\' AND ra.reason LIKE '%signal=owner\_session\_confirm' ESCAPE '\'),
  'an anchor-shaped reason through a signed-in move does not feed capture_sets_score''s owner-filed read');
SELECT set_config('request.jwt.claims', '', false);

-- Grants: no end-user role inserts into the audit; anon cannot call the writer.
SELECT t_assert(NOT has_table_privilege('authenticated', 'public.reattribution_audit', 'INSERT')
  AND NOT has_table_privilege('anon', 'public.reattribution_audit', 'INSERT'), 'anon and authenticated hold no INSERT on reattribution_audit');
SELECT t_assert(NOT has_function_privilege('anon', 'public.reattribution_audit_record_move(uuid,uuid,uuid,text,text)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.reattribution_audit_record_move(uuid,uuid,uuid,text,text)', 'EXECUTE'),
  'the writer is callable by authenticated only (anon and PUBLIC revoked)');
SELECT t_assert((SELECT prosecdef AND proconfig @> ARRAY['search_path=pg_catalog, public'] FROM pg_proc
  WHERE oid = 'public.reattribution_audit_record_move(uuid,uuid,uuid,text,text)'::regprocedure), 'the writer is SECURITY DEFINER with search_path pinned');
SELECT t_assert(NOT has_table_privilege('authenticated', 'public.reattribution_reason_kinds', 'INSERT,UPDATE,DELETE')
  AND NOT has_table_privilege('anon', 'public.reattribution_reason_kinds', 'INSERT,UPDATE,DELETE')
  AND (SELECT array_agg(kind) FROM public.reattribution_reason_kinds WHERE signed_in) = ARRAY['signed_in_move'],
  'the allowed-kind key holds signed_in_move only, and no end-user role can write it');
SELECT t_assert((SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.reattribution_reason_kinds'::regclass AND contype = 'c'
  AND pg_get_constraintdef(oid) LIKE '%first_attribution%') = 1, 'the key refuses the kind first_attribution');

-- Re-apply: the guard accepts its own body and nothing changes.
SELECT md5(pg_get_functiondef('public.relink_testimony(text,uuid,uuid,text,uuid,text)'::regprocedure)) AS after_md5 \gset
\ir ../migrations/20261126001000_relink_testimony_signed_in_audit.sql
SELECT t_assert(md5(pg_get_functiondef('public.relink_testimony(text,uuid,uuid,text,uuid,text)'::regprocedure)) = :'after_md5',
  're-applying the migration changes nothing');
SELECT t_assert(:'after_md5' = 'f9b1c2e7219bc4723a3d6907fa1f95bf', 'the after-fingerprint in the guard is this body''s'); -- gitleaks:allow (function-definition fingerprint, not a secret)
