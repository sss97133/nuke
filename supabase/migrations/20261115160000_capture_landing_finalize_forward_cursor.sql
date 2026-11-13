-- When a forward chunk finalizes with no clear sets, advance forward_cursor to t_to.
--
-- capture_landing_apply_chunk already does this after a gate-passed apply.
-- finalize_plan with n_clear=0 writes state=applied and never moves the cursor, so
-- capture_landing_tick keeps re-opening the same window (2026-11-10: 83af2b77 at
-- 11:30, finalized 11:40, fd97ce25 same 2026-10-28..2026-11-03 window at 11:50).
-- Manual / recent 0-clear finalizes do not move the forward cursor.
-- Does not change apply_chunk. Does not call capture_landing_gate_check.
-- Revert: supabase/sql/revert_20261115160000_capture_landing_finalize_forward_cursor.sql

SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $do$
DECLARE
  v_fn text;
  v_n int;
  v_old text := $ev$if n_clear = 0 then
    update capture_landing_chunks set state = 'applied', note = 'no set passed the score threshold; all held as proposals (capture_set_review)', updated_at = now() where id = c.id;
    return jsonb_build_object('chunk', c.id, 'state', 'applied', 'clear_sets', 0);
  end if;$ev$;
  v_new text := $ev$if n_clear = 0 then
    update capture_landing_chunks set state = 'applied', note = 'no set passed the score threshold; all held as proposals (capture_set_review)', updated_at = now() where id = c.id;
    if c.track = 'forward' then
      update capture_landing_config set forward_cursor = c.t_to, updated_at = now() where id = 1;  -- (20261115160000)
    end if;
    return jsonb_build_object('chunk', c.id, 'state', 'applied', 'clear_sets', 0);
  end if;$ev$;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_fn
    FROM pg_proc
   WHERE proname = 'capture_landing_finalize_plan' AND pronargs = 1 AND pronamespace = 'public'::regnamespace;
  IF v_fn IS NULL THEN RAISE EXCEPTION 'capture_landing_finalize_plan is not live'; END IF;
  IF position('(20261115160000)' in v_fn) > 0 THEN
    RAISE NOTICE 'capture_landing_finalize_plan already advances forward_cursor on a 0-clear forward finalize';
    RETURN;
  END IF;
  v_n := (length(v_fn) - length(replace(v_fn, v_old, ''))) / length(v_old);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'finalize_plan n_clear=0 block drifted (n=%); refusing forward_cursor patch', v_n;
  END IF;
  v_fn := replace(v_fn, v_old, v_new);
  EXECUTE v_fn;
END
$do$;

REVOKE ALL ON FUNCTION public.capture_landing_finalize_plan(uuid) FROM PUBLIC, anon, authenticated;
DO $g$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.capture_landing_finalize_plan(uuid) TO service_role;
  END IF;
END $g$;
