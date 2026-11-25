-- data_set_member_grades_v1: every data-set membership is graded by its witnesses' classes, under a rule row per set kind.
--
-- WHY. data_set_members admits a membership on any basis (99.7% of active rows are code_reading, a pattern match over
-- free text), one row per text span, and every reader counts state = 'active' alone. The proof car is in trans_type
-- automatic and manual, trans_speeds 3 and 4, and five trans_model sets at once, all from text spans; its facet
-- transmission.current.type is established by photo readings. Owner order 2026-11-24: values are gated by witness class,
-- text-only memberships stay as 'mentioned', an exclusive property with two live values is a conflict, readers count by
-- grade, and the fold loop re-grades.
--
-- WHAT.
-- 1. evidence_class_rank gains 'mentioned' (rank 5): a text span that names the value (listing text, a comment, a
--    description, an observation's free text). Below every other witness; never establishes.
-- 2. data_set_kind_properties (set_kind PK, property_id FK observation_properties, exclusive, establish_alone[],
--    establish_classes[], establish_min, note): the rule row. A kind whose value has no registered key keeps property_id
--    NULL. Classes are checked against evidence_class_rank by trigger.
-- 3. data_set_member_grades (vehicle_id FK vehicles, set_id + set_kind FK data_sets, PK (vehicle_id, set_id)): one row per
--    membership, not per span: grade established | supported | mentioned | conflict, witness_classes[], n_witnesses (distinct
--    witness keys), exclusive, rule_version, graded_at. CHECK: established needs a witness. Partial unique index: at most
--    one established set per vehicle and exclusive kind.
-- 4. data_set_grade_vehicle(vehicle): the fold. Witness class from each active member's basis row:
--      observation -> vehicle_observations: with an observation_witnesses photo, 'decode' when its method decodes
--        (*_decode_*), else reading_registered / reading_unregistered by reader_lineage(agent_model); without one, claim;
--      field_evidence -> the facet reader's classifier (as 20261124193600);
--      code_reading -> vehicle_code_readings.origin_*: over a field_evidence value, that row's class; any other text
--        (vehicle_observations.content_text, vehicles columns, auction_comments) is 'mentioned';
--      vehicle_vin -> decode; comment_rubric -> mentioned; vehicle_flag -> record (not a witness).
--    Witness key: the photo for a reading, the row for a decode or claim, the origin row for a mention, so ten spans of
--    one description are one witness. Grade: established when a class in establish_alone is present, or distinct
--    witnesses of establish_classes >= establish_min; supported when any class ranks at claim or better; mentioned
--    otherwise. Exclusive kinds: two established sets both become conflict; with none established, two supported sets
--    both become conflict; mentioned never conflicts. Rows of the vehicle no longer backed are removed (a derived table).
-- 5. model_fold_one grades the vehicle after it applies memberships (cron model-fold-tick, every 30 s).
-- 6. Backfill: data_set_grades_backfill_v1(limit) grades vehicles in id order from a cursor (platform_config
--    'data_set_grades_backfill'); cron data-set-grades-backfill every minute, 1,500 vehicles (read cost measured 4.1-4.7 s per 600), stops itself when the lap is done.
--    Size, sampled 2026-11-25 over 1/256 of the id space: 2,777 vehicles, 7,415 memberships -> about 711k vehicles and
--    1.9M grade rows, about 8 h.
-- 7. Readers by grade: data_set_public_counts gains established / supported / mentioned / conflict public vehicle counts
--    (data_set_public_count_one); vehicle_data_sets returns each set's grade, witness classes and witness count, and those
--    counts per set.
--
-- REVERT. SELECT cron.unschedule('data-set-grades-backfill'); restore model_fold_one, data_set_public_count_one and
-- vehicle_data_sets from pg_get_functiondef before this migration; DROP FUNCTION data_set_grades_backfill_v1(integer),
-- data_set_grade_vehicle(uuid); DROP TABLE data_set_member_grades, data_set_kind_properties; ALTER TABLE
-- data_set_public_counts DROP COLUMN established_vehicles, supported_vehicles, mentioned_vehicles, conflict_vehicles;
-- DELETE FROM evidence_class_rank WHERE class = 'mentioned'. No testimony table is written.
-- Contract: supabase/sql/test_data_set_member_grades.sql.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

INSERT INTO public.evidence_class_rank (class, rank, is_witness, note) VALUES
  ('mentioned', 5, true, 'a text span naming the value: listing text, a comment, a description, an observation''s free text')
ON CONFLICT (class) DO UPDATE SET rank = excluded.rank, is_witness = excluded.is_witness, note = excluded.note;

CREATE TABLE IF NOT EXISTS public.data_set_kind_properties (
  set_kind text PRIMARY KEY,
  property_id uuid REFERENCES public.observation_properties(id),
  exclusive boolean NOT NULL,
  establish_alone text[] NOT NULL DEFAULT '{decode,receipt}',
  establish_classes text[] NOT NULL DEFAULT '{decode,receipt,reading_registered}',
  establish_min integer NOT NULL DEFAULT 2 CHECK (establish_min >= 1),
  note text NOT NULL
);
ALTER TABLE public.data_set_kind_properties ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.data_set_kind_properties FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.data_set_kind_properties TO service_role;
COMMENT ON TABLE public.data_set_kind_properties IS
  'Rule row per data set kind: the registered property it is a value of, whether a vehicle holds one value of it (exclusive), and which witness classes establish a membership (alone, or establish_min distinct witnesses of establish_classes). Read by data_set_grade_vehicle. 20261124193700.';

CREATE OR REPLACE FUNCTION public.data_set_kind_properties_check()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM unnest(NEW.establish_alone || NEW.establish_classes) c
              WHERE NOT EXISTS (SELECT 1 FROM public.evidence_class_rank k WHERE k.class = c AND k.is_witness)) THEN
    RAISE EXCEPTION 'data_set_kind_properties %: every class must be a witness class in evidence_class_rank', NEW.set_kind
      USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS data_set_kind_properties_check ON public.data_set_kind_properties;
CREATE TRIGGER data_set_kind_properties_check BEFORE INSERT OR UPDATE ON public.data_set_kind_properties
  FOR EACH ROW EXECUTE FUNCTION public.data_set_kind_properties_check();

INSERT INTO public.data_set_kind_properties (set_kind, property_id, exclusive, note)
SELECT k.set_kind, (SELECT p.id FROM public.observation_properties p WHERE p.property_key = k.pk AND p.deprecated_at IS NULL), k.ex, k.note
FROM (VALUES
  ('trans_type', 'transmission_type', true, 'manual or automatic: one per vehicle'),
  ('trans_speeds', 'transmission_speeds', true, 'forward speeds of the installed gearbox'),
  ('trans_model', 'transmission_model', true, 'the installed gearbox model'),
  ('trans_case_casting', 'transmission_case_casting', true, 'case casting number'),
  ('trans_tail_casting', 'transmission_tailhousing_casting', true, 'tailhousing casting number'),
  ('engine_cid', 'engine_displacement_l', true, 'displacement of the installed engine'),
  ('engine_code', 'engine_code_stamp', true, 'engine code stamped on the block'),
  ('engine_block_casting', 'engine_block_casting', true, 'block casting number'),
  ('axle_ratio', 'rear_axle_ratio', true, 'rear axle ratio of the installed axle'),
  ('paint_code', 'body_tag_paint_code', true, 'paint code from the body tag (a two-tone is one code pair)'),
  ('body_style', 'body_style', true, 'body style'),
  ('cowl_style', 'body_tag_style', true, 'body tag style number'),
  ('interior_trim_code', 'body_tag_trim_code', true, 'body tag trim code'),
  ('trim_level', 'trim', true, 'trim level'),
  ('build_month', 'body_tag_build_date', true, 'build month from the body tag'),
  ('plant_year', NULL, true, 'assembly plant and model year from the VIN'),
  ('vin_series', NULL, true, 'VIN series'),
  ('vin_engine', NULL, true, 'VIN engine code'),
  ('vin_cohort', NULL, true, 'VIN series and engine cohort'),
  ('dealer_zone', NULL, true, 'selling dealer zone from the body tag'),
  ('rpo_code', NULL, false, 'option codes: a vehicle holds many'),
  ('cowl_option', NULL, false, 'body tag option codes: many'),
  ('documentation', NULL, false, 'kinds of paper a vehicle has: many'),
  ('comment_theme', NULL, false, 'comment themes: many'),
  ('replica_cohort', NULL, false, 'as presented and as built cohorts: both')
) k(set_kind, pk, ex, note)
ON CONFLICT (set_kind) DO NOTHING;

CREATE UNIQUE INDEX IF NOT EXISTS data_sets_id_kind_uq ON public.data_sets (id, set_kind);

CREATE TABLE IF NOT EXISTS public.data_set_member_grades (
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  set_id uuid NOT NULL,
  set_kind text NOT NULL,
  grade text NOT NULL CHECK (grade IN ('established', 'supported', 'mentioned', 'conflict')),
  witness_classes text[] NOT NULL,
  n_witnesses integer NOT NULL,
  exclusive boolean NOT NULL,
  rule_version text NOT NULL,
  graded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (vehicle_id, set_id),
  FOREIGN KEY (set_id, set_kind) REFERENCES public.data_sets (id, set_kind),
  CHECK (grade <> 'established' OR (n_witnesses >= 1 AND cardinality(witness_classes) >= 1))
);
CREATE INDEX IF NOT EXISTS data_set_member_grades_set_idx ON public.data_set_member_grades (set_id, grade) INCLUDE (vehicle_id);
CREATE UNIQUE INDEX IF NOT EXISTS data_set_member_grades_one_established_uq
  ON public.data_set_member_grades (vehicle_id, set_kind) WHERE grade = 'established' AND exclusive;
ALTER TABLE public.data_set_member_grades ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.data_set_member_grades FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.data_set_member_grades TO service_role;
COMMENT ON TABLE public.data_set_member_grades IS
  'One row per data-set membership (vehicle x set): its grade from its witnesses'' classes under data_set_kind_properties. Folded by data_set_grade_vehicle from model_fold_one; derived, recomputed whole per vehicle. 20261124193700.';

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
                WHEN o.extraction_method LIKE '%\_decode\_%' THEN 'decode'
                WHEN public.reader_lineage(o.agent_model) IS NOT NULL THEN 'reading_registered'
                ELSE 'reading_unregistered' END AS cls,
           coalesce('img:' || w.image_id, 'obs:' || o.id) AS wkey
      FROM mem JOIN public.vehicle_observations o ON o.id = mem.basis_id
      LEFT JOIN LATERAL (SELECT ow.image_id FROM public.observation_witnesses ow WHERE ow.observation_id = o.id) w ON true
     WHERE mem.basis_type = 'observation'
    UNION ALL
    SELECT mem.set_id, mem.set_kind, fc.cls, 'fe:' || fc.id
      FROM mem JOIN fe_cls fc ON fc.id = mem.basis_id WHERE mem.basis_type = 'field_evidence'
    UNION ALL
    SELECT mem.set_id, mem.set_kind,
           CASE WHEN r.origin_table = 'field_evidence' THEN coalesce(fc.cls, 'mentioned') ELSE 'mentioned' END,
           CASE WHEN r.origin_table = 'field_evidence' THEN 'fe:' || r.origin_id ELSE r.origin_table || ':' || r.origin_id END
      FROM mem JOIN public.vehicle_code_readings r ON r.id = mem.basis_id
      LEFT JOIN fe_cls fc ON r.origin_table = 'field_evidence' AND fc.id = r.origin_id
     WHERE mem.basis_type = 'code_reading'
    UNION ALL
    SELECT mem.set_id, mem.set_kind,
           CASE mem.basis_type WHEN 'vehicle_vin' THEN 'decode' WHEN 'comment_rubric' THEN 'mentioned' ELSE 'record' END,
           mem.basis_type || ':' || coalesce(mem.basis_id::text, '')
      FROM mem WHERE mem.basis_type NOT IN ('observation', 'field_evidence', 'code_reading')),
  ranked AS (
    SELECT wit.set_id, wit.set_kind, wit.cls, wit.wkey, k.rank
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
           coalesce(r.establish_min, 2) AS emin
      FROM (SELECT DISTINCT set_id, set_kind FROM mem) s
      LEFT JOIN public.data_set_kind_properties r ON r.set_kind = s.set_kind),
  graded AS (
    SELECT p.*, CASE WHEN p.n_wit = 0 THEN 'mentioned'
                     WHEN p.alone OR p.n_est >= p.emin THEN 'established'
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
  SELECT p_vehicle_id, set_id, set_kind, grade, witness_classes, n_witnesses, exclusive, 'data_set_member_grades_v1', now() FROM _dsg
  ON CONFLICT (vehicle_id, set_id) DO UPDATE SET grade = excluded.grade, witness_classes = excluded.witness_classes,
    n_witnesses = excluded.n_witnesses, exclusive = excluded.exclusive, rule_version = excluded.rule_version, graded_at = excluded.graded_at;
  GET DIAGNOSTICS n = ROW_COUNT;
  SELECT jsonb_object_agg(grade, k) INTO c FROM (SELECT grade, count(*) k FROM _dsg GROUP BY grade) q;
  RETURN jsonb_build_object('vehicle_id', p_vehicle_id, 'graded', n, 'removed', n_del, 'grades', coalesce(c, '{}'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.data_set_grade_vehicle(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.data_set_grade_vehicle(uuid) TO service_role;

-- 5. the fold loop grades after it applies
DO $fold$
DECLARE d text; anchor text := 'a := public.data_set_membership_apply_v1(v_mem, 500, 200, false);';
BEGIN
  d := pg_get_functiondef('public.model_fold_one(uuid, uuid, jsonb, uuid[])'::regprocedure);
  IF position('data_set_grade_vehicle' IN d) > 0 THEN RETURN; END IF;
  IF (length(d) - length(replace(d, anchor, ''))) / length(anchor) <> 1 THEN
    RAISE EXCEPTION 'model_fold_one: apply anchor not found exactly once';
  END IF;
  EXECUTE replace(d, anchor, anchor || chr(10) || '  perform public.data_set_grade_vehicle(p_vehicle);');
END $fold$;

-- 6. backfill, bounded, self-stopping
CREATE OR REPLACE FUNCTION public.data_set_grades_backfill_v1(p_limit integer DEFAULT 600)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE cfg jsonb; cur uuid; v uuid; n int := 0; last uuid; t0 timestamptz := clock_timestamp();
BEGIN
  SELECT config_value INTO cfg FROM public.platform_config WHERE config_key = 'data_set_grades_backfill' FOR UPDATE;
  IF coalesce((cfg->>'done')::boolean, false) THEN RETURN jsonb_build_object('done', true); END IF;
  cur := coalesce((cfg->>'cursor')::uuid, '00000000-0000-0000-0000-000000000000');
  FOR v IN SELECT DISTINCT m.vehicle_id FROM public.data_set_members m
            WHERE m.state = 'active' AND m.vehicle_id > cur ORDER BY m.vehicle_id LIMIT greatest(1, least(coalesce(p_limit, 600), 2000)) LOOP
    EXIT WHEN clock_timestamp() - t0 > interval '45 seconds';
    PERFORM public.data_set_grade_vehicle(v); n := n + 1; last := v;
  END LOOP;
  cfg := jsonb_build_object('cursor', coalesce(last, cur), 'done', last IS NULL,
                            'vehicles_total', coalesce((cfg->>'vehicles_total')::int, 0) + n,
                            'last_run', jsonb_build_object('at', now(), 'vehicles', n, 'ms', round(extract(epoch FROM clock_timestamp() - t0) * 1000)));
  INSERT INTO public.platform_config (config_key, config_value, description, updated_at)
  VALUES ('data_set_grades_backfill', cfg, 'Cursor of data_set_grades_backfill_v1 (20261124193700); done = the first lap is graded.', now())
  ON CONFLICT (config_key) DO UPDATE SET config_value = excluded.config_value, updated_at = now();
  IF last IS NULL AND to_regnamespace('cron') IS NOT NULL THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'data-set-grades-backfill';
  END IF;
  RETURN cfg;
END;
$$;
REVOKE ALL ON FUNCTION public.data_set_grades_backfill_v1(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.data_set_grades_backfill_v1(integer) TO service_role;

-- 7a. public counts by grade
ALTER TABLE public.data_set_public_counts
  ADD COLUMN IF NOT EXISTS established_vehicles integer,
  ADD COLUMN IF NOT EXISTS supported_vehicles integer,
  ADD COLUMN IF NOT EXISTS mentioned_vehicles integer,
  ADD COLUMN IF NOT EXISTS conflict_vehicles integer;

CREATE OR REPLACE FUNCTION public.data_set_public_count_one(p_set_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE n integer; e integer; s integer; m integer; c integer;
BEGIN
  SELECT count(DISTINCT mm.vehicle_id)::int INTO n
    FROM public.data_set_members mm
    JOIN public.vehicles pv ON pv.id = mm.vehicle_id AND pv.is_public IS TRUE AND pv.deleted_at IS NULL
   WHERE mm.set_id = p_set_id AND mm.state = 'active' AND mm.member_type IN ('vehicle', 'auction_comment');
  SELECT count(*) FILTER (WHERE g.grade = 'established'), count(*) FILTER (WHERE g.grade = 'supported'),
         count(*) FILTER (WHERE g.grade = 'mentioned'), count(*) FILTER (WHERE g.grade = 'conflict')
    INTO e, s, m, c
    FROM public.data_set_member_grades g
    JOIN public.vehicles pv ON pv.id = g.vehicle_id AND pv.is_public IS TRUE AND pv.deleted_at IS NULL
   WHERE g.set_id = p_set_id;
  INSERT INTO public.data_set_public_counts (set_id, public_vehicles, established_vehicles, supported_vehicles, mentioned_vehicles,
                                             conflict_vehicles, counted_at)
  VALUES (p_set_id, n, e, s, m, c, now())
  ON CONFLICT (set_id) DO UPDATE SET public_vehicles = excluded.public_vehicles, established_vehicles = excluded.established_vehicles,
    supported_vehicles = excluded.supported_vehicles, mentioned_vehicles = excluded.mentioned_vehicles,
    conflict_vehicles = excluded.conflict_vehicles, counted_at = excluded.counted_at;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.data_set_public_count_one(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.data_set_public_count_one(uuid) TO service_role;

-- 7b. vehicle_data_sets returns the grade of each set and the set's counts by grade
DO $vds$
DECLARE d text; n int;
  a1 text := 'LEFT JOIN public.data_set_public_counts pc ON pc.set_id = s.id)';
  a2 text := '''confidence'', sets.conf, ''public_vehicles_in_set'', sets.n_vehicles,';
BEGIN
  d := pg_get_functiondef('public.vehicle_data_sets(uuid)'::regprocedure);
  IF position('data_set_member_grades' IN d) > 0 THEN RETURN; END IF;
  FOREACH n IN ARRAY ARRAY[1, 2] LOOP
    IF (length(d) - length(replace(d, CASE n WHEN 1 THEN a1 ELSE a2 END, ''))) / length(CASE n WHEN 1 THEN a1 ELSE a2 END) <> 1 THEN
      RAISE EXCEPTION 'vehicle_data_sets: anchor % not found exactly once', n;
    END IF;
  END LOOP;
  d := replace(d, 'SELECT s.id, s.set_kind, s.set_key, s.label, s.rule_version, mine.*,',
                  'SELECT s.id, s.set_kind, s.set_key, s.label, s.rule_version, mine.*, g.grade, g.witness_classes, g.n_witnesses, pc.established_vehicles, pc.supported_vehicles, pc.mentioned_vehicles, pc.conflict_vehicles,');
  d := replace(d, a1, 'LEFT JOIN public.data_set_public_counts pc ON pc.set_id = s.id' || chr(10) ||
                      '      LEFT JOIN public.data_set_member_grades g ON g.vehicle_id = p_vehicle_id AND g.set_id = s.id)');
  d := replace(d, a2, a2 || ' ''grade'', sets.grade, ''witness_classes'', to_jsonb(sets.witness_classes), ''witnesses'', sets.n_witnesses,'
                      || ' ''public_vehicles_by_grade'', jsonb_build_object(''established'', sets.established_vehicles, ''supported'', sets.supported_vehicles, ''mentioned'', sets.mentioned_vehicles, ''conflict'', sets.conflict_vehicles),');
  IF position('g.grade, g.witness_classes' IN d) = 0 THEN RAISE EXCEPTION 'vehicle_data_sets: select anchor not found'; END IF;
  EXECUTE d;
END $vds$;

DO $cron$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    PERFORM cron.schedule('data-set-grades-backfill', '* * * * *',
      $cmd$SET statement_timeout = '55s'; SET lock_timeout = '5s'; SELECT public.data_set_grades_backfill_v1(1500);$cmd$);
  END IF;
END $cron$;
