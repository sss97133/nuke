-- vehicles read policies: a deleted car is public only as a merge redirect, by the one predicate the readers use.
--
-- WHY. vehicles_public_select admits any row with is_public = true, so a deleted car still flagged public is readable
-- by anon and every signed-in stranger through PostgREST, and through every other table's policy that consults
-- vehicles (68 tables' SELECT/ALL policies reference it, live 2026-11-25). Prod 2026-11-25 (read-only, counts only,
-- 185 of 256 primary-key slices = 1,076,292 rows): 64,362 deleted and public, 39,600 of them not merged; about 89k and
-- 55k for the table. The 34,527 merged stubs stay readable: the page redirects from them to merged_into_vehicle_id.
-- vehicle_row_read (20261125214500) and get_vehicle_profile_data (20261125225500) already answer with this rule; the
-- table was the last copy that did not.
--
-- WHAT. Two ALTER POLICY, one predicate (public.vehicle_publicly_readable, plain SQL, IMMUTABLE, inlined at plan time;
-- created by 20261125214500 and recreated here with the identical body so this applies on its own):
--   vehicles_public_select:  vehicle_publicly_readable(is_public, deleted_at, merged_into_vehicle_id) OR service_role
--                            (was is_public = true OR service_role).
--   vehicles_private_select: NOT vehicle_publicly_readable(...) AND <the same insider test as before>
--                            (was is_public = false AND <insider>), so an owner, uploader, user or tied contributor still
--                            reads their deleted car: before, a deleted public car reached them only through the public
--                            policy. is_public has no null rows (pg_stats null_frac 0), so no other insider answer moves.
--   For anon: deleted and unmerged public cars are no longer visible; nothing else changes. For a signed-in stranger: the
--   same. For an insider: nothing changes. The service role: nothing changes.
-- vehicles_anon_public_only (#3911, RESTRICTIVE, anon) is independent of this and must not deploy in the same run.
-- Policy copies (private_row_policy_copies, when present): a copy whose recorded hash was current just before is
-- re-recorded just after; the guard requires both definer readers to call the predicate already, so they agree.
-- Watch: a private_row_probes row (when present) samples 50 deleted, unmerged public cars and counts what anon and a
-- signed-in stranger read of them: expected 0 after this deploys.
-- EXPLAIN (prod, 2026-11-25, the five most-called anon statements on vehicles in pg_stat_statements, 7,726-8,980 calls
-- each; EXPLAIN ANALYZE, median of three, before = live policies as anon, after = the new quals written out for anon):
-- same plan shapes (four by-id: Index Scan vehicles_pkey; one page: Seq Scan under Limit), 0.12-0.19 ms either way.
-- Child reads through a policy subquery on vehicles (the #2293 class), same method, median of 5 interleaved: the two
-- most-called anon vehicle_images statements (10,274 and 7,730 calls) 20.2 -> 20.1 and 20.1 -> 16.3 ms; the
-- vehicle_events + lateral vehicles statement (3,473 calls) 3.6 -> 2.0 ms; same plan shapes.
-- CONTRACT: supabase/sql/test_vehicles_policy_deleted_gate.sql (PG17). REVERSAL:
-- supabase/sql/revert_20261125225000_vehicles_policy_deleted_gate.sql.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $guard$
DECLARE pub text; priv text;
BEGIN
  SELECT md5(qual) INTO pub FROM pg_policies WHERE schemaname = 'public' AND tablename = 'vehicles' AND policyname = 'vehicles_public_select';
  SELECT md5(qual) INTO priv FROM pg_policies WHERE schemaname = 'public' AND tablename = 'vehicles' AND policyname = 'vehicles_private_select';
  -- The live quals (2026-11-25), or this migration's own on a re-run.
  IF NOT ((pub = 'bff26993e09e17fa0a65c86b36a7634a' AND priv = '9f5079189d0163734d6fa1e83a2a388b')
          OR (position('vehicle_publicly_readable' in coalesce((SELECT qual FROM pg_policies WHERE schemaname = 'public'
                AND tablename = 'vehicles' AND policyname = 'vehicles_public_select'), '')) > 0)) THEN
    RAISE EXCEPTION 'vehicles read policies are not the 2026-11-25 ones (md5 % / %); review', pub, priv;
  END IF;
  -- The two definer readers that restate this rule must already carry it, so the table and the readers agree.
  IF position('vehicle_publicly_readable' in (SELECT prosrc FROM pg_proc WHERE oid = 'public.vehicle_row_read(uuid)'::regprocedure)) = 0
     OR position('vehicle_publicly_readable' in (SELECT prosrc FROM pg_proc WHERE oid = 'public.get_vehicle_profile_data(uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'deploy 20261125214500 (vehicle_row_read) and 20261125225500 (get_vehicle_profile_data) first';
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.vehicle_publicly_readable(p_is_public boolean, p_deleted_at timestamptz, p_merged_into_vehicle_id uuid)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  SELECT coalesce(p_is_public, false) AND (p_deleted_at IS NULL OR p_merged_into_vehicle_id IS NOT NULL)
$function$;
-- The policies apply TO public, so every role that may read vehicles must be able to execute (and so inline) the
-- predicate: live 2026-11-25, pg_read_all_data selects vehicles without bypassing RLS and had no EXECUTE. It reads no
-- data, so PUBLIC.
GRANT EXECUTE ON FUNCTION public.vehicle_publicly_readable(boolean, timestamptz, uuid) TO PUBLIC, anon, authenticated, service_role;

CREATE TEMP TABLE _vehicles_copy_before AS SELECT NULL::text AS reader, NULL::text AS policy_filter, NULL::text AS h LIMIT 0;
DO $b$ BEGIN
  IF to_regclass('public.private_row_policy_copies') IS NOT NULL THEN
    INSERT INTO _vehicles_copy_before
    SELECT c.reader, c.policy_filter, (SELECT policy_hash FROM public.private_row_policy_hash('vehicles', c.policy_filter))
      FROM public.private_row_policy_copies c WHERE c.relation = 'vehicles';
  END IF;
END $b$;

ALTER POLICY vehicles_public_select ON public.vehicles
  USING (public.vehicle_publicly_readable(is_public, deleted_at, merged_into_vehicle_id) OR (auth.role() = 'service_role'::text));
ALTER POLICY vehicles_private_select ON public.vehicles
  USING ((NOT public.vehicle_publicly_readable(is_public, deleted_at, merged_into_vehicle_id))
         AND ((SELECT auth.uid() AS uid) IS NOT NULL)
         AND (((SELECT auth.uid() AS uid) = user_id) OR ((SELECT auth.uid() AS uid) = owner_id)
              OR ((SELECT auth.uid() AS uid) = uploaded_by) OR public.vehicle_user_has_access(id, (SELECT auth.uid() AS uid))));
COMMENT ON POLICY vehicles_public_select ON public.vehicles IS
  'vehicles_policy_deleted_gate_v1: everyone reads a car that vehicle_publicly_readable admits (public, and not deleted unless merged, so a merged stub can redirect); the service role reads all. Migration 20261125225000.';
COMMENT ON POLICY vehicles_private_select ON public.vehicles IS
  'vehicles_policy_deleted_gate_v1: owner, user, uploader and tied contributors read every car vehicle_publicly_readable does not admit (private or deleted). Migration 20261125225000.';

DO $a$ BEGIN
  IF to_regclass('public.private_row_policy_copies') IS NOT NULL THEN
    UPDATE public.private_row_policy_copies c
       SET recorded_hash = (SELECT policy_hash FROM public.private_row_policy_hash('vehicles', c.policy_filter)),
           recorded_at = now(),
           note = c.note || ' [re-recorded by 20261125225000: vehicles policies on vehicle_publicly_readable]'
      FROM _vehicles_copy_before b
     WHERE c.relation = 'vehicles' AND c.reader = b.reader AND c.policy_filter = b.policy_filter
       AND c.recorded_hash = b.h
       AND b.h IS DISTINCT FROM (SELECT policy_hash FROM public.private_row_policy_hash('vehicles', c.policy_filter));
  END IF;
END $a$;
DROP TABLE _vehicles_copy_before;

DO $w$ BEGIN
  IF to_regclass('public.private_row_probes') IS NOT NULL THEN
    INSERT INTO public.private_row_probes (rank, relation, row_key, subject_kind, subject_column, reader, sample_filter,
                                           owner_lane, note, audiences, active, sample_size)
    VALUES (24, 'vehicles', 'id', 'vehicle', 'id', '',
            'x.is_public AND x.deleted_at IS NOT NULL AND x.merged_into_vehicle_id IS NULL', 'ta-provenance',
            'deleted, unmerged cars still flagged public: none readable outside their insiders (20261125225000)',
            '{anon,authenticated}', true, 50)
    ON CONFLICT (relation, subject_kind, subject_column, reader) DO NOTHING;
  END IF;
END $w$;

DO $check$
DECLARE pub text; priv text;
BEGIN
  SELECT qual INTO pub FROM pg_policies WHERE schemaname = 'public' AND tablename = 'vehicles' AND policyname = 'vehicles_public_select';
  SELECT qual INTO priv FROM pg_policies WHERE schemaname = 'public' AND tablename = 'vehicles' AND policyname = 'vehicles_private_select';
  IF position('vehicle_publicly_readable' in pub) = 0 OR position('NOT vehicle_publicly_readable' in priv) = 0
     OR position('vehicle_user_has_access' in priv) = 0 OR position('service_role' in pub) = 0 THEN
    RAISE EXCEPTION 'vehicles policies not as intended';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = 'public.vehicle_publicly_readable(boolean,timestamptz,uuid)'::regprocedure
                 AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'sql') AND NOT p.prosecdef
                 AND p.proconfig IS NULL AND p.provolatile = 'i'
                 AND NOT EXISTS (SELECT 1 FROM pg_roles r WHERE NOT r.rolsuper AND NOT r.rolbypassrls
                                   AND has_any_column_privilege(r.oid, 'public.vehicles', 'SELECT')
                                   AND NOT has_function_privilege(r.oid, p.oid, 'EXECUTE'))) THEN
    RAISE EXCEPTION 'vehicle_publicly_readable not inlinable, or a role that reads vehicles under RLS cannot execute it';
  END IF;
END $check$;
COMMIT;
