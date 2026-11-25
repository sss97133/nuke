-- vehicle_row_read: a merged stub redirects an outsider only to a car the public may open.
--
-- WHY. 20261125214500 answers a non-insider asking for a deleted merged car with {"id", "merged_into_vehicle_id"} so the
-- page can redirect. When the target is private, that answer names a private car's id. Prod 2026-11-25 (read-only, 8 of
-- 256 primary-key slices): 280 of 1,050 public stubs (26.7%), about 9.0k for the table, point at a private car; none at a
-- deleted, unmerged one. get_vehicle_profile_data and the web fallback answer such a stub as missing (20261125225500,
-- #3960); this reader still did.
--
-- WHAT. The same body as 20261125214500, plus one test before the redirect: the target must pass
-- vehicle_publicly_readable, or the stub answers NULL, exactly like a missing car. A public live (undeleted) car whose
-- merged_into_vehicle_id names a car the public may not open is projected with that column null (prod 2026-11-25,
-- read-only: 15 of 197 public live cars carrying the column; skeptic2's should-fix). Insiders of the car and the service
-- role read it whole as before; every other answer is unchanged. The vehicles table still shows merged_into_vehicle_id
-- on a stub row to anon; that half is a key on the stub (merged_target_public), designed on the board, not here.
-- Guard: the live body (sha256 cdd2d17f..., 20261125214500), or this one on a re-run.
-- CONTRACT: supabase/sql/test_vehicle_row_read_stub_target.sql (PG17). REVERSAL: re-apply 20261125214500's function
-- body (supabase/sql/revert_20261126020000_vehicle_row_read_stub_target.sql).
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';

DO $guard$
DECLARE s text := (SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') FROM pg_proc
                   WHERE oid = 'public.vehicle_row_read(uuid)'::regprocedure);
BEGIN
  IF s IS DISTINCT FROM 'cdd2d17f8c769b3bee02eb1c63b7b8e94ba29088eeb5adca9aad2af290baa775'
     AND position('vehicle_row_read_stub_target_v1' in coalesce((SELECT prosrc FROM pg_proc
           WHERE oid = 'public.vehicle_row_read(uuid)'::regprocedure), '')) = 0 THEN
    RAISE EXCEPTION 'vehicle_row_read is not the 20261125214500 body (sha256 %); review', s;
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.vehicle_row_read(p_vehicle_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row jsonb;
  v_public boolean;
  v_insider boolean;
  v_redirect uuid;
BEGIN
  -- vehicle_row_read_deleted_gate_v1: public means vehicle_publicly_readable; a deleted merged car is a redirect only.
  SELECT to_jsonb(v.*),
         public.vehicle_publicly_readable(v.is_public, v.deleted_at, v.merged_into_vehicle_id),
         CASE WHEN v.deleted_at IS NOT NULL THEN v.merged_into_vehicle_id END,
         coalesce(auth.role() = 'service_role', false)
           OR (v_uid IS NOT NULL AND (coalesce(v_uid IN (v.owner_id, v.user_id, v.created_by_user_id, v.uploaded_by), false)
                                     OR public.vehicle_user_has_access(v.id, v_uid)))
    INTO v_row, v_public, v_redirect, v_insider
  FROM public.vehicles v
  WHERE v.id = p_vehicle_id;
  IF v_row IS NULL OR NOT (v_public OR v_insider) THEN
    RETURN NULL;
  END IF;
  IF v_insider THEN
    RETURN v_row;
  END IF;
  IF v_redirect IS NOT NULL THEN
    -- vehicle_row_read_stub_target_v1: a redirect to a car that is not publicly readable (private, or deleted and
    -- unmerged) would name it to an outsider; answer as missing, as get_vehicle_profile_data does (20261125225500).
    IF NOT EXISTS (SELECT 1 FROM public.vehicles t WHERE t.id = v_redirect
                   AND public.vehicle_publicly_readable(t.is_public, t.deleted_at, t.merged_into_vehicle_id)) THEN
      RETURN NULL;
    END IF;
    RETURN jsonb_build_object('id', p_vehicle_id, 'merged_into_vehicle_id', v_redirect);
  END IF;
  -- vehicle_row_read_live_merge_target_v1: a live car can carry merged_into_vehicle_id too; the public row names that
  -- car only when the public may open it.
  IF v_row ->> 'merged_into_vehicle_id' IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.vehicles t WHERE t.id = (v_row ->> 'merged_into_vehicle_id')::uuid
                     AND public.vehicle_publicly_readable(t.is_public, t.deleted_at, t.merged_into_vehicle_id)) THEN
    v_row := jsonb_set(v_row, '{merged_into_vehicle_id}', 'null'::jsonb);
  END IF;
  RETURN public.vehicle_row_public_projection(v_row);
END;
$function$;


DO $check$
DECLARE f record;
BEGIN
  SELECT p.prosecdef, p.provolatile, p.proconfig, pg_get_function_result(p.oid) AS res,
         has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_x,
         position('vehicle_row_read_deleted_gate_v1' in p.prosrc) > 0 AND position('vehicle_row_read_stub_target_v1' in p.prosrc) > 0
           AND position('vehicle_row_read_live_merge_target_v1' in p.prosrc) > 0 AS marked
  INTO f FROM pg_proc p WHERE p.oid = 'public.vehicle_row_read(uuid)'::regprocedure;
  IF NOT (f.prosecdef AND f.provolatile = 's' AND f.proconfig = ARRAY['search_path=public'] AND f.res = 'jsonb'
          AND f.anon_x AND f.marked) THEN
    RAISE EXCEPTION 'vehicle_row_read not as intended';
  END IF;
END $check$;
COMMIT;
