-- Follow-up to 20261122232000_land_child_vehicle_sync: revert undoes a row's changes newest first.
--
-- Why. Run 'live' logs a new row every time a photo moves, so one child row can have several applied log rows in the
-- same run (A->B, later B->C, or A->B then C->B). land_child_vehicle_sync_revert_v1 joined all of them at once, so a
-- 'live' revert could restore any one of their old vehicles. A producer run logs each child row once, so its revert
-- was not affected.
-- Change: revert works in passes. Each pass takes only the newest still-applied log row of each child row, restores
-- it when the row still holds that entry's new vehicle (or deletes an inserted angle row), and repeats until a pass
-- changes nothing. A row changed since its newest entry stops there and is counted as changed_since_left.
-- Contract: supabase/sql/test_land_child_vehicle_sync.sql
-- Revert: supabase/sql/revert_20261122232000_land_child_vehicle_sync.sql removes the function.

begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.land_child_vehicle_sync_revert_v1(p_run text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE t record; n_set int; n_del int; s_set int; s_del int; n_left int; n_pass int; v_out jsonb := '{}';
BEGIN
  IF p_run IS NULL THEN RAISE EXCEPTION 'land_child_vehicle_sync_revert_v1: run required'; END IF;
  FOR t IN SELECT * FROM public.land_child_vehicle_tables() LOOP
    s_set := 0; s_del := 0; n_pass := 0;
    LOOP
      n_pass := n_pass + 1;
      EXIT WHEN n_pass > 1000;
      EXECUTE format($q$
        WITH r AS (
          SELECT DISTINCT ON (l.row_id) l.id AS lid, l.row_id, l.old_vehicle_id, l.new_vehicle_id, l.action
            FROM public.land_child_vehicle_sync_log l
           WHERE l.run_id = $1 AND l.tbl = %2$L AND l.state = 'applied'
           ORDER BY l.row_id, l.id DESC),
        u AS (
          UPDATE public.%1$I c SET vehicle_id = r.old_vehicle_id FROM r
           WHERE r.action = 'set_vehicle' AND c.id = r.row_id AND c.vehicle_id IS NOT DISTINCT FROM r.new_vehicle_id
          RETURNING r.lid),
        d AS (
          DELETE FROM public.%1$I c USING r WHERE r.action = 'insert' AND c.id = r.row_id RETURNING r.lid),
        m AS (
          UPDATE public.land_child_vehicle_sync_log l SET state = 'reverted', reverted_at = now()
           WHERE l.id IN (SELECT lid FROM u UNION ALL SELECT lid FROM d) RETURNING l.id)
        SELECT (SELECT count(*) FROM u)::int, (SELECT count(*) FROM d)::int, (SELECT count(*) FROM m)::int
      $q$, t.tbl, t.tbl) INTO n_set, n_del, n_left USING p_run;
      s_set := s_set + n_set; s_del := s_del + n_del;
      EXIT WHEN n_set + n_del = 0;
    END LOOP;
    SELECT count(*)::int INTO n_left FROM public.land_child_vehicle_sync_log l
     WHERE l.run_id = p_run AND l.tbl = t.tbl AND l.state = 'applied';
    v_out := v_out || jsonb_build_object(t.tbl, jsonb_build_object('vehicle_restored', s_set, 'inserted_deleted', s_del,
                                                                   'changed_since_left', n_left));
  END LOOP;
  RETURN jsonb_build_object('run_id', p_run, 'reverted', v_out);
END
$function$;

REVOKE ALL ON FUNCTION public.land_child_vehicle_sync_revert_v1(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.land_child_vehicle_sync_revert_v1(text) TO service_role;

commit;
