-- data_set_member_grades v2: a photo reading establishes a membership only with a second reader family, as the facet
-- reader does; a photographed stamp or tag decode is a photo reading, not a decode.
--
-- WHY. data_set_grade_vehicle (20261124193700) classed every photo observation whose method matches '%_decode_%'
-- (cowl_tag_decode_v1, engine_block_decode_v1, trans_id_stamp_decode_v1) as 'decode', which establishes alone, and counted
-- distinct photos without reader families, so two photos read by one model family established. The facet reader
-- (vehicle_facet_items) and the settled rule (TRANSAM board 17:26 PT 2026-11-24: one vendor is one family; establishment
-- needs two photos each read by a registered family and two families overall, or paper, or a VIN decode) class those rows as
-- readings. Measured 2026-11-25 on the proof vehicle under v1: 13 sets established, of which only the three vin_* sets rest on
-- a VIN decode; trans_type manual and trans_speeds 4 rested on trans_id_stamp_decode_v1 rows read by one family.
--
-- WHAT.
-- 1. data_set_kind_properties.establish_min_families (default 2): the rule row's family floor.
-- 2. data_set_grade_vehicle: an observation with a photo is reading_registered / reading_unregistered by
--    reader_lineage(agent_model), whatever its method; 'decode' is a VIN decode (vehicle_vin basis, or a field_evidence
--    mirror of vin_decode_*). Established = a class in establish_alone, or (establish_min distinct witnesses of
--    establish_classes AND establish_min_families distinct reader families among the registered readings). rule_version
--    data_set_member_grades_v2.
-- 3. The backfill lap restarts from the first vehicle (cursor reset, cron re-scheduled if it had stopped), so every graded
--    membership is re-graded under v2; model_fold_one keeps grading each folded vehicle.
--
-- REVERT: re-run the data_set_grade_vehicle definition of 20261124193700 and reset the cursor the same way.
-- Contract: supabase/sql/test_data_set_grade_families.sql.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

ALTER TABLE public.data_set_kind_properties
  ADD COLUMN IF NOT EXISTS establish_min_families integer NOT NULL DEFAULT 2 CHECK (establish_min_families >= 1);
COMMENT ON COLUMN public.data_set_kind_properties.establish_min_families IS
  'Distinct reader families (reader_lineage) among registered photo readings needed to establish without a decode or paper. 20261124194400.';

CREATE OR REPLACE FUNCTION public.data_set_grade_vehicle(p_vehicle_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE n int := 0; n_del int := 0; c jsonb;
BEGIN
  IF p_vehicle_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.vehicles WHERE id = p_vehicle_id) THEN
    RETURN jsonb_build_object('skipped', 'no vehicle');
  END IF;
  CREATE TEMP TABLE IF NOT EXISTS _dsg (set_id uuid, set_kind text, grade text, witness_classes text[], n_witnesses int, exclusive boolean) ON COMMIT DROP;
  TRUNCATE _dsg;
  INSERT INTO _dsg
  WITH mem AS (
    SELECT m.set_id, d.set_kind, m.basis_type, m.basis_id
      FROM public.data_set_members m JOIN public.data_sets d ON d.id = m.set_id
     WHERE m.vehicle_id = p_vehicle_id AND m.state = 'active'),
  fe_cls AS (
    SELECT f.id,
           CASE WHEN f.source_type = 'vehicle_record' THEN 'record_mirror'
                WHEN f.extraction_context LIKE '% via observation-writer%'
                     AND split_part(f.extraction_context, ' via ', 1) LIKE 'vin\_decode\_%' THEN 'decode'
                WHEN f.source_type IN ('quickbooks', 'invoice', 'email_receipt', 'receipt') THEN 'receipt'
                WHEN f.raw_extraction_data->>'image_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                     THEN 'reading_unregistered'
                ELSE 'claim' END AS cls
      FROM public.field_evidence f
     WHERE f.vehicle_id = p_vehicle_id),
  wit AS (
    -- observation: one witness per photo, or the row
    SELECT mem.set_id, mem.set_kind,
           CASE WHEN w.image_id IS NULL THEN 'claim'
                WHEN public.reader_lineage(o.agent_model) IS NOT NULL THEN 'reading_registered'
                ELSE 'reading_unregistered' END AS cls,
           coalesce('img:' || w.image_id, 'obs:' || o.id) AS wkey,
           CASE WHEN w.image_id IS NOT NULL THEN public.reader_lineage(o.agent_model) END AS fam
      FROM mem JOIN public.vehicle_observations o ON o.id = mem.basis_id
      LEFT JOIN LATERAL (SELECT ow.image_id FROM public.observation_witnesses ow WHERE ow.observation_id = o.id) w ON true
     WHERE mem.basis_type = 'observation'
    UNION ALL
    SELECT mem.set_id, mem.set_kind, fc.cls, 'fe:' || fc.id, NULL::text
      FROM mem JOIN fe_cls fc ON fc.id = mem.basis_id WHERE mem.basis_type = 'field_evidence'
    UNION ALL
    SELECT mem.set_id, mem.set_kind,
           CASE WHEN r.origin_table = 'field_evidence' THEN coalesce(fc.cls, 'mentioned') ELSE 'mentioned' END,
           CASE WHEN r.origin_table = 'field_evidence' THEN 'fe:' || r.origin_id ELSE r.origin_table || ':' || r.origin_id END,
           NULL::text
      FROM mem JOIN public.vehicle_code_readings r ON r.id = mem.basis_id
      LEFT JOIN fe_cls fc ON r.origin_table = 'field_evidence' AND fc.id = r.origin_id
     WHERE mem.basis_type = 'code_reading'
    UNION ALL
    SELECT mem.set_id, mem.set_kind,
           CASE mem.basis_type WHEN 'vehicle_vin' THEN 'decode' WHEN 'comment_rubric' THEN 'mentioned' ELSE 'record' END,
           mem.basis_type || ':' || coalesce(mem.basis_id::text, ''), NULL::text
      FROM mem WHERE mem.basis_type NOT IN ('observation', 'field_evidence', 'code_reading')),
  ranked AS (
    SELECT wit.set_id, wit.set_kind, wit.cls, wit.wkey, wit.fam, k.rank
      FROM wit JOIN public.evidence_class_rank k ON k.class = wit.cls AND k.is_witness),
  per_set AS (
    SELECT s.set_id, s.set_kind,
           coalesce(r.exclusive, false) AS exclusive,
           (SELECT array_agg(DISTINCT x.cls ORDER BY x.cls) FROM ranked x WHERE x.set_id = s.set_id) AS classes,
           (SELECT count(DISTINCT x.wkey) FROM ranked x WHERE x.set_id = s.set_id)::int AS n_wit,
           (SELECT count(DISTINCT x.wkey) FROM ranked x
             WHERE x.set_id = s.set_id AND x.cls = ANY (coalesce(r.establish_classes, '{decode,receipt,reading_registered}')))::int AS n_est,
           (SELECT min(x.rank) FROM ranked x WHERE x.set_id = s.set_id) AS best,
           EXISTS (SELECT 1 FROM ranked x WHERE x.set_id = s.set_id AND x.cls = ANY (coalesce(r.establish_alone, '{decode,receipt}'))) AS alone,
           (SELECT count(DISTINCT x.fam) FROM ranked x WHERE x.set_id = s.set_id AND x.cls = 'reading_registered')::int AS n_fam,
           coalesce(r.establish_min, 2) AS emin, coalesce(r.establish_min_families, 2) AS fmin
      FROM (SELECT DISTINCT set_id, set_kind FROM mem) s
      LEFT JOIN public.data_set_kind_properties r ON r.set_kind = s.set_kind),
  graded AS (
    SELECT p.*, CASE WHEN p.n_wit = 0 THEN 'mentioned'
                     WHEN p.alone OR (p.n_est >= p.emin AND p.n_fam >= p.fmin) THEN 'established'
                     WHEN p.best <= (SELECT rank FROM public.evidence_class_rank WHERE class = 'reading_unregistered') THEN 'supported'
                     ELSE 'mentioned' END AS g0
      FROM per_set p)
  SELECT g.set_id, g.set_kind,
         CASE WHEN g.exclusive AND g.g0 = 'established'
                   AND (SELECT count(*) FROM graded o WHERE o.set_kind = g.set_kind AND o.g0 = 'established') > 1 THEN 'conflict'
              WHEN g.exclusive AND g.g0 = 'supported'
                   AND NOT EXISTS (SELECT 1 FROM graded o WHERE o.set_kind = g.set_kind AND o.g0 = 'established')
                   AND (SELECT count(*) FROM graded o WHERE o.set_kind = g.set_kind AND o.g0 = 'supported') > 1 THEN 'conflict'
              ELSE g.g0 END,
         coalesce(g.classes, '{}'), g.n_wit, g.exclusive
    FROM graded g;

  DELETE FROM public.data_set_member_grades x
   WHERE x.vehicle_id = p_vehicle_id AND NOT EXISTS (SELECT 1 FROM _dsg WHERE _dsg.set_id = x.set_id);
  GET DIAGNOSTICS n_del = ROW_COUNT;
  -- conflicts first, so no transient second established row meets the partial unique index
  UPDATE public.data_set_member_grades x SET grade = 'conflict', graded_at = now()
    FROM _dsg WHERE x.vehicle_id = p_vehicle_id AND x.set_id = _dsg.set_id AND _dsg.grade <> 'established' AND x.grade = 'established';
  INSERT INTO public.data_set_member_grades (vehicle_id, set_id, set_kind, grade, witness_classes, n_witnesses, exclusive, rule_version, graded_at)
  SELECT p_vehicle_id, set_id, set_kind, grade, witness_classes, n_witnesses, exclusive, 'data_set_member_grades_v2', now() FROM _dsg
  ON CONFLICT (vehicle_id, set_id) DO UPDATE SET grade = excluded.grade, witness_classes = excluded.witness_classes,
    n_witnesses = excluded.n_witnesses, exclusive = excluded.exclusive, rule_version = excluded.rule_version, graded_at = excluded.graded_at;
  GET DIAGNOSTICS n = ROW_COUNT;
  SELECT jsonb_object_agg(grade, k) INTO c FROM (SELECT grade, count(*) k FROM _dsg GROUP BY grade) q;
  RETURN jsonb_build_object('vehicle_id', p_vehicle_id, 'graded', n, 'removed', n_del, 'grades', coalesce(c, '{}'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.data_set_grade_vehicle(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.data_set_grade_vehicle(uuid) TO service_role;COMMENT ON FUNCTION public.data_set_grade_vehicle(uuid) IS
  'Grade fold v2: one data_set_member_grades row per membership; photo readings need establish_min_families reader families. 20261124194400.';

-- re-grade every membership under v2: restart the backfill lap
INSERT INTO public.platform_config (config_key, config_value, description, updated_at)
VALUES ('data_set_grades_backfill', jsonb_build_object('cursor', NULL, 'done', false, 'vehicles_total', 0, 'restarted_for', 'data_set_member_grades_v2'),
        'Cursor of data_set_grades_backfill_v1 (20261124193700); done = the lap is graded. Restarted by 20261124194400.', now())
ON CONFLICT (config_key) DO UPDATE SET config_value = excluded.config_value, description = excluded.description, updated_at = now();
DO $cron$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    PERFORM cron.schedule('data-set-grades-backfill', '* * * * *',
      $cmd$SET statement_timeout = '55s'; SET lock_timeout = '5s'; SELECT public.data_set_grades_backfill_v1(1500);$cmd$);
  END IF;
END $cron$;
