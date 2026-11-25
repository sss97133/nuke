-- facet_grades_fold_v1: an item's grade is a property of the car's evidence, not of the viewer. The grade is folded over
-- every witness; the reader returns it to every caller and masks only the sources that caller cannot see.
--
-- WHY. vehicle_facet_items is LANGUAGE sql and runs as the caller, so row policies decide which witnesses it counts.
-- Measured 2026-11-25 on three public cars (dcc1e063, ea6ee3c7, 5a1deb95): 9 items read claim for a logged-out visitor
-- and established for the service role, and 5 more differ only in their witness count. Every one of them gains exactly
-- one witness the visitor cannot see: a vehicle_field_evidence row, whose read policy admits only the car's uploader.
-- The owner's rule is "profiles public; privacy is line-item masking inside" (lead ruling 2026-11-25).
--
-- ROWS.
--   vehicle_facet_item_rules   one row per facet item: may its value leave the fold (value_publishable). No row = no.
--   vehicle_facet_grades       (vehicle_id, item_key): status, witness count and counts by class, basis, and the value
--                              only for a publishable item. Readable by no client role; read through
--                              vehicle_facet_grades_read, which applies the item rule at read time.
--   vehicle_facet_grade_folds  one row per folded vehicle: logic key, items, unregistered items, ms, error.
-- FOLD. vehicle_facet_grades_fold(vehicle), SECURITY DEFINER: runs the reader with no caller and no overlay
--   (nuke.facet_grades = raw), so it counts every witness of a public car, and writes its rows. A failure is written to
--   the folds row and never fails the vehicle's model fold. logic_key = the establishment_rules row (key/version).
-- WHO RUNS IT. model_fold_one, after data_set_grade_vehicle, for a vehicle in scope (vehicle_facet_grades_in_scope:
--   slice one = the cars holding vehicle_field_evidence rows, or already folded). New evidence reaches it through the
--   existing model_fold_signal triggers. vehicle_facet_grades_enqueue (cron, every 5 min) queues the slice at
--   model_fold_work priority 9, the lowest (signals are 1, the sweep 5), only once the data-set-grades-backfill job is
--   gone and the pending queue is under the fold's sweep_pending_cap.
-- READER. everything -> everything_raw; everything = vehicle_facet_grade_overlay(doc, fold row). The overlay, per item:
--   private_witnesses = fold witnesses - caller witnesses; none private, or fewer in the fold than the caller sees
--   (a stale fold): the caller's doc unchanged. Caller has no value: the fold's status, the value only when the item is
--   publishable (else value_private). Caller has a value: a publishable item takes the fold's status only when the
--   fold's normalized value equals the caller's (else the fold is stale and the caller's doc stands); a private item
--   keeps the caller's status and gains the count, since a grade beside a visible value would tell the private value.
--   Sources stay as the caller's row policies return them.
-- NEVER RAISE UNTIL THE RULE SHIPS (lead ruling 2026-11-25, after ta-skeptic). establishment_rules.overlay_may_raise,
--   false on the live row (rule version 1): the overlay may keep or lower a caller's grade (rank missing = conflict <
--   claim < reading < established) and add the count, never raise it. Under version 1 one hidden nhtsa decode claim plus a
--   listing claim would raise 9 items to established on the 3 cars; with the flag false the dry run raises 0. The flag
--   flips with the rule row (the two-axis rule), not with a code edit.
-- STALE FOLD. A fold row is not used when its car's evidence changed after it: vehicle_facet_grade_folds.evidence_changed_at
--   is stamped by a statement trigger on vehicle_field_evidence (which also queues a model_fold_signal for the car, in or
--   out of the fold's make scope), and a car whose model_fold_work row is pending or leased with dirty_at after the fold
--   is skipped too (every table the model fold signals). The caller's own grade stands until the car folds again.
-- NOT CHANGED. The receipt branch keeps its party gate: 0 paper rows in field_evidence map to a facet field (all are
--   spend:* fields, 2026-11-25), so no grade moves on it today.
-- EVERY CAR (lap 2, a later migration): vehicle_facet_grades_in_scope returns true for every public car and the seed
--   cursor walks vehicles; at ~0.3 s a fold and the tick's spare budget that is ~40k cars a day, ~30 days for ~1.16M.
--   When every public car has a current fold row the reader drops the caller-status path.
-- REVERT. Redefine vehicle_facet_items and model_fold_one without the text between facet_grades_fold_v1 and
--   facet_grades_fold_v1_end, unschedule vehicle-facet-grades-seed, drop the three vehicle_facet_grades_changed_*
--   triggers; the tables and the rule column can stay (nothing else reads them).
SET lock_timeout = '5s';
SET statement_timeout = '60s';

-- 0. The rule row says whether the folded grade may raise a caller's grade ---------------------------------------------
ALTER TABLE public.establishment_rules ADD COLUMN IF NOT EXISTS overlay_may_raise boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.establishment_rules.overlay_may_raise IS
  'facet_grades_fold_v1: may the grade folded over every witness raise the grade a caller computes from the witnesses it can see. False until the two-axis rule ships (lead ruling 2026-11-25): keep or lower only.';

-- 1. Which item values may leave the fold -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vehicle_facet_item_rules (
  item_key text PRIMARY KEY CHECK (item_key ~ '^[a-z_]+(\.[a-z_]+)+$'),
  value_publishable boolean NOT NULL,
  note text NOT NULL CHECK (length(btrim(note)) >= 12),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.vehicle_facet_item_rules IS
  'One row per vehicle_facet_items item: may its value be shown when only private witnesses state it (facet_grades_fold_v1). No row: no.';
ALTER TABLE public.vehicle_facet_item_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vehicle_facet_item_rules_read ON public.vehicle_facet_item_rules;
CREATE POLICY vehicle_facet_item_rules_read ON public.vehicle_facet_item_rules FOR SELECT TO anon, authenticated USING (true);
REVOKE ALL ON public.vehicle_facet_item_rules FROM anon, authenticated;
GRANT SELECT ON public.vehicle_facet_item_rules TO anon, authenticated;
GRANT ALL ON public.vehicle_facet_item_rules TO service_role;

INSERT INTO public.vehicle_facet_item_rules (item_key, value_publishable, note)
SELECT k, NOT (k LIKE 'location.%' OR k IN ('engine.current.machine_work', 'engine.current.engine_code_stamp',
                                             'transmission.current.id_stamp', 'body_style.body_number')),
       CASE WHEN k LIKE 'location.%' THEN 'where the car is: from photo GPS and listings; never shown from private witnesses'
            WHEN k = 'engine.current.machine_work' THEN 'machine work words can name a shop or a person'
            WHEN k IN ('engine.current.engine_code_stamp', 'transmission.current.id_stamp')
              THEN 'a stamp that can carry a VIN derivative'
            WHEN k = 'body_style.body_number' THEN 'a body serial: identifies the one car like a VIN'
            ELSE 'a specification of the car: shown when only private witnesses state it' END
FROM unnest(ARRAY[
  'year.decode', 'year.recorded', 'year.title', 'make.decode', 'make.recorded', 'make.title',
  'model.decode', 'model.recorded', 'model.title', 'body_style.decode', 'body_style.recorded', 'body_style.title',
  'body_style.body_tag', 'body_style.body_number', 'body_style.build_date', 'body_style.option_codes',
  'trim.recorded', 'trim.tribute', 'trim.decode', 'trim.as_built.interior', 'paint.current.recorded', 'paint.as_built.code',
  'engine.as_built.engine', 'engine.current.family', 'engine.current.displacement', 'engine.current.bore',
  'engine.current.stroke', 'engine.derived.displacement_ci', 'engine.current.block_casting', 'engine.current.block_date',
  'engine.current.engine_code_stamp', 'engine.current.heads', 'engine.current.induction', 'engine.current.cam',
  'engine.current.machine_work', 'engine.derived.changed',
  'transmission.as_built.type', 'transmission.as_built.model', 'transmission.current.type', 'transmission.current.model',
  'transmission.current.id_stamp', 'transmission.current.date_code', 'transmission.current.case_casting',
  'transmission.current.tailhousing_casting', 'transmission.current.side_cover_casting',
  'transmission.current.bellhousing_casting', 'transmission.current.shifter', 'transmission.current.gear_ratios',
  'transmission.axle.as_built.ratio', 'transmission.axle.current.ratio', 'transmission.current.tire_size',
  'transmission.derived.final_drive', 'transmission.derived.changed',
  'drivetrain.as_built.layout', 'drivetrain.current.layout', 'drivetrain.axle.current.type',
  'location.current.area', 'location.sources.photo_gps', 'location.sources.listing', 'location.map']) k
ON CONFLICT (item_key) DO NOTHING;

-- 2. The folded grades and the fold record ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vehicle_facet_grades (
  vehicle_id uuid NOT NULL REFERENCES public.vehicles (id) ON DELETE CASCADE,
  item_key text NOT NULL REFERENCES public.vehicle_facet_item_rules (item_key),
  status text NOT NULL CHECK (status IN ('established', 'reading', 'claim', 'conflict')),
  value jsonb,
  normalized text,
  n_witnesses integer NOT NULL CHECK (n_witnesses >= 0),
  by_class jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(by_class) = 'object'),
  basis jsonb CHECK (basis IS NULL OR jsonb_typeof(basis) = 'object'),
  logic_key text NOT NULL,
  folded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (vehicle_id, item_key)
);
COMMENT ON TABLE public.vehicle_facet_grades IS
  'facet_grades_fold_v1: each non-missing facet item of a public car graded over every witness (vehicle_facet_grades_fold). Value only for a publishable item. Read through vehicle_facet_grades_read.';
ALTER TABLE public.vehicle_facet_grades ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vehicle_facet_grades FROM anon, authenticated;
GRANT ALL ON public.vehicle_facet_grades TO service_role;

CREATE TABLE IF NOT EXISTS public.vehicle_facet_grade_folds (
  vehicle_id uuid PRIMARY KEY REFERENCES public.vehicles (id) ON DELETE CASCADE,
  logic_key text NOT NULL,
  items integer NOT NULL DEFAULT 0,
  unregistered text[] NOT NULL DEFAULT '{}',
  ms integer,
  error text,
  folded_at timestamptz NOT NULL DEFAULT now(),
  evidence_changed_at timestamptz
);
ALTER TABLE public.vehicle_facet_grade_folds ADD COLUMN IF NOT EXISTS evidence_changed_at timestamptz;
CREATE INDEX IF NOT EXISTS vehicle_facet_grade_folds_folded_at_idx ON public.vehicle_facet_grade_folds (folded_at);
COMMENT ON TABLE public.vehicle_facet_grade_folds IS
  'facet_grades_fold_v1: the last fold of each vehicle (logic key, items written, items with no vehicle_facet_item_rules row, ms, error); folded_at is when its read began; evidence_changed_at is stamped when a private source of the car changes, and a row stamped after its fold is not read.';
ALTER TABLE public.vehicle_facet_grade_folds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vehicle_facet_grade_folds FROM anon, authenticated;
GRANT ALL ON public.vehicle_facet_grade_folds TO service_role;

-- 3. Functions --------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.vehicle_facet_grades_logic_key()
RETURNS text LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT 'establishment_rules/' || r.rule_key || '/' || r.rule_version FROM public.establishment_rules r WHERE r.rule_key = 'default'
$$;

-- Slice one: the cars holding a source the logged-out reader cannot see (vehicle_field_evidence), or already folded.
CREATE OR REPLACE FUNCTION public.vehicle_facet_grades_in_scope(p_vehicle_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.vehicle_field_evidence e WHERE e.vehicle_id = p_vehicle_id)
      OR EXISTS (SELECT 1 FROM public.vehicle_facet_grade_folds f WHERE f.vehicle_id = p_vehicle_id)
$$;

CREATE OR REPLACE FUNCTION public.vehicle_facet_grades_fold(p_vehicle_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  t0 timestamptz := clock_timestamp();
  k text := public.vehicle_facet_grades_logic_key();
  c_claims text := current_setting('request.jwt.claims', true);
  c_sub text := current_setting('request.jwt.claim.sub', true);
  j jsonb; v_rows jsonb := '[]'::jsonb; v_unreg text[] := '{}'; n int := 0; err text;
BEGIN
  IF p_vehicle_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.vehicles WHERE id = p_vehicle_id) THEN
    RETURN jsonb_build_object('skipped', 'no vehicle');
  END IF;
  BEGIN
    IF k IS NULL THEN RAISE EXCEPTION 'no establishment_rules default row'; END IF;
    -- No caller: the reader sees a public car whole and counts every witness; raw: no overlay of its own rows.
    PERFORM set_config('request.jwt.claims', '', true);
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('nuke.facet_grades', 'raw', true);
    j := public.vehicle_facet_items(p_vehicle_id, NULL);
    PERFORM set_config('nuke.facet_grades', '', true);
    PERFORM set_config('request.jwt.claims', coalesce(c_claims, ''), true);
    PERFORM set_config('request.jwt.claim.sub', coalesce(c_sub, ''), true);

    WITH items AS (
      SELECT DISTINCT ON (i->>'key') i->>'key' AS item_key, i AS doc
      FROM jsonb_each(CASE WHEN jsonb_typeof(j) = 'object' THEN j ELSE '{}'::jsonb END) d
      CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(d.value) = 'array' THEN d.value ELSE '[]'::jsonb END) i
      WHERE nullif(i->>'key', '') IS NOT NULL AND coalesce(i->>'status', 'missing') IN ('established', 'reading', 'claim', 'conflict')
      ORDER BY i->>'key'
    ), w AS (
      SELECT it.item_key, s.src
      FROM items it
      CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(it.doc->'sources') = 'array' THEN it.doc->'sources' ELSE '[]'::jsonb END) s(src)
      WHERE s.src->>'class' IS DISTINCT FROM 'record'
    ), cls AS (
      SELECT x.item_key, jsonb_object_agg(x.c, x.n) AS by_class, sum(x.n)::int AS n
      FROM (SELECT item_key, coalesce(src->>'class', 'other') AS c, count(*) AS n FROM w GROUP BY 1, 2) x GROUP BY x.item_key
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'item_key', it.item_key, 'status', it.doc->>'status',
             'value', CASE WHEN r.value_publishable AND it.doc->>'status' <> 'conflict' THEN nullif(it.doc->'value', 'null'::jsonb) END,
             'normalized', CASE WHEN r.value_publishable AND it.doc->>'status' <> 'conflict'
                                THEN coalesce(it.doc->>'normalized', it.doc->>'value') END,
             'n_witnesses', coalesce(c.n, 0), 'by_class', coalesce(c.by_class, '{}'::jsonb),
             'basis', CASE WHEN jsonb_typeof(it.doc->'basis') = 'object' THEN it.doc->'basis' END)
             ORDER BY it.item_key) FILTER (WHERE r.item_key IS NOT NULL), '[]'::jsonb),
           coalesce(array_agg(it.item_key ORDER BY it.item_key) FILTER (WHERE r.item_key IS NULL), '{}')
      INTO v_rows, v_unreg
    FROM items it
    LEFT JOIN public.vehicle_facet_item_rules r ON r.item_key = it.item_key
    LEFT JOIN cls c ON c.item_key = it.item_key;

    DELETE FROM public.vehicle_facet_grades g
     WHERE g.vehicle_id = p_vehicle_id
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_rows) x WHERE x->>'item_key' = g.item_key);
    INSERT INTO public.vehicle_facet_grades AS g (vehicle_id, item_key, status, value, normalized, n_witnesses, by_class, basis,
                                                  logic_key, folded_at)
    SELECT p_vehicle_id, x.item_key, x.status, x.value, x.normalized, x.n_witnesses, x.by_class, x.basis, k, t0
    FROM jsonb_to_recordset(v_rows) AS x(item_key text, status text, value jsonb, normalized text, n_witnesses int,
                                         by_class jsonb, basis jsonb)
    ON CONFLICT (vehicle_id, item_key) DO UPDATE SET
      status = excluded.status, value = excluded.value, normalized = excluded.normalized,
      n_witnesses = excluded.n_witnesses, by_class = excluded.by_class, basis = excluded.basis,
      logic_key = excluded.logic_key, folded_at = excluded.folded_at;
    n := jsonb_array_length(v_rows);
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS err = MESSAGE_TEXT;
  END;
  INSERT INTO public.vehicle_facet_grade_folds AS f (vehicle_id, logic_key, items, unregistered, ms, error, folded_at)
  VALUES (p_vehicle_id, coalesce(k, ''), n, coalesce(v_unreg, '{}'),
          (extract(epoch FROM clock_timestamp() - t0) * 1000)::int, left(err, 500), t0)
  ON CONFLICT (vehicle_id) DO UPDATE SET
    logic_key = excluded.logic_key,
    items = CASE WHEN excluded.error IS NULL THEN excluded.items ELSE f.items END,
    unregistered = CASE WHEN excluded.error IS NULL THEN excluded.unregistered ELSE f.unregistered END,
    ms = excluded.ms, error = excluded.error,
    folded_at = CASE WHEN excluded.error IS NULL THEN excluded.folded_at ELSE f.folded_at END;
  RETURN jsonb_build_object('items', n, 'unregistered', v_unreg, 'error', err,
                            'ms', (extract(epoch FROM clock_timestamp() - t0) * 1000)::int);
END $$;

-- The folded grades a caller may use: only for a car the caller may read, only under the current logic key, only when
-- no evidence of the car changed after the fold, the value only for a publishable item (the rule as it stands at read
-- time), with the rule row's overlay_may_raise. NULL while the fold itself is reading.
CREATE OR REPLACE FUNCTION public.vehicle_facet_grades_read(p_vehicle_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN coalesce(current_setting('nuke.facet_grades', true), '') = 'raw' THEN NULL
              WHEN NOT public.data_set_can_read_vehicle(p_vehicle_id) THEN NULL
              ELSE (SELECT jsonb_object_agg(g.item_key, jsonb_build_object(
                             'status', g.status, 'n', g.n_witnesses, 'by_class', g.by_class, 'basis', g.basis,
                             'publishable', r.value_publishable, 'may_raise', er.overlay_may_raise,
                             'value', CASE WHEN r.value_publishable THEN g.value END,
                             'normalized', CASE WHEN r.value_publishable THEN g.normalized END))
                    FROM public.vehicle_facet_grade_folds f
                    JOIN public.vehicle_facet_grades g ON g.vehicle_id = f.vehicle_id
                    JOIN public.vehicle_facet_item_rules r ON r.item_key = g.item_key
                    JOIN public.establishment_rules er ON er.rule_key = 'default'
                                                      AND g.logic_key = 'establishment_rules/' || er.rule_key || '/' || er.rule_version
                    WHERE f.vehicle_id = p_vehicle_id AND f.error IS NULL
                      AND (f.evidence_changed_at IS NULL OR f.evidence_changed_at < f.folded_at)
                      AND NOT EXISTS (SELECT 1 FROM public.model_fold_work w
                                       WHERE w.vehicle_id = f.vehicle_id AND w.state IN ('pending', 'leased')
                                         AND w.dirty_at > f.folded_at)) END
$$;

-- One item: the caller's doc with the fold's grade laid over it (see the header).
CREATE OR REPLACE FUNCTION public.vehicle_facet_grade_overlay(p_doc jsonb, p_fold jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
DECLARE
  vis_n int; priv int; fs text; pub boolean; has_val boolean; vis_norm text; d jsonb;
  rank_of constant jsonb := '{"missing": 0, "conflict": 0, "claim": 1, "reading": 2, "established": 3}';
BEGIN
  IF p_doc IS NULL OR p_fold IS NULL OR jsonb_typeof(p_fold) <> 'object' OR jsonb_typeof(p_doc) <> 'object' THEN
    RETURN p_doc;
  END IF;
  SELECT count(*) INTO vis_n
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_doc->'sources') = 'array' THEN p_doc->'sources' ELSE '[]'::jsonb END) s
   WHERE s->>'class' IS DISTINCT FROM 'record';
  priv := coalesce((p_fold->>'n')::int, 0) - vis_n;
  IF priv <= 0 THEN RETURN p_doc; END IF;        -- the caller sees every witness the fold counted (or the fold is stale)
  fs := p_fold->>'status';
  pub := coalesce((p_fold->>'publishable')::boolean, false);
  has_val := coalesce(p_doc->>'status', 'missing') <> 'missing';
  vis_norm := coalesce(p_doc->>'normalized', p_doc->>'value');
  d := p_doc || jsonb_build_object('private_witnesses', priv);
  -- The rule row decides whether the fold may raise the caller's grade; until then it keeps or lowers it.
  IF NOT coalesce((p_fold->>'may_raise')::boolean, false)
     AND coalesce((rank_of->>fs)::int, 0) > coalesce((rank_of->>coalesce(p_doc->>'status', 'missing'))::int, 0) THEN
    RETURN d;
  END IF;
  IF NOT has_val THEN
    d := d || jsonb_build_object('status', fs,
                                 'value', CASE WHEN pub AND fs <> 'conflict' THEN p_fold->'value' END,
                                 'normalized', CASE WHEN pub AND fs <> 'conflict' THEN p_fold->'normalized' END,
                                 'value_private', NOT pub);
  ELSIF NOT pub THEN
    RETURN d;                                    -- a grade beside a visible value would tell the private value
  ELSIF p_doc->>'status' = 'conflict' THEN
    RETURN d;
  ELSIF fs = 'conflict' THEN
    d := d || jsonb_build_object('status', 'conflict', 'value', NULL, 'normalized', NULL, 'stated', NULL,
                                 'sides', jsonb_build_array(jsonb_build_object('value', p_doc->'value',
                                   'normalized', p_doc->'normalized', 'sources', p_doc->'sources', 'witnesses', vis_n)));
  ELSIF (p_fold->>'normalized') IS NOT DISTINCT FROM vis_norm THEN
    d := d || jsonb_build_object('status', fs);
  ELSE
    RETURN p_doc;                                -- the values differ: the fold is stale; the caller's grade stands
  END IF;
  IF d->>'status' = 'established' THEN
    d := d || jsonb_build_object('basis', p_fold->'basis', 'needed', NULL);
  ELSE
    d := d || jsonb_build_object('basis', NULL);
  END IF;
  RETURN d;
END $$;

-- Queue slice one at the lowest fold priority, behind the set-grade backfill and the fold's own backlog.
CREATE OR REPLACE FUNCTION public.vehicle_facet_grades_enqueue(p_limit integer DEFAULT 500)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  cfg jsonb; cur uuid; last uuid; n int := 0; cap int; pend int; k text := public.vehicle_facet_grades_logic_key();
BEGIN
  SELECT config_value INTO cfg FROM public.platform_config WHERE config_key = 'vehicle_facet_grades_seed' FOR UPDATE;
  IF coalesce((cfg->>'done')::boolean, false) THEN RETURN jsonb_build_object('done', true); END IF;
  IF to_regclass('cron.job') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'data-set-grades-backfill') THEN
      RETURN jsonb_build_object('waiting', 'data-set-grades-backfill');
    END IF;
  END IF;
  cap := coalesce((public.model_fold_config()->>'sweep_pending_cap')::int, 1000);
  SELECT count(*) INTO pend FROM public.model_fold_work WHERE state = 'pending';
  IF pend >= cap THEN RETURN jsonb_build_object('waiting', 'model_fold_work', 'pending', pend, 'cap', cap); END IF;
  cur := coalesce((cfg->>'cursor')::uuid, '00000000-0000-0000-0000-000000000000');
  CREATE TEMP TABLE IF NOT EXISTS _vfg_seed (vehicle_id uuid PRIMARY KEY) ON COMMIT DROP;
  TRUNCATE _vfg_seed;
  INSERT INTO _vfg_seed
  SELECT DISTINCT e.vehicle_id FROM public.vehicle_field_evidence e
   WHERE e.vehicle_id > cur ORDER BY e.vehicle_id LIMIT greatest(1, least(coalesce(p_limit, 500), cap - pend, 2000));
  SELECT s.vehicle_id INTO last FROM _vfg_seed s ORDER BY s.vehicle_id DESC LIMIT 1;
  INSERT INTO public.model_fold_work AS w (vehicle_id, priority, reasons, first_dirty_at, dirty_at, next_attempt_at)
  SELECT s.vehicle_id, 9, '{facet_grades}', now(), now(), now()
  FROM _vfg_seed s JOIN public.vehicles v ON v.id = s.vehicle_id AND v.is_public IS TRUE AND v.deleted_at IS NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.vehicle_facet_grade_folds f
                     WHERE f.vehicle_id = s.vehicle_id AND f.logic_key = k AND f.error IS NULL)
  ON CONFLICT (vehicle_id) DO UPDATE SET
    reasons = CASE WHEN w.state IN ('done', 'dead') THEN excluded.reasons
                   ELSE (SELECT array_agg(DISTINCT x ORDER BY x) FROM unnest(w.reasons || excluded.reasons) x) END,
    priority = CASE WHEN w.state IN ('done', 'dead') THEN 9 ELSE w.priority END,
    first_dirty_at = CASE WHEN w.state IN ('done', 'dead') THEN now() ELSE w.first_dirty_at END,
    dirty_at = CASE WHEN w.state IN ('done', 'dead') THEN now() ELSE w.dirty_at END,
    state = CASE WHEN w.state = 'leased' THEN w.state ELSE 'pending' END,
    attempts = CASE WHEN w.state = 'dead' THEN 0 ELSE w.attempts END,
    next_attempt_at = CASE WHEN w.state IN ('done', 'dead') THEN now() ELSE w.next_attempt_at END,
    updated_at = now();
  GET DIAGNOSTICS n = ROW_COUNT;
  cfg := jsonb_build_object('cursor', coalesce(last, cur), 'done', last IS NULL,
                            'queued_total', coalesce((cfg->>'queued_total')::int, 0) + n,
                            'last_run', jsonb_build_object('at', now(), 'queued', n, 'pending_before', pend));
  INSERT INTO public.platform_config (config_key, config_value, description, updated_at)
  VALUES ('vehicle_facet_grades_seed', cfg,
          'Cursor of vehicle_facet_grades_enqueue (20261125064500): slice one of the facet grade fold, by vehicle_field_evidence vehicle id.', now())
  ON CONFLICT (config_key) DO UPDATE SET config_value = excluded.config_value, updated_at = now();
  IF last IS NULL AND to_regclass('cron.job') IS NOT NULL THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'vehicle-facet-grades-seed';
  END IF;
  RETURN cfg;
END $$;

-- How far the fold has got, measured: folds a day, newest, errors, rows.
CREATE OR REPLACE FUNCTION public.vehicle_facet_grades_gauge()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp SET statement_timeout = '8s' AS $$
  SELECT jsonb_build_object(
    'logic_key', public.vehicle_facet_grades_logic_key(),
    'folded_vehicles', (SELECT count(*) FROM public.vehicle_facet_grade_folds),
    'current', (SELECT count(*) FROM public.vehicle_facet_grade_folds f
                 WHERE f.logic_key = public.vehicle_facet_grades_logic_key() AND f.error IS NULL),
    'errors', (SELECT count(*) FROM public.vehicle_facet_grade_folds WHERE error IS NOT NULL),
    'folds_24h', (SELECT count(*) FROM public.vehicle_facet_grade_folds WHERE folded_at > now() - interval '24 hours'),
    'newest', (SELECT max(folded_at) FROM public.vehicle_facet_grade_folds),
    'ms_p50_24h', (SELECT percentile_disc(0.5) WITHIN GROUP (ORDER BY ms) FROM public.vehicle_facet_grade_folds
                    WHERE folded_at > now() - interval '24 hours'),
    'with_unregistered_items', (SELECT count(*) FROM public.vehicle_facet_grade_folds WHERE cardinality(unregistered) > 0),
    'grade_rows_est', (SELECT greatest(c.reltuples, 0)::bigint FROM pg_class c WHERE c.oid = 'public.vehicle_facet_grades'::regclass),
    'seed', (SELECT config_value FROM public.platform_config WHERE config_key = 'vehicle_facet_grades_seed'),
    'counted_at', now())
$$;

REVOKE ALL ON FUNCTION public.vehicle_facet_grades_fold(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.vehicle_facet_grades_enqueue(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.vehicle_facet_grades_in_scope(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vehicle_facet_grades_fold(uuid), public.vehicle_facet_grades_enqueue(integer),
  public.vehicle_facet_grades_in_scope(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.vehicle_facet_grades_read(uuid), public.vehicle_facet_grade_overlay(jsonb, jsonb),
  public.vehicle_facet_grades_logic_key(), public.vehicle_facet_grades_gauge() TO anon, authenticated, service_role;

-- 3b. A private source of a car changed: its fold row stops being read, and the car is queued to fold again -----------
CREATE OR REPLACE FUNCTION public.vehicle_facet_grades_evidence_changed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_ids uuid[];
BEGIN
  IF tg_op = 'INSERT' THEN
    SELECT array_agg(DISTINCT n.vehicle_id) INTO v_ids FROM new_rows n WHERE n.vehicle_id IS NOT NULL;
  ELSIF tg_op = 'DELETE' THEN
    SELECT array_agg(DISTINCT o.vehicle_id) INTO v_ids FROM old_rows o WHERE o.vehicle_id IS NOT NULL;
  ELSE
    SELECT array_agg(DISTINCT x) INTO v_ids
      FROM (SELECT o.vehicle_id AS x FROM old_rows o UNION SELECT n.vehicle_id FROM new_rows n) z WHERE x IS NOT NULL;
  END IF;
  IF v_ids IS NULL THEN RETURN NULL; END IF;
  UPDATE public.vehicle_facet_grade_folds SET evidence_changed_at = clock_timestamp() WHERE vehicle_id = ANY (v_ids);
  BEGIN
    IF public.model_fold_signals_on() THEN
      INSERT INTO public.model_fold_signal (vehicle_id, reason)
      SELECT v.id, 'vehicle_field_evidence_' || lower(tg_op) FROM public.vehicles v WHERE v.id = ANY (v_ids);
    END IF;
  EXCEPTION WHEN others THEN
    RAISE WARNING 'facet grade refold signal skipped: %', sqlerrm;
  END;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.vehicle_facet_grades_evidence_changed() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS vehicle_facet_grades_changed_ins ON public.vehicle_field_evidence;
DROP TRIGGER IF EXISTS vehicle_facet_grades_changed_upd ON public.vehicle_field_evidence;
DROP TRIGGER IF EXISTS vehicle_facet_grades_changed_del ON public.vehicle_field_evidence;
CREATE TRIGGER vehicle_facet_grades_changed_ins AFTER INSERT ON public.vehicle_field_evidence
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.vehicle_facet_grades_evidence_changed();
CREATE TRIGGER vehicle_facet_grades_changed_upd AFTER UPDATE ON public.vehicle_field_evidence
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.vehicle_facet_grades_evidence_changed();
CREATE TRIGGER vehicle_facet_grades_changed_del AFTER DELETE ON public.vehicle_field_evidence
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.vehicle_facet_grades_evidence_changed();

-- 4. The reader lays the fold over each item ---------------------------------------------------------------------------
DO $patch$
DECLARE
  d text;
  a1 text := E'everything AS (\n  SELECT d.dim, d.ord, e.doc\n  FROM (SELECT key, doc FROM item UNION ALL SELECT key, doc FROM derived_items UNION ALL SELECT key, doc FROM loc_docs WHERE p_dimension IS DISTINCT FROM ''masthead'') e\n  JOIN defs d ON d.key = e.key\n),\n';
  r1 text := E'everything_raw AS (\n  SELECT d.dim, d.ord, e.doc\n  FROM (SELECT key, doc FROM item UNION ALL SELECT key, doc FROM derived_items UNION ALL SELECT key, doc FROM loc_docs WHERE p_dimension IS DISTINCT FROM ''masthead'') e\n  JOIN defs d ON d.key = e.key\n),\n'
    || E'-- facet_grades_fold_v1: the grade over every witness (vehicle_facet_grades, folded by vehicle_facet_grades_fold), laid\n'
    || E'-- over each item; the caller''s sources stay as its row policies return them and the rest are counted.\n'
    || E'fg AS MATERIALIZED (SELECT public.vehicle_facet_grades_read(v.id) AS m FROM v),\n'
    || E'everything AS (\n  SELECT e.dim, e.ord, public.vehicle_facet_grade_overlay(e.doc, (SELECT fg.m FROM fg)->(e.doc->>''key'')) AS doc\n'
    || E'  FROM everything_raw e\n),\n-- facet_grades_fold_v1_end\n';
  n int;
BEGIN
  d := pg_get_functiondef('public.vehicle_facet_items(uuid,text)'::regprocedure);
  IF position('facet_grades_fold_v1' IN d) > 0 THEN RETURN; END IF;
  n := (length(d) - length(replace(d, a1, ''))) / length(a1);
  IF n <> 1 THEN RAISE EXCEPTION 'vehicle_facet_items everything anchor drifted: % matches', n; END IF;
  EXECUTE replace(d, a1, r1);
END $patch$;

-- 5. The vehicle fold folds the facet grades of a car in scope ---------------------------------------------------------
DO $patch$
DECLARE
  d text;
  a1 text := E'  perform public.data_set_grade_vehicle(p_vehicle);\n';
  r1 text := E'  perform public.data_set_grade_vehicle(p_vehicle);\n'
    || E'  -- facet_grades_fold_v1: the viewer-independent facet grades of a car in scope (a failure lands in its folds row)\n'
    || E'  if public.vehicle_facet_grades_in_scope(p_vehicle) then\n'
    || E'    perform public.vehicle_facet_grades_fold(p_vehicle);\n'
    || E'  end if;\n'
    || E'  -- facet_grades_fold_v1_end\n';
  n int;
BEGIN
  d := pg_get_functiondef('public.model_fold_one(uuid,uuid,jsonb,uuid[])'::regprocedure);
  IF position('facet_grades_fold_v1' IN d) > 0 THEN RETURN; END IF;
  n := (length(d) - length(replace(d, a1, ''))) / length(a1);
  IF n <> 1 THEN RAISE EXCEPTION 'model_fold_one anchor drifted: % matches', n; END IF;
  EXECUTE replace(d, a1, r1);
END $patch$;

-- 6. The seed job ------------------------------------------------------------------------------------------------------
DO $cron$
BEGIN
  IF to_regclass('cron.job') IS NULL THEN RETURN; END IF;
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'vehicle-facet-grades-seed';
  PERFORM cron.schedule('vehicle-facet-grades-seed', '3-58/5 * * * *',
    $cmd$SET client_min_messages = error; SET statement_timeout = '30s'; SET lock_timeout = '5s'; SELECT public.vehicle_facet_grades_enqueue(500);$cmd$);
END $cron$;
