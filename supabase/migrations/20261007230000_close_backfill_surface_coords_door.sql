-- 20261007230000_close_backfill_surface_coords_door.sql
--
-- Close one RPC write door the 2026-09-27 pass (20260927170000_p0_4_close_rpc_write_door.sql) did not list:
-- public.backfill_surface_coords(integer) is SECURITY DEFINER, writes surface_observations (UPDATE of the inch
-- coordinate columns from vehicle_surface_templates), and on 2026-10-07 its ACL still granted EXECUTE to PUBLIC, anon and
-- authenticated ({=X/postgres, anon=X/postgres, authenticated=X/postgres, service_role=X/postgres}), so anyone holding the
-- public anon key could run it at /rest/v1/rpc/backfill_surface_coords. Found by the describe-batch5 lane while describing
-- surface_observations (PR #796).
--
-- EVIDENCE (read-only, prod, 2026-10-07 11:58Z): prosecdef true; has_function_privilege('anon', ..., 'EXECUTE') true,
-- same for authenticated; no caller on origin/main in supabase/functions, nuke_frontend/src, scripts or mcp-server;
-- surface_observations has had no write since the statistics counters began (its three writers are offline Python jobs).
--
-- WHAT: the same treatment as class (c) of the 2026-09-27 pass: REVOKE EXECUTE from PUBLIC, anon and authenticated; keep
-- service_role (edge functions and cron). The function body is unchanged. Idempotent.
-- Reversal: GRANT EXECUTE ON FUNCTION public.backfill_surface_coords(integer) TO anon, authenticated;
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

REVOKE ALL ON FUNCTION public.backfill_surface_coords(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_surface_coords(integer) TO service_role;

COMMENT ON FUNCTION public.backfill_surface_coords(integer) IS
'Backfill spatial inch coordinates for surface_observations from vehicle_surface_templates. Call repeatedly until remaining=0. SECURITY DEFINER writer: EXECUTE for service_role only since 2026-10-07 (20261007230000; anon and authenticated could run it before, missed by the 2026-09-27 RPC write-door pass). No caller in the repo on 2026-10-07; surface_observations has no live writer.';

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.backfill_surface_coords(integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.backfill_surface_coords(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'backfill_surface_coords is still executable by anon or authenticated';
  END IF;
  RAISE NOTICE 'backfill_surface_coords: EXECUTE for service_role only';
END $$;

COMMIT;
