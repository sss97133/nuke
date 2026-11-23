-- Follow-up to 20261122232000_land_child_vehicle_sync: image_angle_observations.vehicle_id is NOT NULL.
--
-- Why. The first platform-wide batch stopped (and rolled back whole) on an angle row whose photo had been pulled off
-- its vehicle: the sync tried to set that row's vehicle_id to NULL. In the live path the same error made
-- land_child_vehicle_sync_image give up on every table for that photo (the trigger and the landing catch it), so a
-- photo with an angle row did not take its other rows off a vehicle either.
-- Change: land_child_vehicle_tables() says which tables need a vehicle; for those, a row whose photo now belongs on no
-- vehicle is left where it is (plan and apply record it as skipped 'vehicle_required'; the live path passes over that
-- table only). Every other table still follows the photo off the vehicle. Nothing else changes.
-- Contract: supabase/sql/test_land_child_vehicle_sync.sql
-- Revert: supabase/sql/revert_20261122232000_land_child_vehicle_sync.sql removes both files' functions.

begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';

DROP FUNCTION IF EXISTS public.land_child_vehicle_tables();
CREATE OR REPLACE FUNCTION public.land_child_vehicle_tables()
RETURNS TABLE (tbl text, col text, val text, needs_vehicle boolean) LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp' AS $function$
  VALUES ('image_descriptions', 'description_type', 'classifier_v2', false),
         ('photo_extracted_fields', 'source', 'classifier_v2', false),
         ('photo_text_lines', 'source', 'classifier_v2', false),
         ('image_angle_observations', 'source', 'classifier_v2', true),
         ('image_camera_position', 'source', 'byok_deep_analysis', false)
$function$;

CREATE OR REPLACE FUNCTION public.land_child_vehicle_sync_image(p_image_id uuid, p_run text DEFAULT 'live')
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE
  vi record; v_target uuid; t record; n int := 0; rc int;
BEGIN
  SELECT v.id, v.vehicle_id, v.vision_gate_status::text AS gate, v.image_url, v.is_sensitive
    INTO vi FROM public.vehicle_images v WHERE v.id = p_image_id;
  IF NOT FOUND THEN RETURN 0; END IF;
  IF public.land_child_skip_reason(vi.id, vi.image_url, vi.is_sensitive, vi.gate, vi.vehicle_id) IS NOT NULL THEN
    RETURN 0;
  END IF;
  v_target := public.land_child_target_vehicle(vi.vehicle_id, vi.gate);
  FOR t IN SELECT * FROM public.land_child_vehicle_tables() LOOP
    -- image_angle_observations.vehicle_id is NOT NULL: an angle row stays where it is when its photo goes to no vehicle.
    CONTINUE WHEN t.needs_vehicle AND v_target IS NULL;
    EXECUTE format($q$
      WITH s AS (
        SELECT c.id, c.vehicle_id AS old FROM public.%1$I c
         WHERE c.image_id = $1 AND c.%2$I = $2 AND c.vehicle_id IS DISTINCT FROM $3
           AND coalesce(c.vehicle_id::text, '') NOT LIKE '9cf5b7a4%%'
         FOR UPDATE),
      u AS (UPDATE public.%1$I c SET vehicle_id = $3 FROM s WHERE c.id = s.id RETURNING c.id, s.old)
      INSERT INTO public.land_child_vehicle_sync_log (run_id, tbl, row_id, action, old_vehicle_id, new_vehicle_id, state, applied_at)
      SELECT $4, %3$L, u.id, 'set_vehicle', u.old, $3, 'applied', now() FROM u
    $q$, t.tbl, t.col, t.tbl) USING p_image_id, t.val, v_target, p_run;
    GET DIAGNOSTICS rc = ROW_COUNT; n := n + rc;
  END LOOP;
  RETURN n;
END
$function$;

CREATE OR REPLACE FUNCTION public.land_child_vehicle_sync_plan_v1(p_run uuid, p_vehicle uuid DEFAULT NULL,
  p_table text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE t record; rc int; v_out jsonb := '{}';
BEGIN
  IF p_run IS NULL THEN RAISE EXCEPTION 'land_child_vehicle_sync_plan_v1: run required'; END IF;
  IF p_table IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.land_child_vehicle_tables() x WHERE x.tbl = p_table) THEN
    RAISE EXCEPTION 'land_child_vehicle_sync_plan_v1: unknown table %', p_table;
  END IF;
  FOR t IN SELECT * FROM public.land_child_vehicle_tables() x WHERE p_table IS NULL OR x.tbl = p_table LOOP
    EXECUTE format($q$
      INSERT INTO public.land_child_vehicle_sync_log (run_id, tbl, row_id, action, old_vehicle_id, new_vehicle_id, state, skip_reason)
      SELECT $1::text, %3$L, c.id, 'set_vehicle', c.vehicle_id, m.target,
             CASE WHEN m.skip IS NULL THEN 'planned' ELSE 'skipped' END, m.skip
        FROM public.%1$I c
        JOIN public.vehicle_images vi ON vi.id = c.image_id
        CROSS JOIN LATERAL (
          SELECT public.land_child_target_vehicle(vi.vehicle_id, vi.vision_gate_status::text) AS target,
                 coalesce(public.land_child_skip_reason(vi.id, vi.image_url, vi.is_sensitive, vi.vision_gate_status::text, vi.vehicle_id),
                          CASE WHEN coalesce(c.vehicle_id::text, '') LIKE '9cf5b7a4%%' THEN 'excluded_vehicle' END,
                          CASE WHEN %4$L::boolean AND public.land_child_target_vehicle(vi.vehicle_id, vi.vision_gate_status::text) IS NULL
                               THEN 'vehicle_required' END) AS skip
        ) m
       WHERE c.%2$I = $2
         AND c.vehicle_id IS DISTINCT FROM m.target
         AND ($3::uuid IS NULL OR vi.vehicle_id = $3 OR c.vehicle_id = $3)
         AND NOT EXISTS (SELECT 1 FROM public.land_child_vehicle_sync_log l
                          WHERE l.run_id = $1::text AND l.tbl = %3$L AND l.row_id = c.id)
    $q$, t.tbl, t.col, t.tbl, t.needs_vehicle) USING p_run, t.val, p_vehicle;
    GET DIAGNOSTICS rc = ROW_COUNT;
    v_out := v_out || jsonb_build_object(t.tbl, rc);
  END LOOP;
  RETURN jsonb_build_object('run_id', p_run, 'vehicle', p_vehicle, 'recorded', v_out,
    'by_state', (SELECT jsonb_object_agg(k, n) FROM (SELECT l.tbl || ':' || l.state || coalesce(':' || l.skip_reason, '') k, count(*) n
                   FROM public.land_child_vehicle_sync_log l WHERE l.run_id = p_run::text GROUP BY 1) s));
END
$function$;

CREATE OR REPLACE FUNCTION public.land_child_vehicle_sync_v1(p_run uuid, p_batch integer DEFAULT 50,
  p_max_batches integer DEFAULT 1, p_dry boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE
  v_ids bigint[]; t record; b int := 0; n_ok int; n_skip int; n_bad int; n_req int;
  v_applied jsonb := '{}'; v_skipped jsonb := '{}'; v_batches jsonb := '[]'; v_b_ok int; v_b_skip int;
BEGIN
  IF p_run IS NULL THEN RAISE EXCEPTION 'land_child_vehicle_sync_v1: run required'; END IF;
  IF p_batch NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'land_child_vehicle_sync_v1: batch must be 1..200'; END IF;
  IF p_max_batches NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'land_child_vehicle_sync_v1: max_batches must be 1..100'; END IF;
  IF p_dry THEN
    RETURN jsonb_build_object('run_id', p_run, 'dry', true,
      'planned', (SELECT jsonb_object_agg(tbl, n) FROM (SELECT l.tbl, count(*) n FROM public.land_child_vehicle_sync_log l
                    WHERE l.run_id = p_run::text AND l.state = 'planned' GROUP BY 1) s),
      'would_take_now', least(p_batch * p_max_batches,
                              (SELECT count(*) FROM public.land_child_vehicle_sync_log l WHERE l.run_id = p_run::text AND l.state = 'planned')));
  END IF;
  WHILE b < p_max_batches LOOP
    SELECT array_agg(id ORDER BY id) INTO v_ids FROM (
      SELECT l.id FROM public.land_child_vehicle_sync_log l
       WHERE l.run_id = p_run::text AND l.state = 'planned' ORDER BY l.id LIMIT p_batch FOR UPDATE SKIP LOCKED) s;
    EXIT WHEN v_ids IS NULL;
    b := b + 1; v_b_ok := 0; v_b_skip := 0;
    FOR t IN SELECT * FROM public.land_child_vehicle_tables() LOOP
      n_req := 0;
      IF t.needs_vehicle THEN  -- NOT NULL vehicle_id: a row planned onto no vehicle is left where it is
        UPDATE public.land_child_vehicle_sync_log l SET state = 'skipped', skip_reason = 'vehicle_required'
         WHERE l.id = ANY (v_ids) AND l.tbl = t.tbl AND l.state = 'planned' AND l.new_vehicle_id IS NULL;
        GET DIAGNOSTICS n_req = ROW_COUNT;
      END IF;
      EXECUTE format($q$
        WITH p AS (
          SELECT l.id AS lid, l.row_id, l.old_vehicle_id, l.new_vehicle_id
            FROM public.land_child_vehicle_sync_log l WHERE l.id = ANY ($1) AND l.tbl = %2$L AND l.state = 'planned'),
        cur AS (
          SELECT p.*, c.id AS cid, c.vehicle_id AS cur_vid,
                 public.land_child_target_vehicle(vi.vehicle_id, vi.vision_gate_status::text) AS tgt,
                 public.land_child_skip_reason(vi.id, vi.image_url, vi.is_sensitive, vi.vision_gate_status::text, vi.vehicle_id) AS skip
            FROM p
            LEFT JOIN public.%1$I c ON c.id = p.row_id
            LEFT JOIN public.vehicle_images vi ON vi.id = c.image_id),
        ok AS (
          SELECT * FROM cur
           WHERE cid IS NOT NULL AND skip IS NULL
             AND cur_vid IS NOT DISTINCT FROM old_vehicle_id
             AND tgt IS NOT DISTINCT FROM new_vehicle_id
             AND coalesce(old_vehicle_id::text, '') NOT LIKE '9cf5b7a4%%'
             AND coalesce(new_vehicle_id::text, '') NOT LIKE '9cf5b7a4%%'),
        u AS (
          UPDATE public.%1$I c SET vehicle_id = ok.new_vehicle_id FROM ok
           WHERE c.id = ok.cid AND c.vehicle_id IS NOT DISTINCT FROM ok.old_vehicle_id
          RETURNING ok.lid),
        m_ok AS (
          UPDATE public.land_child_vehicle_sync_log l SET state = 'applied', applied_at = now()
            FROM u WHERE l.id = u.lid RETURNING l.id),
        m_skip AS (
          UPDATE public.land_child_vehicle_sync_log l
             SET state = 'skipped',
                 skip_reason = CASE
                   WHEN cur.cid IS NULL THEN 'row_gone'
                   WHEN cur.skip IS NOT NULL THEN cur.skip
                   WHEN coalesce(cur.old_vehicle_id::text, '') LIKE '9cf5b7a4%%' OR coalesce(cur.new_vehicle_id::text, '') LIKE '9cf5b7a4%%' THEN 'excluded_vehicle'
                   WHEN cur.cur_vid IS NOT DISTINCT FROM cur.tgt THEN 'already_in_sync'
                   WHEN cur.cur_vid IS DISTINCT FROM cur.old_vehicle_id THEN 'row_changed'
                   ELSE 'target_changed' END
            FROM cur
           WHERE l.id = cur.lid AND NOT EXISTS (SELECT 1 FROM u WHERE u.lid = cur.lid)
          RETURNING l.id)
        SELECT (SELECT count(*) FROM m_ok)::int, (SELECT count(*) FROM m_skip)::int
      $q$, t.tbl, t.tbl) INTO n_ok, n_skip USING v_ids;
      n_skip := n_skip + n_req;
      IF n_ok > 0 THEN v_applied := v_applied || jsonb_build_object(t.tbl, coalesce((v_applied ->> t.tbl)::int, 0) + n_ok); END IF;
      IF n_skip > 0 THEN v_skipped := v_skipped || jsonb_build_object(t.tbl, coalesce((v_skipped ->> t.tbl)::int, 0) + n_skip); END IF;
      v_b_ok := v_b_ok + n_ok; v_b_skip := v_b_skip + n_skip;
      -- verify: every row this batch marked applied now holds its new vehicle_id
      EXECUTE format($q$
        SELECT count(*)::int FROM public.land_child_vehicle_sync_log l JOIN public.%1$I c ON c.id = l.row_id
         WHERE l.id = ANY ($1) AND l.tbl = %2$L AND l.state = 'applied' AND c.vehicle_id IS DISTINCT FROM l.new_vehicle_id
      $q$, t.tbl, t.tbl) INTO n_bad USING v_ids;
      IF n_bad > 0 THEN
        RAISE EXCEPTION 'land_child_vehicle_sync_v1: batch % verify failed: % % rows do not hold their new vehicle_id', b, n_bad, t.tbl;
      END IF;
    END LOOP;
    IF v_b_ok + v_b_skip <> cardinality(v_ids) THEN
      RAISE EXCEPTION 'land_child_vehicle_sync_v1: batch % verify failed: % rows taken, % applied, % skipped',
        b, cardinality(v_ids), v_b_ok, v_b_skip;
    END IF;
    v_batches := v_batches || jsonb_build_array(jsonb_build_object('batch', b, 'rows', cardinality(v_ids), 'applied', v_b_ok, 'skipped', v_b_skip));
  END LOOP;
  RETURN jsonb_build_object('run_id', p_run, 'dry', false, 'batches', b, 'applied', v_applied, 'skipped', v_skipped,
    'per_batch', v_batches,
    'still_planned', (SELECT count(*) FROM public.land_child_vehicle_sync_log l WHERE l.run_id = p_run::text AND l.state = 'planned'));
END
$function$;

REVOKE ALL ON FUNCTION public.land_child_vehicle_tables() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.land_child_vehicle_sync_image(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.land_child_vehicle_sync_plan_v1(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.land_child_vehicle_sync_v1(uuid, integer, integer, boolean) FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.land_child_vehicle_tables() WHERE needs_vehicle) <> 1 THEN
    RAISE EXCEPTION 'land_child_vehicle_tables: exactly image_angle_observations needs a vehicle';
  END IF;
END
$$;

commit;
