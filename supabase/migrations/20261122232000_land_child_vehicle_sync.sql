-- Landed photo readings follow their photo's vehicle.
--
-- Why. photo_land_classification() copies a photo's classifier reading into image_descriptions,
-- photo_extracted_fields, photo_text_lines and image_angle_observations (and a deep reading's camera pose into
-- image_camera_position), stamping each row with the photo's vehicle at that moment. Its inserts use
-- ON CONFLICT DO NOTHING / NOT EXISTS, so a row landed while the photo was still unfiled kept vehicle_id NULL after the
-- photo was filed, and a row landed on one vehicle kept that vehicle after the photo moved. On one owner's car about
-- 95% of its landed rows pointed at no vehicle, so per-vehicle readers saw almost nothing. The angle map also dropped
-- three classifier labels (exterior_side, exterior_three_quarter, exterior), so those photos never got an angle.
--
-- Change.
--   1. land_child_vehicle_sync_log: one row per child row a run planned, changed, skipped or reverted
--      (table, row id, old vehicle_id, new vehicle_id, run id). Changes made by the live path are logged as run 'live'.
--   2. land_child_vehicle_sync_image(photo, run): moves the landed rows of one photo onto the photo's current vehicle
--      (NULL when the photo is unfiled or its gate is rejected, as the landing itself decides). Called at the end of
--      every landing (so a re-land updates vehicle_id) and by trigger a08_trg_land_child_vehicle_sync whenever
--      vehicle_images.vehicle_id or vision_gate_status changes (so rows follow a photo on and off a vehicle).
--   3. Backfill producer, dry by default: land_child_vehicle_sync_plan_v1(run, vehicle?, table?) writes the plan
--      (the backup: every mismatched row with its current vehicle_id) before anything changes;
--      land_child_vehicle_sync_v1(run, batch, max_batches, dry) applies it in batches of at most 200 rows, re-checking
--      each row and verifying each batch; land_child_vehicle_sync_revert_v1(run) puts back exactly what a run changed.
--   4. Angle map: photo_land_angle_key() adds exterior_side -> exterior.side.unknown,
--      exterior_three_quarter -> exterior.three_quarter.unknown and exterior -> exterior.general (three new
--      angle_taxonomy rows; the classifier does not say which side or which end, so neither is guessed).
--      land_angle_reland_v1(run, vehicle, limit, dry) lands the missing classifier angle for photos already landed,
--      logged as inserts so the run can be reverted.
-- Never touched: a photo with no stored picture (empty image_url: the privacy holds), a privacy-excluded, sensitive or
-- rejected_personal photo, and any row whose photo, current or new vehicle id starts with 9cf5b7a4. Only rows this
-- landing writes are synced (classifier_v2 descriptions, fields, text lines and angles; byok_deep_analysis camera
-- pose); other producers' rows in the same tables are left as they are. vehicle_images itself is not written.
-- Contract: supabase/sql/test_land_child_vehicle_sync.sql
-- Revert of this file: supabase/sql/revert_20261122232000_land_child_vehicle_sync.sql (revert each run first).

begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS public.land_child_vehicle_sync_log (
  id bigserial PRIMARY KEY,
  run_id text NOT NULL,
  tbl text NOT NULL CHECK (tbl IN ('image_descriptions','photo_extracted_fields','photo_text_lines',
                                   'image_angle_observations','image_camera_position')),
  row_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('set_vehicle','insert')),
  old_vehicle_id uuid,
  new_vehicle_id uuid,
  state text NOT NULL CHECK (state IN ('planned','applied','skipped','reverted')),
  skip_reason text,
  planned_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  reverted_at timestamptz
);
CREATE INDEX IF NOT EXISTS land_child_vehicle_sync_log_run_idx ON public.land_child_vehicle_sync_log (run_id, state, id);
CREATE INDEX IF NOT EXISTS land_child_vehicle_sync_log_row_idx ON public.land_child_vehicle_sync_log (tbl, row_id);
ALTER TABLE public.land_child_vehicle_sync_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.land_child_vehicle_sync_log FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.land_child_vehicle_sync_log_id_seq FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.land_child_vehicle_sync_log IS
  'Every landed child row whose vehicle_id a run planned, changed, skipped or reverted (20261122232000). Run ''live'' = the landing and the a08 trigger.';

-- The tables this landing writes, and the column/value that marks the landing's own rows in each.
CREATE OR REPLACE FUNCTION public.land_child_vehicle_tables()
RETURNS TABLE (tbl text, col text, val text) LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp' AS $function$
  VALUES ('image_descriptions', 'description_type', 'classifier_v2'),
         ('photo_extracted_fields', 'source', 'classifier_v2'),
         ('photo_text_lines', 'source', 'classifier_v2'),
         ('image_angle_observations', 'source', 'classifier_v2'),
         ('image_camera_position', 'source', 'byok_deep_analysis')
$function$;

-- The vehicle a landed row belongs on: the photo's vehicle, unless the photo is unfiled or its gate rejected it
-- (the same rule photo_land_classification uses for vid).
CREATE OR REPLACE FUNCTION public.land_child_target_vehicle(p_vehicle_id uuid, p_gate text)
RETURNS uuid LANGUAGE sql IMMUTABLE AS $function$
  SELECT CASE WHEN p_vehicle_id IS NOT NULL AND coalesce(p_gate, '') NOT LIKE 'rejected%' THEN p_vehicle_id END
$function$;

-- Why a photo's landed rows are left alone, or NULL when they may be synced.
CREATE OR REPLACE FUNCTION public.land_child_skip_reason(p_image_id uuid, p_image_url text, p_is_sensitive boolean,
  p_gate text, p_vehicle_id uuid)
RETURNS text LANGUAGE sql STABLE SET search_path TO 'public', 'pg_temp' AS $function$
  SELECT CASE
    WHEN p_image_id IS NULL THEN 'no_such_photo'
    WHEN nullif(btrim(coalesce(p_image_url, '')), '') IS NULL THEN 'no_stored_picture'
    WHEN EXISTS (SELECT 1 FROM public.capture_privacy_promote_exclude e WHERE e.image_id = p_image_id) THEN 'privacy_excluded'
    WHEN coalesce(p_is_sensitive, false) OR p_gate = 'rejected_personal' THEN 'private'
    WHEN coalesce(p_vehicle_id::text, '') LIKE '9cf5b7a4%' THEN 'excluded_vehicle'
  END
$function$;

CREATE OR REPLACE FUNCTION public.photo_land_angle_key(p_classifier_angle text)
RETURNS text LANGUAGE sql IMMUTABLE AS $function$
  SELECT CASE p_classifier_angle
    WHEN 'exterior_front' THEN 'exterior.front.center'
    WHEN 'exterior_rear' THEN 'exterior.rear.center'
    WHEN 'exterior_side' THEN 'exterior.side.unknown'
    WHEN 'exterior_three_quarter' THEN 'exterior.three_quarter.unknown'
    WHEN 'exterior' THEN 'exterior.general'
    WHEN 'interior_dashboard' THEN 'interior.dash.full'
    WHEN 'engine_bay' THEN 'engine.bay'
    WHEN 'undercarriage' THEN 'undercarriage.general'
    WHEN 'detail_shot' THEN 'detail.general'
  END
$function$;

INSERT INTO public.angle_taxonomy (canonical_key, domain, display_label, side_applicability)
VALUES ('exterior.side.unknown', 'exterior', 'Side profile (side not given)', NULL),
       ('exterior.three_quarter.unknown', 'exterior', 'Three-quarter (end and side not given)', NULL),
       ('exterior.general', 'exterior', 'Exterior (angle not given)', NULL)
ON CONFLICT (canonical_key) DO NOTHING;

-- One photo: move this landing's rows onto the photo's current vehicle, logging each change under p_run.
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

CREATE OR REPLACE FUNCTION public.land_child_vehicle_sync_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
BEGIN
  PERFORM public.land_child_vehicle_sync_image(NEW.id, 'live');
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'land_child_vehicle_sync_trigger failed for %: %', NEW.id, SQLERRM;
  RETURN NULL;
END
$function$;

DROP TRIGGER IF EXISTS a08_trg_land_child_vehicle_sync ON public.vehicle_images;
CREATE TRIGGER a08_trg_land_child_vehicle_sync
  AFTER UPDATE OF vehicle_id, vision_gate_status ON public.vehicle_images
  FOR EACH ROW
  WHEN (OLD.vehicle_id IS DISTINCT FROM NEW.vehicle_id OR OLD.vision_gate_status IS DISTINCT FROM NEW.vision_gate_status)
  EXECUTE FUNCTION public.land_child_vehicle_sync_trigger();

-- Backfill step 1 (the backup): record every landed row whose vehicle_id disagrees with its photo, with its current
-- value, before anything changes. Rows that must be left alone are recorded as skipped with the reason.
-- p_vehicle limits the plan to rows whose photo is on that vehicle or that point at it; p_table to one table.
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
                          CASE WHEN coalesce(c.vehicle_id::text, '') LIKE '9cf5b7a4%%' THEN 'excluded_vehicle' END) AS skip
        ) m
       WHERE c.%2$I = $2
         AND c.vehicle_id IS DISTINCT FROM m.target
         AND ($3::uuid IS NULL OR vi.vehicle_id = $3 OR c.vehicle_id = $3)
         AND NOT EXISTS (SELECT 1 FROM public.land_child_vehicle_sync_log l
                          WHERE l.run_id = $1::text AND l.tbl = %3$L AND l.row_id = c.id)
    $q$, t.tbl, t.col, t.tbl) USING p_run, t.val, p_vehicle;
    GET DIAGNOSTICS rc = ROW_COUNT;
    v_out := v_out || jsonb_build_object(t.tbl, rc);
  END LOOP;
  RETURN jsonb_build_object('run_id', p_run, 'vehicle', p_vehicle, 'recorded', v_out,
    'by_state', (SELECT jsonb_object_agg(k, n) FROM (SELECT l.tbl || ':' || l.state || coalesce(':' || l.skip_reason, '') k, count(*) n
                   FROM public.land_child_vehicle_sync_log l WHERE l.run_id = p_run::text GROUP BY 1) s));
END
$function$;

-- Backfill step 2: apply a planned run in batches. Each row is re-checked against its photo right before it changes:
-- it must still hold the vehicle_id the plan recorded, its photo must still map to the planned vehicle and must not
-- have become a row to leave alone. After each batch the changed rows are read back; a mismatch aborts the call.
CREATE OR REPLACE FUNCTION public.land_child_vehicle_sync_v1(p_run uuid, p_batch integer DEFAULT 50,
  p_max_batches integer DEFAULT 1, p_dry boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE
  v_ids bigint[]; t record; b int := 0; n_ok int; n_skip int; n_bad int;
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
      EXECUTE format($q$
        WITH p AS (
          SELECT l.id AS lid, l.row_id, l.old_vehicle_id, l.new_vehicle_id
            FROM public.land_child_vehicle_sync_log l WHERE l.id = ANY ($1) AND l.tbl = %2$L),
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

-- Revert a run (a producer run's uuid, or 'live'): every row it changed goes back to the vehicle_id it had, and every
-- angle row it inserted is deleted. A row changed again since the run is left as it is and counted.
CREATE OR REPLACE FUNCTION public.land_child_vehicle_sync_revert_v1(p_run text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE t record; n_set int; n_del int; n_left int; v_out jsonb := '{}';
BEGIN
  IF p_run IS NULL THEN RAISE EXCEPTION 'land_child_vehicle_sync_revert_v1: run required'; END IF;
  FOR t IN SELECT * FROM public.land_child_vehicle_tables() LOOP
    EXECUTE format($q$
      WITH r AS (
        SELECT l.id AS lid, l.row_id, l.old_vehicle_id, l.new_vehicle_id, l.action
          FROM public.land_child_vehicle_sync_log l WHERE l.run_id = $1 AND l.tbl = %2$L AND l.state = 'applied'),
      u AS (
        UPDATE public.%1$I c SET vehicle_id = r.old_vehicle_id FROM r
         WHERE r.action = 'set_vehicle' AND c.id = r.row_id AND c.vehicle_id IS NOT DISTINCT FROM r.new_vehicle_id
        RETURNING r.lid),
      d AS (
        DELETE FROM public.%1$I c USING r WHERE r.action = 'insert' AND c.id = r.row_id RETURNING r.lid),
      m AS (
        UPDATE public.land_child_vehicle_sync_log l SET state = 'reverted', reverted_at = now()
         WHERE l.id IN (SELECT lid FROM u UNION ALL SELECT lid FROM d) RETURNING l.id)
      SELECT (SELECT count(*) FROM u)::int, (SELECT count(*) FROM d)::int,
             ((SELECT count(*) FROM r) - (SELECT count(*) FROM m))::int
    $q$, t.tbl, t.tbl) INTO n_set, n_del, n_left USING p_run;
    v_out := v_out || jsonb_build_object(t.tbl, jsonb_build_object('vehicle_restored', n_set, 'inserted_deleted', n_del,
                                                                   'changed_since_left', n_left));
  END LOOP;
  RETURN jsonb_build_object('run_id', p_run, 'reverted', v_out);
END
$function$;

-- Land the classifier angle a photo is missing (the label had no key before this file). Same row the landing writes,
-- with relanded_by in evidence; each insert is logged under p_run so land_child_vehicle_sync_revert_v1 removes it.
CREATE OR REPLACE FUNCTION public.land_angle_reland_v1(p_run uuid, p_vehicle uuid, p_limit integer DEFAULT 50,
  p_dry boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE n int := 0; v_cand jsonb;
BEGIN
  IF p_run IS NULL OR p_vehicle IS NULL THEN RAISE EXCEPTION 'land_angle_reland_v1: run and vehicle required'; END IF;
  IF p_limit NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'land_angle_reland_v1: limit must be 1..500'; END IF;
  IF p_vehicle::text LIKE '9cf5b7a4%' THEN RAISE EXCEPTION 'land_angle_reland_v1: vehicle excluded'; END IF;
  CREATE TEMP TABLE IF NOT EXISTS _land_angle_cand (image_id uuid, vehicle_id uuid, angle_id uuid, confidence numeric,
    pv text, classifier_angle text, quote text) ON COMMIT DROP;
  TRUNCATE _land_angle_cand;
  INSERT INTO _land_angle_cand
  SELECT vi.id, vi.vehicle_id, a.angle_id,
         least(greatest(coalesce(nullif(c.x #>> '{angle,confidence}', '')::numeric,
                                 least(greatest(coalesce(nullif(c0.cls ->> 'confidence', '')::numeric, 0), 0), 1)), 0), 1),
         coalesce(c.x ->> 'prompt_version', c0.cls #>> '{classifier_receipt,prompt_version}', 'legacy'),
         c.x #>> '{angle,value}',
         left(nullif(btrim(coalesce(c0.cls ->> 'description', '')), ''), 300)
    FROM public.vehicle_images vi
    CROSS JOIN LATERAL (SELECT vi.ai_scan_metadata -> 'classification' AS cls) c0
    CROSS JOIN LATERAL (SELECT CASE WHEN jsonb_typeof(c0.cls -> 'v2') = 'object' THEN c0.cls -> 'v2' ELSE '{}'::jsonb END AS x) c
    JOIN public.angle_taxonomy a ON a.canonical_key = public.photo_land_angle_key(c.x #>> '{angle,value}') AND a.deprecated_at IS NULL
   WHERE vi.vehicle_id = p_vehicle
     AND vi.ai_processing_status = 'completed'
     AND jsonb_typeof(c0.cls) = 'object' AND c0.cls ->> 'image_type' IS NOT NULL
     AND public.land_child_target_vehicle(vi.vehicle_id, vi.vision_gate_status::text) IS NOT NULL
     AND public.land_child_skip_reason(vi.id, vi.image_url, vi.is_sensitive, vi.vision_gate_status::text, vi.vehicle_id) IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.image_angle_observations o WHERE o.image_id = vi.id AND o.source = 'classifier_v2')
   ORDER BY vi.id
   LIMIT p_limit;
  SELECT jsonb_object_agg(classifier_angle, k) INTO v_cand FROM (SELECT classifier_angle, count(*) k FROM _land_angle_cand GROUP BY 1) s;
  IF p_dry THEN
    RETURN jsonb_build_object('run_id', p_run, 'dry', true, 'would_insert', (SELECT count(*) FROM _land_angle_cand), 'by_label', v_cand);
  END IF;
  WITH ins AS (
    INSERT INTO public.image_angle_observations (image_id, vehicle_id, angle_id, confidence, source, source_version, evidence)
    SELECT c.image_id, c.vehicle_id, c.angle_id, c.confidence, 'classifier_v2', c.pv,
           jsonb_build_object('photo_id', c.image_id, 'classifier_angle', c.classifier_angle, 'quote', c.quote,
                              'relanded_by', 'land_angle_reland_v1/' || p_run)
      FROM _land_angle_cand c
    RETURNING id, vehicle_id)
  INSERT INTO public.land_child_vehicle_sync_log (run_id, tbl, row_id, action, old_vehicle_id, new_vehicle_id, state, applied_at)
  SELECT p_run::text, 'image_angle_observations', ins.id, 'insert', NULL, ins.vehicle_id, 'applied', now() FROM ins;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('run_id', p_run, 'dry', false, 'inserted', n, 'by_label', v_cand);
END
$function$;

-- photo_land_classification: angle map from photo_land_angle_key(); a (re-)land ends by syncing the photo's landed rows.
CREATE OR REPLACE FUNCTION public.photo_land_classification(p_image_id uuid, p_include_classifier boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  vi record; cls jsonb; x jsonb; pv text; conf numeric; descr text; vid uuid;
  n_desc int := 0; n_f int := 0; n_t int := 0; n_fe int := 0; n_ang int := 0; n_cam int := 0; rc int;
  ang_key text; ang_id uuid; n_sync int := 0; pose jsonb; byok jsonb; dist numeric; az numeric; el numeric; res jsonb; dq text; pl jsonb;
begin
  select v.id, v.user_id, v.vehicle_id, v.vision_gate_status::text as gate, v.ai_scan_metadata as md
    into vi from public.vehicle_images v where v.id = p_image_id and v.ai_processing_status = 'completed';
  if not found then return jsonb_build_object('skipped', 'not_completed'); end if;
  vid := case when vi.vehicle_id is not null and coalesce(vi.gate, '') not like 'rejected%' then vi.vehicle_id end;
  cls := vi.md->'classification';
  if p_include_classifier and cls is not null and jsonb_typeof(cls) = 'object' and cls->>'image_type' is not null then
    x := case when jsonb_typeof(cls->'v2') = 'object' then cls->'v2' else '{}'::jsonb end;
    pv := coalesce(x->>'prompt_version', cls#>>'{classifier_receipt,prompt_version}', 'legacy');
    conf := least(greatest(coalesce(nullif(cls->>'confidence','')::numeric, 0), 0), 1);
    descr := nullif(btrim(coalesce(cls->>'description', '')), '');

    if descr is not null and not exists (select 1 from public.image_descriptions d where d.image_id = p_image_id and d.description_type = 'classifier_v2') then
      insert into public.image_descriptions(image_id, vehicle_id, description, description_type, source, source_version, confidence, evidence)
      values (p_image_id, vid, descr, 'classifier_v2', 'photo-pipeline-classifier', pv, conf,
              jsonb_build_object('photo_id', p_image_id, 'image_type', cls->>'image_type', 'is_automotive', cls->'is_automotive', 'model', cls#>>'{classifier_receipt,model}'));
      n_desc := 1;
    end if;

    insert into public.photo_extracted_fields(image_id, user_id, vehicle_id, field_name, value, quote, confidence, source, prompt_version, meta)
    select distinct on (s.fn) p_image_id, vi.user_id, vid, s.fn, s.val, s.qt, s.cf, 'classifier_v2', pv, s.meta
    from (
      select e->>'field_name' fn, nullif(btrim(e->>'value'), '') val, nullif(e->>'evidence','') qt,
             least(greatest(nullif(e->>'confidence','')::numeric, 0), 1) cf, jsonb_build_object('photo_id', p_image_id) meta
        from jsonb_array_elements(case when jsonb_typeof(x->'vehicle_fields') = 'array' then x->'vehicle_fields' else '[]'::jsonb end) e
      union all
      select 'vin', nullif(btrim(x#>>'{vin,value}'), ''), nullif(x#>>'{vin,evidence}',''),
             least(greatest(nullif(x#>>'{vin,confidence}','')::numeric, 0), 1),
             jsonb_build_object('photo_id', p_image_id, 'checksum_ok', x#>'{vin,checksum_ok}')
        where jsonb_typeof(x->'vin') = 'object'
    ) s where s.fn is not null and s.val is not null
    order by s.fn, s.cf desc nulls last
    on conflict do nothing;
    get diagnostics rc = row_count; n_f := n_f + rc;

    insert into public.photo_extracted_fields(image_id, user_id, vehicle_id, field_name, value, quote, confidence, source, prompt_version, meta)
    select p_image_id, vi.user_id, vid, c.fn, c.val, c.qt, c.cf, 'classifier_v2', pv, jsonb_build_object('photo_id', p_image_id)
    from (values
      ('core.image_type', cls->>'image_type', left(descr, 300), conf),
      ('core.is_automotive', cls->>'is_automotive', left(descr, 300), conf),
      ('core.classifier_confidence', cls->>'confidence', null, conf),
      ('core.description', descr, descr, conf),
      ('doc.type', nullif(x->>'document_type', ''), left(descr, 300), conf),
      ('doc.kind', nullif(x->>'document_kind', ''), left(descr, 300), conf)
    ) c(fn, val, qt, cf) where c.val is not null
    on conflict do nothing;
    get diagnostics rc = row_count; n_f := n_f + rc;

    insert into public.photo_text_lines(image_id, user_id, vehicle_id, line_idx, text, region, confidence, source, prompt_version)
    select p_image_id, vi.user_id, vid, (t.ord - 1)::int, btrim(t.e->>'text'),
           case when t.e ? 'region' then t.e->'region' end,
           least(greatest(nullif(t.e->>'confidence','')::numeric, 0), 1), 'classifier_v2', pv
    from jsonb_array_elements(case when jsonb_typeof(x->'text_lines') = 'array' then x->'text_lines' else '[]'::jsonb end) with ordinality t(e, ord)
    where nullif(btrim(coalesce(t.e->>'text', '')), '') is not null
    on conflict do nothing;
    get diagnostics rc = row_count; n_t := rc;

    if vid is not null then
      insert into public.field_evidence(vehicle_id, field_name, proposed_value, source_type, source_confidence, extraction_context, raw_extraction_data)
      select vid, s.fn, s.val, 'ai_visual', round(s.cf * 100)::int, left('photo-pipeline landing v1: ' || s.qt, 400),
             jsonb_build_object('photo_id', p_image_id, 'image_id', p_image_id, 'quote', s.qt, 'confidence', s.cf, 'extractor', 'photo_land_classification', 'prompt_version', pv)
      from (
        select distinct on (fn, val) e->>'field_name' fn, btrim(e->>'value') val, e->>'evidence' qt, least(greatest(nullif(e->>'confidence','')::numeric, 0), 1) cf
          from jsonb_array_elements(case when jsonb_typeof(x->'vehicle_fields') = 'array' then x->'vehicle_fields' else '[]'::jsonb end) e
         order by fn, val
      ) s
      where s.cf >= 0.6 and nullif(s.qt, '') is not null and nullif(s.val, '') is not null and s.fn is not null
        -- plate stamping codes are identifiers, not attributes; other-vehicle / non-body readings are not evidence about this car
        and not exists (select 1 from public.photo_plate_code_kind(s.qt))
        and public.photo_field_not_about_vehicle(s.fn, s.val, s.qt, descr) is null
      on conflict (vehicle_id, field_name, source_type, proposed_value) do nothing;
      get diagnostics rc = row_count; n_fe := rc;

      begin
        select jsonb_agg(jsonb_build_object('kind', k.kind, 'value', k.code, 'quote', left(k.qt, 400), 'confidence', k.cf)) into pl
        from (select distinct on (pk.kind, pk.code) pk.kind, pk.code, s2.qt, s2.cf
                from (select e->>'evidence' qt, least(greatest(nullif(e->>'confidence','')::numeric, 0), 1) cf
                        from jsonb_array_elements(case when jsonb_typeof(x->'vehicle_fields') = 'array' then x->'vehicle_fields' else '[]'::jsonb end) e) s2
                cross join lateral public.photo_plate_code_kind(s2.qt) pk
               where s2.cf >= 0.6
               order by pk.kind, pk.code) k;
        if pl is not null then
          perform public.land_identifier_claims(vid, jsonb_build_object('identifiers', pl), null, 'photo_land_classification', 'photo', p_image_id, null);
          update public.vehicle_identifiers set evidence_class = 'plate_stamping'
           where vehicle_id = vid and source_image_id = p_image_id and kind like 'plate\_%' and evidence_class is null;
        end if;
      exception when others then null;
      end;

      ang_key := public.photo_land_angle_key(x#>>'{angle,value}');
      if ang_key is not null and not exists (select 1 from public.image_angle_observations o where o.image_id = p_image_id and o.source = 'classifier_v2') then
        select a.angle_id into ang_id from public.angle_taxonomy a where a.canonical_key = ang_key and a.deprecated_at is null limit 1;
        if ang_id is not null then
          insert into public.image_angle_observations(image_id, vehicle_id, angle_id, confidence, source, source_version, evidence)
          values (p_image_id, vid, ang_id, least(greatest(coalesce(nullif(x#>>'{angle,confidence}','')::numeric, conf), 0), 1), 'classifier_v2', pv,
                  jsonb_build_object('photo_id', p_image_id, 'classifier_angle', x#>>'{angle,value}', 'quote', left(descr, 300)));
          n_ang := 1;
        end if;
      end if;
    end if;
  end if;

  byok := vi.md->'byok_deep_analysis';
  if byok is not null and jsonb_typeof(byok->'camera_pose') = 'object' then
    pose := byok->'camera_pose';
    az := case when (pose->>'azimuth_deg') ~ '^-?[0-9.]+$' then (pose->>'azimuth_deg')::numeric end;
    el := case when (pose->>'elevation_deg') ~ '^-?[0-9.]+$' then (pose->>'elevation_deg')::numeric end;
    dq := pose->>'distance_est';
    dist := case when dq ~* '^[~ ]*[0-9.]+ ?m$' then round((regexp_replace(dq, '[^0-9.]', '', 'g'))::numeric * 1000) end;
    if (az is not null or el is not null) then
      insert into public.image_camera_position(image_id, vehicle_id, subject_key, azimuth_deg, elevation_deg, distance_mm, confidence, source, source_version, evidence)
      values (p_image_id, vid, 'vehicle', az, el, dist,
              least(greatest(coalesce(nullif(byok->>'confidence','')::numeric, 0.5), 0), 1), 'byok_deep_analysis',
              coalesce('review:' || (byok->>'observation_id'), byok->>'prompt_version', 'unknown'),
              jsonb_strip_nulls(jsonb_build_object('photo_id', p_image_id, 'camera_pose', pose, 'run_id', byok->>'run_id',
                'observation_id', byok->>'observation_id', 'source_identifier', byok->>'source_identifier')))
      on conflict (image_id, subject_key, source, source_version) do nothing;
      get diagnostics rc = row_count; n_cam := rc;
    end if;
  end if;

  -- 20261122232000: a re-land brings every row this landing wrote for the photo onto the photo's current vehicle
  -- (or none, when the photo is unfiled or rejected). Inserts above keep ON CONFLICT DO NOTHING / NOT EXISTS, so
  -- before this a row first landed while the photo was unfiled kept vehicle_id NULL after filing.
  begin
    n_sync := public.land_child_vehicle_sync_image(p_image_id, 'live');
  exception when others then
    raise warning 'photo_land_classification: child vehicle sync failed for %: %', p_image_id, sqlerrm;
    n_sync := -1;
  end;

  res := jsonb_build_object('descriptions', n_desc, 'fields', n_f, 'text_lines', n_t, 'field_evidence', n_fe, 'angles', n_ang, 'camera', n_cam, 'vehicle_synced', n_sync);
  insert into public.photo_land_progress(image_id, result) values (p_image_id, res)
    on conflict (image_id) do update set landed_at = now(), result = excluded.result;
  return res;
exception when others then
  return jsonb_build_object('error', sqlerrm, 'state', sqlstate);
end;
$function$;

REVOKE ALL ON FUNCTION public.land_child_vehicle_tables() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.land_child_target_vehicle(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.land_child_skip_reason(uuid, text, boolean, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.photo_land_angle_key(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.land_child_vehicle_sync_image(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.land_child_vehicle_sync_trigger() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.land_child_vehicle_sync_plan_v1(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.land_child_vehicle_sync_v1(uuid, integer, integer, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.land_child_vehicle_sync_revert_v1(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.land_angle_reland_v1(uuid, uuid, integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.land_child_vehicle_sync_plan_v1(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.land_child_vehicle_sync_v1(uuid, integer, integer, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.land_child_vehicle_sync_revert_v1(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.land_angle_reland_v1(uuid, uuid, integer, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.land_child_vehicle_sync_image(uuid, text) TO service_role;

DO $$
BEGIN
  IF public.photo_land_angle_key('exterior_side') IS DISTINCT FROM 'exterior.side.unknown'
     OR public.photo_land_angle_key('exterior_three_quarter') IS DISTINCT FROM 'exterior.three_quarter.unknown'
     OR public.photo_land_angle_key('exterior') IS DISTINCT FROM 'exterior.general'
     OR public.photo_land_angle_key('engine_bay') IS DISTINCT FROM 'engine.bay' THEN
    RAISE EXCEPTION 'photo_land_angle_key map is wrong';
  END IF;
  IF (SELECT count(*) FROM public.angle_taxonomy WHERE canonical_key IN ('exterior.side.unknown','exterior.three_quarter.unknown','exterior.general') AND deprecated_at IS NULL) <> 3 THEN
    RAISE EXCEPTION 'new angle_taxonomy rows missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'a08_trg_land_child_vehicle_sync' AND tgrelid = 'public.vehicle_images'::regclass) THEN
    RAISE EXCEPTION 'a08_trg_land_child_vehicle_sync missing';
  END IF;
  IF has_function_privilege('anon', 'public.land_child_vehicle_sync_v1(uuid, integer, integer, boolean)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.land_child_vehicle_sync_image(uuid, text)', 'EXECUTE')
     OR has_table_privilege('anon', 'public.land_child_vehicle_sync_log', 'SELECT') THEN
    RAISE EXCEPTION 'an API caller can reach the child vehicle sync';
  END IF;
END
$$;

commit;
