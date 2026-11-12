-- Inverse of 20261115160000: 0-clear finalize no longer moves forward_cursor.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $do$
DECLARE
  v_fn text;
  v_n int;
  v_new text := $ev$if n_clear = 0 then
    update capture_landing_chunks set state = 'applied', note = 'no set passed the score threshold; all held as proposals (capture_set_review)', updated_at = now() where id = c.id;
    if c.track = 'forward' then
      update capture_landing_config set forward_cursor = c.t_to, updated_at = now() where id = 1;  -- (20261115160000)
    end if;
    return jsonb_build_object('chunk', c.id, 'state', 'applied', 'clear_sets', 0);
  end if;$ev$;
  v_old text := $ev$if n_clear = 0 then
    update capture_landing_chunks set state = 'applied', note = 'no set passed the score threshold; all held as proposals (capture_set_review)', updated_at = now() where id = c.id;
    return jsonb_build_object('chunk', c.id, 'state', 'applied', 'clear_sets', 0);
  end if;$ev$;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_fn
    FROM pg_proc
   WHERE proname = 'capture_landing_finalize_plan' AND pronargs = 1 AND pronamespace = 'public'::regnamespace;
  IF position('(20261115160000)' in coalesce(v_fn,'')) = 0 THEN
    RAISE EXCEPTION 'refusing revert: live finalize_plan does not carry the 20261115160000 marker';
  END IF;
  v_n := (length(v_fn) - length(replace(v_fn, v_new, ''))) / length(v_new);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'finalize_plan 0-clear forward_cursor block drifted (n=%); refusing revert', v_n;
  END IF;
  v_fn := replace(v_fn, v_new, v_old);
  IF position('(20261115160000)' in v_fn) > 0 THEN
    RAISE EXCEPTION 'revert did not remove the 20261115160000 marker';
  END IF;
  EXECUTE v_fn;
END
$do$;

REVOKE ALL ON FUNCTION public.capture_landing_finalize_plan(uuid) FROM PUBLIC, anon, authenticated;
DO $g$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.capture_landing_finalize_plan(uuid) TO service_role;
  END IF;
END $g$;
