-- Isolated PostgreSQL 17 contract for 20261016221500_supersede_image_vehicle_suggestions.sql.
-- Synthetic rows only; never production. Run in an empty disposable dm_refinement_* database:
--   createdb dm_refinement_supersede_image_vehicle_suggestions
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_supersede_image_vehicle_suggestions \
--     -f supabase/sql/test_supersede_image_vehicle_suggestions.sql
-- Fixtures carry the live shapes read from prod on 2026-10-15: the vehicle_images columns the migration reads and
-- writes, reattribution_audit (columns, observation_type check, both vehicle FKs), vehicles' merge columns and
-- relink_testimony as live (pg_get_functiondef). Cases:
--   * the writer: compare-and-set, the 1,000-id cap, a required reason, a live target, an audit row per change with the
--     filing untouched, the status reset only on a clear, a re-run changing nothing, service_role only;
--   * the owner's rows: an upload-clock suggestion with no clock support is cleared (any source); one with a photo of that
--     vehicle (or of the vehicle it was merged into) within 90 minutes is kept; rows with reasons, superseded rows, a row
--     filed on its suggestion and another user's rows are untouched;
--   * merged vehicles: suggestions repointed to the end of a two-hop chain; live filings moved by relink_testimony with
--     merged_from_vehicle_id and an audit row; a filing whose file is already on the target is refused and left;
--     superseded filings stay; the held merge eeb9fa61 is never followed (its suggestion and filing stay, and its
--     photos are not evidence for the vehicle it was merged into);
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
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dm_contract_deployer') THEN CREATE ROLE dm_contract_deployer NOLOGIN; END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' $$;
GRANT USAGE ON SCHEMA auth TO PUBLIC;

-- Prod's deploy role owns the tables and is not a superuser; the fixture is built, and the migration applied, as one.
GRANT CREATE ON SCHEMA public TO dm_contract_deployer;
SET ROLE dm_contract_deployer;
DO $$ BEGIN
  IF (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'the contract must run as a non-superuser after SET ROLE';
  END IF;
END $$;

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;

-- Live shapes -------------------------------------------------------------------------------------------------------
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, merged_into_vehicle_id uuid, deleted_at timestamptz);
CREATE TABLE public.vehicle_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid,
  user_id uuid,
  source text,
  suggested_vehicle_id uuid,
  image_vehicle_match_status text,
  auto_suggestion_reasons text[],
  taken_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  is_superseded boolean DEFAULT false,
  file_hash text,
  is_primary boolean DEFAULT false,
  is_document boolean DEFAULT false,
  is_duplicate boolean DEFAULT false,
  merged_from_vehicle_id uuid
);
CREATE INDEX idx_vehicle_images_user_created ON public.vehicle_images (user_id, created_at DESC);
CREATE INDEX idx_vehicle_images_suggested_vehicle ON public.vehicle_images (suggested_vehicle_id) WHERE suggested_vehicle_id IS NOT NULL;
CREATE TABLE public.reattribution_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  observation_type text NOT NULL CHECK (observation_type = ANY (ARRAY['image'::text, 'observation'::text])),
  old_observation_id uuid NOT NULL,
  old_vehicle_id uuid REFERENCES public.vehicles(id),
  new_observation_id uuid NOT NULL,
  new_vehicle_id uuid REFERENCES public.vehicles(id),
  reason text NOT NULL,
  actor_user_id uuid,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE public.vehicle_observations (id uuid PRIMARY KEY, vehicle_id uuid, merged_from_vehicle_id uuid);
CREATE FUNCTION public.user_can_edit_vehicle(p_vehicle_id uuid, p_user_id uuid) RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT false $$;

-- relink_testimony exactly as live on 2026-10-15 (pg_get_functiondef).
CREATE OR REPLACE FUNCTION public.relink_testimony(p_observation_type text, p_observation_id uuid, p_target_vehicle_id uuid, p_reason text, p_actor_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_old_vehicle_id uuid;
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
  IF p_observation_type NOT IN ('image', 'observation') THEN
    RAISE EXCEPTION 'observation_type must be image or observation, got %', p_observation_type;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM vehicles WHERE id = p_target_vehicle_id) THEN
    RAISE EXCEPTION 'target vehicle % does not exist', p_target_vehicle_id;
  END IF;

  IF p_observation_type = 'image' THEN
    SELECT vehicle_id, COALESCE(is_primary, false), file_hash
      INTO v_old_vehicle_id, v_is_primary, v_file_hash
      FROM vehicle_images WHERE id = p_observation_id;

    IF v_old_vehicle_id IS NULL THEN
      RAISE EXCEPTION 'image % not found (or vehicle_id is null)', p_observation_id;
    END IF;

    IF v_old_vehicle_id = p_target_vehicle_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'target_same_as_current',
                                'observation_id', p_observation_id);
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
           merged_from_vehicle_id = v_old_vehicle_id,
           is_primary = CASE WHEN v_demoted THEN false ELSE is_primary END,
           updated_at = NOW()
     WHERE id = p_observation_id;

  ELSE
    SELECT vehicle_id INTO v_old_vehicle_id
      FROM vehicle_observations WHERE id = p_observation_id;

    IF v_old_vehicle_id IS NULL THEN
      RAISE EXCEPTION 'observation % not found (or vehicle_id is null)', p_observation_id;
    END IF;

    IF v_old_vehicle_id = p_target_vehicle_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'target_same_as_current',
                                'observation_id', p_observation_id);
    END IF;

    UPDATE vehicle_observations
       SET vehicle_id = p_target_vehicle_id,
           merged_from_vehicle_id = v_old_vehicle_id
     WHERE id = p_observation_id;
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
    'merged_from_vehicle_id', v_old_vehicle_id,
    'demoted_primary', v_demoted);
END;
$function$;

-- Synthetic world ----------------------------------------------------------------------------------------------------
-- O is the owner the migration names; X is another user.
CREATE TEMP TABLE ids (k text PRIMARY KEY, id uuid);
INSERT INTO ids VALUES
  ('O', '0b9f107a-d124-49de-9ded-94698f63c1c4'), ('X', 'a0000000-0000-0000-0000-0000000000b2'),
  ('truck',    'c0000000-0000-0000-0000-000000000001'),  -- the upload-clock pick
  ('mustang',  'c0000000-0000-0000-0000-000000000002'),  -- live merge target
  ('mustang1', 'c0000000-0000-0000-0000-000000000003'),  -- merged into mustang2
  ('mustang2', 'c0000000-0000-0000-0000-000000000004'),  -- merged into mustang (two hops)
  ('charger',  'c0000000-0000-0000-0000-000000000005'),
  ('charger_dup', 'c0000000-0000-0000-0000-000000000006'), -- merged into charger
  ('other',    'c0000000-0000-0000-0000-000000000007'),
  ('held',     'eeb9fa61-01e8-49a6-8eab-a7cc0e23d30f');  -- the real id of the merge held for an un-merge
CREATE FUNCTION pg_temp.v(k text) RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT id FROM ids WHERE ids.k = $1 $$;
INSERT INTO public.vehicles VALUES
  (pg_temp.v('truck'), NULL, NULL), (pg_temp.v('mustang'), NULL, NULL), (pg_temp.v('charger'), NULL, NULL),
  (pg_temp.v('other'), NULL, NULL),
  (pg_temp.v('mustang2'), pg_temp.v('mustang'), '2026-06-24'), (pg_temp.v('mustang1'), pg_temp.v('mustang2'), '2026-06-24'),
  (pg_temp.v('charger_dup'), pg_temp.v('charger'), '2026-06-24'),
  (pg_temp.v('held'), pg_temp.v('mustang'), '2026-05-24');

CREATE FUNCTION pg_temp.img(label text, owner text, src text, filed text, suggested text, status text, reasons text[],
  taken timestamptz, created timestamptz, superseded boolean DEFAULT false, hash text DEFAULT NULL)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.vehicle_images (id, user_id, source, vehicle_id, suggested_vehicle_id, image_vehicle_match_status,
    auto_suggestion_reasons, taken_at, created_at, is_superseded, file_hash)
  VALUES (md5(label)::uuid, pg_temp.v(owner), src, pg_temp.v(filed), pg_temp.v(suggested), status, reasons,
    taken, created, superseded, hash)
$$;
CREATE FUNCTION pg_temp.row_of(label text) RETURNS public.vehicle_images LANGUAGE sql STABLE AS
$$ SELECT * FROM public.vehicle_images WHERE id = md5(label)::uuid $$;

-- Evidence: O's live filed photos of the truck on 2026-06-14 10:00 and of the mustang on 2026-06-15 12:00; a superseded
-- truck photo on 2026-06-16 (not evidence).
SELECT pg_temp.img('filed truck', 'O', 'capture_relay_ios', 'truck', NULL, NULL, NULL, '2026-06-14 10:00', '2026-06-15 01:00');
SELECT pg_temp.img('filed mustang', 'O', 'iphoto', 'mustang', NULL, NULL, NULL, '2026-06-15 12:00', '2026-06-15 02:00');
SELECT pg_temp.img('superseded truck', 'O', 'capture_relay_ios', 'truck', NULL, NULL, NULL, '2026-06-16 10:00', '2026-06-15 03:00', true);
-- Upload-clock suggestions.
SELECT pg_temp.img('phone 2017', 'O', 'capture_relay_ios', NULL, 'truck', 'ambiguous', NULL, '2017-09-11 09:00', '2026-06-15 04:00');
SELECT pg_temp.img('phone same burst', 'O', 'capture_relay_ios', NULL, 'truck', 'ambiguous', NULL, '2026-06-14 11:15', '2026-06-15 04:01');
SELECT pg_temp.img('phone near superseded', 'O', 'capture_relay_ios', NULL, 'truck', 'ambiguous', '{}', '2026-06-16 10:30', '2026-06-15 04:02');
SELECT pg_temp.img('iphoto 2019', 'O', 'iphoto', NULL, 'truck', 'ambiguous', NULL, '2019-03-01 09:00', '2026-09-28 21:00');
SELECT pg_temp.img('merged burst', 'O', 'capture_relay_ios', NULL, 'mustang1', 'ambiguous', NULL, '2026-06-15 13:00', '2026-06-15 04:03');
SELECT pg_temp.img('merged no burst', 'O', 'capture_relay_ios', NULL, 'mustang1', 'ambiguous', NULL, '2024-01-01 09:00', '2026-06-15 04:04');
-- Not upload-clock shape, or not the owner's, or superseded, or filed on its suggestion: untouched by the clear.
SELECT pg_temp.img('with reasons', 'O', 'capture_relay_ios', NULL, 'truck', 'ambiguous', '{day-classifier: x}', '2018-01-01', '2026-06-15 04:05');
SELECT pg_temp.img('other user', 'X', 'capture_relay_ios', NULL, 'truck', 'ambiguous', NULL, '2018-01-01', '2026-06-15 04:06');
SELECT pg_temp.img('superseded shape', 'O', 'capture_relay_ios', NULL, 'truck', 'ambiguous', NULL, '2018-01-01', '2026-06-15 04:07', true);
SELECT pg_temp.img('filed on suggestion', 'O', 'capture_relay_ios', 'truck', 'truck', 'ambiguous', NULL, '2018-01-01', '2026-06-15 04:08');
-- A non-shape suggestion on a merged vehicle (repointed), one on a superseded row (left).
SELECT pg_temp.img('merged with reasons', 'O', 'capture_relay_ios', NULL, 'mustang2', 'ambiguous', '{gps}', '2018-01-01', '2026-06-15 04:09');
SELECT pg_temp.img('merged superseded', 'O', 'capture_relay_ios', NULL, 'mustang2', NULL, NULL, '2018-01-01', '2026-06-15 04:10', true);
-- The held merge: a filing and a suggestion that must stay, and a mustang suggestion 30 minutes from the held photo
-- (3.5 hours from any mustang photo) that the held photo must not support.
SELECT pg_temp.img('held filed', 'O', 'iphoto', 'held', NULL, NULL, NULL, '2026-06-15 15:00', '2026-06-15 05:00');
SELECT pg_temp.img('held suggestion', 'O', 'capture_relay_ios', NULL, 'held', 'ambiguous', '{gps}', '2018-01-01', '2026-06-15 05:01');
SELECT pg_temp.img('near held photo', 'O', 'capture_relay_ios', NULL, 'mustang', 'ambiguous', NULL, '2026-06-15 15:30', '2026-06-15 05:02');
-- Filings on a merged vehicle: moved; one whose file is already on the target is refused; a superseded one stays.
SELECT pg_temp.img('charger on dup', 'O', 'iphoto', 'charger_dup', NULL, NULL, NULL, '2026-03-01', '2026-03-20 10:00', false, 'h1');
SELECT pg_temp.img('charger dup file', 'O', 'iphoto', 'charger_dup', NULL, NULL, NULL, '2026-03-01', '2026-03-20 10:01', false, 'h2');
SELECT pg_temp.img('charger target file', 'O', 'iphoto', 'charger', NULL, NULL, NULL, '2026-03-01', '2026-03-20 10:02', false, 'h2');
SELECT pg_temp.img('charger dup superseded', 'O', 'iphoto', 'charger_dup', NULL, NULL, NULL, '2026-03-01', '2026-03-20 10:03', true);
SELECT pg_temp.img('other user on dup', 'X', 'iphoto', 'charger_dup', NULL, NULL, NULL, '2026-03-01', '2026-03-20 10:04');

-- The migration, as the deploy role ------------------------------------------------------------------------------------
\ir ../migrations/20261016221500_supersede_image_vehicle_suggestions.sql
SET statement_timeout = '60s';

SELECT pg_temp.ok('clear: a 2017 phone photo no longer suggests the upload-week truck; its status is reset',
  (SELECT suggested_vehicle_id IS NULL AND image_vehicle_match_status IS NULL AND vehicle_id IS NULL FROM pg_temp.row_of('phone 2017')));
SELECT pg_temp.ok('clear: any source (an iphoto row of the same shape is cleared)',
  (SELECT suggested_vehicle_id IS NULL FROM pg_temp.row_of('iphoto 2019')));
SELECT pg_temp.ok('clear: a superseded photo is not evidence (the photo 30 minutes from it is cleared)',
  (SELECT suggested_vehicle_id IS NULL FROM pg_temp.row_of('phone near superseded')));
SELECT pg_temp.ok('keep: a photo 75 minutes from a filed photo of the truck keeps its suggestion',
  (SELECT suggested_vehicle_id = pg_temp.v('truck') AND image_vehicle_match_status = 'ambiguous' FROM pg_temp.row_of('phone same burst')));
SELECT pg_temp.ok('keep, then repoint: burst support through the merge chain keeps the suggestion and moves it to the live vehicle',
  (SELECT suggested_vehicle_id = pg_temp.v('mustang') AND image_vehicle_match_status = 'ambiguous' FROM pg_temp.row_of('merged burst')));
SELECT pg_temp.ok('clear: a merged-vehicle suggestion with no clock support is cleared, not repointed',
  (SELECT suggested_vehicle_id IS NULL FROM pg_temp.row_of('merged no burst')));
SELECT pg_temp.ok('untouched: rows with reasons, another user''s, superseded, filed on the suggestion',
  (SELECT suggested_vehicle_id = pg_temp.v('truck') FROM pg_temp.row_of('with reasons'))
  AND (SELECT suggested_vehicle_id = pg_temp.v('truck') FROM pg_temp.row_of('other user'))
  AND (SELECT suggested_vehicle_id = pg_temp.v('truck') FROM pg_temp.row_of('superseded shape'))
  AND (SELECT suggested_vehicle_id = pg_temp.v('truck') AND vehicle_id = pg_temp.v('truck') FROM pg_temp.row_of('filed on suggestion')));
SELECT pg_temp.ok('repoint: a suggestion on a twice-merged vehicle points at the end of the chain; status kept',
  (SELECT suggested_vehicle_id = pg_temp.v('mustang') AND image_vehicle_match_status = 'ambiguous' FROM pg_temp.row_of('merged with reasons')));
SELECT pg_temp.ok('repoint: a superseded row keeps its old suggestion',
  (SELECT suggested_vehicle_id = pg_temp.v('mustang2') FROM pg_temp.row_of('merged superseded')));
SELECT pg_temp.ok('filings: a live photo on the merged charger moves to the charger, with lineage',
  (SELECT vehicle_id = pg_temp.v('charger') AND merged_from_vehicle_id = pg_temp.v('charger_dup') FROM pg_temp.row_of('charger on dup')));
SELECT pg_temp.ok('filings: a photo whose file is already on the target is refused and left; superseded and other users stay',
  (SELECT vehicle_id = pg_temp.v('charger_dup') FROM pg_temp.row_of('charger dup file'))
  AND (SELECT vehicle_id = pg_temp.v('charger_dup') FROM pg_temp.row_of('charger dup superseded'))
  AND (SELECT vehicle_id = pg_temp.v('charger_dup') FROM pg_temp.row_of('other user on dup')));
SELECT pg_temp.ok('held merge: its filing and its suggestion stay; its photo supports nothing on the vehicle it was merged into',
  (SELECT vehicle_id = pg_temp.v('held') AND merged_from_vehicle_id IS NULL FROM pg_temp.row_of('held filed'))
  AND (SELECT suggested_vehicle_id = pg_temp.v('held') FROM pg_temp.row_of('held suggestion'))
  AND (SELECT suggested_vehicle_id IS NULL FROM pg_temp.row_of('near held photo'))
  AND NOT EXISTS (SELECT 1 FROM public.reattribution_audit
                  WHERE old_observation_id IN (md5('held filed')::uuid, md5('held suggestion')::uuid)));
SELECT pg_temp.ok('audit: one row per change; suggestion rows keep vehicle ids NULL and name both suggestions',
  (SELECT count(*) FROM public.reattribution_audit WHERE reason LIKE 'suggestion_superseded: upload-clock%') = 5
  AND (SELECT count(*) FROM public.reattribution_audit WHERE reason LIKE 'suggestion_superseded: suggested vehicle%') = 2
  AND (SELECT bool_and(old_vehicle_id IS NULL AND new_vehicle_id IS NULL AND old_observation_id = new_observation_id)
       FROM public.reattribution_audit WHERE reason LIKE 'suggestion_superseded:%')
  AND EXISTS (SELECT 1 FROM public.reattribution_audit WHERE old_observation_id = md5('phone 2017')::uuid
    AND reason LIKE '%suggested_vehicle_id ' || pg_temp.v('truck') || ' -> none; image_vehicle_match_status ambiguous -> null'));
SELECT pg_temp.ok('audit: the filing move is a relink_testimony row from the merged vehicle to the target',
  (SELECT count(*) FROM public.reattribution_audit
   WHERE old_observation_id = md5('charger on dup')::uuid AND old_vehicle_id = pg_temp.v('charger_dup')
     AND new_vehicle_id = pg_temp.v('charger') AND reason LIKE 'filed on merged vehicle%') = 1
  AND (SELECT count(*) FROM public.reattribution_audit WHERE reason LIKE 'filed on merged vehicle%') = 1);

-- The writer on its own -------------------------------------------------------------------------------------------------
SELECT pg_temp.ok('writer: a row that no longer suggests `from` is skipped (compare-and-set)',
  (public.supersede_image_vehicle_suggestion(ARRAY[md5('with reasons')::uuid], pg_temp.v('other'), NULL, 'test', NULL)->>'changed')::int = 0);
SELECT pg_temp.ok('writer: of two ids, only the one suggesting `from` changes',
  (public.supersede_image_vehicle_suggestion(ARRAY[md5('other user')::uuid, md5('charger dup file')::uuid], pg_temp.v('truck'), pg_temp.v('other'), 'test', NULL)->>'changed')::int = 1);
SELECT pg_temp.ok('writer: repointing keeps the status and never touches vehicle_id; one audit row',
  (SELECT suggested_vehicle_id = pg_temp.v('other') AND vehicle_id IS NULL AND image_vehicle_match_status = 'ambiguous'
   FROM pg_temp.row_of('other user'))
  AND (SELECT suggested_vehicle_id IS NULL AND vehicle_id = pg_temp.v('charger_dup') FROM pg_temp.row_of('charger dup file'))
  AND (SELECT count(*) FROM public.reattribution_audit WHERE reason LIKE 'suggestion_superseded: test;%') = 1);
DO $$ BEGIN
  BEGIN
    PERFORM public.supersede_image_vehicle_suggestion(ARRAY[md5('with reasons')::uuid], pg_temp.v('truck'), NULL, ' ', NULL);
    RAISE EXCEPTION 'no error';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%a reason is required%' THEN RAISE EXCEPTION 'Contract failed: blank reason: %', SQLERRM; END IF;
  END;
  BEGIN
    PERFORM public.supersede_image_vehicle_suggestion(ARRAY[md5('with reasons')::uuid], pg_temp.v('truck'), pg_temp.v('mustang2'), 'test', NULL);
    RAISE EXCEPTION 'no error';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%is not a live vehicle%' THEN RAISE EXCEPTION 'Contract failed: merged target: %', SQLERRM; END IF;
  END;
  BEGIN
    PERFORM public.supersede_image_vehicle_suggestion(ARRAY(SELECT gen_random_uuid() FROM generate_series(1, 1001)), pg_temp.v('truck'), NULL, 'test', NULL);
    RAISE EXCEPTION 'no error';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%at most 1000 ids%' THEN RAISE EXCEPTION 'Contract failed: cap: %', SQLERRM; END IF;
  END;
  RAISE NOTICE 'PASS writer: a blank reason, a merged target and 1,001 ids are refused';
END $$;
SELECT pg_temp.ok('writer: service_role only',
  NOT has_function_privilege('anon', 'public.supersede_image_vehicle_suggestion(uuid[],uuid,uuid,text,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.supersede_image_vehicle_suggestion(uuid[],uuid,uuid,text,uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.supersede_image_vehicle_suggestion(uuid[],uuid,uuid,text,uuid)', 'EXECUTE'));

-- Re-applying the migration changes nothing.
CREATE TEMP TABLE before_reapply AS SELECT * FROM public.vehicle_images;
CREATE TEMP TABLE audit_before AS SELECT count(*) AS n FROM public.reattribution_audit;
\ir ../migrations/20261016221500_supersede_image_vehicle_suggestions.sql
SET statement_timeout = '60s';
SELECT pg_temp.ok('re-apply: no row changes and no new audit rows',
  NOT EXISTS (SELECT 1 FROM public.vehicle_images a JOIN before_reapply b USING (id)
              WHERE (a.vehicle_id, a.suggested_vehicle_id, a.image_vehicle_match_status)
                    IS DISTINCT FROM (b.vehicle_id, b.suggested_vehicle_id, b.image_vehicle_match_status))
  AND (SELECT count(*) FROM public.reattribution_audit) = (SELECT n FROM audit_before));

DO $$ BEGIN RAISE NOTICE 'ALL PASS test_supersede_image_vehicle_suggestions'; END $$;
