-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_grade_closed -f this-file.sql
-- Contract for 20261109010000_grade_closed_hammer_predictions.sql. Synthetic rows only; never production.
-- The grader itself has its own contract (test_grade_hammer_predictions_by_lot.sql); here a stand-in with its signature
-- keys every unkeyed row in the blocks it is handed and logs each call, so the test sees which blocks the hourly run
-- hands it:
--   * only unkeyed model 31/32/33 rows from the last 30 days whose recorded close has passed, not another house's;
--   * blocks within 16 of each other go in one call, farther ones in another, and no call spans more than 200 blocks;
--     newest closes first; every target row is inside a block range it was handed;
--   * the time budget stops further calls and counts what is left; the budget is bounded;
--   * service_role executes it, anon and authenticated do not; no cron schema, no schedule.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
     OR current_setting('server_version_num')::int / 10000 <> 17
     OR to_regclass('public.hammer_predictions') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 dm_refinement_* database';
  END IF;
END $$;
SET statement_timeout = '60s';
SET lock_timeout = '3s';
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;

CREATE TABLE public.hammer_predictions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tag text, model_version integer,
  predicted_at timestamptz, hours_remaining numeric, notes text, auction_event_id uuid, lot_outcome text, pad text);
-- One row per heap page: the padding stays inline and fills the page.
ALTER TABLE public.hammer_predictions ALTER COLUMN pad SET STORAGE PLAIN;

-- The stand-in grader: the live signature, the live block arithmetic, a log of its calls.
CREATE TABLE public.grader_calls (n serial, p_batch integer, from_block bigint, blocks bigint);
CREATE FUNCTION public.grade_hammer_predictions_by_lot(p_batch integer DEFAULT 1000, p_from_block bigint DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_rpp numeric; v_blocks bigint; v_n bigint;
BEGIN
  SELECT CASE WHEN relpages > 0 AND reltuples > 0 THEN reltuples::numeric / relpages ELSE 20 END INTO v_rpp
    FROM pg_class WHERE oid = 'public.hammer_predictions'::regclass;
  v_blocks := greatest(1, ceil(p_batch / greatest(v_rpp, 1)))::bigint;
  INSERT INTO public.grader_calls (p_batch, from_block, blocks) VALUES (p_batch, p_from_block, v_blocks);
  PERFORM pg_sleep(coalesce(nullif(current_setting('test.grader_sleep', true), ''), '0')::numeric);
  UPDATE public.hammer_predictions SET auction_event_id = gen_random_uuid(), lot_outcome = 'sold'
  WHERE ctid >= format('(%s,0)', p_from_block)::tid AND ctid < format('(%s,0)', p_from_block + v_blocks)::tid
    AND auction_event_id IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('graded', v_n, 'held', 0, 'written', v_n, 'lots', v_n, 'blocks_scanned', v_blocks);
END $$;

-- Rows in heap order, one per block. Targets: t-* ; never targets: x-*.
INSERT INTO public.hammer_predictions (tag, model_version, predicted_at, hours_remaining, notes, auction_event_id, pad)
SELECT r.tag, r.mv, now() - r.ago, r.hr, r.notes, r.ae, repeat('x', 7000)
FROM (VALUES
  (1,  't-old-close',   33, interval '3 days', 24.0, NULL,                       NULL::uuid),  -- block 0, closed 2 days ago
  (2,  'x-open',        33, interval '1 hour', 10.0, NULL,                       NULL),        -- closes later
  (3,  'x-house',       32, interval '3 days', 24.0, '{"house":"pcarmarket"}',   NULL),        -- another house
  (4,  'x-model-24',    24, interval '3 days', 24.0, NULL,                       NULL),
  (5,  'x-40-days',     32, interval '40 days', 24.0, NULL,                      NULL),
  (6,  'x-keyed',       33, interval '3 days', 24.0, NULL,  'a0000000-0000-0000-0000-00000000000a'),
  (7,  'x-no-hours',    33, interval '3 days', NULL,  NULL,                      NULL)
) r(ord, tag, mv, ago, hr, notes, ae) ORDER BY r.ord;
-- Blocks 7..26: filler that is never a target.
INSERT INTO public.hammer_predictions (tag, model_version, predicted_at, hours_remaining, pad)
SELECT 'x-filler', 24, now() - interval '3 days', 1, repeat('x', 7000) FROM generate_series(1, 20);
-- Block 27 and block 30 (three blocks apart, one range): newer closes. Block 28-29 filler.
INSERT INTO public.hammer_predictions (tag, model_version, predicted_at, hours_remaining, notes, pad) VALUES
  ('t-new-31', 31, now() - interval '2 hours', 1.0, 'not json', repeat('x', 7000)),
  ('x-filler', 24, now() - interval '2 hours', 1.0, NULL, repeat('x', 7000)),
  ('x-filler', 24, now() - interval '2 hours', 1.0, NULL, repeat('x', 7000)),
  ('t-new-32', 32, now() - interval '3 hours', 1.0, '{"grade":"A"}', repeat('x', 7000));
ANALYZE public.hammer_predictions;

SELECT pg_temp.ok('fixture: one row per block',
  (SELECT count(DISTINCT (ctid::text::point)[0]) FROM public.hammer_predictions) = (SELECT count(*) FROM public.hammer_predictions));

\ir ../migrations/20261109010000_grade_closed_hammer_predictions.sql

SET statement_timeout = '55s';
CREATE TEMP TABLE run1 AS SELECT public.grade_closed_hammer_predictions(40000) AS j;

SELECT pg_temp.ok('three target rows, two ranges, two calls, nothing left',
  (SELECT (j->>'target_rows')::int = 3 AND (j->>'ranges')::int = 2 AND (j->>'calls')::int = 2 AND (j->>'ranges_left')::int = 0 FROM run1));
SELECT pg_temp.ok('every target keyed', NOT EXISTS (SELECT FROM public.hammer_predictions WHERE tag LIKE 't-%' AND auction_event_id IS NULL));
SELECT pg_temp.ok('no other row handed to the grader but the filler inside a range',
  NOT EXISTS (SELECT FROM public.hammer_predictions WHERE tag LIKE 'x-%' AND tag <> 'x-filler' AND tag <> 'x-keyed' AND auction_event_id IS NOT NULL));
SELECT pg_temp.ok('newest closes first: the 27..30 range, as one call of four blocks, then block 0 alone',
  (SELECT array_agg(from_block::text || '+' || blocks ORDER BY n) FROM public.grader_calls) = ARRAY['27+4', '0+1']);
SELECT pg_temp.ok('the counts add up the calls',
  (SELECT (j->>'written')::int = 5 AND (j->>'blocks_scanned')::int = 5 FROM run1));

-- Nothing left: the next run calls nothing.
CREATE TEMP TABLE run2 AS SELECT public.grade_closed_hammer_predictions(40000) AS j;
SELECT pg_temp.ok('a second run finds nothing to do', (SELECT (j->>'calls')::int = 0 AND (j->>'target_rows')::int = 0 FROM run2));

-- The budget: a grader call slower than the budget leaves the second range to the next run.
-- Two new targets 21 blocks apart, at the end of the heap (an UPDATE would move rows, so new rows are inserted).
INSERT INTO public.hammer_predictions (tag, model_version, predicted_at, hours_remaining, pad)
SELECT CASE g WHEN 1 THEN 't-budget-older' WHEN 22 THEN 't-budget-newer' ELSE 'x-filler' END,
       CASE WHEN g IN (1, 22) THEN 33 ELSE 24 END, now() - interval '3 days' + g * interval '1 hour', 1, repeat('x', 7000)
FROM generate_series(1, 22) g ORDER BY g;
TRUNCATE public.grader_calls;
SET test.grader_sleep = '1.1';
CREATE TEMP TABLE run3 AS SELECT public.grade_closed_hammer_predictions(1000) AS j;
RESET test.grader_sleep;
SELECT pg_temp.ok('budget spent after the first call: one range left for the next run',
  (SELECT (j->>'calls')::int = 1 AND (j->>'ranges_left')::int = 1 FROM run3)
  AND EXISTS (SELECT FROM public.hammer_predictions WHERE tag = 't-budget-older' AND auction_event_id IS NULL)
  AND NOT EXISTS (SELECT FROM public.hammer_predictions WHERE tag = 't-budget-newer' AND auction_event_id IS NULL));

-- The span: targets every 10 blocks over 450 blocks are one gap-group, cut into calls of at most 200 blocks.
CREATE TEMP TABLE span_start AS SELECT max((ctid::text::point)[0])::bigint + 1 AS blk FROM public.hammer_predictions;
INSERT INTO public.hammer_predictions (tag, model_version, predicted_at, hours_remaining, pad)
SELECT CASE WHEN g % 10 = 0 THEN 't-span' ELSE 'x-filler' END, CASE WHEN g % 10 = 0 THEN 33 ELSE 24 END,
       now() - interval '3 days', 1, repeat('x', 7000)
FROM generate_series(0, 450) g ORDER BY g;
TRUNCATE public.grader_calls;
CREATE TEMP TABLE run4 AS SELECT public.grade_closed_hammer_predictions(40000) AS j;
SELECT pg_temp.ok('a long run of targets is cut into calls of at most 200 blocks, all keyed',
  (SELECT count(*) FROM public.grader_calls, span_start WHERE from_block >= span_start.blk) = 3
  AND (SELECT max(blocks) FROM public.grader_calls) <= 200
  AND NOT EXISTS (SELECT FROM public.hammer_predictions WHERE tag LIKE 't-%' AND auction_event_id IS NULL));

DO $$ BEGIN
  PERFORM public.grade_closed_hammer_predictions(100);
  RAISE EXCEPTION 'Contract failed: a budget under 1 s was accepted';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM LIKE 'Contract failed%' THEN RAISE; END IF;
  RAISE NOTICE 'PASS budget bounded';
END $$;

SELECT pg_temp.ok('service_role only, definer, pinned path',
  has_function_privilege('service_role', 'public.grade_closed_hammer_predictions(integer)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.grade_closed_hammer_predictions(integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.grade_closed_hammer_predictions(integer)', 'EXECUTE')
  AND (SELECT prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp'] FROM pg_proc
       WHERE oid = 'public.grade_closed_hammer_predictions(integer)'::regprocedure));
