-- C25 + C26 (docs/ledger/theory/data-machine-cases.md): the vein ledger, opened with its first veins.
--
-- WHY: on 2026-10-01 the owner asked of one Facebook listing (1996 LX450, VIN JT6HJ88J8T0149733, 224k mi, no
-- catalytic converters, $9,000 OBO, Las Vegas) "to what condition do I bring it to lock in a profit". Answering took
-- an agent 100k+ tokens of re-scraping and hand-scoring 32 BaT listings, and every number it produced lived only in
-- its scratchpad. The case ledger names the missing organ: a vein ledger, "a table, not a document: one row per vein
-- with hypothesis, query, sample size, numbers, verdict, as-of" (C25). This migration is that table, written the
-- Turing way: the hypotheses and their pass rules are registered BEFORE the run that grades them, every run is an
-- appended row, and a better idea is a new version, never an edit.
--
-- MEASURED before (2026-10-01, read-only):
--   condition observations on 1996-97 LX450 lots sold on BaT since 2020: 1 vehicle of 61 (ai-description-extraction,
--     stopped 2026-04-13). vehicles.quality_grade = 5.5 on 14 of 33 recent lots and 5.6 on 3 (a default, not a measure);
--     vehicles.condition_rating on 2 of 33; bat listing observations carry 16 characters of content_text.
--   Dry run of vein_lx450_condition_stats() over the 32 hand-scored lots (scores inline, rubric lx450_condition_v0),
--   log(price) residual against a mileage fit (n 32, R2 0.36), Welch t:
--     records +0.327 (x1.39) t 2.14 | lockers +0.224 (x1.25) t 1.57 | engine_major_work +0.229 (x1.26) t 1.13
--     paint_poor -0.307 (x0.74) t -1.84 | interior_damaged -0.250 (x0.78) t -1.74 | title_flag -0.288 (x0.75) t -2.43
--   Those numbers are the DISCOVERY sample: the hypotheses below were written after seeing them, so they cannot
--   confirm themselves. The verdict that counts is the CONFIRMATION sample (lots sold 2019-01-01 to 2023-12-31, not
--   yet scored) and every lot that closes after registration (LIVE).
--
-- CHANGE:
--   vein_ledger (append-only): one row per vein version. vein_runs (append-only): one row per vein per run.
--   vein_lx450_condition_stats(rubric, since, until): read-only test over vehicle_observations (kind condition,
--     structured_data.rubric) joined to sold auction_events.
--   run_vein_lx450_condition(sample): grades every active vein of the family against its registered rule and
--     appends to vein_runs. service_role only.
--   Seeds V001-V006 (condition effects) and V007 (the six-blank prediction for the subject truck).
--   Rubric: docs/ledger/theory/veins/lx450_condition_v0.md.
--
-- EXPECTED after: 7 rows in vein_ledger; 0 in vein_runs until the condition observations land through
--   ingest-observation (source bat, kind condition, rubric lx450_condition_v0) and the runner is called.

SET statement_timeout = '60s';
SET lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS public.vein_ledger (
  vein_id       text        NOT NULL,
  version       integer     NOT NULL DEFAULT 1,
  family        text        NOT NULL,
  hypothesis    text        NOT NULL,
  intent        text        NOT NULL,
  population    text        NOT NULL,
  outcome       text        NOT NULL,
  test          text        NOT NULL,
  pass_rule     text        NOT NULL,
  baseline      text        NOT NULL,
  parameters    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  case_ref      text,
  status        text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  supersedes_version integer,
  registered_at timestamptz NOT NULL DEFAULT now(),
  registered_by text        NOT NULL,
  PRIMARY KEY (vein_id, version)
);

COMMENT ON TABLE public.vein_ledger IS
  'C25 vein ledger. One row per version of a pre-registered hypothesis (a vein): what is claimed, about which population, graded by which rule against which baseline. Append-only: a better idea is a new version with supersedes_version, never an edit. Runs land in vein_runs. Theory: docs/ledger/theory/data-machine-cases.md §1, §5, §7.';
COMMENT ON COLUMN public.vein_ledger.vein_id IS 'Stable id of the vein (V001...). Grain: vein_id + version is one registered hypothesis.';
COMMENT ON COLUMN public.vein_ledger.version IS 'Version of the hypothesis; a changed test, rule or population is a new version.';
COMMENT ON COLUMN public.vein_ledger.family IS 'The test function family that grades this vein (e.g. lx450_condition).';
COMMENT ON COLUMN public.vein_ledger.hypothesis IS 'The claim, in one sentence, written before the grading run.';
COMMENT ON COLUMN public.vein_ledger.intent IS 'The owner question the vein serves.';
COMMENT ON COLUMN public.vein_ledger.population IS 'Population P: which lots or vehicles the claim is about.';
COMMENT ON COLUMN public.vein_ledger.outcome IS 'Outcome Y and its form (e.g. log hammer price residual against a mileage fit).';
COMMENT ON COLUMN public.vein_ledger.test IS 'The function and arguments that compute the evidence.';
COMMENT ON COLUMN public.vein_ledger.pass_rule IS 'Scoring rule S: when the run says pass, refuted or inconclusive. Fixed at registration.';
COMMENT ON COLUMN public.vein_ledger.baseline IS 'Baseline B the vein must beat.';
COMMENT ON COLUMN public.vein_ledger.parameters IS 'Machine-readable test parameters: feature, expected sign, t threshold, minimum n per group, sample windows, rubric.';
COMMENT ON COLUMN public.vein_ledger.case_ref IS 'Case in data-machine-cases.md the vein serves.';
COMMENT ON COLUMN public.vein_ledger.status IS 'active or retired. Retirement is a new version with status retired.';
COMMENT ON COLUMN public.vein_ledger.supersedes_version IS 'The earlier version of this vein_id this row replaces, if any.';
COMMENT ON COLUMN public.vein_ledger.registered_at IS 'Ingest time: when the hypothesis was registered. Runs before this time cannot grade it.';
COMMENT ON COLUMN public.vein_ledger.registered_by IS 'Who registered it (owner, agent session).';

CREATE TABLE IF NOT EXISTS public.vein_runs (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  vein_id     text        NOT NULL,
  version     integer     NOT NULL,
  sample      text        NOT NULL CHECK (sample IN ('discovery', 'confirmation', 'live')),
  window_from date        NOT NULL,
  window_to   date        NOT NULL,
  n           integer     NOT NULL,
  n_with      integer,
  n_without   integer,
  effect      numeric,
  multiplier  numeric,
  welch_t     numeric,
  verdict     text        NOT NULL CHECK (verdict IN ('pass', 'refuted', 'inconclusive')),
  counts      boolean     NOT NULL,
  result      jsonb       NOT NULL,
  ran_at      timestamptz NOT NULL DEFAULT now(),
  ran_by      text        NOT NULL DEFAULT current_user,
  FOREIGN KEY (vein_id, version) REFERENCES public.vein_ledger (vein_id, version)
);
CREATE INDEX IF NOT EXISTS vein_runs_vein_idx ON public.vein_runs (vein_id, version, ran_at DESC);

COMMENT ON TABLE public.vein_runs IS
  'C25 vein runs. One row per vein version per grading run: the sample, the evidence and the verdict under the rule registered in vein_ledger. Append-only. Written only by run_vein_<family>() (pipeline_registry).';
COMMENT ON COLUMN public.vein_runs.vein_id IS 'Key to vein_ledger.';
COMMENT ON COLUMN public.vein_runs.version IS 'Key to vein_ledger: the hypothesis version graded.';
COMMENT ON COLUMN public.vein_runs.sample IS 'discovery (the data the hypothesis was written from; never counts), confirmation (held-out past), live (lots closed after registration).';
COMMENT ON COLUMN public.vein_runs.window_from IS 'Event time: first auction end date in the sample (inclusive).';
COMMENT ON COLUMN public.vein_runs.window_to IS 'Event time: last auction end date in the sample (exclusive).';
COMMENT ON COLUMN public.vein_runs.n IS 'Lots in the sample with a condition observation under the vein rubric.';
COMMENT ON COLUMN public.vein_runs.n_with IS 'Lots where the feature is present.';
COMMENT ON COLUMN public.vein_runs.n_without IS 'Lots where the feature is absent.';
COMMENT ON COLUMN public.vein_runs.effect IS 'Mean log-price residual with the feature minus without (residual against a mileage fit on the same sample).';
COMMENT ON COLUMN public.vein_runs.multiplier IS 'exp(effect): the price multiple the feature carries, mileage held.';
COMMENT ON COLUMN public.vein_runs.welch_t IS 'Welch t statistic of the effect.';
COMMENT ON COLUMN public.vein_runs.verdict IS 'pass / refuted / inconclusive under the registered pass_rule.';
COMMENT ON COLUMN public.vein_runs.counts IS 'True when the run can grade the vein: a confirmation or live sample. Discovery runs are recorded and never count.';
COMMENT ON COLUMN public.vein_runs.result IS 'Full evidence: fit slope, intercept, R2 and the per-group means and variances.';
COMMENT ON COLUMN public.vein_runs.ran_at IS 'Ingest time of the run.';
COMMENT ON COLUMN public.vein_runs.ran_by IS 'Database role or caller that ran it.';

CREATE OR REPLACE FUNCTION public.vein_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $fn$
BEGIN
  RAISE EXCEPTION '% is append-only: register a new version or append a new run', TG_TABLE_NAME;
END;
$fn$;

DROP TRIGGER IF EXISTS vein_ledger_append_only ON public.vein_ledger;
CREATE TRIGGER vein_ledger_append_only BEFORE UPDATE OR DELETE ON public.vein_ledger
  FOR EACH ROW EXECUTE FUNCTION public.vein_append_only();
DROP TRIGGER IF EXISTS vein_runs_append_only ON public.vein_runs;
CREATE TRIGGER vein_runs_append_only BEFORE UPDATE OR DELETE ON public.vein_runs
  FOR EACH ROW EXECUTE FUNCTION public.vein_append_only();

ALTER TABLE public.vein_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vein_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vein_ledger_read ON public.vein_ledger;
CREATE POLICY vein_ledger_read ON public.vein_ledger FOR SELECT USING (true);
DROP POLICY IF EXISTS vein_runs_read ON public.vein_runs;
CREATE POLICY vein_runs_read ON public.vein_runs FOR SELECT USING (true);
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.vein_ledger, public.vein_runs FROM anon, authenticated;
GRANT SELECT ON public.vein_ledger, public.vein_runs TO anon, authenticated;

-- The test. Read-only. Population: 1996-97 Lexus LX450 lots sold at auction in [p_since, p_until), latest sale per
-- vehicle, joined to the latest non-superseded condition observation under p_rubric for the same listing URL. Outcome: log hammer
-- residual against a mileage fit on the same sample; per feature, the mean residual with minus without and Welch t.
CREATE OR REPLACE FUNCTION public.vein_lx450_condition_stats(p_rubric text, p_since date, p_until date)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $fn$
  WITH lots AS (
    SELECT DISTINCT ON (ae.vehicle_id) ae.vehicle_id, v.mileage::float8 AS m,
           coalesce(ae.winning_bid, ae.high_bid)::float8 AS p, rtrim(ae.source_url, '/') AS url
    FROM auction_events ae
    JOIN vehicles v ON v.id = ae.vehicle_id
    WHERE v.make ILIKE 'lexus' AND v.model ILIKE 'LX%450%' AND v.year BETWEEN 1996 AND 1997
      AND ae.outcome = 'sold' AND ae.auction_end_date >= p_since AND ae.auction_end_date < p_until
      AND v.mileage > 0 AND coalesce(ae.winning_bid, ae.high_bid) > 0
    ORDER BY ae.vehicle_id, ae.auction_end_date DESC
  ), cond AS (
    -- Condition is a property of the lot as listed, so the score must come from the same listing as the sale.
    SELECT DISTINCT ON (o.vehicle_id, rtrim(o.source_url, '/')) o.vehicle_id, rtrim(o.source_url, '/') AS url,
           o.structured_data AS sd
    FROM vehicle_observations o
    WHERE o.kind = 'condition' AND o.vehicle_id IN (SELECT vehicle_id FROM lots)
      AND o.structured_data ->> 'rubric' = p_rubric AND coalesce(o.is_superseded, false) = false
    ORDER BY o.vehicle_id, rtrim(o.source_url, '/'), o.ingested_at DESC
  ), j AS (
    SELECT l.*, c.sd FROM lots l JOIN cond c USING (vehicle_id, url)
  ), fit AS (
    SELECT regr_slope(ln(p), m) AS b, regr_intercept(ln(p), m) AS a, regr_r2(ln(p), m) AS r2, count(*) AS n FROM j
  ), r AS (
    SELECT j.sd, ln(j.p) - (fit.a + fit.b * j.m) AS res FROM j, fit
  ), feat AS (
              SELECT 'records' AS f,            (sd ->> 'records')::int = 1           AS x, res FROM r
    UNION ALL SELECT 'lockers',                 (sd ->> 'lockers')::int = 1,                res FROM r
    UNION ALL SELECT 'engine_major_work',       (sd ->> 'engine_major_work')::int = 1,      res FROM r
    UNION ALL SELECT 'paint_poor',              (sd ->> 'paint')::int = 0,                  res FROM r
    UNION ALL SELECT 'interior_damaged',        (sd ->> 'interior')::int = 0,               res FROM r
    UNION ALL SELECT 'title_flag',              (sd ->> 'title_flag') IS NOT NULL,          res FROM r
  ), st AS (
    SELECT f,
           count(*) FILTER (WHERE x) AS n1, count(*) FILTER (WHERE NOT x) AS n0,
           avg(res) FILTER (WHERE x) AS m1, avg(res) FILTER (WHERE NOT x) AS m0,
           var_samp(res) FILTER (WHERE x) AS v1, var_samp(res) FILTER (WHERE NOT x) AS v0
    FROM feat GROUP BY f
  )
  SELECT jsonb_build_object(
    'rubric', p_rubric, 'since', p_since, 'until', p_until,
    'n', (SELECT n FROM fit), 'slope_per_mile', (SELECT b FROM fit), 'intercept', (SELECT a FROM fit),
    'r2', (SELECT r2 FROM fit),
    'features', coalesce((SELECT jsonb_object_agg(f, jsonb_build_object(
        'n_with', n1, 'n_without', n0, 'mean_with', m1, 'mean_without', m0, 'var_with', v1, 'var_without', v0,
        'effect', m1 - m0,
        'welch_t', CASE WHEN n1 > 1 AND n0 > 1 AND (v1 / n1 + v0 / n0) > 0
                        THEN (m1 - m0) / sqrt(v1 / n1 + v0 / n0) END)) FROM st), '{}'::jsonb));
$fn$;

COMMENT ON FUNCTION public.vein_lx450_condition_stats(text, date, date) IS
  'C26 test for veins of family lx450_condition. Read-only evidence: mileage fit and per-feature log-price residual effects with Welch t over sold 1996-97 LX450 lots in [p_since, p_until) that carry a condition observation under p_rubric.';

-- The runner: grades every active vein of family lx450_condition on one sample and appends the verdicts.
CREATE OR REPLACE FUNCTION public.run_vein_lx450_condition(p_sample text)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  v record;
  w_from date;
  w_to date;
  ev jsonb;
  fe jsonb;
  n1 integer; n0 integer; eff numeric; t numeric;
  sgn integer; tmin numeric; nmin integer;
  verdict text;
  out jsonb := '[]'::jsonb;
BEGIN
  IF p_sample NOT IN ('discovery', 'confirmation', 'live') THEN
    RAISE EXCEPTION 'sample must be discovery, confirmation or live';
  END IF;
  FOR v IN
    SELECT DISTINCT ON (vein_id) * FROM vein_ledger
    WHERE family = 'lx450_condition' AND parameters ? 'feature'
    ORDER BY vein_id, version DESC
  LOOP
    CONTINUE WHEN v.status <> 'active';
    w_from := (v.parameters -> 'samples' -> p_sample ->> 'from')::date;
    w_to := coalesce((v.parameters -> 'samples' -> p_sample ->> 'to')::date, current_date + 1);
    CONTINUE WHEN w_from IS NULL;
    ev := vein_lx450_condition_stats(v.parameters ->> 'rubric', w_from, w_to);
    IF coalesce((ev ->> 'n')::int, 0) = 0 THEN
      -- Nothing scored in this window yet: no evidence, so no run row.
      out := out || jsonb_build_object('vein', v.vein_id, 'version', v.version, 'n', 0, 'skipped', 'no scored lots');
      CONTINUE;
    END IF;
    fe := ev -> 'features' -> (v.parameters ->> 'feature');
    n1 := coalesce((fe ->> 'n_with')::int, 0);
    n0 := coalesce((fe ->> 'n_without')::int, 0);
    eff := (fe ->> 'effect')::numeric;
    t := (fe ->> 'welch_t')::numeric;
    sgn := (v.parameters ->> 'expected_sign')::int;
    tmin := (v.parameters ->> 't_min')::numeric;
    nmin := (v.parameters ->> 'n_min_per_group')::int;
    verdict := CASE
      WHEN n1 < nmin OR n0 < nmin OR t IS NULL THEN 'inconclusive'
      WHEN sign(t) = sgn AND abs(t) >= tmin THEN 'pass'
      WHEN sign(t) = -sgn AND abs(t) >= tmin THEN 'refuted'
      ELSE 'inconclusive' END;
    INSERT INTO vein_runs (vein_id, version, sample, window_from, window_to, n, n_with, n_without, effect,
                           multiplier, welch_t, verdict, counts, result)
    VALUES (v.vein_id, v.version, p_sample, w_from, w_to, coalesce((ev ->> 'n')::int, 0), n1, n0, eff,
            CASE WHEN eff IS NOT NULL THEN exp(eff) END, t, verdict, p_sample <> 'discovery', ev);
    out := out || jsonb_build_object('vein', v.vein_id, 'version', v.version, 'n', (ev ->> 'n')::int,
                                     'effect', eff, 'welch_t', t, 'verdict', verdict);
  END LOOP;
  RETURN jsonb_build_object('sample', p_sample, 'runs', out);
END;
$fn$;

COMMENT ON FUNCTION public.run_vein_lx450_condition(text) IS
  'C26 runner: grades every active lx450_condition vein on one sample (discovery / confirmation / live) under its registered rule and appends one vein_runs row each. The only writer of vein_runs for this family.';

REVOKE ALL ON FUNCTION public.vein_lx450_condition_stats(text, date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.run_vein_lx450_condition(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.vein_append_only() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vein_lx450_condition_stats(text, date, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.run_vein_lx450_condition(text) TO service_role;

INSERT INTO public.pipeline_registry (table_name, column_name, owned_by, description, do_not_write_directly, write_via)
SELECT 'vein_runs', NULL, 'run_vein_lx450_condition',
       'C25/C26 vein runs: appended by the family runner under the rule registered in vein_ledger; never written by hand.',
       true, 'select run_vein_lx450_condition(''confirmation'')'
WHERE NOT EXISTS (SELECT 1 FROM public.pipeline_registry WHERE table_name = 'vein_runs');

-- The registered veins. Common to V001-V006: population and outcome as in the test; rubric lx450_condition_v0;
-- pass when the Welch t has the expected sign and |t| >= 2 with at least 5 lots on each side; refuted when the sign
-- is opposite with |t| >= 2; otherwise inconclusive. Discovery = 2024-01-01..2026-10-02 (the 32 lots the hypotheses
-- were read from; recorded, never counts). Confirmation = 2019-01-01..2024-01-01 (held out, not yet scored).
-- Live = lots that close from 2026-10-02 on.
INSERT INTO public.vein_ledger (vein_id, version, family, hypothesis, intent, population, outcome, test, pass_rule,
                                baseline, parameters, case_ref, registered_by)
SELECT x.vein_id, 1, 'lx450_condition', x.hypothesis,
  'Owner, 2026-10-01: to what condition must a 224k-mile LX450 bought at $9,000 be brought to lock in a profit.',
  '1996-97 Lexus LX450 lots sold at auction (BaT, Cars & Bids), latest sale per vehicle, with a condition observation under rubric lx450_condition_v0.',
  'log hammer price residual against a log-linear mileage fit on the same sample; effect = mean residual with the feature minus without.',
  'vein_lx450_condition_stats(''lx450_condition_v0'', from, to) via run_vein_lx450_condition(sample)',
  'pass: Welch t has the expected sign and |t| >= 2, n >= 5 on each side. refuted: opposite sign, |t| >= 2. Otherwise inconclusive. Only confirmation and live runs count.',
  'Mileage alone (effect 0): the cohort mileage fit, R2 0.36 on the discovery sample.',
  jsonb_build_object('feature', x.feature, 'expected_sign', x.sgn, 't_min', 2, 'n_min_per_group', 5,
    'rubric', 'lx450_condition_v0',
    'samples', jsonb_build_object(
      'discovery', jsonb_build_object('from', '2024-01-01', 'to', '2026-10-02'),
      'confirmation', jsonb_build_object('from', '2019-01-01', 'to', '2024-01-01'),
      'live', jsonb_build_object('from', '2026-10-02')),
    'discovery_dry_run', x.dry),
  'C26', 'claude-code session_017xZW2umaiq6bSXNU7Q4D7Z for the owner'
FROM (VALUES
  ('V001', 'records', 1, 'Lots sold with service records or receipts bring more than lots without, mileage held.',
     '{"n_with":10,"n_without":22,"effect":0.327,"welch_t":2.14}'::jsonb),
  ('V002', 'lockers', 1, 'Lots with front and rear locking differentials bring more than lots without, mileage held.',
     '{"n_with":13,"n_without":19,"effect":0.224,"welch_t":1.57}'::jsonb),
  ('V003', 'engine_major_work', 1, 'Lots with documented major engine work (head gasket, rings or bearings, rebuild, replacement) bring more, mileage held.',
     '{"n_with":8,"n_without":24,"effect":0.229,"welch_t":1.13}'::jsonb),
  ('V004', 'paint_poor', -1, 'Lots with significant paint failure (failing clear coat, fading, bubbling, multiple dents) bring less, mileage held.',
     '{"n_with":5,"n_without":27,"effect":-0.307,"welch_t":-1.84}'::jsonb),
  ('V005', 'interior_damaged', -1, 'Lots with a damaged interior (tears, cracked dash, broken parts) bring less, mileage held.',
     '{"n_with":8,"n_without":24,"effect":-0.250,"welch_t":-1.74}'::jsonb),
  ('V006', 'title_flag', -1, 'Lots with a title or history flag (salvage or rebuilt, not actual mileage, rollback, flood county, exempt) bring less, mileage held.',
     '{"n_with":5,"n_without":27,"effect":-0.288,"welch_t":-2.43}'::jsonb)
) AS x(vein_id, feature, sgn, hypothesis, dry)
WHERE NOT EXISTS (SELECT 1 FROM public.vein_ledger l WHERE l.vein_id = x.vein_id);

-- V007: the six-blank prediction for the subject truck. Graded by hand when (if) it sells; no runner.
INSERT INTO public.vein_ledger (vein_id, version, family, hypothesis, intent, population, outcome, test, pass_rule,
                                baseline, parameters, case_ref, registered_by)
SELECT 'V007', 1, 'lx450_condition_prediction',
  'If VIN JT6HJ88J8T0149733 (1996 LX450, 224k mi, no lockers, clean NV title) is brought to plan B (catalytic converters, hood and roof refinish, documented service, reupholstered interior) and sold at a timed online auction, it brings a median $22,068 with an 80% range $14,043-$34,681.',
  'Owner, 2026-10-01: to what condition must it be brought to lock in a profit (plan B, about $17.5k all-in by the agent''s cost estimate, which is not data).',
  'One vehicle: VIN JT6HJ88J8T0149733.',
  'Hammer price, as a median and an 80% interval.',
  'Hand-fit OLS on the 31 discovery lots (log price ~ miles + paint + lockers + title flag + engine work + records + accident + interior; one 92k-mile $67,500 outlier dropped; leave-one-out median absolute error 23%). To be replaced by a runner once V001-V006 confirm.',
  'Graded at its sale: absolute percent error of the median, and whether the hammer falls inside the 80% interval. Fails if outside the interval.',
  'Mileage-only cohort expectation at 224k miles: $16,328.',
  jsonb_build_object('vin', 'JT6HJ88J8T0149733', 'as_of', '2026-10-01', 'plan', 'B',
    'median', 22068, 'p10', 14043, 'p90', 34681, 'baseline', 16328,
    'source_listing', 'facebook marketplace item 935545179170402, $9,300 then $9,000 OBO'),
  'C26', 'claude-code session_017xZW2umaiq6bSXNU7Q4D7Z for the owner'
WHERE NOT EXISTS (SELECT 1 FROM public.vein_ledger l WHERE l.vein_id = 'V007');
